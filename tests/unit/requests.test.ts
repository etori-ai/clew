import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { VALUE_WORDS, fieldTone, type RequestRow, type RequestsResult } from '../../packages/contracts/src/index';
import { CapabilityError, SEARCH_CONNECTOR, type Actor, type Connector } from '../../packages/connectors/src/index';
import {
  DELEGATED_TOKEN_HEADER,
  manifestProblems,
  parseManifest,
  remoteConnector,
  type FetchLike,
} from '../../packages/connectors/src/remote';
import { REQUEST_STATE_WORDS, merge, systemReport, unanswered } from '../../apps/server/src/modules/requests/domain';
import { requestCapabilities } from '../../apps/server/src/modules/requests/capabilities';
import { requestUsecases } from '../../apps/server/src/modules/requests/usecases';
import { errandCapabilities } from '../../apps/server/src/modules/errands/capabilities';
import { errandUsecases } from '../../apps/server/src/modules/errands/usecases';
import { assertionFor } from '../connector-authority';

/**
 * The combined list of what a person ordered or reported (D123): every service desk in the person's scope at once
 * under a budget, the rows ordered together by the shared state, each opening in the system it came from, the systems
 * that missed named, and the list kept apart from the errands a person handles. Fake in-process systems stand in for
 * an IT service desk and a facilities desk; one joins over the protocol as a connector outside Clew would.
 */
const at = Date.parse('2026-11-13T09:00:00Z');
const day = 86_400_000;
const ago = (days: number) => new Date(at - days * day).toISOString();

const mikael: Actor = {
  id: 'mikael',
  name: 'Mikael Lind',
  unitId: 'unit-it',
  unitLabel: 'IT-enheten',
  role: 'employee',
};
const hillevi: Actor = { ...mikael, id: 'hillevi', name: 'Hillevi Berg', role: 'manager' };

const row = (system: string, n: number, over: Partial<RequestRow> = {}): RequestRow => ({
  ref: `request:${system}:${n}`,
  label: `${system.toUpperCase()}-${n} · Dator, Felanmälan`,
  state: 'active',
  status: 'Pågår',
  since: ago(1),
  ...over,
});

describe('rows from several service desks become one list, in pure code', () => {
  test('what waits on the person first, then what is open from the oldest, then what is closed from the newest, whichever system holds it', () => {
    const rows = merge([
      {
        id: 'it',
        source: 'IT',
        status: 'ok',
        rows: [
          row('it', 1, { state: 'closed', since: ago(30) }),
          row('it', 2, { state: 'waiting-on-me', since: ago(1) }),
          row('it', 3, { state: 'new', since: ago(0.5) }),
          row('it', 4, { state: 'closed', since: ago(3) }),
        ],
      },
      {
        id: 'facilities',
        source: 'Fastighet',
        status: 'ok',
        rows: [
          row('facilities', 1, { state: 'waiting-on-me', since: ago(5) }),
          row('facilities', 2, { state: 'active', since: ago(9), expectedAt: '2026-11-20' }),
          row('facilities', 3, { state: 'new', since: ago(2) }),
          row('facilities', 4, { state: 'closed', since: ago(10) }),
        ],
      },
    ]);
    expect(rows.map(r => [r.ref, r.state])).toEqual([
      ['request:facilities:1', 'waiting-on-me'],
      ['request:it:2', 'waiting-on-me'],
      // New and active are both the desk's move: the request made longest ago comes first.
      ['request:facilities:2', 'active'],
      ['request:facilities:3', 'new'],
      ['request:it:3', 'new'],
      // What was closed is there to show what was recently delivered: the newest first.
      ['request:it:4', 'closed'],
      ['request:facilities:4', 'closed'],
      ['request:it:1', 'closed'],
    ]);
    expect(rows[0]).toMatchObject({ connector: 'facilities', system: 'Fastighet' });
  });
  test('a repeated ref is one request, the list is capped, and the systems that missed are named once', () => {
    const outcomes = [
      { id: 'it', source: 'IT', status: 'ok' as const, rows: [row('it', 1), row('it', 1), row('it', 2)] },
      { id: 'a', source: 'Fastighet', status: 'timeout' as const },
      { id: 'b', source: 'Fastighet', status: 'unavailable' as const },
    ];
    expect(merge(outcomes).map(r => r.ref)).toEqual(['request:it:1', 'request:it:2']);
    expect(
      merge([{ id: 'it', source: 'IT', status: 'ok', rows: Array.from({ length: 300 }, (_, i) => row('it', i)) }]),
    ).toHaveLength(200);
    expect(systemReport(outcomes).map(s => s.status)).toEqual(['ok', 'timeout', 'unavailable']);
    expect(unanswered(outcomes)).toEqual(['Fastighet']);
  });
  test('the cap cuts the oldest closed requests, never the open ones or the ones closed lately', () => {
    // 150 open and 100 closed, one a day apart: 200 fit, so 50 closed ones are left out.
    const open = Array.from({ length: 150 }, (_, i) => row('it', i, { state: 'active', since: ago(i) }));
    const closed = Array.from({ length: 100 }, (_, i) => row('it', 1000 + i, { state: 'closed', since: ago(200 + i) }));
    const rows = merge([{ id: 'it', source: 'IT', status: 'ok', rows: [...closed, ...open] }]);
    expect(rows).toHaveLength(200);
    expect(rows.filter(r => r.state === 'active')).toHaveLength(150);
    // The open ones from the oldest; the closed ones kept are the 50 closed most recently, newest first.
    expect(rows[0]!.ref).toBe('request:it:149');
    expect(rows.filter(r => r.state === 'closed').map(r => r.ref)).toEqual(
      Array.from({ length: 50 }, (_, i) => `request:it:${1000 + i}`),
    );
  });
});

