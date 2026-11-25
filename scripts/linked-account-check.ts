/**
 * The linked accounts of D147, live, without a browser: the real OAuth client and the Postgres store against the
 * development stack's real Keycloak (the realm `vendor`, a system's own authorization server) and the purchasing
 * fixture connector (the system). Runs inside the app container, against the database DATABASE_URL names, which must
 * have the linked-account tables:
 *
 *   docker exec -w /workspace clew-app-1 bun scripts/vendor-realm.ts          once, as Keycloak's administrator
 *   docker exec -w /workspace clew-app-1 bun scripts/linked-account-check.ts
 *
 * What it does, as the server does it (the same composition, nothing stubbed):
 *
 * 1. starts the purchasing connector on a port of its own, with this database's signing keys served to it;
 * 2. registers it, and approves where its people are sent by discovery (RFC 9728 at the system, then the realm's
 *    metadata);
 * 3. links two people: Clew registers itself at the realm (RFC 7591), each person signs in and consents at Keycloak's
 *    own pages, driven here over HTTP, and returns with a code that is redeemed with PKCE;
 * 4. reads as each of them through the registry, with no session: they see different requests;
 * 5. scans, decides a request and reads the decision back;
 * 6. checks that the realm's one-minute access token makes every call refresh, and that the refresh token is rotated;
 * 7. unlinks one person (revoked at the realm) and ends the other's session at the realm, as a system that takes a
 *    link away: the next call loses the link with its audit row, and linking again restores it.
 *
 * It never prints a token or a password. It leaves the connector's row and Clew's registered client in place, so the
 * next run registers no new client at the realm, and removes the two links it made. `--clean` also removes the
 * connector's row with everything that hangs on it. It refuses to run when a connector `purchasing` is registered at
 * another address than the one it starts, so a developer's own registration is never replaced.
 */
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { desc, eq } from 'drizzle-orm';
import type { AuthenticatedContext } from '@clew/contracts';
import { CapabilityError, audiencedActorOf } from '@clew/connectors';
import { closeDatabase, database, schema } from '@clew/db';
import { deleteConnector, readConnector } from '@clew/db/connectors';
import { testPasswordKey } from './test-password-key';
import { TEST_PASSWORD_FILE, VENDOR_ISSUER, testPasswords } from './vendor-realm';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server', '.env' + '.local'));
} catch {
  /* settings may come from the environment */
}
const { linkedAccounts, LINK_REDIRECT_PATH } = await import('../apps/server/src/composition/linked-accounts');
const { registry } = await import('../apps/server/src/connectors/registry');
// The server's own composition: `refreshConnectors` puts every enabled row in the registry with its governance, as a
// request to the running server does before it answers.
const { refreshConnectors } = await import('../apps/server/src/composition');
const { signingAuthority } = await import('../apps/server/src/connectors/signing');
const { postgresLinkStore } = await import('../apps/server/src/modules/linked-accounts/adapters/postgres');
const { openSecret, sealSecret } = await import('../apps/server/src/auth-crypto');
const { registerConnector } = await import('./connector-registry');

const CONNECTOR = 'purchasing';
const PORT = Number(process.env.LINKED_CHECK_PORT ?? 4067);
const KEYS_PORT = PORT + 1;
const url = `http://127.0.0.1:${PORT}`;
const secret = 'linked-account-check-transport-key';
const redirect = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '') + LINK_REDIRECT_PATH;
const store = postgresLinkStore({ seal: sealSecret, open: openSecret });

const done: string[] = [];
const problems: string[] = [];
const ok = (text: string) => {
  done.push(text);
  console.log('ok    ' + text);
};
const check = (holds: boolean, text: string) =>
  holds ? ok(text) : (problems.push(text), console.log('FAIL  ' + text));
