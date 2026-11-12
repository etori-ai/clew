import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, StaffOverview, StaffPerson } from '../../packages/contracts/src/index';
import { COMPETENCE_CONNECTOR, Registry, actorOf } from '../../packages/connectors/src/index';
import { memoryConnectorStore } from '../../apps/server/src/connectors/adapters/memory';
import { connectorUsecases, type AdminDeps } from '../../apps/server/src/connectors/usecases/admin';
import { applyAllRows, syncBundledRows, type ReconcileDeps } from '../../apps/server/src/connectors/reconcile';
import { memoryCompetenceStore } from '../../apps/server/src/modules/competence/adapters/memory';
import { competenceConnector } from '../../apps/server/src/modules/competence/capabilities';
import { competenceUsecases } from '../../apps/server/src/modules/competence/usecases';
import { competenceRoutes, NOT_ENABLED } from '../../apps/server/src/routes/competence';

/**
 * The competence wiring as the server assembles it (D108 item 13), on memory adapters and the production registry,
 * which denies what no row governs: the bundled connector's row is created disabled, so nothing of the domain shows
 * until an administrator switches it on; and Clew's own routes answer only while it is on for the person.
 */
const ORG = 'org-test';
const T0 = '2026-11-10T09:00:00.000Z';
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
const mikael = persona('mikael', 'Mikael Lund', 'employee', ['admin.connectors', 'admin.competence']);
const staffAnna: StaffPerson = {
  id: 'p-anna',
  name: 'Anna Lindqvist',
  userName: 'anna.lindqvist',
  email: null,
  role: 'employee',
  enabled: true,
};
const overviews = new Map<string, StaffOverview>([
  ['hillevi', { units: [{ unitId: 'unit-skola', unitLabel: 'Bergsåkers skola', people: [staffAnna] }] }],
]);
const personas = new Map([hillevi, anna, mikael].map(p => [p.id, p]));

