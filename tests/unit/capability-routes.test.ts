import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, PanelViewSpec } from '../../packages/contracts/src/index';
import {
  CapabilityError,
  Registry,
  audiencedActorOf,
  openGovernance,
  type Capability,
  type Connector,
} from '../../packages/connectors/src/index';
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
      findFor: (_actor: unknown, name: string) => found[name],
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

/**
 * What the person may know of a capability is the registry's to say (D23), so these run over a real one. A capability
 * whose connector is switched off or leaves the person out of its audience, or that is switched off itself, answers
 * exactly as a name nobody registered: the same status, body and headers, whatever the method and the input. A
 * capability of a connector the person can see that its scope leaves out is the registry's own refusal, since the
 * person may know that it exists (`GET /api/connectors` lists it with `inScope: false`).
 */
describe('a capability the person may not know of answers as one nobody registered (D23)', () => {
  const hassan = {
    id: 'hassan',
    name: 'Hassan Ali',
    unitId: 'unit-skola',
    unitLabel: 'Bergsåkers skola',
    role: 'employee',
    groups: ['S-1-5-21-alla'],
  } as AuthenticatedContext;
  const capability = (name: string, kind: Capability['kind'], ran: string[], roles?: ['manager']): Capability => ({
    name,
    kind,
    title: name,
    description: name,
    input: { type: 'object', properties: { day: { type: 'string' } }, additionalProperties: false } as never,
    output: { type: 'object' } as never,
    model: false,
    scope: roles ? { roles } : {},
    run: async () => {
      ran.push(name);
      return {};
    },
  });
  const connector = (id: string, capabilities: Capability[]): Connector => ({
    id,
    kind: 'passthrough',
    source: id,
    areas: [],
    capabilities,
    uses: [],
  });
  function world() {
    const ran: string[] = [];
    const registry = new Registry();
    const c = (name: string, kind: Capability['kind'], roles?: ['manager']) => capability(name, kind, ran, roles);
    registry.register(
      connector('open', [
        c('open.read', 'read'),
        c('open.offer', 'propose'),
        c('open.flag', 'execute'),
        c('open.switched', 'read'),
        c('open.managers', 'read', ['manager']),
      ]),
    );
    registry.register(connector('off', [c('off.read', 'read'), c('off.offer', 'propose')]));
    registry.register(connector('crm', [c('crm.read', 'read'), c('crm.offer', 'propose')]));
    registry.register(connector('chef', [c('chef.read', 'read', ['manager']), c('chef.offer', 'propose')]));
    registry.govern('open', { ...openGovernance(), capabilities: { 'open.switched': { enabled: false } } });
    registry.govern('off', { ...openGovernance(), state: 'disabled' });
    // An audience of a group he is not in, and one of managers only.
    registry.govern('crm', { ...openGovernance(), audience: { mode: 'selected', groups: ['S-1-5-21-crm'] } });
    registry.govern('chef', { ...openGovernance(), audience: { mode: 'selected', roles: ['manager'] } });
    const routes = capabilityRoutes({
      registry,
      // `runCapability` in the server: the registry's run as the person, its refusals in Swedish as a bad request.
      run: async (persona, name, input) => {
        try {
          return await registry.run(audiencedActorOf(persona), name, input ?? {});
        } catch (error) {
          if (error instanceof CapabilityError) throw new InputError(error.message);
          throw error;
        }
      },
      guard: async (ctx, next) => {
        ctx.set('session', { context: hassan } as never);
        await next();
      },
    });
    /** Everything a caller could compare: the status, every header and the body as sent. */
    const answer = async (path: string, init?: RequestInit) => {
      const response = await routes.request('http://clew.test' + path, init);
      return { status: response.status, headers: [...response.headers].sort(), body: await response.text() };
    };
    return { registry, ran, answer };
  }
  const input = (value: string) => '?input=' + encodeURIComponent(value);
  /** Every way to ask: no input, input that is empty, not JSON, refused by the schema, and a body over the limit. */
  const asked: Array<[string, RequestInit | undefined]> = [
    ['', undefined],
    [input('{}'), undefined],
    ['?input=%7Bnope', undefined],
    [input('{"other":1}'), undefined],
    ['', { method: 'POST', body: '' }],
    ['', { method: 'POST', body: '{}' }],
    ['', { method: 'POST', body: '{nope' }],
    ['', { method: 'POST', body: '{"other":1}' }],
    ['', { method: 'POST', body: JSON.stringify({ day: 'x'.repeat(8001) }) }],
  ];
  const UNKNOWN = {
    status: 404,
    headers: [
      ['cache-control', 'no-store, private'],
      ['content-type', 'application/json'],
      ['x-content-type-options', 'nosniff'],
    ] as Array<[string, string]>,
    body: JSON.stringify({ error: 'Okänd förmåga.' }),
  };

  test('a hidden capability answers GET and POST with the status, body and headers of a name nobody registered, whatever the input', async () => {
    const { ran, answer } = world();
    const hidden = ['off.read', 'off.offer', 'crm.read', 'crm.offer', 'chef.offer', 'open.switched'];
    for (const [i, [rest, init]] of asked.entries()) {
      const unknown = await answer('/nobody.read' + rest, init);
      for (const name of hidden) expect([name, i, await answer(`/${name}${rest}`, init)]).toEqual([name, i, unknown]);
      expect(unknown).toEqual(UNKNOWN);
    }
    // Nothing of a hidden connector ran.
    expect(ran).toEqual([]);
  });
  test('out of the scope of a connector he can see a read is refused as his to know, and out of the scope of a hidden one it is unknown', async () => {
    const { ran, answer } = world();
    for (const [i, [rest, init]] of asked.entries())
      expect([i, await answer('/chef.read' + rest, init)]).toEqual([i, await answer('/nobody.read' + rest, init)]);
    const denied = { error: 'Du saknar behörighet för åtgärden.' };
    expect(await answer('/open.managers' + input('{}'))).toMatchObject({ status: 400, body: JSON.stringify(denied) });
    expect(await answer('/open.managers', { method: 'POST', body: '{}' })).toMatchObject({
      status: 400,
      body: JSON.stringify(denied),
    });
    expect(ran).toEqual([]);
  });
  test('the listing of connectors (GET /api/connectors) names no capability he may not know of; what the scope leaves out is listed as out of scope', () => {
    const { registry } = world();
    const listing = registry
      .catalogueFor(audiencedActorOf(hassan))
      .map(({ connector, capabilities }) => [connector.id, capabilities.map(c => [c.capability.name, c.inScope])]);
    // A connector switched off or leaving him out of its audience is absent, and so is a capability switched off.
    expect(listing).toEqual([
      [
        'open',
        [
          ['open.read', true],
          ['open.offer', true],
          ['open.flag', true],
          ['open.managers', false],
        ],
      ],
    ]);
  });
  test('a capability hidden while it is asked, its connector switched off between the check and the call, answers as unknown too', async () => {
    const { registry, ran, answer } = world();
    // The registry reads the governance again as it runs, and finds the connector switched off.
    registry.setRefresh(async () => {
      registry.govern('open', { ...openGovernance(), state: 'disabled' });
    });
    expect(await answer('/open.read' + input('{}'))).toEqual(await answer('/nobody.read' + input('{}')));
    registry.govern('open', openGovernance());
    const post = { method: 'POST', body: '{}' };
    expect(await answer('/open.offer', post)).toEqual(await answer('/nobody.offer', post));
    expect(await answer('/nobody.offer', post)).toEqual(UNKNOWN);
    expect(ran).toEqual([]);
  });
});