/** A fake service desk as an in-process connector: `<id>.requests` answers from a list, `<id>.request` opens one. */
function desk(
  id: string,
  source: string,
  rows: unknown[],
  options: {
    delayMs?: number;
    fail?: boolean;
    calls?: unknown[];
    roles?: Actor['role'][];
    /** Who may open one request; everyone when absent. */
    openRoles?: Actor['role'][];
  } = {},
): Connector {
  return {
    id,
    kind: 'passthrough',
    source,
    areas: [],
    capabilities: [
      {
        name: id + '.requests',
        kind: 'read',
        title: 'Beställningar i ' + source,
        description: 'x',
        input: {} as never,
        output: {} as never,
        model: true,
        scope: options.roles ? { roles: options.roles } : {},
        view: {
          kind: 'list',
          title: 'label',
          ref: 'ref',
          open: { capability: id + '.request', title: 'Beställning', params: { ref: 'ref' } },
          fields: [{ key: 'label', label: 'Beställning' }],
        },
        run: async (_actor, input: unknown) => {
          options.calls?.push(input);
          if (options.delayMs) await new Promise(r => setTimeout(r, options.delayMs));
          if (options.fail) throw new CapabilityError(source + ' svarar inte just nu.');
          return { rows };
        },
      },
      {
        name: id + '.request',
        kind: 'read',
        title: 'Beställning',
        description: 'x',
        input: {} as never,
        output: {} as never,
        model: false,
        scope: options.openRoles ? { roles: options.openRoles } : {},
        run: async () => ({}),
      },
    ],
  };
}
function world(connectors: Connector[], budget = { perSourceMs: 40, totalMs: 80 }) {
  const registry = new Registry();
  const requests = requestUsecases({ sources: a => registry.requestSources(a), budget });
  for (const c of connectors) registry.register(c);
  registry.register({
    id: SEARCH_CONNECTOR,
    kind: 'core',
    source: 'Startsidan',
    ...requestCapabilities(requests, a => registry.requestSources(a).length > 0),
    uses: ['*'],
  });
  return registry;
}
const list = (registry: Registry, actor: Actor, context = {}) =>
  registry.run<RequestsResult>(actor, 'clew.requests', {}, context);

