import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SITE_NAME_MAX, type AppearanceAdminView, type AuthenticatedContext } from '@clew/contracts';
import { protectedRoute } from '../../apps/server/src/context';
import { AuthError, type Session } from '../../apps/server/src/auth';
import { memoryAppearanceStore } from '../../apps/server/src/modules/appearance/adapters/memory';
import { appearanceUsecases } from '../../apps/server/src/modules/appearance/usecases';
import { appearanceAdminRoutes } from '../../apps/server/src/routes/appearance-admin';

/**
 * The installation's name over HTTP (D98 item 11): `PUT` and `DELETE /api/admin/appearance/name` behind the
 * administration's session guard, over the use cases on the memory store. Who may change it (the capability, the
 * session's origin and CSRF token, the step-up), what a body has to be, and that every refusal is in Swedish and writes
 * nothing. The session is read by a stub of `authenticate`, one cookie per person; nothing here needs the database.
 */
const settings: Record<string, string> = {
  OIDC_ISSUER: 'https://idp.example.test/realms/appearance',
  OIDC_CLIENT_ID: 'clew-appearance-test',
  OIDC_CLIENT_SECRET: 'synthetic-secret',
  PUBLIC_URL: 'https://clew.example.test',
};
const previous: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const [k, v] of Object.entries(settings)) {
    previous[k] = process.env[k];
    process.env[k] = v;
  }
  delete process.env.FRONTEND_ORIGINS;
});
afterAll(() => {
  for (const [k, v] of Object.entries(previous))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});
const ORIGIN = 'https://clew.example.test';
const CSRF = 'csrf-1';
const DENIED = 'Du saknar behörighet för åtgärden.';
const INVALID = 'Ogiltig förfrågan.';

