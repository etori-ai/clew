import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, StaffOverview, StaffPerson } from '../../packages/contracts/src/index';
import { COMPETENCE_CONNECTOR, Registry, audiencedActorOf, openGovernance } from '../../packages/connectors/src/index';
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
/** D121: HR's registrar, who holds Kompetenssökning by grant and manages nobody. */
const hr: AuthenticatedContext = { ...persona('hr', 'Hanna Registrator', 'employee'), relationGrants: ['registrar'] };
/** Acting head: her grant says employee, and Anna reports to her (D99), as the matrix counts it. */
const acting = persona('acting', 'Agneta Tf', 'employee');
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
  ['acting', { units: [{ unitId: 'unit-skola', unitLabel: 'Bergsåkers skola', people: [staffAnna] }] }],
]);
const personas = new Map([hillevi, anna, mikael, acting, hr].map(p => [p.id, p]));

function world() {
  let now = Date.parse(T0);
  const clock = () => new Date(now);
  let n = 0;
  const store = memoryCompetenceStore({
    persons: [
      { id: 'p-anna', organisationId: ORG, name: 'Anna Lindqvist', userName: 'anna.lindqvist', enabled: true },
      { id: 'hillevi', organisationId: ORG, name: 'Hillevi Berg', userName: 'hillevi.berg', enabled: true },
    ],
  });
  const competence = competenceUsecases({
    store,
    staff: async p => overviews.get(p.id) ?? { units: [] },
    // Anna reports to Hillevi (D99 item 4); Hillevi and Mikael report to nobody.
    above: async p => (p.id === 'p-anna' ? ['hillevi'] : []),
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
    return registry.visible(audiencedActorOf(p), COMPETENCE_CONNECTOR);
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
  /** A request as it comes off the wire: its own headers, and a body that may be sent in pieces. */
  const raw = (who: AuthenticatedContext, method: string, path: string, init: RequestInit) =>
    app.request('http://clew.local' + path, {
      method,
      ...init,
      headers: { 'x-test-person': who.id, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  return {
    registry,
    competence,
    store,
    raw,
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
      expect(w.registry.visible(audiencedActorOf(p), COMPETENCE_CONNECTOR)).toBe(false);
      expect((await w.registry.areas(audiencedActorOf(p))).map(a => a.id)).toEqual([]);
      expect(await w.registry.scan(audiencedActorOf(p))).toEqual([]);
      await expect(w.registry.run(audiencedActorOf(p), 'competence.holdings', {})).rejects.toThrow();
    }
    const refused = await w.call(mikael, 'GET', '/types');
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: NOT_ENABLED, code: 'denied' });
    expect((await w.call(mikael, 'POST', '/types', { name: 'HLR', area: 'Akut', kind: 'course' })).status).toBe(403);
    expect(w.store.state.types.size).toBe(0);

    w.advance(60_000);
    await w.admin.update(mikael, COMPETENCE_CONNECTOR, { state: 'enabled' });
    expect(w.registry.visible(audiencedActorOf(hillevi), COMPETENCE_CONNECTOR)).toBe(true);
    expect((await w.registry.areas(audiencedActorOf(hillevi))).map(a => a.id)).toEqual(['competence']);
    expect(await w.registry.run(audiencedActorOf(anna), 'competence.holdings', {})).toEqual({ rows: [] });
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
    // A person reads the types they may register one of their own for (D108 item 7), the archived ones left out.
    const ownTypes = await w.call(anna, 'GET', '/own/types');
    expect(ownTypes.headers.get('cache-control')).toContain('no-store');
    expect(await ownTypes.json()).toEqual({
      rows: [{ id: typeId, name: 'HLR', area: 'Akut', kind: 'course', validityMonths: 24, archived: false }],
    });

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

  test("the routes carry a person's own registration and its manager's decision (D108 item 7), and map each refusal", async () => {
    const w = world();
    await syncBundledRows(w.reconcile);
    await w.admin.update(mikael, COMPETENCE_CONNECTOR, { state: 'enabled' });
    const added = await w.call(mikael, 'POST', '/types', { name: 'HLR', area: 'Akut', kind: 'course' });
    const { id: typeId } = (await added.json()) as { id: string };

    // Anna reports to Hillevi; Hillevi reports to nobody, so hers cannot be sent.
    const mine = await w.call(anna, 'GET', '/own');
    expect(mine.headers.get('cache-control')).toContain('no-store');
    expect(await mine.json()).toEqual({ approver: true, pending: [], rejected: [], skills: [] });
    expect(await (await w.call(hillevi, 'GET', '/own')).json()).toEqual({
      approver: false,
      pending: [],
      rejected: [],
      skills: [],
    });
    const nobody = await w.call(hillevi, 'POST', '/own/holdings', { typeId, issuedOn: '2025-05-10' });
    expect(nobody.status).toBe(400);
    expect(await nobody.json()).toMatchObject({
      error: 'Registreringen kan inte skickas: ingen chef är registrerad för dig.',
    });
    expect((await w.call(anna, 'POST', '/own/holdings', { typeId, issuedOn: '10 maj' })).status).toBe(400);

    const sent = await w.call(anna, 'POST', '/own/holdings', { typeId, issuedOn: '2025-05-10' });
    expect(sent.status).toBe(201);
    const { id: holdingId } = (await sent.json()) as { id: string };
    expect(await (await w.call(anna, 'GET', '/own')).json()).toEqual({
      approver: true,
      rejected: [],
      pending: [{ holdingId, typeId, competence: 'HLR', issuedOn: '2025-05-10' }],
      skills: [],
    });
    const twice = await w.call(anna, 'POST', '/own/holdings', { typeId, issuedOn: '2025-06-10' });
    expect(twice.status).toBe(400);

    // Hillevi reads it and decides; Anna and Mikael may not, and a body outside the contract is turned down.
    const read = await w.call(hillevi, 'GET', `/approvals/${holdingId}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      holdingId,
      personId: 'p-anna',
      name: 'Anna Lindqvist',
      competence: 'HLR',
    });
    expect((await w.call(anna, 'GET', `/approvals/${holdingId}`)).status).toBe(403);
    expect((await w.call(mikael, 'POST', `/approvals/${holdingId}`, { decision: 'approve' })).status).toBe(403);
    expect((await w.call(hillevi, 'POST', `/approvals/${holdingId}`, { decision: 'maybe' })).status).toBe(400);
    // Through the registry too, as the card's read: a row for her manager, refused to anyone else.
    expect(await w.registry.run(audiencedActorOf(hillevi), 'competence.approval', { holding: holdingId })).toEqual({
      rows: [{ name: 'Anna Lindqvist', competence: 'HLR', issuedOn: '2025-05-10' }],
    });
    await expect(
      w.registry.run(audiencedActorOf(mikael), 'competence.approval', { holding: holdingId }),
    ).rejects.toThrow();
    // Scoped as the matrix is, by whom the server counts as reports, not by the session's role.
    expect(await w.registry.run(audiencedActorOf(acting), 'competence.approval', { holding: holdingId })).toEqual({
      rows: [{ name: 'Anna Lindqvist', competence: 'HLR', issuedOn: '2025-05-10' }],
    });
    expect(w.registry.views(audiencedActorOf(acting)).map(v => v.capability)).toContain('competence.approval');

    expect((await w.call(hillevi, 'POST', `/approvals/${holdingId}`, { decision: 'approve' })).status).toBe(204);
    expect(w.store.state.holdings.get(holdingId)).toMatchObject({ state: 'valid', decidedBy: 'hillevi' });
    const again = await w.call(hillevi, 'POST', `/approvals/${holdingId}`, { decision: 'reject' });
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: 'Registreringen är redan granskad.' });
    // Decided, it can no longer be taken back.
    expect((await w.call(anna, 'DELETE', `/own/holdings/${holdingId}`)).status).toBe(400);

    // A new one is taken back while it waits; someone else's is refused as unknown.
    const other = await w.call(anna, 'POST', '/own/holdings', { typeId, issuedOn: '2026-01-10' });
    const { id: second } = (await other.json()) as { id: string };
    expect((await w.call(hillevi, 'DELETE', `/own/holdings/${second}`)).status).toBe(403);
    expect((await w.call(anna, 'DELETE', `/own/holdings/${second}`)).status).toBe(204);
    expect(w.store.state.holdings.has(second)).toBe(false);

    // One rejected is hers alone to remove.
    const third = await w.call(anna, 'POST', '/own/holdings', { typeId, issuedOn: '2026-02-10' });
    const { id: turnedDown } = (await third.json()) as { id: string };
    expect((await w.call(hillevi, 'POST', `/approvals/${turnedDown}`, { decision: 'reject' })).status).toBe(204);
    expect((await w.call(hillevi, 'DELETE', `/own/rejected/${turnedDown}`)).status).toBe(403);
    expect((await w.call(anna, 'DELETE', `/own/rejected/${turnedDown}`)).status).toBe(204);
    expect(w.store.state.holdings.has(turnedDown)).toBe(false);
  });

  test('the routes carry a skill (D120): her own rating, its removal, and her manager’s registration and confirmation', async () => {
    const w = world();
    await syncBundledRows(w.reconcile);
    await w.admin.update(mikael, COMPETENCE_CONNECTOR, { state: 'enabled' });
    const add = async (body: unknown) =>
      ((await (await w.call(mikael, 'POST', '/types', body)).json()) as { id: string }).id;
    const english = await add({ name: 'Engelska', area: 'Språk', kind: 'skill' });
    const sheets = await add({ name: 'Kalkylprogram', area: 'Digital kompetens', kind: 'skill' });
    const hlr = await add({ name: 'HLR', area: 'Akut', kind: 'course' });
    const ruled = await w.call(mikael, 'POST', '/types', {
      name: 'Tyska',
      area: 'Språk',
      kind: 'skill',
      validityMonths: 12,
    });
    expect(ruled.status).toBe(400);
    expect(await ruled.json()).toMatchObject({ error: 'En färdighet har ingen giltighetstid.' });

    // Her own rating is stored at once and needs nobody; added again it is refused, and changed by its holding.
    const rated = await w.call(anna, 'POST', '/own/skills', { typeId: english, level: 2, interest: true });
    expect(rated.status).toBe(201);
    const { id: holdingId } = (await rated.json()) as { id: string };
    expect(await (await w.call(anna, 'GET', '/own')).json()).toEqual({
      approver: true,
      rejected: [],
      pending: [],
      skills: [
        {
          holdingId,
          typeId: english,
          competence: 'Engelska',
          area: 'Språk',
          level: 2,
          validated: false,
          interest: true,
        },
      ],
    });
    const again = await w.call(anna, 'POST', '/own/skills', { typeId: english, level: 3, interest: true });
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({
      error: 'Du har redan den färdigheten. Ändra nivån under Färdigheter i stället.',
    });
    expect((await w.call(anna, 'PUT', `/own/skills/${holdingId}`, { level: 3, interest: true })).status).toBe(204);
    expect(w.store.state.holdings.get(holdingId)).toMatchObject({ level: 3, interest: true });
    // A change names no type, and is hers alone.
    expect(
      (await w.call(anna, 'PUT', `/own/skills/${holdingId}`, { level: 3, interest: true, typeId: english })).status,
    ).toBe(400);
    expect((await w.call(hillevi, 'PUT', `/own/skills/${holdingId}`, { level: 1, interest: false })).status).toBe(403);
    // A level outside the three, a person named in the body, and a type that is no skill each have their answer.
    expect((await w.call(anna, 'POST', '/own/skills', { typeId: english, level: 4, interest: false })).status).toBe(
      400,
    );
    expect(
      (await w.call(hillevi, 'POST', '/own/skills', { typeId: english, level: 1, interest: false, personId: 'p-anna' }))
        .status,
    ).toBe(400);
    const course = await w.call(anna, 'POST', '/own/skills', { typeId: hlr, level: 1, interest: false });
    expect(course.status).toBe(400);
    expect(await course.json()).toMatchObject({ error: 'Bara en färdighet bedöms med en nivå.' });
    const dated = await w.call(anna, 'POST', '/own/holdings', { typeId: english, issuedOn: '2025-05-10' });
    expect(await dated.json()).toMatchObject({ error: 'En färdighet registreras med en nivå, inte med datum.' });

    // Her manager reads it and confirms it, at another level; Mikael may not, nor may she.
    const read = await w.call(hillevi, 'GET', `/skills/${holdingId}`);
    expect(read.status).toBe(200);
    expect(read.headers.get('cache-control')).toContain('no-store');
    expect(await read.json()).toEqual({
      holdingId,
      personId: 'p-anna',
      name: 'Anna Lindqvist',
      typeId: english,
      competence: 'Engelska',
      area: 'Språk',
      level: 3,
      validated: false,
      interest: true,
    });
    for (const who of [anna, mikael]) {
      expect((await w.call(who, 'GET', `/skills/${holdingId}`)).status).toBe(403);
      expect((await w.call(who, 'POST', `/skills/${holdingId}/validation`, {})).status).toBe(403);
    }
    expect((await w.call(hillevi, 'POST', `/skills/${holdingId}/validation`, { level: 0 })).status).toBe(400);
    expect((await w.call(hillevi, 'POST', `/skills/${holdingId}/validation`, { level: 2 })).status).toBe(204);
    expect(w.store.state.holdings.get(holdingId)).toMatchObject({ level: 2, validatedBy: 'hillevi', validatedAt: T0 });

    // Her manager registers another for her, confirmed; the same again is refused, and nobody registers for himself.
    const registered = await w.call(hillevi, 'POST', '/people/p-anna/skills', { typeId: sheets, level: 1 });
    expect(registered.status).toBe(201);
    const twice = await w.call(hillevi, 'POST', '/people/p-anna/skills', { typeId: sheets, level: 2 });
    expect(twice.status).toBe(400);
    expect(await twice.json()).toMatchObject({
      error: 'Personen har redan den färdigheten. Bekräfta nivån i stället.',
    });
    expect((await w.call(anna, 'POST', '/people/p-anna/skills', { typeId: sheets, level: 1 })).status).toBe(403);

    // She removes her own; nobody else can, and an unknown one is refused alike.
    expect((await w.call(hillevi, 'DELETE', `/own/skills/${holdingId}`)).status).toBe(403);
    expect((await w.call(anna, 'DELETE', `/own/skills/${holdingId}`)).status).toBe(204);
    expect(w.store.state.holdings.get(holdingId)).toMatchObject({ state: 'revoked', revokedBy: 'p-anna' });
    expect((await w.call(anna, 'DELETE', `/own/skills/${holdingId}`)).status).toBe(403);
  });

  test('the routes carry requirements and share targets (D108 item 6) and map each refusal', async () => {
    const w = world();
    await syncBundledRows(w.reconcile);
    await w.admin.update(mikael, COMPETENCE_CONNECTOR, { state: 'enabled' });
    w.store.addPosition({ id: 'pos-usk', organisationId: ORG, code: 'usk', label: 'Undersköterska' });
    w.store.addUnit({ id: 'unit-skola', organisationId: ORG, label: 'Bergsåkers skola' });
    const added = await w.call(mikael, 'POST', '/types', { name: 'HLR', area: 'Akut', kind: 'course' });
    const { id: typeId } = (await added.json()) as { id: string };

    const onPosition = await w.call(mikael, 'POST', '/requirements', { typeId, positionCode: 'usk' });
    expect(onPosition.status).toBe(201);
    const { id: requirementId } = (await onPosition.json()) as { id: string };
    // A least level on a type that is no skill (D120), a body naming no target, a taken one and a missing capability
    // each have their answer.
    const level = await w.call(mikael, 'POST', '/requirements', { typeId, positionCode: 'usk', minLevel: 2 });
    expect(level.status).toBe(400);
    expect(((await level.json()) as { error: string }).error).toBe('Bara en färdighet kan krävas på en viss nivå.');
    expect((await w.call(mikael, 'POST', '/requirements', { typeId, positionCode: 'usk', minLevel: 4 })).status).toBe(
      400,
    );
    const none = await w.call(mikael, 'POST', '/requirements', { typeId });
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: string }).error).toBe(
      'Ett krav gäller en befattning, en enhet eller en person.',
    );
    const again = await w.call(mikael, 'POST', '/requirements', { typeId, positionCode: 'usk' });
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
      rows: [{ id: requirementId, typeId, on: 'position', targetId: 'usk', targetLabel: 'Undersköterska' }],
      positions: [{ code: 'usk', label: 'Undersköterska' }],
      units: [{ id: 'unit-skola', label: 'Bergsåkers skola' }],
    });
    expect((await w.call(hillevi, 'GET', '/requirements')).status).toBe(403);
    expect((await w.call(hillevi, 'DELETE', `/requirements/${requirementId}`)).status).toBe(403);
    expect((await w.call(mikael, 'DELETE', `/requirements/${requirementId}`)).status).toBe(204);
    // Gone now: refused in the same words as one the reader may not touch, so a refusal never tells which.
    const gone = await w.call(mikael, 'DELETE', `/requirements/${requirementId}`);
    expect(gone.status).toBe(403);
    expect(((await gone.json()) as { error: string }).error).toBe('Du kan inte ta bort det här kravet.');

    const target = await w.call(mikael, 'POST', '/share-targets', { typeId, positionCode: 'usk', minShare: 40 });
    expect(target.status).toBe(201);
    const { id: targetId } = (await target.json()) as { id: string };
    for (const minShare of [0, 101, 12.5, '40'])
      expect((await w.call(mikael, 'POST', '/share-targets', { typeId, positionCode: 'usk', minShare })).status).toBe(
        400,
      );
    expect(
      (
        await w.call(hillevi, 'POST', '/share-targets', {
          typeId,
          positionCode: 'usk',
          unitId: 'unit-skola',
          minShare: 40,
        })
      ).status,
    ).toBe(403);
    const targets = await w.call(mikael, 'GET', '/share-targets');
    expect(targets.headers.get('cache-control')).toContain('no-store');
    expect(await targets.json()).toEqual({
      rows: [
        {
          id: targetId,
          typeId,
          positionCode: 'usk',
          positionLabel: 'Undersköterska',
          minShare: 40,
          outcome: { tooFew: true },
        },
      ],
    });
    expect((await w.call(hillevi, 'DELETE', `/share-targets/${targetId}`)).status).toBe(403);
    expect((await w.call(mikael, 'DELETE', `/share-targets/${targetId}`)).status).toBe(204);
    expect(w.store.state.shareTargets.size).toBe(0);
  });

  test('the matrix and its file (D108 item 11): a manager reads both, the file is audited, the query is checked', async () => {
    const w = world();
    await syncBundledRows(w.reconcile);
    await w.admin.update(mikael, COMPETENCE_CONNECTOR, { state: 'enabled' });
    w.store.addPosition({ id: 'pos-usk', organisationId: ORG, code: 'usk', label: 'Undersköterska' });
    w.store.holdPosition('p-anna', 'pos-usk');
    const added = await w.call(mikael, 'POST', '/types', { name: 'HLR', area: 'Akut', kind: 'course' });
    const { id: typeId } = (await added.json()) as { id: string };
    expect((await w.call(mikael, 'POST', '/requirements', { typeId, positionCode: 'usk' })).status).toBe(201);

    const read = await w.call(hillevi, 'GET', '/matrix?by=area%3AAkut&part=1');
    expect(read.status).toBe(200);
    expect(read.headers.get('cache-control')).toContain('no-store');
    expect(await read.json()).toEqual({
      groups: [],
      awaiting: [],
      columns: [{ typeId, name: 'HLR', area: 'Akut', kind: 'course' }],
      rows: [
        {
          personId: 'p-anna',
          key: 'anna.lindqvist',
          name: 'Anna Lindqvist',
          cells: [
            {
              typeId,
              status: 'missing',
              required: true,
              through: [{ on: 'position', label: 'Undersköterska' }],
              revocable: false,
            },
          ],
        },
      ],
      required: 1,
    });
    // Someone who manages nobody is refused in Swedish; a query outside its bounds is a 400.
    const refused = await w.call(anna, 'GET', '/matrix');
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: 'Medarbetarnas kompetens visas för den som är chef för en enhet.',
      code: 'denied',
    });
    for (const query of ['?part=0', '?part=100', '?part=x', '?by=', `?by=${'a'.repeat(201)}`])
      expect((await w.call(hillevi, 'GET', '/matrix' + query)).status).toBe(400);

    const before = w.store.audit().length;
    const file = await w.call(hillevi, 'GET', '/matrix.csv');
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="kompetens-2026-11-10.csv"');
    expect(file.headers.get('cache-control')).toContain('no-store');
    // The byte order mark is kept, so a spreadsheet reads the file as UTF-8.
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(await file.arrayBuffer())).toBe(
      '\ufeffNamn;Användarnamn;HLR\r\nAnna Lindqvist;anna.lindqvist;Saknas\r\n',
    );
    expect(w.store.audit().slice(before)).toEqual([
      {
        actor: 'person:hillevi',
        action: 'competence.matrix_exported',
        subject: 'organisation:' + ORG,
        at: T0,
        details: { people: 1, types: 1 },
      },
    ]);
    // An export of the reports' competence is logged as one, beside its audit row (D108 item 15).
    expect(w.store.readLog().map(r => [r.readerId, r.relation, r.kind, r.typeId, r.rows])).toEqual([
      ['hillevi', 'managed', 'export', null, 1],
    ]);
    expect((await w.call(anna, 'GET', '/matrix.csv')).status).toBe(403);
    expect((await w.call(hillevi, 'GET', '/matrix.csv?part=0')).status).toBe(400);
    expect(w.store.audit().length).toBe(before + 1);
    expect(w.store.readLog()).toHaveLength(1);
    // Narrowed as the page is (`only=attention`, the review of 2026-11-13): Anna's missing HLR is required of her, so
    // she is in it; any other narrowing is refused.
    const narrowed = await w.call(hillevi, 'GET', '/matrix.csv?only=attention');
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(await narrowed.arrayBuffer())).toBe(
      '﻿Namn;Användarnamn;HLR\r\nAnna Lindqvist;anna.lindqvist;Saknas\r\n',
    );
    expect((await w.call(hillevi, 'GET', '/matrix.csv?only=everything')).status).toBe(400);
  });

  test('Kompetenssökning (D121): the registrar alone searches, in a body, gets the file, and every read is logged', async () => {
    const w = world();
    // Off, the search is refused as every route is.
    await syncBundledRows(w.reconcile);
    expect(await (await w.call(hr, 'GET', '/search')).json()).toEqual({ error: NOT_ENABLED, code: 'denied' });
    await w.admin.update(mikael, COMPETENCE_CONNECTOR, { state: 'enabled' });
    const added = await w.call(mikael, 'POST', '/types', { name: 'HLR', area: 'Akut', kind: 'course' });
    const { id: typeId } = (await added.json()) as { id: string };
    expect(
      (
        await w.call(hillevi, 'POST', '/people/p-anna/holdings', {
          typeId,
          issuedOn: '2026-01-10',
          expiresOn: '2028-01-09',
        })
      ).status,
    ).toBe(201);
    // Anyone without the relation is refused in Swedish: a manager, and an administrator of the catalogue too (D118).
    for (const who of [hillevi, mikael, anna]) {
      const refused = await w.call(who, 'GET', '/search');
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({
        error: 'Kompetenssökning är inte tilldelad dig. En administratör ger den genom en grupp.',
        code: 'denied',
      });
      expect((await w.call(who, 'POST', '/search', { typeIds: [typeId] })).status).toBe(403);
      expect((await w.call(who, 'POST', '/search.csv', { typeIds: [typeId] })).status).toBe(403);
    }
    expect(w.store.readLog()).toEqual([]);
    const options = await w.call(hr, 'GET', '/search');
    expect(options.status).toBe(200);
    expect(options.headers.get('cache-control')).toContain('no-store');
    // The type field is the catalogue, in a body.
    const found = await w.call(anna, 'POST', '/search/types', { text: 'hl' });
    expect(((await found.json()) as { rows: Array<{ name: string }> }).rows.map(t => t.name)).toEqual(['HLR']);
    expect((await w.call(anna, 'POST', '/search/types', { text: 'x'.repeat(121) })).status).toBe(400);
    // Or by the ids an address names, which the page labels its field with; an unknown id is left out.
    const named = await w.call(anna, 'POST', '/search/types', { ids: [typeId, 'type-borta'] });
    expect(((await named.json()) as { rows: Array<{ id: string }> }).rows.map(t => t.id)).toEqual([typeId]);
    for (const wrong of [
      {},
      { ids: [] },
      { ids: ['a', 'a'] },
      { ids: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { text: '', ids: ['a'] },
    ])
      expect((await w.call(anna, 'POST', '/search/types', wrong)).status).toBe(400);
    // What is searched for is a body; anything outside the contract is a 400 and is not read.
    const page = await w.call(hr, 'POST', '/search', { typeIds: [typeId], pageSize: 50 });
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toContain('no-store');
    expect(await page.json()).toEqual({
      types: [{ id: typeId, name: 'HLR', area: 'Akut', kind: 'course' }],
      rows: [
        {
          personId: 'p-anna',
          key: 'anna.lindqvist',
          name: 'Anna Lindqvist',
          units: [],
          held: [{ typeId, status: 'valid', expiresOn: '2028-01-09' }],
        },
      ],
      total: 1,
      unfiltered: 1,
      page: 1,
      pageSize: 50,
    });
    for (const wrong of [
      {},
      { typeId },
      { typeIds: [] },
      { typeIds: [typeId, typeId] },
      { typeIds: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { typeIds: [typeId], page: 0 },
      { typeIds: [typeId], pageSize: 30 },
      { typeIds: [typeId], minLevel: 4 },
      { typeIds: [typeId], name: 'x' },
      // The filters and the order are closed lists.
      { typeIds: [typeId], status: [] },
      { typeIds: [typeId], status: ['gone'] },
      { typeIds: [typeId], status: ['valid', 'valid'] },
      { typeIds: [typeId], until: 60 },
      { typeIds: [typeId], sort: 'age' },
      { typeIds: [typeId], order: 'up' },
      // A unit or a type is an id: no control character, no more than 80 characters.
      { typeIds: [typeId], unitId: 'u\n1' },
      { typeIds: [typeId], unitId: 'u'.repeat(81) },
      { typeIds: [typeId + '\u001b[2K'] },
    ])
      expect((await w.call(hr, 'POST', '/search', wrong)).status).toBe(400);
    // A unit that is no unit of the organisation's tree is refused by the use case, in Swedish, and nothing is logged.
    const unknown = await w.call(hr, 'POST', '/search', { typeIds: [typeId], unitId: 'unit-borta' });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: 'Enheten finns inte.' });
    const file = await w.call(hr, 'POST', '/search.csv', { typeIds: [typeId] });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="kompetenssokning-2026-11-10.csv"');
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(await file.arrayBuffer())).toBe(
      '\ufeffNamn;Användarnamn;Enhet;Status;Giltigt till\r\nAnna Lindqvist;anna.lindqvist;;Giltigt;2028-01-09\r\n',
    );
    expect(w.store.readLog().map(r => [r.readerId, r.relation, r.kind, r.typeId, r.rows])).toEqual([
      ['hr', 'registrar', 'search', typeId, 1],
      ['hr', 'registrar', 'export', typeId, 1],
    ]);
    expect(w.store.audit().at(-1)).toMatchObject({
      actor: 'person:hr',
      action: 'competence.search_exported',
      details: { typeIds: [typeId], people: 1 },
    });
  });

  test('a person opened from a hit (D121 item 3): competence.holdings admits registrar through the registry, competence.person does not', async () => {
    const w = world();
    await syncBundledRows(w.reconcile);
    await w.admin.update(mikael, COMPETENCE_CONNECTOR, { state: 'enabled' });
    // The core rule as composition binds it, for the one reader who holds the grant: registrar where a read admits it.
    const registry = new Registry({
      relations: async (actor, _entity, keys, admits) =>
        keys.flatMap(asked => {
          const key = asked.toLowerCase();
          if (!['anna.lindqvist', 'hillevi.berg'].includes(key)) return [];
          const relation =
            actor.id === 'hr' && admits.includes('registrar')
              ? ('registrar' as const)
              : admits.includes('colleague')
                ? ('colleague' as const)
                : undefined;
          return relation ? [{ asked, key, relation }] : [];
        }),
    });
    registry
      .register({ ...competenceConnector(w.competence, async a => personas.get(a.id)!), uses: ['*'] })
      .govern(COMPETENCE_CONNECTOR, openGovernance());
    // Her own session's direct read (`GET /api/cap`) is the one call the relation is resolved on.
    expect(
      await registry.run(audiencedActorOf(hr), 'competence.holdings', { person: 'Anna.Lindqvist' }, { direct: true }),
    ).toEqual({ rows: [] });
    expect(w.store.readLog().map(r => [r.readerId, r.relation, r.kind, r.personId])).toEqual([
      ['hr', 'registrar', 'person', 'p-anna'],
    ]);
    // Any other call (a card, a tool, a job) is refused, and logs nothing.
    await expect(
      registry.run(audiencedActorOf(hr), 'competence.holdings', { person: 'anna.lindqvist' }),
    ).rejects.toThrow('Okänd förmåga.');
    // The read about a person is a manager's, of their reports alone: it is not opened to a registrar.
    await expect(registry.run(audiencedActorOf(hr), 'competence.person', { keys: ['anna.lindqvist'] })).rejects.toThrow(
      'Du saknar behörighet för åtgärden.',
    );
    // Nor is anyone else who does not hold the grant.
    await expect(
      registry.run(audiencedActorOf(anna), 'competence.holdings', { person: 'hillevi.berg' }),
    ).rejects.toThrow('Okänd förmåga.');
    expect(w.store.readLog()).toHaveLength(1);
  });

  test('the routes carry the catalogue at scale (D120 item 7, D108 item 2): an import, a merge with its preview, a restore', async () => {
    const w = world();
    await syncBundledRows(w.reconcile);
    await w.admin.update(mikael, COMPETENCE_CONNECTOR, { state: 'enabled' });
    const uri = 'http://data.europa.eu/esco/skill/0000-1';
    const row = { row: 2, name: 'leda ett team', area: 'Ledarskap', kind: 'skill', validityMonths: null, uri };
    const imported = await w.call(mikael, 'POST', '/types/import', { format: 'esco', rows: [row] });
    expect(imported.status).toBe(200);
    expect(await imported.json()).toEqual({ added: 1, skipped: 0 });
    expect(await (await w.call(mikael, 'POST', '/types/import', { format: 'esco', rows: [row] })).json()).toEqual({
      added: 0,
      skipped: 1,
    });
    // The server checks every row again with the contract and the shared rule, whatever the browser sent.
    for (const body of [
      { format: 'csv', rows: [row] },
      { format: 'esco', rows: [] },
      { format: 'esco', rows: [{ ...row, extra: true }] },
      { format: 'esco', rows: Array.from({ length: 1001 }, (_, i) => ({ ...row, row: i + 2 })) },
    ])
      expect((await w.call(mikael, 'POST', '/types/import', body)).status).toBe(400);
    const wrong = await w.call(mikael, 'POST', '/types/import', {
      format: 'clew',
      rows: [{ ...row, row: 7, kind: 'course', validityMonths: 0, uri: null }],
    });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: 'Ogiltig förfrågan.' });
    const control = await w.call(mikael, 'POST', '/types/import', {
      format: 'clew',
      rows: [{ ...row, row: 7, name: 'Namn\u0007', kind: 'course', uri: null }],
    });
    expect(await control.json()).toMatchObject({ error: 'Rad 7: Namnet innehåller tecken som inte kan sparas.' });
    expect((await w.call(hillevi, 'POST', '/types/import', { format: 'esco', rows: [row] })).status).toBe(403);

    const [from, into] = [
      (
        (await (
          await w.call(mikael, 'POST', '/types', { name: 'Truckkort', area: 'A', kind: 'certificate' })
        ).json()) as { id: string }
      ).id,
      (
        (await (
          await w.call(mikael, 'POST', '/types', { name: 'Truckförarbevis', area: 'A', kind: 'certificate' })
        ).json()) as { id: string }
      ).id,
    ];
    await w.call(hillevi, 'POST', '/people/p-anna/holdings', { typeId: from, issuedOn: '2025-05-10' });
    const preview = await w.call(mikael, 'GET', `/types/${from}/merge?into=${into}`);
    expect(preview.headers.get('cache-control')).toContain('no-store');
    // One holding of one person: fewer than five, as an administrator is shown it (D118).
    expect(await preview.json()).toMatchObject({ holdings: 'few', people: 'few', waiting: false });
    expect((await w.call(mikael, 'GET', `/types/${from}/merge`)).status).toBe(400);
    expect((await w.call(mikael, 'POST', `/types/${from}/merge`, { into: 7 })).status).toBe(400);
    expect((await w.call(hillevi, 'POST', `/types/${from}/merge`, { into })).status).toBe(403);
    const self = await w.call(mikael, 'POST', `/types/${from}/merge`, { into: from });
    expect(await self.json()).toMatchObject({ error: 'En kompetens kan inte slås ihop med sig själv.' });
    const merged = await w.call(mikael, 'POST', `/types/${from}/merge`, { into });
    expect(merged.status).toBe(200);
    expect(await merged.json()).toMatchObject({ holdings: 'few' });
    const listed = (await (await w.call(mikael, 'GET', '/types')).json()) as { rows: Array<Record<string, unknown>> };
    expect(listed.rows.find(t => t.id === from)).toMatchObject({ archived: true, mergedInto: into });
    expect(listed.rows.find(t => t.name === 'leda ett team')).toMatchObject({ uri });

    const restoredMerged = await w.call(mikael, 'POST', `/types/${from}/restore`);
    expect(restoredMerged.status).toBe(400);
    expect(((await restoredMerged.json()) as { error: string }).error).toStartWith('Kompetensen är sammanslagen');
    expect((await w.call(mikael, 'POST', `/types/${into}/archive`)).status).toBe(204);
    expect((await w.call(hillevi, 'POST', `/types/${into}/restore`)).status).toBe(403);
    expect((await w.call(mikael, 'POST', `/types/${into}/restore`)).status).toBe(204);
    expect(w.store.state.types.get(into)?.archivedAt).toBeNull();
  });

  test('a body is read no further than its bound, and an administrator’s route refuses anyone else before reading it', async () => {
    const w = world();
    await syncBundledRows(w.reconcile);
    await w.admin.update(mikael, COMPETENCE_CONNECTOR, { state: 'enabled' });
    // A declared length above the bound is refused unread; so is a body sent in pieces once it passes the bound.
    const declared = await w.raw(mikael, 'POST', '/types', {
      headers: { 'content-length': String(10_000_000) },
      body: '{}',
    });
    expect(declared.status).toBe(400);
    expect(await declared.json()).toMatchObject({ error: 'För stor förfrågan.' });
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent++;
        controller.enqueue(new TextEncoder().encode('x'.repeat(64 * 1024)));
        if (sent > 1000) controller.close();
      },
    });
    const streamed = await w.raw(mikael, 'POST', '/types/import', {
      body: endless,
      duplex: 'half',
    } as RequestInit);
    expect(streamed.status).toBe(400);
    expect(await streamed.json()).toMatchObject({ error: 'För stor förfrågan.' });
    // Three megabytes at most for an import: the stream was let go long before its end.
    expect(sent).toBeLessThan(60);
    // A manager without the capability is refused before the import's body is read, as the use case would refuse them.
    let read = 0;
    // Pulled only when read (no queue filled ahead).
    const watched = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          read++;
          controller.enqueue(new TextEncoder().encode('{}'));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const refused = await w.raw(hillevi, 'POST', '/types/import', { body: watched, duplex: 'half' } as RequestInit);
    expect(refused.status).toBe(403);
    expect(read).toBe(0);
    for (const [method, path] of [
      ['POST', '/types'],
      ['PATCH', '/types/t1'],
      ['POST', '/types/t1/merge'],
      ['GET', '/types/t1/merge?into=t2'],
      ['POST', '/types/t1/restore'],
      ['GET', '/sources'],
      ['GET', '/requirements'],
      ['POST', '/share-targets'],
    ] as const)
      expect((await w.call(hillevi, method, path, method === 'GET' ? undefined : {})).status).toBe(403);
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
      ['GET', '/matrix'],
      ['GET', '/matrix.csv'],
      ['POST', '/types/import'],
      ['GET', '/types/t1/merge?into=t2'],
      ['POST', '/types/t1/merge'],
      ['POST', '/types/t1/restore'],
    ] as const) {
      const refused = await w.call(mikael, method, path, method === 'POST' ? {} : undefined);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: NOT_ENABLED, code: 'denied' });
    }
  });
});
