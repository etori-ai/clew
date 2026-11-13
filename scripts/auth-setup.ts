/** Run inside the app container. Admin credentials come from env or piped Docker env JSON; never printed. */
import { randomBytes } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';
import { and, eq, isNull } from 'drizzle-orm';
import { database, closeDatabase } from '@clew/db';
import { ABSOLUTE_MS, IDLE_MS, people, provisioners, identityBindings, removeExpiredSignIns } from '@clew/db/auth';
import { insertConnector, readConnector } from '@clew/db/connectors';
import { writeAudit } from '@clew/db/threads';
import { randomToken, sealSecret, tokenDigest } from '../apps/server/src/auth-crypto';
import { scimRoutes } from '../apps/server/src/routes/scim';
import { scim } from '../apps/server/src/composition/people';
import { scimClient } from './provisioner/client';
import { developmentScope, developmentDirectory, fullName } from './provisioner/directory';
import { push } from './provisioner/push';
const realm = 'clew',
  issuer = 'http://keycloak.orb.local:8090/realms/' + realm;
const base = process.env.KEYCLOAK_ADMIN_URL ?? 'http://host.docker.internal:8090';
const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3020';
let credentials = { ...process.env };
if (!process.stdin.isTTY && !credentials.KEYCLOAK_ADMIN_PASSWORD) {
  const values: unknown = JSON.parse(await Bun.stdin.text());
  if (!Array.isArray(values) || !values.every(v => typeof v === 'string'))
    throw new Error('Expected environment array');
  credentials = {
    ...Object.fromEntries(values.map(v => [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)])),
    ...credentials,
  };
}
const username = credentials.KC_BOOTSTRAP_ADMIN_USERNAME ?? credentials.KEYCLOAK_ADMIN;
const password = credentials.KC_BOOTSTRAP_ADMIN_PASSWORD ?? credentials.KEYCLOAK_ADMIN_PASSWORD;
if (!username || !password) throw new Error('Supply Keycloak administrator credentials securely');
const tokenResponse = await fetch(base + '/realms/master/protocol/openid-connect/token', {
  method: 'POST',
  body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username, password }),
});
if (!tokenResponse.ok) throw new Error('Keycloak administrator authentication failed');
const token = ((await tokenResponse.json()) as { access_token: string }).access_token;
async function admin(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(base + '/admin/' + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok && response.status !== 404) throw new Error(`Keycloak setup failed (${response.status})`);
  return response;
}
async function objects(path: string): Promise<Array<Record<string, unknown>>> {
  return (await admin(path)).json();
}
const root = 'realms/' + realm;
if ((await admin(root)).status === 404)
  await admin('realms', 'POST', {
    realm,
    enabled: true,
    registrationAllowed: false,
    resetPasswordAllowed: false,
    internationalizationEnabled: true,
    supportedLocales: ['sv', 'en'],
    defaultLocale: 'sv',
    accessTokenLifespan: 60,
    bruteForceProtected: true,
    permanentLockout: false,
  });
await admin(root, 'PUT', { ssoSessionIdleTimeout: IDLE_MS / 1000, ssoSessionMaxLifespan: ABSOLUTE_MS / 1000 });
// Only this dedicated realm is modified. Never delete users or reset an existing password.
const localFile = 'apps/server/.env.local',
  testFile = '.auth-test.env';
