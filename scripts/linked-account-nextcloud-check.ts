/**
 * The outside test of linked accounts (D147 items 14 and 15): the Approval connector of D101 acting with an account a
 * person links at Nextcloud's own OAuth 2 server, against the development stack's real Nextcloud, without a browser.
 * The same loop the connector runs with the identity provider's token, so the two ways are compared on one product
 * that was not written for Clew. Runs inside the app container, against the database DATABASE_URL names, which must
 * have the linked-account tables, with the calendar profile's Nextcloud running:
 *
 *   # once, on the host: a client in Nextcloud. It prints the client's id and secret.
 *   docker exec -u www-data -w /var/www/html clew-calendar-1 php occ oauth2:add-client --output=json \
 *     "Clew linked accounts (development)" http://localhost:3020/api/linked-accounts/callback
 *   # the first run takes the id as an argument and the secret on standard input; later runs take neither
 *   docker exec -i -w /workspace clew-app-1 bun scripts/linked-account-nextcloud-check.ts --client-id <id>
 *   docker exec -w /workspace clew-app-1 bun scripts/linked-account-nextcloud-check.ts [--decide]
 *
 * This server is the old kind on purpose (Nextcloud 35): it publishes no metadata, checks no PKCE, registers no client
 * and has no revocation endpoint. So what is approved is entered, not discovered: the authorize address as a browser
 * reaches Nextcloud, the token address as the server reaches it, and the client with its secret.
 *
 * What it does, with the server's own composition:
 *
 * 1. starts the Approval connector in its linked mode, on a port of its own, with this database's keys served to it;
 * 2. registers it and approves the entered server;
 * 3. links two people: each signs in at Nextcloud's own sign-in page with the account the calendar seed gave them, and
 *    grants access on Nextcloud's own page;
 * 4. reads what waits for each of them, and scans, with no session;
 * 5. makes a stored token look due and checks that Clew refreshes it and keeps the rotated refresh token;
 * 6. with `--decide`, approves one waiting file and reads the decision back (the seed's own `reset` undoes it:
 *    `docker exec -u www-data clew-calendar-1 php /opt/clew-calendar/approval-seed.php reset`);
 * 7. unlinks one person, and checks whether the token lives on at Nextcloud, which has nowhere to revoke it;
 * 8. takes the other's token away at Nextcloud and expects the link lost with its audit row, then links again.
 *
 * It never prints a token, a secret or a password. It leaves the connector's row and the approval in place and removes
 * the links it made; `--clean` removes the row too. It refuses to run when `nextcloud-approval` is registered at
 * another address than the one it starts.
 */
import { resolve } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import type { AuthenticatedContext } from '@clew/contracts';
import { CapabilityError, audiencedActorOf, type ThreadDraft } from '@clew/connectors';
import { closeDatabase, database, schema } from '@clew/db';
import { deleteConnector, readConnector } from '@clew/db/connectors';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server', '.env' + '.local'));
} catch {
  /* settings may come from the environment */
}
const { linkedAccounts, LINK_REDIRECT_PATH } = await import('../apps/server/src/composition/linked-accounts');
const { registry } = await import('../apps/server/src/connectors/registry');
const { refreshConnectors } = await import('../apps/server/src/composition');
const { signingAuthority } = await import('../apps/server/src/connectors/signing');
const { postgresLinkStore } = await import('../apps/server/src/modules/linked-accounts/adapters/postgres');
const { openSecret, sealSecret } = await import('../apps/server/src/auth-crypto');
const { registerConnector } = await import('./connector-registry');

const CONNECTOR = 'nextcloud-approval';
/** Nextcloud as the server and this script reach it, and as a person's browser does. */
const INTERNAL = (process.env.CALENDAR_URL ?? 'http://calendar').replace(/\/$/, '');
const PUBLIC = (process.env.NEXTCLOUD_PUBLIC_URL ?? 'http://localhost:3021').replace(/\/$/, '');
const PORT = Number(process.env.LINKED_CHECK_PORT ?? 4077);
const KEYS_PORT = PORT + 1;
const url = `http://127.0.0.1:${PORT}`;
const secret = 'linked-account-check-transport-key';
const redirect = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '') + LINK_REDIRECT_PATH;
const store = postgresLinkStore({ seal: sealSecret, open: openSecret });
const option = (name: string) => {
  const at = process.argv.indexOf('--' + name);
  return at > 0 ? process.argv[at + 1] : undefined;
};

