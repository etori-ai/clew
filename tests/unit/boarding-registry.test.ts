import { describe, expect, test } from 'bun:test';
import {
  BOARDING_IMPORT_COLUMNS,
  BOARDING_IMPORT_ROWS_MAX,
  BOARDING_LAYER_ITEMS_MAX,
  BOARDING_LAYER_NAME_MAX,
  BOARDING_TIED_TO_MAX,
  BOARDING_TITLE_MAX,
  BOARDING_VALUE_MAX,
  BoardingPlanOutputSchema,
  type BoardingImportRow,
  checkContract,
  parseBoardingImport,
  type AuthenticatedContext,
} from '../../packages/contracts/src/index';
import {
  BOARDING_CONNECTOR,
  Registry,
  actorOf,
  viewProblem,
  type RelationResolver,
} from '../../packages/connectors/src/index';
import { memoryConnectorStore } from '../../apps/server/src/connectors/adapters/memory';
import { connectorUsecases, type AdminDeps } from '../../apps/server/src/connectors/usecases/admin';
import { applyAllRows, syncBundledRows, type ReconcileDeps } from '../../apps/server/src/connectors/reconcile';
import { memoryBoardingStore } from '../../apps/server/src/modules/boarding/adapters/memory';
import {
  PersonBoardingOutputSchema,
  boardingConnector,
  personBoardingView,
  planView,
} from '../../apps/server/src/modules/boarding/capabilities';
import type { Report, Staff } from '../../apps/server/src/modules/boarding/model';
import { boardingUsecases } from '../../apps/server/src/modules/boarding/usecases';
import { IMPORT_BODY_MAX, NOT_ENABLED, boardingRoutes } from '../../apps/server/src/routes/boarding';

/**
 * The boarding wiring as the server assembles it (D124), on memory adapters and the production registry, which denies
 * what no row governs: the bundled connector's row is created disabled, so nothing of the domain shows until an
 * administrator switches it on; `boarding.person` answers through the registry for the reader's reports alone; the
 * scan suggests without a name in what the assistant reads; and Clew's own routes answer only while it is on.
 */
const ORG = 'org-test';
const T0 = '2026-11-13T09:00:00.000Z';
const persona = (
  id: string,
  name: string,
  role: 'manager' | 'employee',
  capabilities: AuthenticatedContext['capabilities'] = [],
): AuthenticatedContext => ({
  id,
  name,
  unitId: 'unit-skola',
  unitLabel: 'Bergsåkers skola',
  role,
  organisationId: ORG,
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities,
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
});
const hillevi = persona('hillevi', 'Hillevi Berg', 'manager');
const anna = persona('p-anna', 'Anna Lindqvist', 'employee');
const vilma = persona('p-vilma', 'Vilma Strand', 'employee');
const mikael = persona('mikael', 'Mikael Lund', 'employee', ['admin.connectors', 'admin.boarding']);
const personas = new Map([hillevi, anna, vilma, mikael].map(p => [p.id, p]));
const report = (id: string, name: string, userName: string, startDate?: string): Report => ({
  id,
  name,
  userName,
  enabled: true,
  unitIds: ['unit-skola'],
  positionCodes: ['larare'],
  employments: [{ employmentType: 'Tillsvidare', ...(startDate ? { startDate } : {}) }],
});
/** Hillevi's reports: Anna, and Vilma, a teacher who starts in three weeks. */
const REPORTS = [
  report('p-anna', 'Anna Lindqvist', 'anna'),
  report('p-vilma', 'Vilma Strand', 'vilma.strand', '2026-12-04'),
];
const staff: Staff = async p =>
  p.id === 'hillevi'
    ? { manages: true, reports: REPORTS, tree: [{ id: 'unit-skola', parentId: null }] }
    : { manages: false, reports: [], tree: [] };
/** Who may be asked about (D117), as the directory would answer it: Hillevi manages Anna and Vilma; nobody else anyone. */
const relations: RelationResolver = async (actor, entity, keys, admits) =>
  keys.flatMap(asked =>
    entity === 'person' &&
    actor.id === 'hillevi' &&
    admits.includes('managed') &&
    ['anna', 'vilma.strand'].includes(asked.toLowerCase())
      ? [{ asked, key: asked.toLowerCase(), relation: 'managed' as const }]
      : [],
  );