async function envFile(path: string) {
  if (!(await Bun.file(path).exists())) return {};
  return Object.fromEntries(
    (await Bun.file(path).text()).split('\n').flatMap(line => {
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (!match) return [];
      return [[match[1]!, match[2]!.replace(/^(['"])(.*)\1$/, '$2')]];
    }),
  );
}
async function writeSettings(path: string, settings: Record<string, string>) {
  const original = (await Bun.file(path).exists()) ? await Bun.file(path).text() : '';
  const remaining = new Set(Object.keys(settings));
  const lines = original
    .split('\n')
    .filter((line, index, array) => line !== '' || index < array.length - 1)
    .map(line => {
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(line),
        key = match?.[1];
      if (!key || !(key in settings)) return line;
      remaining.delete(key);
      return key + '=' + settings[key];
    });
  for (const key of remaining) lines.push(key + '=' + settings[key]);
  const temporary = path + '.' + randomBytes(8).toString('hex') + '.tmp';
  await writeFile(temporary, lines.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}
const existing = await envFile(localFile),
  previousTest = await envFile(testFile);
async function client(id: string, origins: string[], backchannel: string) {
  const list = await objects(root + '/clients?clientId=' + id);
  const found = list.find(c => c.clientId === id);
  const settings = {
    clientId: id,
    protocol: 'openid-connect',
    enabled: true,
    publicClient: false,
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    // The development sign-in (D6) asks for a persona's tokens with its test password. This realm is development only.
    directAccessGrantsEnabled: true,
    serviceAccountsEnabled: false,
    redirectUris: origins.map(o => o + '/api/auth/callback'),
    webOrigins: [],
    attributes: {
      ...(found?.attributes as Record<string, string> | undefined),
      'pkce.code.challenge.method': 'S256',
      'post.logout.redirect.uris': origins.map(o => o + '/login').join('##'),
      'backchannel.logout.url': backchannel,
      'backchannel.logout.session.required': 'true',
      'backchannel.logout.revoke.offline.tokens': 'true',
    },
  };
  if (found) await admin(root + '/clients/' + found.id, 'PUT', { ...found, ...settings });
  else await admin(root + '/clients', 'POST', settings);
  const current = (await objects(root + '/clients?clientId=' + id)).find(c => c.clientId === id)!;
  const secret = (await (await admin(root + '/clients/' + current.id + '/client-secret')).json()) as { value: string };
  return secret.value;
}
const clientSecret = await client(
  'clew-web',
  [publicUrl],
  'http://host.docker.internal:3020/api/auth/backchannel-logout',
);
/**
 * Delegation (D26): clew-web may trade the person's token for one bound to a connector's audience (standard token exchange,
 * RFC 8693, Keycloak 26.2). Each audience is a client of its own that nothing logs in as, plus a client scope carrying the
 * audience mapper, optional on clew-web and requested as `scope=<audience>-audience` in the exchange.
 */
async function enableTokenExchange(id: string) {
  const found = (await objects(root + '/clients?clientId=' + id)).find(c => c.clientId === id)!;
  await admin(root + '/clients/' + found.id, 'PUT', {
    ...found,
    attributes: { ...(found.attributes as Record<string, string>), 'standard.token.exchange.enabled': 'true' },
  });
}
async function audienceClient(audience: string) {
  if (!(await objects(root + '/clients?clientId=' + audience)).some(c => c.clientId === audience))
    await admin(root + '/clients', 'POST', {
      clientId: audience,
      protocol: 'openid-connect',
      enabled: true,
      publicClient: false,
      standardFlowEnabled: false,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      redirectUris: [],
      webOrigins: [],
      attributes: {},
    });
  const scopeName = audience + '-audience';
  if (!(await objects(root + '/client-scopes')).some(s => s.name === scopeName))
    await admin(root + '/client-scopes', 'POST', {
      name: scopeName,
      protocol: 'openid-connect',
      attributes: { 'include.in.token.scope': 'true', 'display.on.consent.screen': 'false' },
      protocolMappers: [
        {
          name: audience,
          protocol: 'openid-connect',
          protocolMapper: 'oidc-audience-mapper',
          consentRequired: false,
          config: {
            'included.client.audience': audience,
            'access.token.claim': 'true',
            'id.token.claim': 'false',
            'introspection.token.claim': 'true',
          },
        },
      ],
    });
  const scope = (await objects(root + '/client-scopes')).find(s => s.name === scopeName)!,
    web = (await objects(root + '/clients?clientId=clew-web')).find(c => c.clientId === 'clew-web')!;
  await admin(root + '/clients/' + web.id + '/optional-client-scopes/' + scope.id, 'PUT');
}
await enableTokenExchange('clew-web');
await audienceClient('eneo');
// The SupportManagement connector acts as the person too (D89); its fixture reads this audience.
await audienceClient('supportmanagement');
// Nextcloud's Approval app (D101) is called as the person too: the development Nextcloud's user_oidc provider has this
// client id, accepts a bearer token whose `aud` holds it, and maps `preferred_username` to the existing account
// (`sh scripts/calendar.sh seed`).
await audienceClient('nextcloud');
const testPasswords: Record<string, string> = {};
try {
  // The development directory (scripts/provisioner/directory.ts) is the one list of people. This bootstrap gives each
  // persona (`login`) a Keycloak account and a person row with the id the stack's fixtures and calendars key on; the
  // synthetic provisioner below pushes everything else (the other people, names, addresses, units, roles, groups,
  // capabilities) through SCIM, and the first login binds the Keycloak subject to the person by `preferred_username`
  // (D68 item 6), so no binding is written here.
  for (const person of developmentDirectory.people.filter(p => p.login)) {
    const id = person.userName,
      key = 'TEST_' + id.toUpperCase() + '_PASSWORD';
    let user = (await objects(root + '/users?exact=true&username=' + id)).find(u => u.username === id);
    let secret = previousTest[key];
    if (!user) {
      secret = randomBytes(18).toString('base64url');
      await admin(root + '/users', 'POST', {
        username: id,
        firstName: person.givenName,
        lastName: person.familyName,
        email: person.email,
        emailVerified: true,
        enabled: true,
        requiredActions: [],
        credentials: [{ type: 'password', value: secret, temporary: false }],
      });
      user = (await objects(root + '/users?exact=true&username=' + id)).find(u => u.username === id);
    }
    if (!user || typeof user.id !== 'string') throw new Error('Unable to bind synthetic account');
    if (secret) testPasswords[key] = secret;
    await database().transaction(async tx => {
      await tx
        .insert(people)
        .values({
          id,
          organisationId: 'poc',
          name: fullName(person),
          externalId: person.externalId,
          userName: person.userName,
          email: person.email,
        })
        .onConflictDoUpdate({
          target: people.id,
          set: { externalId: person.externalId, userName: person.userName, email: person.email },
        });
      // A binding that names another Keycloak account than today's is a changed subject: refuse, as a login would (D68 item 6).
      const [binding] = await tx
        .select()
        .from(identityBindings)
        .where(and(eq(identityBindings.issuer, issuer), eq(identityBindings.personId, id)));
      if (binding && binding.subject !== user.id) throw new Error('Subject changed: explicit identity review required');
    });
  }
  // The development provisioner (D68): one token, kept in the ignored test file and reused while its digest is still live.
  let provisionerToken = previousTest.DEV_PROVISIONER_TOKEN;
  const [live] = provisionerToken
    ? await database()
        .select({ id: provisioners.id })
        .from(provisioners)
        .where(
          and(
            eq(provisioners.id, 'dev'),
            eq(provisioners.tokenDigest, tokenDigest(provisionerToken)),
            isNull(provisioners.revokedAt),
          ),
        )
    : [];
  if (!live) {
    provisionerToken = randomToken();
    await database().transaction(async tx => {
      await tx
        .insert(provisioners)
        .values({
          id: 'dev',
          organisationId: 'poc',
          label: 'Development directory',
          tokenDigest: tokenDigest(provisionerToken!),
          createdBy: 'bootstrap:auth',
        })
        .onConflictDoUpdate({
          target: provisioners.id,
          set: { tokenDigest: tokenDigest(provisionerToken!), revokedAt: null, createdBy: 'bootstrap:auth' },
        });
      await writeAudit(tx, {
        actor: 'bootstrap:auth',
        action: 'provisioner.added',
        subject: 'provisioner:dev',
        details: { organisationId: 'poc' },
      });
    });
  }
  testPasswords.DEV_PROVISIONER_TOKEN = provisionerToken!;
  // Push the directory through the SCIM server in-process: the same routes `bun run dev:provision` reaches over HTTP.
  const inProcess = scimRoutes(scim, console.error);
  const pushed = await push(
    scimClient('http://clew.local', provisionerToken!, (input, init) => inProcess.request(input, init)),
    developmentDirectory,
    developmentScope,
  );
  if (pushed.refused.length || pushed.groupsRefused.length)
    throw new Error(
      'The development directory was not written whole: ' +
        [
          ...pushed.refused.map(r => `${r.userName} (${r.detail})`),
          ...pushed.groupsRefused.map(r => `${r.externalId} (${r.detail})`),
        ].join('; '),
    );
  console.log(
    `Development directory pushed through SCIM: ${pushed.created} users created, ${pushed.replaced} replaced, ${pushed.deactivated} deactivated; ${pushed.groupsCreated} groups created, ${pushed.groupsReplaced} replaced, ${pushed.groupsRemoved} removed.`,
  );
  const master = existing.MASTER_KEY ?? randomBytes(32).toString('base64');
  // The hello connector (connectors/hello) as a draft row (D23): enable it with `bun scripts/connector-add.ts hello --enable` once it runs on :4010.
  process.env.MASTER_KEY = master;
  const helloSecret = previousTest.HELLO_CONNECTOR_SECRET ?? randomBytes(18).toString('base64url');
  testPasswords.HELLO_CONNECTOR_SECRET = helloSecret;
  if (!(await readConnector('hello')))
    await database().transaction(async tx => {
      await insertConnector(tx, {
        id: 'hello',
        url: 'http://127.0.0.1:4010',
        secret: sealSecret(helloSecret, 'connector:secret:hello'),
        createdBy: 'bootstrap:auth',
      });
      await writeAudit(tx, {
        actor: 'bootstrap:auth',
        action: 'connector.added',
        subject: 'connector:hello',
        details: { url: 'http://127.0.0.1:4010', draft: true },
      });
    });
  const settings = {
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: 'clew-web',
    OIDC_CLIENT_SECRET: clientSecret,
    PUBLIC_URL: publicUrl,
    // Other front ends on their own origins (D67 item 6): Clew has one front end since D88, so only an operator's own
    // list is kept.
    ...(existing.FRONTEND_ORIGINS ? { FRONTEND_ORIGINS: existing.FRONTEND_ORIGINS } : {}),
    MASTER_KEY: master,
    AUTH_LOCAL_HTTP: 'true',
  };
  // The development sign-in (D6): one click per persona on the sign-in page. Set AUTH_DEV_LOGIN=false to keep the form.
  const devAccounts = developmentDirectory.people
    .filter(p => p.login && testPasswords['TEST_' + p.userName.toUpperCase() + '_PASSWORD'])
    .map(p => p.userName + ':' + testPasswords['TEST_' + p.userName.toUpperCase() + '_PASSWORD']);
  await writeSettings(localFile, {
    ...settings,
    AUTH_DEV_LOGIN: existing.AUTH_DEV_LOGIN ?? 'true',
    AUTH_DEV_ACCOUNTS: devAccounts.join(','),
  });
  await writeSettings(testFile, { ...settings, ...testPasswords });
  // The server's nightly clean-up (D120), run once now so a development database starts without expired sign-in data.
  await removeExpiredSignIns(new Date());
  console.log(
    'Keycloak realm, client and accounts are ready; each account binds to its person at first login. Secrets written to ignored, owner-only files.',
  );
} finally {
  await closeDatabase();
}
