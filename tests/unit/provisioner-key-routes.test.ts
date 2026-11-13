import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, ProvisionerKeyIssued, UsersAdminOverview } from '@clew/contracts';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { usersAdminUsecases } from '../../apps/server/src/modules/people/usecases';
import { provisionerKeyRoutes } from '../../apps/server/src/routes/provisioner-keys';
import { refusingNul } from '../refusing-nul';

/**
 * The routes of the provisioners' keys (D107) over the use cases on the memory store: what a body has to be, which
 * answers carry a key and that they are never to be stored, where the key is said to be sent, and the refusals in
 * Swedish. The session guard is the administration's and is stood in for here by a header that says who is signed in.
 * The store fails on a NUL as PostgreSQL does (`refusingNul`), so a NUL that reached it would answer 503 here too.
 */
const PUBLIC_URL = process.env.PUBLIC_URL;
beforeAll(() => {
  process.env.PUBLIC_URL = 'https://clew.example/';
});
afterAll(() => {
  if (PUBLIC_URL === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = PUBLIC_URL;
});
function stack() {
  const store = memoryProvisionStore();
  let tokens = 0;
  const usecases = usersAdminUsecases({
    store: refusingNul(store),
    clock: () => new Date('2026-11-11T06:00:00.000Z'),
    token: () => 'route-token-' + ++tokens,
    digest: token => 'digest:' + token,
  });
  const persona = (capabilities: string[]): AuthenticatedContext => ({
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
    authorize: async () => ({ version: 'v' }),
  });
  const app = provisionerKeyRoutes(usecases, async (c, next) => {
    c.set('session', { context: persona(c.req.header('x-test-admin') === 'no' ? [] : ['admin.users']) } as never);
    await next();
  });
  const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request('http://internal.test' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
  return { store, post };
}
const refused = async (response: Response, status: number, error: string) => {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error });
};
describe('the routes of the provisioners’ keys (D107)', () => {
  test('issuing answers the key once, whose it is and where it is sent, and says the answer is never to be stored', async () => {
    const { store, post } = stack();
    const response = await post('/', { id: 'metakatalogen', label: 'Metakatalogen' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    const issued = (await response.json()) as ProvisionerKeyIssued;
    expect(issued).toMatchObject({
      id: 'metakatalogen',
      token: 'route-token-1',
      // The installation's public address, not the address the request happened to arrive at.
      address: 'https://clew.example/scim/v2',
    });
    expect(issued.overview.provisioners.map(p => p.id)).toEqual(['metakatalogen']);
    expect(Object.keys(issued).sort()).toEqual(['address', 'id', 'overview', 'token']);
    expect([...store.state.provisioners.keys()]).toEqual(['digest:route-token-1']);
    await refused(
      await post('/', { id: 'metakatalogen', label: 'Igen' }),
      400,
      'Det finns redan en katalog med det id:t.',
    );
  });
  test('a body that is not what the contract says is refused in Swedish, and nothing is written', async () => {
    const { store, post } = stack();
    for (const body of [
      '{not json',
      {},
      { id: 'Metakatalogen', label: 'Stor bokstav' },
      { id: 'm', label: 'För kort' },
      { id: 'metakatalogen', label: '' },
      { id: 'metakatalogen', label: 'x'.repeat(121) },
      { id: 'metakatalogen', label: 'Ok', organisationId: 'timra' },
      // One line without a control character (K3): a NUL, which PostgreSQL cannot hold, among them.
      { id: 'metakatalogen', label: 'Meta\u0000katalogen' },
      { id: 'metakatalogen', label: 'Meta\tkatalogen' },
      { id: 'metakatalogen', label: 'Meta\nkatalogen' },
      { id: 'metakatalogen', label: 'Meta\u007fkatalogen' },
      { id: 'metakatalogen', label: 'Meta\u0085katalogen' },
    ])
      await refused(await post('/', body), 400, 'Ogiltig förfrågan.');
    // Any other text is a label, a no-break space just past the control characters included.
    expect((await post('/', { id: 'ostra', label: 'Östra\u00a0katalogen – HR, 2026' })).status).toBe(200);
    await post('/', { id: 'metakatalogen', label: 'Metakatalogen' });
    for (const body of [{}, { graceHours: 5 }, { graceHours: '24' }, { graceHours: 24, extra: true }])
      await refused(await post('/metakatalogen/rotate', body), 400, 'Ogiltig förfrågan.');
    expect([...store.state.provisioners.keys()]).toEqual(['digest:route-token-1', 'digest:route-token-2']);
    expect(store.state.audit.map(a => a.action)).toEqual(['provisioner.added', 'provisioner.added']);
  });
  test('replacing answers a new key the same way; taking it back answers the page and no key', async () => {
    const { store, post } = stack();
    await post('/', { id: 'metakatalogen', label: 'Metakatalogen' });
    const rotated = await post('/metakatalogen/rotate', { graceHours: 24 });
    expect(rotated.status).toBe(200);
    expect(rotated.headers.get('cache-control')).toBe('no-store, private');
    const answer = (await rotated.json()) as ProvisionerKeyIssued;
    expect(answer).toMatchObject({
      id: 'metakatalogen',
      token: 'route-token-2',
      address: 'https://clew.example/scim/v2',
    });
    expect(answer.overview.provisioners[0]?.previousValidUntil).toBe('2026-11-12T06:00:00.000Z');
    await refused(await post('/okand/rotate', { graceHours: 0 }), 400, 'Katalogen finns inte.');
    const revoked = await post('/metakatalogen/revoke');
    expect(revoked.status).toBe(200);
    const page = (await revoked.json()) as UsersAdminOverview;
    expect(page.provisioners).toEqual([]);
    expect(JSON.stringify(page)).not.toContain('route-token');
    await refused(await post('/metakatalogen/revoke'), 400, 'Katalogen finns inte.');
    expect(store.state.audit.map(a => a.action)).toEqual([
      'provisioner.added',
      'provisioner.rotated',
      'provisioner.revoked',
    ]);
  });
  test('an address whose id is not of a provisioner’s shape, a NUL included, names no provisioner and is answered as an unknown one (K3)', async () => {
    const { store, post } = stack();
    await post('/', { id: 'metakatalogen', label: 'Metakatalogen' });
    for (const id of [
      'metakatalogen%00',
      '%00',
      'Metakatalogen',
      'm',
      'meta%20katalogen',
      '-metakatalogen',
      'x'.repeat(65),
    ]) {
      await refused(await post(`/${id}/rotate`, { graceHours: 0 }), 400, 'Katalogen finns inte.');
      await refused(await post(`/${id}/revoke`), 400, 'Katalogen finns inte.');
    }
    // Before the body is read: an address that names nothing is that, whatever is sent with it.
    await refused(await post('/metakatalogen%00/rotate', '{not json'), 400, 'Katalogen finns inte.');
    expect(store.state.audit.map(a => a.action)).toEqual(['provisioner.added']);
    expect([...store.state.provisioners.keys()]).toEqual(['digest:route-token-1']);
  });
  test('without admin.users every one of the three is refused, and nothing is written', async () => {
    const { store, post } = stack();
    await post('/', { id: 'metakatalogen', label: 'Metakatalogen' });
    const no = { 'x-test-admin': 'no' };
    for (const [path, body] of [
      ['/', { id: 'annan', label: 'Annan' }],
      ['/metakatalogen/rotate', { graceHours: 0 }],
      ['/metakatalogen/revoke', undefined],
    ] as const)
      expect((await post(path, body, no)).status).toBe(403);
    expect(store.state.audit).toHaveLength(1);
    expect([...store.state.provisioners.keys()]).toEqual(['digest:route-token-1']);
  });
});