const LAYERS = [
  BOARDING_IMPORT_COLUMNS.join(';'),
  'Alla nyanställda;introduction;all;;Beställ dator;order;manager;-14;',
  'Alla nyanställda;introduction;all;;Välkomstsamtal;meeting;manager;0;',
  'Lärare;introduction;position;larare;Läs skolans rutiner;acknowledge;person;3;',
].join('\n');

function world() {
  let now = Date.parse(T0);
  const clock = () => new Date(now);
  let n = 0;
  const store = memoryBoardingStore({
    persons: [
      { id: 'p-anna', organisationId: ORG, name: 'Anna Lindqvist', userName: 'anna', enabled: true },
      { id: 'p-vilma', organisationId: ORG, name: 'Vilma Strand', userName: 'vilma.strand', enabled: true },
      { id: 'hillevi', organisationId: ORG, name: 'Hillevi Berg', userName: 'hillevi', enabled: true },
    ],
  });
  const boarding = boardingUsecases({ store, staff, clock, ids: () => 'id-' + ++n });
  const registry = new Registry({ relations });
  registry.register({
    ...boardingConnector(boarding, async a => {
      const p = personas.get(a.id);
      if (!p) throw new Error('unknown');
      return p;
    }),
    uses: ['*'],
  });
  const connectors = memoryConnectorStore();
  const secrets = { seal: (v: string) => v, open: (v: string) => v };
  const live = { register: () => undefined, unregister: () => undefined };
  const reconcile: ReconcileDeps = {
    registry,
    store: connectors,
    secrets,
    live,
    bundled: [BOARDING_CONNECTOR],
    offAtFirstBoot: [BOARDING_CONNECTOR],
    internal: [],
    clock,
    log: () => undefined,
  };
  const deps: AdminDeps = {
    internal: [],
    store: connectors,
    registry,
    clock,
    live,
    units: { list: async () => [] },
    groups: { list: async () => [] },
    secrets,
    transport: {
      fetchManifest: async () => {
        throw new Error('not called');
      },
      check: async () => {
        throw new Error('not called');
      },
    },
  };
  const writable = async (p: AuthenticatedContext) => {
    await applyAllRows(reconcile);
    return registry.visible(actorOf(p), BOARDING_CONNECTOR);
  };
  const app = boardingRoutes({
    boarding,
    writable,
    guard: async (c, next) => {
      c.set('session', { context: personas.get(c.req.header('x-test-person') ?? '')! } as never);
      await next();
    },
  });
  const call = (who: AuthenticatedContext, method: string, path: string, body?: unknown) =>
    app.request('http://clew.local' + path, {
      method,
      headers: { 'x-test-person': who.id, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    registry,
    boarding,
    store,
    connectors,
    admin: connectorUsecases(deps),
    reconcile,
    call,
    advance: (ms: number) => void (now += ms),
  };
}
/** The world with the module switched on and the layers imported, as an administrator would. */
async function switchedOn() {
  const w = world();
  await syncBundledRows(w.reconcile);
  await w.admin.update(mikael, BOARDING_CONNECTOR, { state: 'enabled' });
  await w.boarding.seedLayers('operator:test', ORG, parseBoardingImport(LAYERS).rows);
  return w;
}

describe('the boarding wiring (D124)', () => {
  test('the bundled row is created disabled: no area, no read, no scan and no route until an administrator switches it on', async () => {
    const w = world();
    await syncBundledRows(w.reconcile);
    await applyAllRows(w.reconcile);
    expect((await w.connectors.read(BOARDING_CONNECTOR))!).toMatchObject({ bundled: true, state: 'disabled' });
    for (const p of [hillevi, anna]) {
      expect(w.registry.visible(actorOf(p), BOARDING_CONNECTOR)).toBe(false);
      expect((await w.registry.areas(actorOf(p))).map(a => a.id)).toEqual([]);
      expect(await w.registry.scan(actorOf(p))).toEqual([]);
      await expect(w.registry.run(actorOf(p), 'boarding.person', { keys: ['anna'] })).rejects.toThrow();
    }
    const refused = await w.call(hillevi, 'GET', '/plans');
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: NOT_ENABLED, code: 'denied' });
    expect(
      (await w.call(hillevi, 'POST', '/plans', { personId: 'p-vilma', event: 'introduction', anchorOn: '2026-12-04' }))
        .status,
    ).toBe(403);
    expect(w.store.state.plans.size).toBe(0);

    w.advance(60_000);
    await w.admin.update(mikael, BOARDING_CONNECTOR, { state: 'enabled' });
    expect((await w.registry.areas(actorOf(hillevi))).map(a => a.id)).toEqual(['boarding']);
    // A later boot leaves the administrator's choice alone.
    await syncBundledRows(w.reconcile);
    expect((await w.connectors.read(BOARDING_CONNECTOR))!.state).toBe('enabled');
  });

  test('it passes the registry’s validation, its reads are no model tools, and their views are drawable', async () => {
    const w = await switchedOn();
    expect(w.registry.tools(actorOf(hillevi))).toEqual([]);
    const reads = w.registry.connector(BOARDING_CONNECTOR)!.capabilities;
    for (const c of reads) expect(viewProblem(c, reads)).toBeUndefined();
    expect(reads.map(c => c.view)).toEqual([planView, personBoardingView]);
    const found = w.registry.find('boarding.person')!.capability;
    expect(found.about).toEqual({ entity: 'person', page: { title: 'Öppna planen', href: '/boarding/{id}' } });
    expect(found.person).toEqual({ admits: ['managed'] });
  });

  test('`boarding.person` answers through the registry for the reader’s reports alone', async () => {
    const w = await switchedOn();
    const answer = (await w.registry.run(actorOf(hillevi), 'boarding.person', {
      keys: ['vilma.strand', 'anna', 'hillevi', 'someone'],
    })) as { rows: Array<Record<string, unknown>> };
    expect(checkContract(PersonBoardingOutputSchema, answer)).toBe(true);
    // Vilma starts within the window with no plan; Anna has neither a plan nor a start, so she has no row.
    expect(answer.rows).toEqual([
      { key: 'vilma.strand', status: 'Plan saknas', event: 'Introduktion', day: 'Börjar 4 dec' },
    ]);
    const { id } = await w.boarding.startPlan(hillevi, {
      personId: 'p-vilma',
      event: 'introduction',
      anchorOn: '2026-12-04',
    });
    const after = (await w.registry.run(actorOf(hillevi), 'boarding.person', { keys: ['vilma.strand'] })) as {
      rows: Array<Record<string, unknown>>;
    };
    expect(after.rows).toEqual([
      {
        key: 'vilma.strand',
        status: 'Pågår',
        event: 'Introduktion',
        day: 'Börjar 4 dec',
        progress: '0 av 3',
        waiting: '2 uppgifter',
        plan: id,
      },
    ]);
    // Anyone else is asked about nobody: the registry leaves every key out.
    expect(
      ((await w.registry.run(actorOf(anna), 'boarding.person', { keys: ['vilma.strand'] })) as { rows: unknown[] })
        .rows,
    ).toEqual([]);
    // The row opens the plan, through the registry, for whoever the plan lets read it.
    const plan = await w.registry.run(actorOf(hillevi), 'boarding.plan', { plan: id });
    expect(checkContract(BoardingPlanOutputSchema, plan)).toBe(true);
    expect((plan as { rows: unknown[] }).rows).toHaveLength(3);
    const own = (await w.registry.run(actorOf(vilma), 'boarding.plan', { plan: id })) as {
      plan: { access: string };
    };
    expect(own.plan.access).toBe('person');
    await expect(w.registry.run(actorOf(anna), 'boarding.plan', { plan: id })).rejects.toThrow(
      'Planen finns inte, eller så kan du inte se den.',
    );
  });

  test('the scan suggests the introduction with nobody named where the assistant reads, as a complete observation', async () => {
    const w = await switchedOn();
    const observed = await w.registry.scanOne(actorOf(hillevi), BOARDING_CONNECTOR);
    expect(observed.observation).toMatchObject({ completeness: 'complete', exhausted: true, observedAt: T0 });
    expect(observed.drafts).toHaveLength(1);
    const [draft] = observed.drafts;
    expect(draft).toMatchObject({
      topic: 'boarding:suggestion:p-vilma:2026-12-04',
      area: 'boarding',
      title: 'Förbered introduktionen',
      reason: 'Börjar snart',
      deadline: '2026-12-04',
      occurrences: [{ key: 'boarding:suggestion:p-vilma', revision: '2026-12-04', period: '2026-12-04' }],
      actions: [{ capability: 'boarding.person', kind: 'read', input: { keys: ['vilma.strand'] } }],
    });
    expect(draft!.items).toEqual([
      {
        ref: 'boarding:person:p-vilma',
        // Nobody named, on the row either (vision principle 7): the person is the row's subject and the read's input.
        label: 'Ny medarbetare',
        detail: 'Börjar 4 dec',
        selectable: false,
        selected: false,
        subject: { entity: 'person', key: 'vilma.strand' },
      },
    ]);
    expect(JSON.stringify(draft)).not.toContain('Vilma');
    // Started, the suggestion is gone from the next observation, which resolves the card.
    await w.boarding.startPlan(hillevi, { personId: 'p-vilma', event: 'introduction', anchorOn: '2026-12-04' });
    expect((await w.registry.scanOne(actorOf(hillevi), BOARDING_CONNECTOR)).drafts).toEqual([]);
    // Someone who manages nobody is observed completely too: nothing.
    expect((await w.registry.scanOne(actorOf(anna), BOARDING_CONNECTOR)).drafts).toEqual([]);
  });

  test('switched on, the routes start a plan, tick an item, add one, close the plan and import layers, and map each refusal', async () => {
    const w = await switchedOn();
    const preview = await w.call(hillevi, 'POST', '/preview', {
      personId: 'p-vilma',
      event: 'introduction',
      anchorOn: '2026-12-04',
    });
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { items: unknown[] }).items).toHaveLength(3);
    expect(
      (await w.call(hillevi, 'POST', '/plans', { personId: 'p-vilma', event: 'birthday', anchorOn: '2026-12-04' }))
        .status,
    ).toBe(400);
    expect(
      (await w.call(anna, 'POST', '/plans', { personId: 'p-vilma', event: 'introduction', anchorOn: '2026-12-04' }))
        .status,
    ).toBe(403);
    const started = await w.call(hillevi, 'POST', '/plans', {
      personId: 'p-vilma',
      event: 'introduction',
      anchorOn: '2026-12-04',
    });
    expect(started.status).toBe(201);
    const { id } = (await started.json()) as { id: string };
    const again = await w.call(hillevi, 'POST', '/plans', {
      personId: 'p-vilma',
      event: 'introduction',
      anchorOn: '2026-12-04',
    });
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: 'Personen har redan en pågående introduktion.' });

    const page = await w.call(hillevi, 'GET', '/plans/' + id);
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toContain('no-store');
    const plan = (await page.json()) as { rows: Array<{ id: string; title: string }> };
    const read = plan.rows.find(r => r.title === 'Läs skolans rutiner')!;
    expect((await w.call(anna, 'POST', `/items/${read.id}/done`)).status).toBe(403);
    expect((await w.call(vilma, 'POST', `/items/${read.id}/done`)).status).toBe(204);
    expect((await w.call(vilma, 'DELETE', `/items/${read.id}/done`)).status).toBe(204);
    const added = await w.call(hillevi, 'POST', `/plans/${id}/items`, {
      title: 'Ring Vilma veckan före',
      kind: 'todo',
      ownerRole: 'manager',
      dueOn: '2026-11-27',
    });
    expect(added.status).toBe(201);
    expect((await w.call(hillevi, 'POST', `/plans/${id}/items`, { title: 'x', kind: 'todo' })).status).toBe(400);
    expect(((await (await w.call(hillevi, 'GET', '/plans')).json()) as { rows: unknown[] }).rows).toHaveLength(1);
    expect(((await (await w.call(hillevi, 'GET', '/people/p-vilma')).json()) as { canStart: boolean }).canStart).toBe(
      true,
    );
    expect(await (await w.call(hillevi, 'GET', '/suggestions')).json()).toEqual({ rows: [] });
    expect((await w.call(hillevi, 'POST', `/plans/${id}/close`)).status).toBe(204);
    expect(w.store.state.plans.get(id)?.closedAt).not.toBeNull();

    // The layers are the administrator's: anyone else is refused before the body is read.
    expect((await w.call(hillevi, 'GET', '/layers')).status).toBe(403);
    expect((await w.call(hillevi, 'POST', '/layers/import', { rows: [] })).status).toBe(403);
    const rows = parseBoardingImport(LAYERS).rows;
    const imported = await w.call(mikael, 'POST', '/layers/import', { rows });
    expect(imported.status).toBe(200);
    expect(await imported.json()).toEqual({ layers: 2, added: 0, replaced: 0, unchanged: 2 });
    const bad = await w.call(mikael, 'POST', '/layers/import', {
      rows: rows.map(r => (r.row === 3 ? { ...r, title: ' Välkomstsamtal' } : r)),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Rad 3: Raden innehåller text som inte är rensad.' });
    const layers = (await (await w.call(mikael, 'GET', '/layers')).json()) as { layers: unknown[] };
    expect(layers.layers).toHaveLength(2);
  });

  test('an item’s owner reads, through `boarding.plan`, their own items and the counts of those alone', async () => {
    const w = await switchedOn();
    const { id } = await w.boarding.startPlan(hillevi, {
      personId: 'p-vilma',
      event: 'introduction',
      anchorOn: '2026-12-04',
      buddyId: 'p-anna',
    });
    await w.boarding.addItem(hillevi, id, {
      title: 'Visa skolgården',
      kind: 'meeting',
      ownerRole: 'buddy',
      dueOn: '2026-12-05',
    });
    const asBuddy = (await w.registry.run(actorOf(anna), 'boarding.plan', { plan: id })) as {
      note: string;
      plan: { access: string; done: number; total: number };
      rows: unknown[];
    };
    expect(asBuddy.plan).toMatchObject({ access: 'owner', done: 0, total: 1 });
    expect(asBuddy.rows).toHaveLength(1);
    expect(asBuddy.note).toBe('Första dagen 4 december · 0 av 1 klara');
    const asManager = (await w.registry.run(actorOf(hillevi), 'boarding.plan', { plan: id })) as {
      plan: { total: number };
    };
    expect(asManager.plan.total).toBe(4);
  });

  test('an added item that names what it ties to is refused: `tiedTo` is the administrator’s, on a layer', async () => {
    const w = await switchedOn();
    const { id } = await w.boarding.startPlan(hillevi, {
      personId: 'p-vilma',
      event: 'introduction',
      anchorOn: '2026-12-04',
    });
    const refused = await w.call(hillevi, 'POST', `/plans/${id}/items`, {
      title: 'Gå kursen',
      kind: 'course',
      ownerRole: 'person',
      dueOn: '2026-12-10',
      tiedTo: 'competence.holdings',
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'Ogiltig förfrågan.' });
    expect(w.store.state.items.size).toBe(3);
  });

  test('a file at every limit the page accepts is a body the route reads; one larger is refused before it is parsed', async () => {
    const w = await switchedOn();
    // Every text at its longest, in a character JSON escapes, so the body is as long as a file the page accepts can make it.
    const text = (n: number, tag: string) => '"'.repeat(n - tag.length) + tag;
    const layers = BOARDING_IMPORT_ROWS_MAX / BOARDING_LAYER_ITEMS_MAX;
    const rows: BoardingImportRow[] = Array.from({ length: BOARDING_IMPORT_ROWS_MAX }, (_, i) => ({
      row: i + 2,
      layer: text(BOARDING_LAYER_NAME_MAX, String(Math.floor(i / BOARDING_LAYER_ITEMS_MAX))),
      event: 'introduction',
      condition: 'employment_type',
      value: text(BOARDING_VALUE_MAX, 'x'),
      title: text(BOARDING_TITLE_MAX, String(i)),
      kind: 'acknowledge',
      owner: 'manager',
      offsetDays: -365,
      tiedTo: text(BOARDING_TIED_TO_MAX, 'y'),
    }));
    const body = JSON.stringify({ rows });
    // The page's file at its limits is over a million characters, which the route once refused.
    expect(body.length).toBeGreaterThan(1_000_000);
    expect(body.length).toBeLessThanOrEqual(IMPORT_BODY_MAX);
    const imported = await w.call(mikael, 'POST', '/layers/import', { rows });
    expect(imported.status).toBe(200);
    expect(await imported.json()).toEqual({ layers, added: layers, replaced: 0, unchanged: 0 });
    const tooLarge = await w.call(mikael, 'POST', '/layers/import', { rows, padding: ' '.repeat(IMPORT_BODY_MAX) });
    expect(tooLarge.status).toBe(400);
    expect(await tooLarge.json()).toEqual({ error: 'För stor förfrågan.' });
  });
});