const done: string[] = [];
const problems: string[] = [];
const ok = (text: string) => {
  done.push(text);
  console.log('ok    ' + text);
};
const note = (text: string) => console.log('note  ' + text);
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
type Rows = { rows: Array<{ ref: string; file: string }> };
type Result = { headline: string; rows: Array<{ ref: string; outcome: string; detail: string }> };

/** A value of Nextcloud's page state: what its own script reads to draw the page. */
function pageState<T>(html: string, name: string): T | undefined {
  const value = new RegExp(`id="initial-state-${name}"[^>]*value="([^"]*)"`).exec(html)?.[1];
  return value ? (JSON.parse(Buffer.from(value, 'base64').toString()) as T) : undefined;
}
const requestToken = (html: string) => /data-requesttoken="([^"]+)"/.exec(html)?.[1] ?? '';
/**
 * A person at Nextcloud's own pages (its login flow, which its OAuth authorize address leads to): the sign-in form
 * with the account's own password, then the page that asks whether the client may have access. Returns the address
 * Nextcloud sends the browser back to at Clew. Every address a browser would ask at `PUBLIC` is asked at `INTERNAL`.
 */
async function atNextcloud(start: string, account: string, password: string): Promise<string> {
  const jar = new Map<string, string>();
  const inside = (address: string) => (address.startsWith(PUBLIC) ? INTERNAL + address.slice(PUBLIC.length) : address);
  const visit = async (address: string, init: RequestInit = {}): Promise<Response | string> => {
    const response = await fetch(inside(address), {
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
    const next = new URL(response.headers.get('location')!, inside(address)).href;
    return next.startsWith(redirect) ? next : visit(next);
  };
  const form = (fields: Record<string, string>) => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: INTERNAL },
    body: new URLSearchParams(fields),
  });
  const expectPage = async (page: Response | string, what: string) => {
    if (typeof page === 'string') throw new Stop(`Nextcloud sent the person back to Clew before ${what}`);
    return page.text();
  };
  // The flow's first page, signed out: it leads to the sign-in form.
  const first = await expectPage(await visit(start), 'the sign-in page');
  const signedIn = await visit(
    INTERNAL + '/login',
    form({ user: account, password, requesttoken: requestToken(first), redirect_url: '/' }),
  );
  if (typeof signedIn === 'string') return signedIn;
  // Signed in, the same address shows who asks for access and leads to the page that grants it.
  const flow = await expectPage(await visit(start), 'the page that asks for access');
  if (!flow.includes(`data-user="${account}"`)) throw new Stop(`Nextcloud did not sign ${account} in`);
  const auth = pageState<{ loginRedirectUrl: string }>(flow, 'core-loginFlowAuth');
  if (!auth) throw new Stop("Nextcloud's page that asks for access was not the one expected");
  const grantPage = await expectPage(await visit(INTERNAL + auth.loginRedirectUrl), 'the page that grants access');
  const grant = pageState<Record<string, string | boolean>>(grantPage, 'core-loginFlowGrant');
  if (!grant) throw new Stop("Nextcloud's page that grants access was not the one expected");
  const back = await visit(
    INTERNAL + '/login/flow',
    form({
      clientIdentifier: String(grant.clientIdentifier ?? ''),
      stateToken: String(grant.stateToken ?? ''),
      requesttoken: requestToken(grantPage),
      oauthState: String(grant.oauthState ?? ''),
      providedRedirectUri: String(grant.providedRedirectUri ?? ''),
      direct: grant.direct ? '1' : '0',
    }),
  );
  if (typeof back !== 'string') throw new Stop(`Nextcloud answered ${back.status} to the grant and sent nobody back`);
  return back;
}
/** The password the calendar seed gives an account (`.devcontainer/calendar/seed.php`): development only. */
const seededPassword = (account: string) => `calendar-${account}-local-only`;
async function link(who: AuthenticatedContext) {
  const { url: start } = await linkedAccounts.begin(who, CONNECTOR, '/');
  return linkedAccounts.complete(who, await atNextcloud(start, who.id, seededPassword(who.id)));
}
const refusal = (attempt: Promise<unknown>) =>
  attempt.then(
    () => 'answered',
    error => (error instanceof CapabilityError ? String(error.code) : 'another error: ' + String(error)),
  );
