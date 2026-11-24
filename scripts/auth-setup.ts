/**
 * Run inside the app container, against the development stack's Keycloak (the `keycloak` service of
 * `.devcontainer/compose.yaml`). Its administrator is KEYCLOAK_ADMIN with KEYCLOAK_ADMIN_PASSWORD, which the compose
 * file sets in the app container from the workstation's generated `.devcontainer/.env`; never printed. Before it changes
 * anything in Keycloak it checks that no persona is bound to another account than the one it will sign in as
 * (`auth-setup-subjects.ts`), and refuses, naming the way forward, when one is.
 */
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
import { subjectRefusal, type PersonaSubject } from './auth-setup-subjects';
import { testPasswordKey } from './test-password-key';
const realm = 'clew',
  issuer = 'http://keycloak.orb.local:8090/realms/' + realm;
// The containers of the stack reach Keycloak under the issuer's own host, the service's alias on their network.
const base = new URL(issuer).origin;
// Keycloak tells Clew when a person signs out there (back-channel logout, D121) on the same network: the app service,
// where the BFF listens on every interface. The address works with every container runtime, unlike the host's.
const backchannel = 'http://app:3000/api/auth/backchannel-logout';
const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3020';
const username = process.env.KEYCLOAK_ADMIN,
  password = process.env.KEYCLOAK_ADMIN_PASSWORD;
if (!username || !password)
  throw new Error(
    'Set KEYCLOAK_ADMIN and KEYCLOAK_ADMIN_PASSWORD (.devcontainer/compose.yaml sets them in the app container)',
  );
const tokenResponse = await fetch(base + '/realms/master/protocol/openid-connect/token', {
  method: 'POST',
  body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username, password }),
});
if (!tokenResponse.ok)
  throw new Error(
    'Keycloak refused its administrator: KEYCLOAK_ADMIN_PASSWORD (CLEW_DEV_KEYCLOAK_ADMIN_PASSWORD in .devcontainer/.env) is not the password the volume keycloak_data was first started with (docs/maintainers/local-development.md)',
  );
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
try {
  // Read first, change nothing: whether the realm exists, and each persona's person, binding and Keycloak account.
  const realmExists = (await admin(root)).status !== 404;
  const personas: Array<PersonaSubject & { person: (typeof developmentDirectory.people)[number] }> = [];
  // The development directory (scripts/provisioner/directory.ts) is the one list of people; a persona (`login`) has a
  // Keycloak account.
  for (const person of developmentDirectory.people.filter(p => p.login)) {
    // A persona's person row has its user name as its id, the id the fixtures and calendars key on. A generated person
    // given an account later (D135) was provisioned under an id of its own before, and keeps it.
    const [provisioned] = await database()
      .select({ id: people.id })
      .from(people)
      .where(eq(people.externalId, person.externalId));
    const personId = provisioned?.id ?? person.userName;
    const [binding] = await database()
      .select({ subject: identityBindings.subject })
      .from(identityBindings)
      .where(and(eq(identityBindings.issuer, issuer), eq(identityBindings.personId, personId)));
    const account = realmExists
      ? (await objects(root + '/users?exact=true&username=' + person.userName)).find(
          u => u.username === person.userName,
        )
      : undefined;
    personas.push({
      person,
      personId,
      userName: person.userName,
      bound: binding?.subject,
      account: typeof account?.id === 'string' ? account.id : undefined,
    });
  }
  // A new Keycloak gives every persona a new subject under the same issuer, which a sign-in refuses: stop before the
  // realm and clients change and leave the BFF's settings behind.
  const refusal = subjectRefusal(issuer, personas);
  if (refusal) throw new Error(refusal);
  if (!realmExists)
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
    const secret = (await (await admin(root + '/clients/' + current.id + '/client-secret')).json()) as {
      value: string;
    };
    return secret.value;
  }
  const clientSecret = await client('clew-web', [publicUrl], backchannel);
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
  // The POB connector checks the person's token for this audience itself, against this realm's keys: POB cannot take a
  // person's token, so the connector is where it is validated (connectors/pob/README.md).
  await audienceClient('pob');
  // Nextcloud's Approval app (D101) is called as the person too: the development Nextcloud's user_oidc provider has this
  // client id, accepts a bearer token whose `aud` holds it, and maps `preferred_username` to the existing account
  // (`sh scripts/calendar.sh seed`).
  await audienceClient('nextcloud');
  const testPasswords: Record<string, string> = {};
  // This bootstrap gives each persona a Keycloak account and a person row with the id the stack's fixtures and calendars
  // key on; the synthetic provisioner below pushes everything else (the other people, names, addresses, units, roles,
  // groups, capabilities) through SCIM, and the first login binds the Keycloak subject to the person by
  // `preferred_username` (D68 item 6), so no binding is written here.
  for (const { person, personId: id } of personas) {
    const key = testPasswordKey(person.userName);
    let user = (await objects(root + '/users?exact=true&username=' + person.userName)).find(
      u => u.username === person.userName,
    );
    let secret = previousTest[key];
    if (!user) {
      secret = randomBytes(18).toString('base64url');
      await admin(root + '/users', 'POST', {
        username: person.userName,
        firstName: person.givenName,
        lastName: person.familyName,
        email: person.email,
        emailVerified: true,
        enabled: true,
        requiredActions: [],
        credentials: [{ type: 'password', value: secret, temporary: false }],
      });
      user = (await objects(root + '/users?exact=true&username=' + person.userName)).find(
        u => u.username === person.userName,
      );
    }
    if (!user || typeof user.id !== 'string') throw new Error('Unable to bind synthetic account');
    const account = user.id;
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
      // Checked before anything changed; again here, in case a sign-in bound the person to another account since.
      const [binding] = await tx
        .select()
        .from(identityBindings)
        .where(and(eq(identityBindings.issuer, issuer), eq(identityBindings.personId, id)));
      const changed = subjectRefusal(issuer, [
        { personId: id, userName: person.userName, bound: binding?.subject, account },
      ]);
      if (changed) throw new Error(changed);
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
  // The hello connector (connectors/hello) as a draft row (D23) with no manifest. Once it runs on :4010, approve what it
  // serves and switch it on with `bun scripts/connector-add.ts hello http://127.0.0.1:4010 --secret <HELLO_CONNECTOR_SECRET
  // from .auth-test.env> --enable`, or read it in and approve it on Administration › Anslutna system (D144).
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
    .filter(p => p.login && testPasswords[testPasswordKey(p.userName)])
    .map(p => p.userName + ':' + testPasswords[testPasswordKey(p.userName)]);
  await writeSettings(localFile, {
    ...settings,
    AUTH_DEV_LOGIN: existing.AUTH_DEV_LOGIN ?? 'true',
    AUTH_DEV_ACCOUNTS: devAccounts.join(','),
  });
  await writeSettings(testFile, { ...settings, ...testPasswords });
  // The server's nightly clean-up (D123), run once now so a development database starts without expired sign-in data.
  await removeExpiredSignIns(new Date());
  console.log(
    'Keycloak realm, client and accounts are ready; each account binds to its person at first login. Secrets written to ignored, owner-only files.',
  );
} finally {
  await closeDatabase();
}