function stack() {
  const store = memoryAppearanceStore();
  let stepUps = 0;
  const persona = (
    capabilities: string[],
    authorize: () => Promise<{ version: string }> = async () => ({ version: 'v' }),
  ): AuthenticatedContext => ({
    id: 'mikael',
    name: 'Mikael Lund',
    unitId: 'unit-it',
    unitLabel: 'IT',
    role: 'employee',
    organisationId: 'poc',
    principal: { id: 'person:mikael', kind: 'person' },
    capabilities,
    authorizationVersion: 'v',
    sessionBinding: 'test',
    expiresAt: '2099-01-01T00:00:00.000Z',
    authorize: async () => {
      stepUps++;
      return authorize();
    },
  });
  /** One person per cookie: an administrator, one without the capability, one whose access changed since sign-in. */
  const people: Record<string, AuthenticatedContext> = {
    admin: persona(['admin.appearance']),
    other: persona(['admin.connectors', 'admin.users']),
    moved: persona(['admin.appearance'], async () => {
      throw new AuthError(403, 'denied');
    }),
  };
  const read = async (raw: string | undefined): Promise<Session> => {
    const context = raw ? people[raw] : undefined;
    if (!context) throw new AuthError(401, 'expired');
    return { context, csrfToken: CSRF, sessionKey: 'key', policyVersion: 'version', row: {} } as never;
  };
  const routes = appearanceAdminRoutes(
    appearanceUsecases({ store, clock: () => new Date('2026-11-24T08:00:00.000Z') }),
    protectedRoute(read),
  );
  /** Served at the part of the path after `/api/admin/appearance`, as the administration mounts it. */
  const send = (
    method: 'PUT' | 'DELETE',
    body?: unknown,
    { as = 'admin', headers = {} }: { as?: string; headers?: Record<string, string> } = {},
  ) =>
    routes.request('http://clew.test/name', {
      method,
      headers: {
        cookie: `__Host-clew-session=${as}`,
        origin: ORIGIN,
        'x-csrf-token': CSRF,
        'content-type': 'application/json',
        ...headers,
      },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
  return { store, send, stepUps: () => stepUps };
}
async function refused(response: Response, status: number, body: Record<string, unknown>) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store, private');
  expect(await response.json()).toEqual(body);
}

describe('`PUT /api/admin/appearance/name`', () => {
  test('names the installation for an administrator, after the step-up, with one audit row', async () => {
    const { store, send, stepUps } = stack();
    const response = await send('PUT', { name: '  Intranätet  ' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(((await response.json()) as AppearanceAdminView).name).toBe('Intranätet');
    expect(stepUps()).toBe(1);
    expect(await store.readName()).toBe('Intranätet');
    expect(store.audit).toEqual([
      {
        actor: 'person:mikael',
        action: 'appearance.name.set',
        subject: expect.any(String),
        details: { from: null, to: 'Intranätet', revision: 1 },
      },
    ]);
  });
  test('refuses a person without `admin.appearance`, in Swedish, and writes nothing', async () => {
    const { store, send, stepUps } = stack();
    await refused(await send('PUT', { name: 'Intranätet' }, { as: 'other' }), 403, { error: DENIED, code: 'denied' });
    expect(stepUps()).toBe(0);
    expect(await store.readName()).toBeNull();
    expect(store.audit).toEqual([]);
  });
  test('refuses a change without the CSRF token or from another origin before anything is read', async () => {
    const { store, send } = stack();
    await refused(await send('PUT', { name: 'Intranätet' }, { headers: { 'x-csrf-token': '' } }), 403, {
      error: DENIED,
      code: 'invalid',
    });
    await refused(await send('PUT', { name: 'Intranätet' }, { headers: { 'x-csrf-token': 'csrf-2' } }), 403, {
      error: DENIED,
      code: 'invalid',
    });
    await refused(await send('PUT', { name: 'Intranätet' }, { headers: { origin: 'https://evil.example' } }), 403, {
      error: DENIED,
      code: 'invalid',
    });
    expect(store.audit).toEqual([]);
  });
  test('refuses without a session, and when the step-up finds the access changed', async () => {
    const { store, send, stepUps } = stack();
    await refused(await send('PUT', { name: 'Intranätet' }, { as: 'nobody' }), 401, {
      error: 'Din inloggning har gått ut. Logga in igen.',
      code: 'expired',
    });
    await refused(await send('PUT', { name: 'Intranätet' }, { as: 'moved' }), 403, { error: DENIED, code: 'denied' });
    expect(stepUps()).toBe(1);
    expect(await store.readName()).toBeNull();
    expect(store.audit).toEqual([]);
  });
  test('refuses a body that is not a name, and does not spend the step-up on it', async () => {
    const { store, send, stepUps } = stack();
    for (const body of [undefined, '', '{', '"Intranätet"', {}, { name: 7 }, { name: 'Intranätet', extra: true }])
      await refused(await send('PUT', body), 400, { error: INVALID });
    // Longer than the schema lets a name be, and longer than any name's body can be.
    await refused(await send('PUT', { name: 'a'.repeat(SITE_NAME_MAX * 4 + 1) }), 400, { error: INVALID });
    await refused(await send('PUT', JSON.stringify({ name: 'a'.repeat(3000) })), 400, {
      error: 'För stor förfrågan.',
    });
    expect(stepUps()).toBe(0);
    expect(store.audit).toEqual([]);
  });
  test('refuses a name the check refuses with its own Swedish words, even for a person the step-up would refuse', async () => {
    const { store, send, stepUps } = stack();
    const cases: Array<[string, string]> = [
      ['', 'Skriv ett namn.'],
      ['   ', 'Skriv ett namn.'],
      ['a'.repeat(SITE_NAME_MAX + 1), `Namnet får vara högst ${SITE_NAME_MAX} tecken.`],
      ['Intra\nnätet', 'Namnet ska stå på en rad.'],
      ['Intra‮nätet', 'Namnet får inte ha osynliga tecken eller tecken som vänder textens riktning.'],
      ['Intra​nätet', 'Namnet får inte ha osynliga tecken eller tecken som vänder textens riktning.'],
      ['Intranätet', 'Namnet har tecken som inte kan visas.'],
      ['Aq́̈̃a', 'Namnet får ha högst två accenter eller andra tecken på samma bokstav.'],
      ['— · —', 'Namnet behöver minst en bokstav eller siffra.'],
    ];
    for (const [name, error] of cases) {
      await refused(await send('PUT', { name }), 400, { error });
      await refused(await send('PUT', { name }, { as: 'moved' }), 400, { error });
    }
    expect(stepUps()).toBe(0);
    expect(await store.readName()).toBeNull();
    expect(store.audit).toEqual([]);
  });
});

describe('`DELETE /api/admin/appearance/name`', () => {
  test('gives the installation its default name again, after the step-up, with one audit row', async () => {
    const { store, send, stepUps } = stack();
    await send('PUT', { name: 'Intranätet' });
    const response = await send('DELETE');
    expect(response.status).toBe(200);
    expect(((await response.json()) as AppearanceAdminView).name).toBe('Clew');
    expect(stepUps()).toBe(2);
    expect(await store.readName()).toBeNull();
    expect(store.audit.map(a => [a.action, a.details])).toEqual([
      ['appearance.name.set', { from: null, to: 'Intranätet', revision: 1 }],
      ['appearance.name.cleared', { from: 'Intranätet', revision: 2 }],
    ]);
  });
  test('refuses a person without the capability, a change without the CSRF token and a refused step-up', async () => {
    const { store, send } = stack();
    await send('PUT', { name: 'Intranätet' });
    await refused(await send('DELETE', undefined, { as: 'other' }), 403, { error: DENIED, code: 'denied' });
    await refused(await send('DELETE', undefined, { headers: { 'x-csrf-token': '' } }), 403, {
      error: DENIED,
      code: 'invalid',
    });
    await refused(await send('DELETE', undefined, { as: 'moved' }), 403, { error: DENIED, code: 'denied' });
    expect(await store.readName()).toBe('Intranätet');
    expect(store.audit).toHaveLength(1);
  });
});