const pending = (who: AuthenticatedContext) =>
  registry.run<Rows>(audiencedActorOf(who), `${CONNECTOR}.pending`, {}).then(output => output.rows);
/** Whether Nextcloud itself takes a token, asked directly: the account it answers for, or null. */
async function acceptedBy(token: string): Promise<string | null> {
  const response = await fetch(INTERNAL + '/ocs/v2.php/cloud/user?format=json', {
    headers: { authorization: 'Bearer ' + token, 'OCS-APIRequest': 'true' },
  });
  if (!response.ok) return null;
  return ((await response.json()) as { ocs?: { data?: { id?: string } } }).ocs?.data?.id ?? null;
}
/** Takes a token away at Nextcloud, as the person does when they remove a device or an app there. */
const removeAtNextcloud = (token: string) =>
  fetch(INTERNAL + '/ocs/v2.php/core/apppassword', {
    method: 'DELETE',
    headers: { authorization: 'Bearer ' + token, 'OCS-APIRequest': 'true' },
  });

async function main() {
  // 0. What must be there before anything is started.
  const status = await fetch(INTERNAL + '/status.php').catch(() => undefined);
  if (!status?.ok) throw new Stop(`Nextcloud does not answer at ${INTERNAL}. Start the calendar profile first.`);
  const version = ((await status.json()) as { versionstring?: string }).versionstring;
  if (!redirect.startsWith('http')) throw new Stop('PUBLIC_URL is not set.');
  const existing = await readConnector(CONNECTOR);
  if (existing && existing.url !== url)
    throw new Stop(
      `A connector ${CONNECTOR} is registered at ${existing.url}. The check starts its own at ${url} and replaces nobody's registration.`,
    );
  const clientId = option('client-id');
  const clientSecret = clientId ? (await Bun.stdin.text()).trim() : undefined;
  if (clientId && !clientSecret) throw new Stop('--client-id needs the client secret on standard input.');

  // 1. Clew's public keys for this database, and the connector in its linked mode.
  const authority = await signingAuthority();
  const keys = Bun.serve({
    port: KEYS_PORT,
    hostname: '127.0.0.1',
    fetch: request =>
      new URL(request.url).pathname === '/api/connectors/jwks'
        ? Response.json(authority.jwks)
        : new Response('not found', { status: 404 }),
  });
  const system = Bun.spawn(['node', 'server.mjs'], {
    cwd: resolve(import.meta.dir, '../connectors/nextcloud-approval'),
    env: {
      PATH: process.env.PATH ?? '',
      PORT: String(PORT),
      CLEW_URL: `http://127.0.0.1:${KEYS_PORT}`,
      CLEW_CONNECTOR_SECRET: secret,
      NEXTCLOUD_ADAPTER: 'nextcloud',
      NEXTCLOUD_URL: INTERNAL,
      NEXTCLOUD_ALLOW_HTTP: 'true',
      NEXTCLOUD_PUBLIC_URL: PUBLIC,
      NEXTCLOUD_ACCOUNT: 'linked',
    },
    stdout: 'ignore',
    stderr: 'inherit',
  });
  try {
    for (let waited = 0; ; waited += 200) {
      if ((await fetch(url + '/clew/manifest').catch(() => undefined))?.ok) break;
      if (waited > 10_000) throw new Stop('The Approval connector did not start.');
      await Bun.sleep(200);
    }
    ok(`Nextcloud ${version} answers, and the Approval connector is up in its linked mode`);

    // 2. Registered; the server is entered, since Nextcloud publishes nothing to discover.
    await registerConnector({ id: CONNECTOR, url, secret, enable: true });
    await refreshConnectors();
    const declared = registry.connector(CONNECTOR);
    check(
      declared?.linkedAccount?.resource === PUBLIC && !declared.delegation,
      'it is registered, declaring a linked account at Nextcloud where it declares delegation otherwise',
    );
    if (clientId)
      await linkedAccounts.approveAsOperator(CONNECTOR, {
        server: {
          issuer: PUBLIC,
          authorizationEndpoint: PUBLIC + '/index.php/apps/oauth2/authorize',
          tokenEndpoint: INTERNAL + '/index.php/apps/oauth2/api/v1/token',
        },
        client: { id: clientId, secret: clientSecret },
      });
    const approval = await linkedAccounts.approvalAsOperator(CONNECTOR);
    if (!approval?.clientId)
      throw new Stop(
        'Nothing is approved for the connector yet. Make a client in Nextcloud and give it once: --client-id <id>, with the secret on standard input (the head of this file has the two commands).',
      );
    check(
      approval.origin === 'entered' && approval.issuer === PUBLIC,
      'the addresses and the client an administrator entered are approved: nothing was discovered',
    );

    // 3. Two people link, at Nextcloud's own pages.
    for (const who of [hillevi, hassan]) {
      await linkedAccounts.unlink(who, CONNECTOR);
      const linked = await link(who);
      check(linked.linked, `${who.id} signed in and granted access at Nextcloud and returned linked`);
    }
    check(
      (await store.transaction(tx => tx.client(CONNECTOR, PUBLIC))) === null,
      'Clew registered no client: it is the one made in Nextcloud, with its secret',
    );
    const first = (await store.transaction(tx => tx.link(hillevi.id, CONNECTOR)))!;
    check(
      !!first.accessToken && !!first.refreshToken && !!first.expiresAt,
      'Nextcloud answered with an access token, a refresh token and a lifetime, though it was sent PKCE and a resource it does not know',
    );
    check(
      (await acceptedBy(first.accessToken!)) === hillevi.id,
      'and Nextcloud itself takes the token as that account',
    );

    // 4. What waits for each, with no session behind the call.
    const [hers, his] = [await pending(hillevi), await pending(hassan)];
    check(hers.length > 0 && his.length > 0, `each has files waiting: ${hers.length} and ${his.length}`);
    check(
      !hers.some(file => his.some(other => other.ref === file.ref)),
      'and no file of one is in the other’s list: Nextcloud decides what each account sees',
    );
    const scanned = await registry.scanOne(audiencedActorOf(hillevi), CONNECTOR);
    check(
      scanned.observation?.completeness === 'complete' && scanned.drafts.length === hers.length,
      `a scan with no session raised a card per waiting file (${scanned.drafts.length})`,
    );

    // 5. A token that is due: Nextcloud's lives an hour, so the stored one is made to look spent.
    await store.transaction(tx => tx.save({ ...first, expiresAt: new Date(Date.now() - 1000).toISOString() }));
    const fresh = await linkedAccounts.tokenFor(hillevi.id, CONNECTOR);
    const second = (await store.transaction(tx => tx.link(hillevi.id, CONNECTOR)))!;
    check(fresh !== first.accessToken, 'a token that is due is refreshed at Nextcloud before the call');
    check(
      !!second.refreshToken && second.refreshToken !== first.refreshToken,
      'and Nextcloud rotated the refresh token, which Clew kept',
    );
    // Not Clew's to decide, but worth knowing about the product: whether the token a refresh replaced still works.
    note(
      (await acceptedBy(first.accessToken!)) === null
        ? 'the access token the refresh replaced is no longer taken by Nextcloud'
        : 'the access token the refresh replaced is still taken by Nextcloud for now: it rotates the refresh token, and the old access token is not ended at once',
    );
    check((await pending(hillevi)).length === hers.length, 'and the list reads the same with the new one');

    // 6. A decision, only when asked: it changes what waits in the shared development Nextcloud.
    if (process.argv.includes('--decide')) {
      const draft = scanned.drafts[0] as ThreadDraft;
      const action = draft.actions.find(a => a.id === 'approve')!;
      const payload = {
        ...(action.input ?? {}),
        ...(action.usesItems ? { refs: draft.items!.filter(i => i.selected).map(i => i.ref) } : {}),
      };
      const decided = await registry.run<Result>(audiencedActorOf(hillevi), action.capability, payload, {
        operationId: 'linked-account-check-' + crypto.randomUUID(),
      });
      check(
        decided.rows.every(row => row.outcome === 'done'),
        `a file was approved in Nextcloud: ${decided.headline}`,
      );
      check(
        (await pending(hillevi)).length === hers.length - 1,
        'and read back: it no longer waits (the seed’s reset undoes it)',
      );
    } else note('no decision was made; --decide approves one waiting file in the development Nextcloud');

    // 7. A person takes their link away. Nextcloud has nowhere to revoke a token.
    const hassansToken = await linkedAccounts.tokenFor(hassan.id, CONNECTOR);
    const unlinked = await linkedAccounts.unlink(hassan, CONNECTOR);
    check(
      unlinked.unlinked && unlinked.revocation === 'not-offered',
      'unlinking removes the link and says the system could not be told',
    );
    check(
      (await refusal(registry.run(audiencedActorOf(hassan), `${CONNECTOR}.pending`, {}))) === 'authorization-required',
      'nothing is sent for the person after it',
    );
    const lingers = (await acceptedBy(hassansToken)) === hassan.id;
    note(
      lingers
        ? 'the unlinked token is still taken by Nextcloud until it expires there: the open item of D147'
        : 'the unlinked token is no longer taken by Nextcloud',
    );
    if (lingers) {
      const removed = await removeAtNextcloud(hassansToken);
      note(
        (await acceptedBy(hassansToken)) === null
          ? `it was removed with Nextcloud's own call for it (${removed.status}), which Clew does not make`
          : `Nextcloud's own call to remove it answered ${removed.status} and it is still taken`,
      );
    }

    // 8. The system takes a link away: the person removes the token in Nextcloud.
    const taken = await removeAtNextcloud(fresh);
    if ((await acceptedBy(fresh)) !== null)
      throw new Stop(
        `The token could not be removed at Nextcloud (${taken.status}), so the lost link cannot be shown.`,
      );
    check(
      (await refusal(registry.run(audiencedActorOf(hillevi), `${CONNECTOR}.pending`, {}))) === 'authorization-required',
      'after Nextcloud removed the token, the next call is answered authorization-required',
    );
    const lost = (await linkedAccounts.list(hillevi)).find(l => l.connectorId === CONNECTOR);
    check(lost?.state === 'needs-link', 'the connector told Clew, and the link reads as needing to be linked again');
    const [row] = await database()
      .select()
      .from(schema.audit)
      .where(eq(schema.audit.subject, 'linked-account:' + CONNECTOR))
      .orderBy(desc(schema.audit.id))
      .limit(1);
    check(
      row?.action === 'account.link-lost' && (row.details as { person?: string }).person === hillevi.id,
      `with its audit row (${row?.action}, reason ${(row?.details as { reason?: string } | undefined)?.reason})`,
    );
    check((await link(hillevi)).linked && (await pending(hillevi)).length > 0, 'linking again restores what waits');
  } finally {
    // The links the check made go, and with them their tokens at Nextcloud, which Clew itself cannot revoke.
    for (const who of [hillevi, hassan]) {
      const left = await store.transaction(tx => tx.link(who.id, CONNECTOR)).catch(() => null);
      if (left?.accessToken) await removeAtNextcloud(left.accessToken).catch(() => undefined);
      await linkedAccounts.unlink(who, CONNECTOR).catch(() => undefined);
    }
    if (process.argv.includes('--clean')) await database().transaction(tx => deleteConnector(tx, CONNECTOR));
    system.kill();
    await system.exited;
    await keys.stop(true);
  }
}
try {
  await main();
  if (problems.length) {
    console.error(`\nFAIL: ${problems.length} of ${problems.length + done.length} did not hold.`);
    process.exitCode = 1;
  } else console.log(`\nOK: ${done.length} checks against Nextcloud's own OAuth server at ${INTERNAL}.`);
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
// The server's composition keeps timers of its own; the check is done.
process.exit(process.exitCode ?? 0);
