/**
 * Runs inside the devcontainer against the dev stack: a real Keycloak login for a synthetic person through the BFF, then
 * the delegation path (D26, phase E) on that session: RFC 8693 token exchange at Keycloak for the audience `eneo`. Prints
 * the exchanged token's claims and checks them; never prints a token. With `--connector` it also calls `eneo.whoami`
 * through the BFF, which needs the Eneo connector registered and running.
 *
 *   docker exec -w /workspace clew-app-1 bun scripts/auth-exchange-check.ts [hillevi|hassan] [--connector]
 */
import { resolve } from 'node:path';
try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const { delegatedToken } = await import('../apps/server/src/auth');
const { tokenDigest } = await import('../apps/server/src/auth-crypto');

const base = process.env.PUBLIC_URL ?? 'http://localhost:3020';
/** Where the BFF answers: the public URL through Vite, or `BFF_URL` (the BFF's own port) when the web dev server is not running; headers still carry the public origin. */
const target = (url: string) =>
  process.env.BFF_URL && url.startsWith(base) ? process.env.BFF_URL + url.slice(base.length) : url;
const env = Object.fromEntries(
  (await Bun.file(resolve(import.meta.dir, '../.auth-test.env')).text()).split('\n').flatMap(line => {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    return m ? [[m[1]!, m[2]!]] : [];
  }),
);
const user = process.argv.find(a => !a.startsWith('--') && /^[a-z]+$/.test(a) && a !== 'bun') ?? 'hillevi';
const password = env['TEST_' + user.toUpperCase() + '_PASSWORD'];
if (!password) throw new Error('Test password missing in .auth-test.env');
const audience = process.env.DELEGATION_AUDIENCE ?? 'eneo';
const jar = new Map<string, string>();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
function remember(response: Response) {
  for (const c of response.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair!.indexOf('=');
    jar.set(pair!.slice(0, i), pair!.slice(i + 1));
  }
}
async function go(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(target(url), {
    ...init,
    redirect: 'manual',
    headers: { ...(init.headers ?? {}), cookie: cookieHeader() },
  });
  remember(response);
  if ([301, 302, 303, 307].includes(response.status)) return go(new URL(response.headers.get('location')!, url).href);
  return response;
}
// 1. Login: app → Keycloak form → callback → session cookie.
const form = await go(base + '/api/auth/login?returnTo=/');
const html = await form.text();
const action = /action="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&');
if (!action || !form.url.includes('keycloak.orb.local')) throw new Error('Keycloak login form not found');
const done = await go(action, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ username: user, password, credentialId: '' }),
});
const raw = jar.get('clew-session');
if (!raw) throw new Error(`No session after login (${done.status} ${done.url})`);
const session = await (await go(base + '/api/auth/session')).json();
console.log('Logged in as', session.user.name, '(' + session.user.role + ')');
// 2. The exchange, on that session, in this process: the same code path the BFF's `context.delegate` runs.
const digest = tokenDigest(raw);
const started = Date.now();
const token = await delegatedToken(digest, audience);
if (!token) throw new Error('No delegated token: the session holds no IdP token');
const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;
const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
const problems: string[] = [];
if (!aud.includes(audience)) problems.push(`aud ${JSON.stringify(claims.aud)} does not include ${audience}`);
if (claims.iss !== process.env.OIDC_ISSUER) problems.push(`iss ${claims.iss} is not ${process.env.OIDC_ISSUER}`);
if (claims.azp !== process.env.OIDC_CLIENT_ID) problems.push(`azp ${claims.azp} is not ${process.env.OIDC_CLIENT_ID}`);
if (typeof claims.email !== 'string') problems.push('no email claim');
if (claims.email_verified === false) problems.push('email_verified is false');
if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number' || claims.exp - claims.iat > 300)
  problems.push(`life ${Number(claims.exp) - Number(claims.iat)} s exceeds 300`);
console.log('Exchanged in', Date.now() - started, 'ms. Claims:', {
  sub: claims.sub,
  iss: claims.iss,
  aud: claims.aud,
  azp: claims.azp,
  email: claims.email,
  email_verified: claims.email_verified,
  scope: claims.scope,
  life: Number(claims.exp) - Number(claims.iat),
});
const again = await delegatedToken(digest, audience);
console.log('Second call reused the cached token:', again === token);
// 3. Optionally through the BFF and the connector: what the Eneo connector is handed.
if (process.argv.includes('--connector')) {
  const headers = { 'content-type': 'application/json', origin: base, 'x-csrf-token': session.csrfToken };
  const r = await go(base + '/api/cap/eneo.whoami', { method: 'POST', headers, body: '{}' });
  const body = await r.json();
  if (!r.ok) throw new Error(`eneo.whoami: ${r.status} ${JSON.stringify(body)}`);
  console.log('eneo.whoami through the BFF:', body.output);
}
if (problems.length) {
  console.error('FAIL\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('OK');
export {};
