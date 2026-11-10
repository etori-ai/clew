/**
 * Runs inside the devcontainer against the dev stack: a real Keycloak login for the synthetic administrator, then
 * Administration › Utseende (D97) end to end through the API on that session: the public read, the guards (no session,
 * no CSRF token, a person without `admin.appearance`), a theme file saved and refused, a logo saved and refused, the
 * audit rows, and the removal. The appearance the installation had before the run is put back, also when a step fails.
 * Passwords are read from the ignored .auth-test.env and never printed.
 *
 *   docker exec -e BFF_URL=http://127.0.0.1:3000 -w /workspace clew-app-1 bun scripts/appearance-check.ts
 */
import { resolve } from 'node:path';
try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const { database, closeDatabase, schema } = await import('@clew/db');
const db = database(),
  { audit } = schema;
const { and, eq, gt } = await import('drizzle-orm');

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

interface Answer {
  status: number;
  headers: Headers;
  json: any;
}
/** One browser: its own cookie jar, signed in through Keycloak when a user is named. */
async function client(user?: string) {
  const jar = new Map<string, string>();
  const go = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const response = await fetch(target(url), {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers ?? {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    for (const c of response.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      jar.set(pair!.slice(0, i), pair!.slice(i + 1));
    }
    if ([301, 302, 303, 307].includes(response.status)) return go(new URL(response.headers.get('location')!, url).href);
    return response;
  };
  let csrf = '';
  if (user) {
    const password = env['TEST_' + user.toUpperCase() + '_PASSWORD'];
    if (!password) throw new Error('Test password missing in .auth-test.env');
    const form = await go(base + '/api/auth/login?returnTo=/');
    const action = /action="([^"]+)"/.exec(await form.text())?.[1]?.replace(/&amp;/g, '&');
    if (!action || !form.url.includes('keycloak.orb.local')) throw new Error('Keycloak login form not found');
    const done = await go(action, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: user, password, credentialId: '' }),
    });
    if (!jar.has('clew-session')) throw new Error(`No session after login (${done.status} ${done.url})`);
    const session = await (await go(base + '/api/auth/session')).json();
    csrf = session.csrfToken;
    console.log('Logged in as', session.user.name, '| administrator:', session.admin === true);
  }
  return {
    raw: go,
    async call(method: string, path: string, body?: unknown, token = csrf): Promise<Answer> {
      const response = await go(base + path, {
        method,
        headers: { 'content-type': 'application/json', origin: base, ...(token ? { 'x-csrf-token': token } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      return { status: response.status, headers: response.headers, json };
    },
  };
}

const problems: string[] = [];
function expect(what: string, ok: boolean, detail?: unknown) {
  console.log((ok ? 'ok   ' : 'FAIL ') + what + (ok || detail === undefined ? '' : ' → ' + JSON.stringify(detail)));
  if (!ok) problems.push(what);
}
const b64 = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64');
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40">${body}</svg>`;
const color = (hex: string) => ({ $type: 'color', $value: hex });

const anonymous = await client();
const admin = await client('mikael');
const employee = await client('hassan');

// The appearance to put back: the saved theme as it is, and the logo's bytes from the public addresses.
const before = (await admin.call('GET', '/api/admin/appearance')).json;
const image = async (variant: 'light' | 'dark') => {
  const response = await anonymous.raw(base + '/api/appearance/logo/' + variant);
  if (!response.ok) return undefined;
  return {
    mediaType: response.headers.get('content-type')!.split(';')[0]!,
    data: b64(new Uint8Array(await response.arrayBuffer())),
  };
};
const beforeLogo = before.logo
  ? { alt: before.logo.alt, light: await image('light'), dark: await image('dark') }
  : null;
const beforeFile = before.theme ? await (await anonymous.raw(base + '/api/appearance/theme-file')).json() : null;
console.log(
  'Before: revision',
  before.revision,
  '| theme:',
  before.theme?.name ?? 'none',
  '| logo:',
  before.logo?.alt ?? 'none',
);
const started = new Date();

try {
  // 1. The guards.
  const open = await anonymous.call('GET', '/api/appearance');
  expect('the public read answers without a session', open.status === 200 && typeof open.json?.revision === 'number');
  expect('any origin may read it', open.headers.get('access-control-allow-origin') === '*');
  expect(
    'the admin read refuses without a session',
    (await anonymous.call('GET', '/api/admin/appearance')).status === 401,
  );
  const denied = await employee.call('GET', '/api/admin/appearance');
  expect('the admin read refuses a person without admin.appearance', denied.status === 403, denied.json);
  const sundsvall = await Bun.file(resolve(import.meta.dir, '../themes/sundsvall/theme.tokens.json')).json();
  const deniedSave = await employee.call('PUT', '/api/admin/appearance/theme', { file: sundsvall });
  expect('a save by that person is refused', deniedSave.status === 403, deniedSave.json);
  const noToken = await admin.call('PUT', '/api/admin/appearance/theme', { file: sundsvall }, '');
  expect('a save without the CSRF token is refused', noToken.status === 403, noToken.json);
  const untouched = (await anonymous.call('GET', '/api/appearance')).json;
  expect('the refused saves changed nothing', untouched.revision === before.revision);

  // 2. A theme file.
  const saved = await admin.call('PUT', '/api/admin/appearance/theme', { file: sundsvall });
  expect(
    'the example theme file is saved',
    saved.status === 200 &&
      saved.json.revision === before.revision + 1 &&
      saved.json.theme?.name === 'Sundsvalls kommun',
    saved.json,
  );
  const seen = (await anonymous.call('GET', '/api/appearance')).json;
  expect('every browser reads the saved theme', seen.theme?.colors?.accent?.length === 2, seen.theme?.colors?.accent);
  const file = await anonymous.raw(base + '/api/appearance/theme-file');
  const again = await admin.call('PUT', '/api/admin/appearance/theme', { file: await file.json() });
  expect(
    'the downloaded theme file saves back to the same colours',
    again.status === 200 && JSON.stringify(again.json.theme?.colors) === JSON.stringify(saved.json.theme?.colors),
    again.json?.problems,
  );
  const unreadable = {
    light: { color: { accent: color('#ffffff'), 'on-accent': color('#ffffff') } },
    dark: { color: { accent: color('#ffffff'), 'on-accent': color('#ffffff') } },
  };
  const refused = await admin.call('PUT', '/api/admin/appearance/theme', { file: unreadable });
  expect(
    'a theme nobody can read is refused with its problems',
    refused.status === 400 && refused.json?.problems?.some((p: { code: string }) => p.code === 'contrast'),
    refused.json,
  );
  const unknown = await admin.call('PUT', '/api/admin/appearance/theme', {
    file: { light: { color: { 'font-size': color('#000000') } }, dark: { color: { 'font-size': color('#000000') } } },
  });
  expect(
    'a token outside the list is refused',
    unknown.status === 400 && unknown.json?.problems?.some((p: { code: string }) => p.code === 'token'),
    unknown.json,
  );

  // 3. A logo.
  const active = await admin.call('PUT', '/api/admin/appearance/logo', {
    alt: 'Provkommunen',
    light: { mediaType: 'image/svg+xml', data: b64(svg('<script>alert(1)</script>')) },
  });
  expect('an SVG with a script is refused', active.status === 400, active.json);
  const nameless = await admin.call('PUT', '/api/admin/appearance/logo', {
    alt: ' ',
    light: { mediaType: 'image/svg+xml', data: b64(svg('<rect width="120" height="40"/>')) },
  });
  expect('a logo without a name is refused', nameless.status === 400, nameless.json);
  const logo = await admin.call('PUT', '/api/admin/appearance/logo', {
    alt: 'Provkommunen',
    light: { mediaType: 'image/svg+xml', data: b64(svg('<rect width="120" height="40" fill="#005595"/>')) },
    dark: { mediaType: 'image/svg+xml', data: b64(svg('<rect width="120" height="40" fill="#ffffff"/>')) },
  });
  expect(
    'a logo with a dark variant is saved',
    logo.status === 200 && logo.json.logo?.alt === 'Provkommunen' && !!logo.json.logo?.darkSrc,
    logo.json,
  );
  if (logo.status === 200) {
    const served = await anonymous.raw(base + logo.json.logo.src);
    expect(
      'its address serves the image, sandboxed and cacheable',
      served.status === 200 &&
        served.headers.get('content-type') === 'image/svg+xml' &&
        (served.headers.get('content-security-policy') ?? '').includes('sandbox') &&
        (served.headers.get('cache-control') ?? '').includes('immutable'),
      Object.fromEntries(served.headers),
    );
    const noDark = await admin.call('PUT', '/api/admin/appearance/logo', { alt: 'Provkommunen', dark: null });
    expect('the dark variant is removed alone', noDark.status === 200 && !noDark.json.logo?.darkSrc, noDark.json);
    expect('and its address is gone', (await anonymous.raw(base + '/api/appearance/logo/dark')).status === 404);
  }

  // 4. Removal, and what the audit log holds.
  const cleared = await admin.call('DELETE', '/api/admin/appearance/theme');
  const bare = await admin.call('DELETE', '/api/admin/appearance/logo');
  expect(
    'theme and logo are removed',
    cleared.status === 200 && bare.status === 200 && bare.json.theme === null && bare.json.logo === null,
    bare.json,
  );
  const rows = await db
    .select({ action: audit.action })
    .from(audit)
    .where(and(eq(audit.subject, 'installation:appearance'), gt(audit.createdAt, started)));
  const count = (action: string) => rows.filter(row => row.action === action).length;
  expect(
    'every change has its audit row and no refusal has one',
    count('appearance.theme.set') === 2 &&
      count('appearance.logo.set') === 2 &&
      count('appearance.theme.cleared') === 1 &&
      count('appearance.logo.cleared') === 1 &&
      rows.length === 6,
    rows.map(row => row.action),
  );
} finally {
  // Put back what the installation had.
  await admin.call('DELETE', '/api/admin/appearance/theme');
  await admin.call('DELETE', '/api/admin/appearance/logo');
  if (beforeFile) await admin.call('PUT', '/api/admin/appearance/theme', { file: beforeFile });
  if (beforeLogo?.light)
    await admin.call('PUT', '/api/admin/appearance/logo', {
      alt: beforeLogo.alt,
      light: beforeLogo.light,
      ...(beforeLogo.dark ? { dark: beforeLogo.dark } : {}),
    });
  const after = (await anonymous.call('GET', '/api/appearance')).json;
  console.log('After: theme:', after.theme?.name ?? 'none', '| logo:', after.logo?.alt ?? 'none');
}
if (problems.length) {
  console.error('FAIL\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('OK');
await closeDatabase();
process.exit(0);