const requestRef = { type: 'string', pattern: '^request:desk:[A-Za-z0-9-]+$' };
/** A service desk outside Clew as its manifest declares it: the list and the read of one request. */
const deskManifest = {
  protocol: 3,
  id: 'desk',
  kind: 'passthrough',
  source: 'IT-servicedesken',
  scan: false,
  areas: [],
  capabilities: [
    {
      name: 'desk.requests',
      kind: 'read',
      title: 'Mina beställningar i IT-servicedesken',
      description: 'Det personen har beställt eller felanmält i IT-servicedesken.',
      model: true,
      scope: {},
      input: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        type: 'object',
        properties: { rows: { type: 'array', items: { type: 'object' } } },
        required: ['rows'],
      },
      view: {
        kind: 'list',
        title: 'label',
        ref: 'ref',
        open: { capability: 'desk.request', title: 'Beställning', params: { ref: 'ref' } },
        fields: [{ key: 'label', label: 'Beställning' }],
      },
    },
    {
      name: 'desk.request',
      kind: 'read',
      title: 'Beställning',
      description: 'En beställning eller felanmälan med rubrik och beskrivning.',
      model: false,
      scope: {},
      input: {
        type: 'object',
        properties: { ref: requestRef },
        required: ['ref'],
        additionalProperties: false,
      },
      output: { type: 'object' },
      view: { kind: 'detail', title: 'label', fields: [{ key: 'status', label: 'Status' }] },
    },
  ],
};
/** The desk over the protocol: `answer` sees each request as the desk would, and its reply is the desk's. */
function remoteDesk(manifest: unknown, answer: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const secret = 'test-secret-test-secret';
  const fetch: FetchLike = async (input, init) => answer(String(input), init);
  return remoteConnector(parseManifest(manifest, 'desk'), {
    url: 'http://desk',
    key: secret,
    assert: assertionFor('desk', secret),
    fetch,
  });
}

