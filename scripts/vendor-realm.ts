/**
 * The realm `vendor` in the development stack's Keycloak: a system's own authorization server, for the linked accounts
 * of D147 (item 14). Clew's own sign-in is the realm `clew`; this one stands for the server of a connected system that
 * does not take the identity provider's token, such as the purchasing fixture (`connectors/purchasing`). Run inside the
 * app container, with Keycloak's administrator from the container's environment (never printed):
 *
 *   docker exec -w /workspace clew-app-1 bun scripts/vendor-realm.ts
 *
 * It touches the realm `vendor` only, and it writes nothing to Clew's database. Run again, it leaves what is there and
 * sets the realm's settings once more:
 *
 * - access tokens that live a minute, so that Clew refreshes on nearly every call, and refresh tokens that are rotated
 *   and end with their use;
 * - anybody may register a client whose redirect address is Clew's (RFC 7591), which then asks the person's consent;
 * - an account for each of the stack's personas, by the same user name and with the test password the persona already
 *   has in the ignored file of test passwords (`TEST_PASSWORD_FILE` below). A system that shared the installation's
 *   sign-in would not need them; the realm has its own so that the check signs in at it without a browser.
 */
import { resolve } from 'node:path';
import { testPasswordKey } from './test-password-key';

const realm = 'vendor';
const base = 'http://keycloak.orb.local:8090';
export const VENDOR_ISSUER = `${base}/realms/${realm}`;
/** Where `scripts/auth-setup.ts` keeps each persona's test password, ignored by git. */
export const TEST_PASSWORD_FILE = resolve(import.meta.dir, '..', '.auth-test' + '.env');
/** The personas that get an account at the system: the two approvers of the purchasing fixture and one with nothing. */
const ACCOUNTS = [
  { username: 'hillevi', firstName: 'Hillevi', lastName: 'Berg' },
  { username: 'hassan', firstName: 'Hassan', lastName: 'Ali' },
  { username: 'mikael', firstName: 'Mikael', lastName: 'Lund' },
];
/** The test passwords, by the key `testPasswordKey` gives a user name. */
export async function testPasswords(): Promise<Record<string, string>> {
  return Object.fromEntries(
    (await Bun.file(TEST_PASSWORD_FILE).text()).split('\n').flatMap(line => {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      return m ? [[m[1]!, m[2]!]] : [];
    }),
  );
}

async function main() {
  const username = process.env.KEYCLOAK_ADMIN,
    password = process.env.KEYCLOAK_ADMIN_PASSWORD;
  if (!username || !password)
    throw new Error(
      'Set KEYCLOAK_ADMIN and KEYCLOAK_ADMIN_PASSWORD (.devcontainer/compose.yaml sets them in the app container)',
    );
  try {
    process.loadEnvFile(resolve(import.meta.dir, '../apps/server', '.env' + '.local'));
  } catch {
    /* settings may come from the environment */
  }
  const publicUrl = new URL(process.env.PUBLIC_URL ?? 'http://localhost:3020');
  const passwords = await testPasswords();
  const tokenResponse = await fetch(base + '/realms/master/protocol/openid-connect/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username, password }),
  });
  if (!tokenResponse.ok) throw new Error(`Keycloak refused its administrator (${tokenResponse.status})`);
  const token = ((await tokenResponse.json()) as { access_token: string }).access_token;
  async function admin(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(base + '/admin/' + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok && response.status !== 404)
      throw new Error(`Keycloak setup failed: ${method} ${path} answered ${response.status}`);
    return response;
  }
  const root = 'realms/' + realm;
  const settings = {
    realm,
    enabled: true,
    displayName: 'Inköpssystemet (utveckling)',
    // A minute: Clew sends a stored token until a minute before its end, so here it refreshes on nearly every call.
    accessTokenLifespan: 60,
    // Rotation: a refresh token ends with its use, and using one twice ends the session.
    revokeRefreshToken: true,
    refreshTokenMaxReuse: 0,
    ssoSessionIdleTimeout: 1800,
    registrationAllowed: false,
    loginWithEmailAllowed: false,
    internationalizationEnabled: true,
    supportedLocales: ['sv', 'en'],
    defaultLocale: 'sv',
  };
  const existed = (await admin(root)).status !== 404;
  if (existed) await admin(root, 'PUT', settings);
  else await admin('realms', 'POST', settings);

  // Anybody may register a client, as a public system's server allows, but only one that returns people to Clew: the
  // policy "Trusted Hosts" holds the hosts a client's addresses may name. The request itself comes from the app
  // container, whose address is no host name, so the sender is not matched.
  const policies = (await (
    await admin(root + '/components?type=org.keycloak.services.clientregistration.policy.ClientRegistrationPolicy')
  ).json()) as Array<{
    id: string;
    name: string;
    providerId: string;
    subType?: string;
    config?: Record<string, string[]>;
  }>;
  const trusted = policies.find(p => p.providerId === 'trusted-hosts' && p.subType === 'anonymous');
  if (!trusted) throw new Error('The realm has no "Trusted Hosts" policy for anonymous client registration');
  await admin(root + '/components/' + trusted.id, 'PUT', {
    ...trusted,
    config: {
      ...trusted.config,
      'trusted-hosts': [publicUrl.hostname],
      'host-sending-registration-request-must-match': ['false'],
      'client-uris-must-match': ['true'],
    },
  });

  const made: string[] = [],
    kept: string[] = [],
    skipped: string[] = [];
  for (const account of ACCOUNTS) {
    const found = (
      (await (await admin(`${root}/users?exact=true&username=${account.username}`)).json()) as Array<{
        username: string;
      }>
    ).some(u => u.username === account.username);
    if (found) {
      kept.push(account.username);
      continue;
    }
    const secret = passwords[testPasswordKey(account.username)];
    if (!secret) {
      // The persona has no test password yet (`bun scripts/auth-setup.ts` makes them): no account without one.
      skipped.push(account.username);
      continue;
    }
    await admin(root + '/users', 'POST', {
      ...account,
      email: `${account.username}@vendor.test`,
      emailVerified: true,
      enabled: true,
      requiredActions: [],
      credentials: [{ type: 'password', value: secret, temporary: false }],
    });
    made.push(account.username);
  }
  console.log(
    `Realm ${realm} ${existed ? 'updated' : 'created'} at ${VENDOR_ISSUER}. ` +
      `Clients may be registered for ${publicUrl.hostname}. ` +
      `Accounts made: ${made.join(', ') || 'none'}; already there: ${kept.join(', ') || 'none'}` +
      (skipped.length ? `; skipped for want of a test password: ${skipped.join(', ')}` : '') +
      '.',
  );
}
if (import.meta.main) await main();
