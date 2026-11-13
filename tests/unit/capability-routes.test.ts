import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, PanelViewSpec } from '../../packages/contracts/src/index';
import { capabilityRoutes } from '../../apps/server/src/routes/capabilities';
import type { UserRecord } from '../../apps/server/src/modules/people/domain';
import { InputError } from '../../apps/server/src/context';
import { memoryPersonKeys } from '../person-keys';

/**
 * The capability routes (`/api/cap/:name`): a read answers its output, the source and its declared view (D38), and the
 * view carries the people its records name, from the user name a record holds to the id of whoever of the reader's
 * organisation holds it (D116), so the web links a record to `/people/<id>`. A name nobody there holds is absent. An
 * execute is reached only through the human decision endpoint. The registry and the run are stubbed here; the people
 * are the memory directory's.
 */
const persona = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Bergsåkers skola',
  role: 'manager',
} as AuthenticatedContext;
const user = (id: string, userName: string | null, organisationId = 'poc'): UserRecord => ({
  id,
  organisationId,
  externalId: null,
  userName,
  name: id,
  email: null,
  title: null,
  enabled: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  phoneNumbers: [],
  employments: [],
});
const talks: PanelViewSpec = {
  kind: 'table',
  title: 'name',
  fields: [{ key: 'name', label: 'Namn' }],
  subject: { entity: 'person', key: 'userName' },
  capability: 'talks.talks',
  connector: 'talks',
  source: 'Utvecklingssamtal',
  chip: false,
};
const rooms: PanelViewSpec = { ...talks, subject: undefined, capability: 'rooms.list', connector: 'rooms' };
function stack(options: { people?: boolean } = {}) {
  const users = new Map(
    [
      user('hillevi', 'hillevi.berg'),
      user('anna', 'anna.lindqvist'),
      // Deactivated, and still the holder: the record says who the source meant.
      { ...user('karin', 'karin.l'), enabled: false },
      // The same user name in another organisation is somebody else's.
      user('outsider', 'ute.person', 'other'),
    ].map(u => [u.id, u] as const),
  );
  const keys = memoryPersonKeys({ users });
  const asked: Array<[string, readonly string[]]> = [];
  const ran: Array<[string, string, unknown]> = [];
  const rows = [
    // The source's own spelling: compared without regard to case, answered as asked.
    { name: 'Anna Lindqvist', userName: 'Anna.Lindqvist' },
    { name: 'Karin L', userName: 'karin.l' },
    { name: 'Utomstående', userName: 'ute.person' },
    { name: 'Okänd', userName: 'okand.person' },
    { name: 'Utan användarnamn' },
  ];
  const found: Record<string, { connector: { source: string }; capability: { kind: string } }> = {
    'talks.talks': { connector: { source: 'Utvecklingssamtal' }, capability: { kind: 'read' } },
    'talks.strangers': { connector: { source: 'Utvecklingssamtal' }, capability: { kind: 'read' } },
    'rooms.list': { connector: { source: 'Lokalbokningen' }, capability: { kind: 'read' } },
    'talks.book': { connector: { source: 'Utvecklingssamtal' }, capability: { kind: 'propose' } },
    'talks.flag': { connector: { source: 'Utvecklingssamtal' }, capability: { kind: 'execute' } },
  };
  const views: Record<string, PanelViewSpec> = {
    'talks.talks': talks,
    'talks.strangers': { ...talks, capability: 'talks.strangers' },
    'rooms.list': rooms,
  };
  const strangers = [
    { name: 'Okänd', userName: 'okand.person' },
    { name: 'Utomstående', userName: 'ute.person' },
  ];
  const routes = capabilityRoutes({
    registry: {
      find: (name: string) => found[name],
      viewFor: (actor: { id: string }, name: string) => (actor.id === persona.id ? views[name] : undefined),
    } as never,
    run: async (p, name, input) => {
      ran.push([p.id, name, input]);
      if ((input as { refuse?: boolean }).refuse) throw new InputError('Källan svarade inte.');
      if (name === 'rooms.list') return { rows: [{ name: 'Rum 1', userName: 'anna.lindqvist' }] };
      return { rows: name === 'talks.strangers' ? strangers : rows };
    },
    ...(options.people === false
      ? {}
      : {
          people: {
            holders: async (readerId: string, names: readonly string[]) => {
              asked.push([readerId, names]);
              return keys.holders(readerId, names);
            },
          },
        }),
    // The session guard's part: who is signed in. The real guard also checks the cookie.
    guard: async (c, next) => {
      c.set('session', { context: persona } as never);
      await next();
    },
  });
  // Served as the API mounts it under /api/cap; the paths below are the part after that.
  const request = (path: string, init?: RequestInit) => routes.request('http://clew.test' + path, init);
  return { request, asked, ran, rows };
}