function world() {
  let now = Date.parse(T0);
  const clock = () => new Date(now);
  let n = 0;
  const store = memoryCompetenceStore({
    persons: [{ id: 'p-anna', organisationId: ORG, name: 'Anna Lindqvist', userName: 'anna.lindqvist' }],
  });
  const competence = competenceUsecases({
    store,
    staff: async p => overviews.get(p.id) ?? { units: [] },
    clock,
    ids: () => 'id-' + ++n,
  });
  const registry = new Registry();
  registry.register({
    ...competenceConnector(competence, async a => {
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
    bundled: [COMPETENCE_CONNECTOR],
    offAtFirstBoot: [COMPETENCE_CONNECTOR],
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
    return registry.visible(actorOf(p), COMPETENCE_CONNECTOR);
  };
  /** The routes behind a guard that signs the request in as the persona named in `x-test-person`. */
  const app = competenceRoutes({
    competence,
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
    competence,
    store,
    connectors,
    admin: connectorUsecases(deps),
    reconcile,
    call,
    advance: (ms: number) => void (now += ms),
  };
}

describe('the competence wiring (D108 item 13)', () => {
  test('the bundled row is created disabled: no area, no read, no card and no route until an administrator switches it on', async () => {
    const w = world();
    await syncBundledRows(w.reconcile);
    await applyAllRows(w.reconcile);
    expect((await w.connectors.read(COMPETENCE_CONNECTOR))!).toMatchObject({ bundled: true, state: 'disabled' });
    for (const p of [hillevi, anna]) {
      expect(w.registry.visible(actorOf(p), COMPETENCE_CONNECTOR)).toBe(false);
      expect((await w.registry.areas(actorOf(p))).map(a => a.id)).toEqual([]);
      expect(await w.registry.scan(actorOf(p))).toEqual([]);
      await expect(w.registry.run(actorOf(p), 'competence.holdings', {})).rejects.toThrow();
    }
    const refused = await w.call(mikael, 'GET', '/types');
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: NOT_ENABLED, code: 'denied' });
    expect((await w.call(mikael, 'POST', '/types', { name: 'HLR', area: 'Akut', kind: 'course' })).status).toBe(403);
    expect(w.store.state.types.size).toBe(0);

    w.advance(60_000);
    await w.admin.update(mikael, COMPETENCE_CONNECTOR, { state: 'enabled' });
    expect(w.registry.visible(actorOf(hillevi), COMPETENCE_CONNECTOR)).toBe(true);
    expect((await w.registry.areas(actorOf(hillevi))).map(a => a.id)).toEqual(['competence']);
    expect(await w.registry.run(actorOf(anna), 'competence.holdings', {})).toEqual({ rows: [] });
    // A later boot leaves the administrator's choice alone, on as well as off.
    await syncBundledRows(w.reconcile);
    expect((await w.connectors.read(COMPETENCE_CONNECTOR))!.state).toBe('enabled');
    w.advance(60_000);
    await w.admin.update(mikael, COMPETENCE_CONNECTOR, { state: 'disabled' });
    await syncBundledRows(w.reconcile);
    expect((await w.connectors.read(COMPETENCE_CONNECTOR))!.state).toBe('disabled');
  });

  test('switched on, the routes carry the catalogue and a registration, and map each refusal', async () => {
    const w = world();
    await syncBundledRows(w.reconcile);
    await w.admin.update(mikael, COMPETENCE_CONNECTOR, { state: 'enabled' });

    const added = await w.call(mikael, 'POST', '/types', {
      name: 'HLR',
      area: 'Akut',
      kind: 'course',
      validityMonths: 24,
    });
    expect(added.status).toBe(201);
    const { id: typeId } = (await added.json()) as { id: string };
    // A body outside the contract, a taken name and a missing capability each have their own answer.
    expect((await w.call(mikael, 'POST', '/types', { name: 'X', area: 'Y', kind: 'diploma' })).status).toBe(400);
    const taken = await w.call(mikael, 'POST', '/types', { name: 'hlr', area: 'Akut', kind: 'course' });
    expect(taken.status).toBe(400);
    expect(((await taken.json()) as { error: string }).error).toBe('Det finns redan en kompetens med det namnet.');
    expect((await w.call(hillevi, 'POST', '/types', { name: 'Ny', area: 'Akut', kind: 'course' })).status).toBe(403);

    const listed = await w.call(hillevi, 'GET', '/types');
    expect(listed.status).toBe(200);
    expect(listed.headers.get('cache-control')).toContain('no-store');
    expect(await listed.json()).toEqual({
      rows: [{ id: typeId, name: 'HLR', area: 'Akut', kind: 'course', validityMonths: 24, archived: false }],
    });
    expect((await w.call(anna, 'GET', '/types')).status).toBe(403);

    const registered = await w.call(hillevi, 'POST', '/people/p-anna/holdings', { typeId, issuedOn: '2025-05-10' });
    expect(registered.status).toBe(201);
    const { id: holdingId } = (await registered.json()) as { id: string };
    expect((await w.call(hillevi, 'POST', '/people/p-anna/holdings', { typeId, issuedOn: '10 maj' })).status).toBe(400);
    expect(
      (await w.call(hillevi, 'POST', '/people/p-nobody/holdings', { typeId, issuedOn: '2025-05-10' })).status,
    ).toBe(403);
    expect((await w.call(anna, 'POST', '/people/p-anna/holdings', { typeId, issuedOn: '2025-05-10' })).status).toBe(
      403,
    );

    const impact = await w.call(mikael, 'GET', `/types/${typeId}/validity?months=12`);
    expect(await impact.json()).toEqual({ holdings: 1, expiredBefore: 0, expiredAfter: 1 });
    expect((await w.call(mikael, 'GET', `/types/${typeId}/validity?months=none`)).status).toBe(200);
    expect((await w.call(mikael, 'GET', `/types/${typeId}/validity?months=0`)).status).toBe(400);
    expect((await w.call(mikael, 'PATCH', `/types/${typeId}`, { validityMonths: 12 })).status).toBe(204);
    expect(w.store.state.types.get(typeId)?.validityMonths).toBe(12);

    expect((await w.call(anna, 'DELETE', `/holdings/${holdingId}`)).status).toBe(403);
    expect((await w.call(hillevi, 'DELETE', `/holdings/${holdingId}`)).status).toBe(204);
    expect(w.store.state.holdings.get(holdingId)?.state).toBe('revoked');
    expect((await w.call(mikael, 'POST', `/types/${typeId}/archive`)).status).toBe(204);
    expect(w.store.state.types.get(typeId)?.archivedAt).not.toBeNull();
  });

  test('the routes carry requirements and share targets (D108 item 6) and map each refusal', async () => {
    const w = world();
    await syncBundledRows(w.reconcile);
    await w.admin.update(mikael, COMPETENCE_CONNECTOR, { state: 'enabled' });
    w.store.addPosition({ id: 'pos-usk', organisationId: ORG, code: 'usk', label: 'Undersköterska' });
    w.store.addUnit({ id: 'unit-skola', organisationId: ORG, label: 'Bergsåkers skola' });
    const added = await w.call(mikael, 'POST', '/types', { name: 'HLR', area: 'Akut', kind: 'course' });
    const { id: typeId } = (await added.json()) as { id: string };

    const onPosition = await w.call(mikael, 'POST', '/requirements', { typeId, positionId: 'pos-usk' });
    expect(onPosition.status).toBe(201);
    const { id: requirementId } = (await onPosition.json()) as { id: string };
    // A body outside the contract, a body naming no target, a taken one and a missing capability each have their answer.
    expect((await w.call(mikael, 'POST', '/requirements', { typeId, positionId: 'pos-usk', minLevel: 2 })).status).toBe(
      400,
    );
    const none = await w.call(mikael, 'POST', '/requirements', { typeId });
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: string }).error).toBe(
      'Ett krav gäller en befattning, en enhet eller en person.',
    );
    const again = await w.call(mikael, 'POST', '/requirements', { typeId, positionId: 'pos-usk' });
    expect(((await again.json()) as { error: string }).error).toBe('Det kravet finns redan.');
    expect((await w.call(hillevi, 'POST', '/requirements', { typeId, unitId: 'unit-skola' })).status).toBe(403);
    // One person: their manager, never the administrator (D118).
    expect((await w.call(mikael, 'POST', '/requirements', { typeId, personId: 'p-anna' })).status).toBe(403);
    const onAnna = await w.call(hillevi, 'POST', '/requirements', { typeId, personId: 'p-anna' });
    expect(onAnna.status).toBe(201);

    const listed = await w.call(mikael, 'GET', '/requirements');
    expect(listed.status).toBe(200);
    expect(listed.headers.get('cache-control')).toContain('no-store');
    expect(await listed.json()).toEqual({
      rows: [{ id: requirementId, typeId, on: 'position', targetId: 'pos-usk', targetLabel: 'Undersköterska' }],
      positions: [{ id: 'pos-usk', code: 'usk', label: 'Undersköterska' }],
      units: [{ id: 'unit-skola', label: 'Bergsåkers skola' }],
    });
    expect((await w.call(hillevi, 'GET', '/requirements')).status).toBe(403);
    expect((await w.call(hillevi, 'DELETE', `/requirements/${requirementId}`)).status).toBe(403);
    expect((await w.call(mikael, 'DELETE', `/requirements/${requirementId}`)).status).toBe(204);
    expect((await w.call(mikael, 'DELETE', `/requirements/${requirementId}`)).status).toBe(400);

    const target = await w.call(mikael, 'POST', '/share-targets', { typeId, positionId: 'pos-usk', minShare: 40 });
    expect(target.status).toBe(201);
    const { id: targetId } = (await target.json()) as { id: string };
    for (const minShare of [0, 101, 12.5, '40'])
      expect((await w.call(mikael, 'POST', '/share-targets', { typeId, positionId: 'pos-usk', minShare })).status).toBe(
        400,
      );
    expect(
      (
        await w.call(hillevi, 'POST', '/share-targets', {
          typeId,
          positionId: 'pos-usk',
          unitId: 'unit-skola',
          minShare: 40,
        })
      ).status,
    ).toBe(403);
    const targets = await w.call(mikael, 'GET', '/share-targets');
    expect(targets.headers.get('cache-control')).toContain('no-store');
    expect(await targets.json()).toEqual({
      rows: [{ id: targetId, typeId, positionId: 'pos-usk', positionLabel: 'Undersköterska', minShare: 40 }],
    });
    expect((await w.call(hillevi, 'DELETE', `/share-targets/${targetId}`)).status).toBe(403);
    expect((await w.call(mikael, 'DELETE', `/share-targets/${targetId}`)).status).toBe(204);
    expect(w.store.state.shareTargets.size).toBe(0);
  });

  test('switched off, the requirements and share targets are refused like every other route', async () => {
    const w = world();
    await syncBundledRows(w.reconcile);
    for (const [method, path] of [
      ['GET', '/requirements'],
      ['POST', '/requirements'],
      ['DELETE', '/requirements/r1'],
      ['GET', '/share-targets'],
      ['POST', '/share-targets'],
      ['DELETE', '/share-targets/s1'],
    ] as const) {
      const refused = await w.call(mikael, method, path, method === 'POST' ? {} : undefined);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: NOT_ENABLED, code: 'denied' });
    }
  });
});