class Stop extends Error {}
const persona = (id: string, name: string, role: 'manager' | 'employee', unitId: string): AuthenticatedContext => ({
  id,
  name,
  unitId,
  unitLabel: unitId,
  role,
  userName: id,
  organisationId: 'poc',
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'check',
  sessionBinding: 'system:linked-account-check',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'check' }),
});
const hillevi = persona('hillevi', 'Hillevi Berg', 'manager', 'unit-skola');
const hassan = persona('hassan', 'Hassan Ali', 'employee', 'unit-omsorg');
type Rows = { rows: Array<{ ref: string }> };
type Result = { rows: Array<{ ref: string; outcome: string }> };

/**
 * A person at the realm's own pages: the sign-in form, then the consent page the first time, until Keycloak sends the
 * browser back to Clew. Returns that address, which the callback route would be given.
 */
async function atTheSystem(start: string, account: string, password: string): Promise<string> {
  const jar = new Map<string, string>();
  const visit = async (address: string, init: RequestInit = {}): Promise<Response | string> => {
    const response = await fetch(address, {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers ?? {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const at = pair!.indexOf('=');
      jar.set(pair!.slice(0, at), pair!.slice(at + 1));
    }
    if (![301, 302, 303, 307].includes(response.status)) return response;
    const next = new URL(response.headers.get('location')!, address).href;
    // Back at Clew: the address is the answer, and nothing is fetched there.
    return next.startsWith(redirect) ? next : visit(next);
  };
  const form = (html: string) => /<form[^>]*action="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&');
  /** What a page of Keycloak's says, for when it is not the page the check expected: its title and its message. */
  const said = (html: string) =>
    [
      /<title>([^<]*)<\/title>/,
      /id="kc-error-message"[^>]*>\s*<p[^>]*>([^<]*)</,
      /class="[^"]*alert[^"]*"[^>]*>([\s\S]{0,200}?)<\/div>/,
    ]
      .map(pattern =>
        pattern
          .exec(html)?.[1]
          ?.replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .filter(Boolean)
      .join(' · ');
  let page = await visit(start);
  for (let step = 0; step < 4 && typeof page !== 'string'; step++) {
    const html = await page.text();
    const found = form(html);
    const action = found && URL.canParse(found, page.url) ? new URL(found, page.url).href : undefined;
    if (!action || !action.includes('/login-actions/'))
      throw new Stop(
        `Keycloak answered ${page.status} at ${new URL(page.url).pathname} with no sign-in or consent form: ${said(html) || 'nothing it says'}`,
      );
    const body = action.includes('/login-actions/consent')
      ? new URLSearchParams({ accept: 'Yes' })
      : new URLSearchParams({ username: account, password, credentialId: '' });
    page = await visit(action, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  }
  if (typeof page !== 'string') throw new Stop('Keycloak never sent the person back to Clew');
  return page;
}
async function link(who: AuthenticatedContext, password: string) {
  const { url: start } = await linkedAccounts.begin(who, CONNECTOR, '/');
  return linkedAccounts.complete(who, await atTheSystem(start, who.id, password));
}
const refusal = (attempt: Promise<unknown>) =>
  attempt.then(
    () => 'answered',
    error => (error instanceof CapabilityError ? String(error.code) : 'another error: ' + String(error)),
  );
const requests = (who: AuthenticatedContext) =>
  registry.run<Rows>(audiencedActorOf(who), 'purchasing.requests', {}).then(output => output.rows.map(r => r.ref));

async function main() {
  // 0. What must be there before anything is started.
  const metadata = await fetch(VENDOR_ISSUER + '/.well-known/openid-configuration').catch(() => undefined);
  if (!metadata?.ok)
    throw new Stop(`The realm at ${VENDOR_ISSUER} does not answer. Run bun scripts/vendor-realm.ts first.`);
  const passwords = await testPasswords().catch(() => {
    throw new Stop(`No test passwords at ${TEST_PASSWORD_FILE}. Run bun scripts/auth-setup.ts first.`);
  });
  const passwordOf = (who: AuthenticatedContext) => {
    const password = passwords[testPasswordKey(who.id)];
    if (!password) throw new Stop(`No test password for ${who.id}.`);
    return password;
  };
  if (!redirect.startsWith('http')) throw new Stop('PUBLIC_URL is not set.');
  const existing = await readConnector(CONNECTOR);
  if (existing && existing.url !== url)
    throw new Stop(
      `A connector ${CONNECTOR} is registered at ${existing.url}. The check starts its own at ${url} and replaces nobody's registration.`,
    );

  // 1. Clew's public keys for this database, and the system.
  const authority = await signingAuthority();
  const keys = Bun.serve({
    port: KEYS_PORT,
    hostname: '127.0.0.1',
    fetch: request =>
      new URL(request.url).pathname === '/api/connectors/jwks'
        ? Response.json(authority.jwks)
        : new Response('not found', { status: 404 }),
  });
  const folder = await mkdtemp(resolve(tmpdir(), 'linked-account-check-'));
  const system = Bun.spawn(['node', 'server.mjs'], {
    cwd: resolve(import.meta.dir, '../connectors/purchasing'),
    env: {
      PATH: process.env.PATH ?? '',
      PORT: String(PORT),
      CLEW_URL: `http://127.0.0.1:${KEYS_PORT}`,
      CLEW_CONNECTOR_SECRET: secret,
      PURCHASING_ISSUER: VENDOR_ISSUER,
      PURCHASING_RESOURCE: url,
      FIXTURE_DB: resolve(folder, 'purchasing.sqlite'),
    },
    stdout: 'ignore',
    stderr: 'inherit',
  });
  try {
    for (let waited = 0; ; waited += 200) {
      if ((await fetch(url + '/clew/manifest').catch(() => undefined))?.ok) break;
      if (waited > 10_000) throw new Stop('The purchasing connector did not start.');
      await Bun.sleep(200);
    }
    ok('the system is up and says who issues its tokens');

    // 2. Registered, and approved by discovery.
    await registerConnector({ id: CONNECTOR, url, secret, enable: true });
    await refreshConnectors();
    check(
      !!registry.connector(CONNECTOR)?.linkedAccount,
      'it is registered, and the registry knows it declares a linked account',
    );
    const approval = await linkedAccounts.approveAsOperator(CONNECTOR);
    check(
      approval.issuer === VENDOR_ISSUER && approval.origin === 'discovered',
      `discovery from ${url} found the realm, and it is approved`,
    );

    // 3. Two people link.
    for (const who of [hillevi, hassan]) {
      await linkedAccounts.unlink(who, CONNECTOR);
      const linked = await link(who, passwordOf(who));
      check(
        linked.linked && linked.returnTo === '/',
        `${who.id} signed in and consented at the realm and returned linked`,
      );
    }
    const client = await store.transaction(tx => tx.client(CONNECTOR, VENDOR_ISSUER));
    check(!!client && client.source === 'registered', 'Clew registered itself at the realm, once');
    check(client?.secret === null, 'as a client without a secret, since the realm says it checks PKCE');

    // 4. A call as each, with no session behind it.
    const [hers, his] = [await requests(hillevi), await requests(hassan)];
    check(
      hers.length === 3 && his.length === 2,
      `the system answered for each account: ${hers.length} and ${his.length} requests`,
    );
    check(!hers.some(ref => his.includes(ref)), 'and no request of one is in the other’s list');

    // 5. A scan, a decision and its read-back.
    const scanned = await registry.scanOne(audiencedActorOf(hillevi), CONNECTOR);
    check(
      scanned.observation?.completeness === 'complete' && scanned.drafts.length === 1,
      'a scan with no session raised the card of what waits',
    );
    const operationId = 'linked-account-check-' + crypto.randomUUID();
    const decided = await registry.run<Result>(
      audiencedActorOf(hillevi),
      'purchasing.decide',
      { refs: [hers[0]!], decision: 'approve' },
      { operationId },
    );
    check(decided.rows[0]?.outcome === 'done', 'a decision was written in the system');
    const found = await registry.run<{ found: boolean }>(audiencedActorOf(hillevi), 'purchasing.lookup', {
      operationId,
    });
    check(found.found && (await requests(hillevi)).length === 2, 'and read back, with the list one shorter');

    // 6. The realm's access token lives a minute, so every call refreshes, and the refresh token is rotated.
    const before = (await store.transaction(tx => tx.link(hillevi.id, CONNECTOR)))!;
    const fresh = await linkedAccounts.tokenFor(hillevi.id, CONNECTOR);
    const after = (await store.transaction(tx => tx.link(hillevi.id, CONNECTOR)))!;
    check(fresh !== before.accessToken, 'a call a moment later carried a new access token');
    check(
      !!after.refreshToken && after.refreshToken !== before.refreshToken,
      'and the realm rotated the refresh token, which Clew kept',
    );
    const reused = await fetch(VENDOR_ISSUER + '/protocol/openid-connect/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: before.refreshToken!,
        client_id: client!.id,
      }),
    });
    check(reused.status === 400, 'the refresh token that was spent is refused by the realm');

    // 7. A link taken away at the system, and one the person takes away. The system ends the person's session there,
    // as its own administrator or the person at its own pages would: Keycloak's logout with the session's refresh
    // token. Whatever it answers (the spent token above may already have ended the session), the link must now be lost.
    await fetch(VENDOR_ISSUER + '/protocol/openid-connect/logout', {
      method: 'POST',
      body: new URLSearchParams({ client_id: client!.id, refresh_token: after.refreshToken! }),
    });
    check(
      (await refusal(registry.run(audiencedActorOf(hillevi), 'purchasing.requests', {}))) === 'authorization-required',
      'after the system ended the link, the next call is answered authorization-required',
    );
    const lost = (await linkedAccounts.list(hillevi)).find(l => l.connectorId === CONNECTOR);
    check(lost?.state === 'needs-link', 'the link reads as needing to be linked again');
    const [row1] = await database()
      .select()
      .from(schema.audit)
      .where(eq(schema.audit.subject, 'linked-account:' + CONNECTOR))
      .orderBy(desc(schema.audit.id))
      .limit(1);
    check(
      row1?.action === 'account.link-lost' && (row1.details as { person?: string }).person === hillevi.id,
      `with its audit row (${row1?.action}, reason ${(row1?.details as { reason?: string } | undefined)?.reason})`,
    );
    check(
      (await link(hillevi, passwordOf(hillevi))).linked && (await requests(hillevi)).length === 2,
      'linking again restores the list',
    );
    const unlinked = await linkedAccounts.unlink(hassan, CONNECTOR);
    check(unlinked.unlinked && unlinked.revocation === 'revoked', 'a person’s own unlinking is revoked at the realm');
    check(
      (await refusal(registry.run(audiencedActorOf(hassan), 'purchasing.requests', {}))) === 'authorization-required',
      'and nothing is sent for them after it',
    );
  } finally {
    await linkedAccounts.unlink(hillevi, CONNECTOR).catch(() => undefined);
    await linkedAccounts.unlink(hassan, CONNECTOR).catch(() => undefined);
    if (process.argv.includes('--clean')) await database().transaction(tx => deleteConnector(tx, CONNECTOR));
    system.kill();
    await system.exited;
    await keys.stop(true);
    await rm(folder, { recursive: true, force: true });
  }
}
try {
  await main();
  if (problems.length) {
    console.error(`\nFAIL: ${problems.length} of ${problems.length + done.length} did not hold.`);
    process.exitCode = 1;
  } else console.log(`\nOK: ${done.length} checks against ${VENDOR_ISSUER}.`);
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
// The server's composition keeps timers of its own; the check is done.
process.exit(process.exitCode ?? 0);