describe('the capability routes', () => {
  test("a read's view links the records whose user name someone of the reader's organisation holds, by id (D116)", async () => {
    const { request, asked, ran, rows } = stack();
    const input = encodeURIComponent(JSON.stringify({ round: '2026' }));
    const response = await request(`/talks.talks?input=${input}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      output: { rows },
      source: 'Utvecklingssamtal',
      // Unheld names, and a name held only in another organisation, are absent: those records link nowhere.
      view: { ...talks, people: { 'Anna.Lindqvist': 'anna', 'karin.l': 'karin' } },
    });
    expect(ran).toEqual([['hillevi', 'talks.talks', { round: '2026' }]]);
    // One question for the whole answer, as the reader, each user name once.
    expect(asked).toEqual([['hillevi', ['Anna.Lindqvist', 'karin.l', 'ute.person', 'okand.person']]]);
  });
  test('a view that names no person is as the registry gave it, and nobody is asked about', async () => {
    const { request, asked } = stack();
    expect(await (await request('/rooms.list')).json()).toEqual({
      output: { rows: [{ name: 'Rum 1', userName: 'anna.lindqvist' }] },
      source: 'Lokalbokningen',
      view: rooms,
    });
    expect(asked).toEqual([]);
  });
  test('when nobody holds any of the names, or the people are not wired, the view carries no people', async () => {
    const { request, asked } = stack();
    const none = (await (await request('/talks.strangers')).json()) as { view: PanelViewSpec };
    expect(none.view).toEqual({ ...talks, capability: 'talks.strangers' });
    expect(asked).toEqual([['hillevi', ['okand.person', 'ute.person']]]);
    const unwired = (await (await stack({ people: false }).request('/talks.talks')).json()) as { view: PanelViewSpec };
    expect(unwired.view).toEqual(talks);
  });
  test('an execute and an unknown capability are the one 404, and a POST answers its output alone', async () => {
    const { request, ran, asked } = stack();
    for (const path of ['/talks.flag', '/talks.book', '/talks.nothing']) expect((await request(path)).status).toBe(404);
    for (const path of ['/talks.flag', '/talks.nothing'])
      expect((await request(path, { method: 'POST', body: '{}' })).status).toBe(404);
    // A propose runs as the person and answers its output; a POST carries no view, so no one is resolved.
    const posted = await request('/talks.book', { method: 'POST', body: JSON.stringify({ person: 'anna' }) });
    expect(await posted.json()).toEqual({ output: { rows: expect.any(Array) } });
    expect(ran).toEqual([['hillevi', 'talks.book', { person: 'anna' }]]);
    expect(asked).toEqual([]);
  });
  test('input that is not JSON, and a refusal from the source, are bad requests in Swedish', async () => {
    const { request, asked } = stack();
    const bad = await request('/talks.talks?input=%7Bnope');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Ogiltig förfrågan.' });
    const refused = await request(`/talks.talks?input=${encodeURIComponent('{"refuse":true}')}`);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'Källan svarade inte.' });
    expect((await request('/talks.book', { method: 'POST', body: '{nope' })).status).toBe(400);
    expect(asked).toEqual([]);
  });
});