describe('clew.requests', () => {
  test('asks every service desk at once and answers with one list, each row opening in its own system', async () => {
    const calls: unknown[] = [];
    const registry = world([
      desk('facilities', 'Fastighetsjouren', [row('facilities', 1, { state: 'active', expectedAt: '2026-11-20' })], {
        calls,
      }),
      desk('it', 'IT-servicedesken', [row('it', 7, { state: 'waiting-on-me' })], { calls }),
    ]);
    const result = await list(registry, mikael);
    expect(result.rows).toEqual([
      {
        ...row('it', 7),
        // The shared state in Clew's word for it, given by the list, never by the system.
        state: 'Väntar på dig',
        connector: 'it',
        system: 'IT-servicedesken',
        view: {
          capability: 'it.request',
          input: { ref: 'request:it:7' },
          title: 'Beställning',
          source: 'IT-servicedesken',
        },
      },
      {
        ...row('facilities', 1, { expectedAt: '2026-11-20' }),
        state: 'Pågår',
        connector: 'facilities',
        system: 'Fastighetsjouren',
        view: {
          capability: 'facilities.request',
          input: { ref: 'request:facilities:1' },
          title: 'Beställning',
          source: 'Fastighetsjouren',
        },
      },
    ]);
    expect(result.systems).toEqual([
      { id: 'facilities', source: 'Fastighetsjouren', status: 'ok' },
      { id: 'it', source: 'IT-servicedesken', status: 'ok' },
    ]);
    expect(result.unanswered).toEqual([]);
    // Every system is asked the same question, and nothing else.
    expect(calls).toEqual([{}, {}]);
  });

  test('each row says where it stands in Clew’s word for the shared state, and only what waits on the person warns', async () => {
    const registry = world([
      desk('it', 'IT-servicedesken', [
        row('it', 1, { state: 'closed', since: ago(3) }),
        row('it', 2, { state: 'new', since: ago(2) }),
        row('it', 3, { state: 'active', since: ago(1) }),
        row('it', 4, { state: 'waiting-on-me', since: ago(4) }),
      ]),
    ]);
    // The order is the shared state's (the use case, in codes); the words are the list's, the same in every system.
    expect((await list(registry, mikael)).rows.map(r => [r.ref, r.state])).toEqual([
      ['request:it:4', 'Väntar på dig'],
      ['request:it:2', 'Ny'],
      ['request:it:3', 'Pågår'],
      ['request:it:1', 'Stängd'],
    ]);
    expect(REQUEST_STATE_WORDS).toEqual({
      'waiting-on-me': 'Väntar på dig',
      new: 'Ny',
      active: 'Pågår',
      closed: 'Stängd',
    });
    const view = registry.viewFor(mikael, 'clew.requests');
    const state = view && 'fields' in view ? view.fields.find(f => f.key === 'state') : undefined;
    expect(state).toMatchObject({ format: 'status' });
    expect(Object.values(REQUEST_STATE_WORDS).map(word => fieldTone(state!, word))).toEqual([
      'warn',
      'none',
      'none',
      'none',
    ]);
    // Not from the value words every connector's values are drawn with: another system's `new` or `active` is its own.
    for (const code of ['waiting-on-me', 'new', 'active']) expect(VALUE_WORDS).not.toHaveProperty(code);
  });

  test('a system that fails or is late is named, and the rest are listed', async () => {
    const registry = world([
      desk('it', 'IT-servicedesken', [row('it', 1)]),
      desk('facilities', 'Fastighetsjouren', [row('facilities', 1)], { fail: true }),
      desk('hr', 'HR-servicedesken', [row('hr', 1)], { delayMs: 200 }),
    ]);
    const result = await list(registry, mikael);
    expect(result.rows.map(r => r.ref)).toEqual(['request:it:1']);
    expect(result.systems.map(s => [s.id, s.status])).toEqual([
      ['it', 'ok'],
      ['facilities', 'unavailable'],
      ['hr', 'timeout'],
    ]);
    expect(result.unanswered).toEqual(['Fastighetsjouren', 'HR-servicedesken']);
  });

  test('the whole fan-out has one budget: what has answered by then is listed, and the rest is named as late', async () => {
    const registry = world(
      [
        desk('it', 'IT-servicedesken', [row('it', 1)]),
        // Within its own budget, but past the budget for the whole.
        desk('hr', 'HR-servicedesken', [row('hr', 1)], { delayMs: 400 }),
      ],
      { perSourceMs: 1000, totalMs: 60 },
    );
    const started = performance.now();
    const result = await list(registry, mikael);
    expect(performance.now() - started).toBeLessThan(300);
    expect(result.rows.map(r => r.ref)).toEqual(['request:it:1']);
    expect(result.systems.map(s => [s.id, s.status])).toEqual([
      ['it', 'ok'],
      ['hr', 'timeout'],
    ]);
    expect(result.unanswered).toEqual(['HR-servicedesken']);
  });

  test('a row opens only a read the person may call: without it the row carries no view', async () => {
    const registry = world([desk('it', 'IT-servicedesken', [row('it', 1)], { openRoles: ['manager'] })]);
    const [mine] = (await list(registry, mikael)).rows;
    expect(mine).toMatchObject({ ref: 'request:it:1', connector: 'it' });
    expect(mine).not.toHaveProperty('view');
    expect((await list(registry, hillevi)).rows[0]!.view).toEqual({
      capability: 'it.request',
      input: { ref: 'request:it:1' },
      title: 'Beställning',
      source: 'IT-servicedesken',
    });
  });

  test('when it is expected may be a day or an instant, and nothing else', async () => {
    const registry = world([
      desk('it', 'IT-servicedesken', [
        row('it', 1, { expectedAt: '2026-11-20T15:00:00.000Z' }),
        row('it', 2, { expectedAt: '2026-11-21' }),
      ]),
      desk('hr', 'HR-servicedesken', [{ ...row('hr', 1), expectedAt: 'nästa vecka' }]),
    ]);
    const result = await list(registry, mikael);
    expect(result.rows.map(r => [r.ref, r.expectedAt])).toEqual([
      ['request:it:1', '2026-11-20T15:00:00.000Z'],
      ['request:it:2', '2026-11-21'],
    ]);
    expect(result.unanswered).toEqual(['HR-servicedesken']);
  });

  test('the list takes nothing: an input is refused before any system is asked', async () => {
    const calls: unknown[] = [];
    const registry = world([desk('it', 'IT-servicedesken', [row('it', 1)], { calls })]);
    await expect(registry.run(mikael, 'clew.requests', { view: 'reported' })).rejects.toThrow();
    await expect(registry.run(mikael, 'clew.requests', { person: 'hillevi' })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  test('when nobody answers it is an error, never an empty list', async () => {
    const one = world([desk('it', 'IT-servicedesken', [], { fail: true })]);
    await expect(list(one, mikael)).rejects.toThrow('IT-servicedesken svarar inte just nu.');
    const two = world([
      desk('it', 'IT-servicedesken', [], { fail: true }),
      desk('facilities', 'Fastighetsjouren', [], { delayMs: 200 }),
    ]);
    await expect(list(two, mikael)).rejects.toThrow(
      'Inget av systemen för beställningar och felanmälningar svarar just nu.',
    );
    // A system that answers with nothing ordered or reported is an answer.
    const empty = world([desk('it', 'IT-servicedesken', [])]);
    expect(await list(empty, mikael)).toEqual({
      rows: [],
      systems: [{ id: 'it', source: 'IT-servicedesken', status: 'ok' }],
      unanswered: [],
    });
  });

  test('an answer that is not request rows is a broken system: nothing of it is shown', async () => {
    const registry = world([
      desk('it', 'IT-servicedesken', [row('it', 1)]),
      // A title would put free text, and possibly a name, in a list the model may be told about.
      desk('facilities', 'Fastighetsjouren', [
        { ...row('facilities', 1), title: 'Anna Andersson har inte fått sin nyckel' },
      ]),
      // An errand state that a request does not have, an errand's ref and a link that is not a web address.
      desk('hr', 'HR-servicedesken', [{ ...row('hr', 1), state: 'waiting-on-others' }]),
      desk('school', 'Skolans servicedesk', [{ ...row('school', 1), ref: 'errand:school:1' }]),
      desk('fleet', 'Fordonsbokningen', [{ ...row('fleet', 1), link: 'javascript:alert(1)' }]),
    ]);
    const result = await list(registry, mikael);
    expect(JSON.stringify(result)).not.toContain('Anna');
    expect(result.rows.map(r => r.ref)).toEqual(['request:it:1']);
    expect(result.unanswered).toEqual([
      'Fastighetsjouren',
      'HR-servicedesken',
      'Skolans servicedesk',
      'Fordonsbokningen',
    ]);
  });

  test('a person is only asked about the systems in their scope, and has no list, area or menu row without one', async () => {
    const calls: unknown[] = [];
    const registry = world([desk('it', 'IT-servicedesken', [row('it', 1)], { roles: ['manager'], calls })]);
    expect((await list(registry, hillevi)).rows).toHaveLength(1);
    expect(registry.requestSources(mikael)).toEqual([]);
    expect(registry.allowed(mikael, 'clew.requests')).toBeUndefined();
    await expect(list(registry, mikael)).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(world([]).allowed(hillevi, 'clew.requests')).toBeUndefined();
    // The area follows the list: a person without a source has none to filter on or start from.
    const areasOf = async (actor: Actor) =>
      (await registry.areas(actor)).map(a => [a.id, a.standing.map(s => s.label)]);
    expect(await areasOf(hillevi)).toEqual([['requests', ['Beställningar och felanmälningar']]]);
    expect(await areasOf(mikael)).toEqual([]);
    // The list can be placed in the menu like any tool (D40); a person without a source does not get the row.
    registry.govern(SEARCH_CONNECTOR, {
      ...registry.governance(SEARCH_CONNECTOR),
      capabilities: { 'clew.requests': { menu: true } },
    });
    expect(registry.menu(hillevi).map(e => [e.capability, e.label, e.icon])).toEqual([
      ['clew.requests', 'Mina beställningar', 'clock'],
    ]);
    expect(registry.menu(mikael)).toEqual([]);
  });

  test('the model is offered the one combined list, and only its view lets a row open in another connector', async () => {
    const registry = world([desk('it', 'IT-servicedesken', [row('it', 1)]), desk('hr', 'HR', [row('hr', 1)])]);
    expect(
      registry
        .tools(mikael)
        .map(t => t.name)
        .filter(name => name.endsWith('.requests')),
    ).toEqual(['clew.requests']);
    expect(registry.viewFor(mikael, 'clew.requests')).toMatchObject({
      kind: 'list',
      connector: 'clew',
      rowViews: true,
      modelReads: 'summary',
    });
    expect(registry.viewFor(mikael, 'it.requests')).not.toHaveProperty('rowViews');
  });

  test('requests are kept apart from errands: a source of one is never asked for the other', async () => {
    const registry = new Registry();
    const requests = requestUsecases({ sources: a => registry.requestSources(a) });
    const errands = errandUsecases({ sources: a => registry.errandSources(a) });
    const asked: string[] = [];
    const both: Connector = {
      id: 'it',
      kind: 'passthrough',
      source: 'IT-servicedesken',
      areas: [],
      capabilities: ['it.requests', 'it.errands'].map(name => ({
        name,
        kind: 'read' as const,
        title: name,
        description: 'x',
        input: {} as never,
        output: {} as never,
        model: true,
        scope: {},
        run: async () => {
          asked.push(name);
          return { rows: [] };
        },
      })),
    };
    registry.register(both);
    const errandPart = errandCapabilities(errands, a => registry.errandSources(a).length > 0);
    const requestPart = requestCapabilities(requests, a => registry.requestSources(a).length > 0);
    registry.register({
      id: SEARCH_CONNECTOR,
      kind: 'core',
      source: 'Startsidan',
      areas: [...errandPart.areas, ...requestPart.areas],
      capabilities: [...errandPart.capabilities, ...requestPart.capabilities],
      uses: ['*'],
    });
    expect(registry.requestSources(mikael).map(s => s.name)).toEqual(['it.requests']);
    expect(registry.errandSources(mikael).map(s => s.name)).toEqual(['it.errands']);
    await registry.run(mikael, 'clew.requests', {});
    expect(asked).toEqual(['it.requests']);
    await registry.run(mikael, 'clew.errands', {});
    expect(asked).toEqual(['it.requests', 'it.errands']);
    // Each composite stands for its own sources in the model's tools.
    expect(
      registry
        .tools(mikael)
        .map(t => t.name)
        .sort(),
    ).toEqual(['clew.errands', 'clew.requests']);
  });

  test('a connector outside Clew declares the profile in its manifest on protocol 3 and is listed over the protocol', async () => {
    const manifest = deskManifest;
    expect(manifestProblems(manifest, 'desk')).toEqual([]);
    // The name fixes the shape: the list is about the person who asks and about nobody else (D97).
    const aboutSomeone = structuredClone(manifest) as unknown as { capabilities: Record<string, unknown>[] };
    aboutSomeone.capabilities[0]!.about = { entity: 'person' };
    expect(manifestProblems(aboutSomeone, 'desk')).toEqual([
      expect.stringContaining('desk.requests: a profile read or the header has a shape of its own'),
    ]);
    const answer = {
      rows: [
        row('desk', 4711, { state: 'waiting-on-me', status: 'Väntar på ditt svar' }),
        row('desk', 4702, { state: 'closed', status: 'Levererad', link: 'https://desk.example.invalid/4702' }),
      ],
    };
    const posted: string[] = [];
    const registry = world(
      [
        remoteDesk(manifest, (url, init) => {
          posted.push(url);
          expect(JSON.parse(String(init?.body))).toMatchObject({ input: {} });
          return Response.json({ output: answer });
        }),
      ],
      { perSourceMs: 2000, totalMs: 3000 },
    );
    const result = await list(registry, mikael);
    expect(posted).toEqual(['http://desk/clew/capabilities/desk.requests']);
    expect(result.rows.map(r => [r.label, r.state, r.status, r.system])).toEqual([
      ['DESK-4711 · Dator, Felanmälan', 'Väntar på dig', 'Väntar på ditt svar', 'IT-servicedesken'],
      ['DESK-4702 · Dator, Felanmälan', 'Stängd', 'Levererad', 'IT-servicedesken'],
    ]);
    expect(result.rows[0]!.view).toEqual({
      capability: 'desk.request',
      input: { ref: 'request:desk:4711' },
      title: 'Beställning',
      source: 'IT-servicedesken',
    });
    expect(registry.tools(mikael).map(t => t.name)).not.toContain('desk.requests');
  });

  test('a desk that acts as the person gets the person’s own token through clew.requests, and without it is named', async () => {
    const delegating = { ...deskManifest, delegation: { audience: 'servicedesk' } };
    expect(manifestProblems(delegating, 'desk')).toEqual([]);
    const tokens: Array<string | null> = [];
    const registry = world(
      [
        remoteDesk(delegating, (_url, init) => {
          const token = new Headers(init?.headers).get(DELEGATED_TOKEN_HEADER);
          tokens.push(token);
          // The desk answers only to the person's own token, as a system that decides access itself does.
          return token === 'token-for-servicedesk'
            ? Response.json({ output: { rows: [row('desk', 4711, { state: 'waiting-on-me' })] } })
            : Response.json({ error: { code: 'denied', message: 'Du saknar behörighet.' } }, { status: 403 });
        }),
        desk('facilities', 'Fastighetsjouren', [row('facilities', 1)]),
      ],
      { perSourceMs: 2000, totalMs: 3000 },
    );
    const audiences: string[] = [];
    const delegate = async (audience: string) => {
      audiences.push(audience);
      return audience === 'servicedesk' ? 'token-for-servicedesk' : undefined;
    };
    const result = await list(registry, mikael, { delegate });
    expect(audiences).toEqual(['servicedesk']);
    expect(tokens).toEqual(['token-for-servicedesk']);
    expect(result.rows.map(r => [r.ref, r.system])).toEqual([
      ['request:desk:4711', 'IT-servicedesken'],
      ['request:facilities:1', 'Fastighetsjouren'],
    ]);
    // Without the person's token the desk cannot be asked as them; the other system still answers and the gap is named.
    const without = await list(registry, mikael);
    expect(tokens).toEqual(['token-for-servicedesk', null]);
    expect(without.rows.map(r => r.system)).toEqual(['Fastighetsjouren']);
    expect(without.unanswered).toEqual(['IT-servicedesken']);
  });
});
