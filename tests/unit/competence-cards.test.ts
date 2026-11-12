import { beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { AuthenticatedContext, StaffOverview, StaffPerson } from '../../packages/contracts/src/index';
import type { Actor, ScanObservation } from '../../packages/connectors/src/index';
import {
  memoryCompetenceStore,
  type MemoryCompetenceStore,
} from '../../apps/server/src/modules/competence/adapters/memory';
import { competenceConnector } from '../../apps/server/src/modules/competence/capabilities';
import { competenceUsecases, type CompetenceUsecases } from '../../apps/server/src/modules/competence/usecases';
import { memoryRefreshStore } from '../../apps/server/src/threads/adapters/refresh-memory';
import { refreshUsecases } from '../../apps/server/src/threads/usecases/refresh';
import { Registry } from '../registry';

/**
 * The competence cards through the real refresh (D108 item 12, D47), on memory adapters: the scan is a complete
 * observation with stable occurrences, so a card whose cause is gone is resolved at the next scan, one whose cause stands
 * is neither reopened nor duplicated, and an open card from when the scan named topics alone is taken over, not left
 * beside a new one.
 */
const ORG = 'org-1';
function personaOf(
  id: string,
  role: 'manager' | 'employee',
  name: string,
  capabilities: AuthenticatedContext['capabilities'] = [],
): AuthenticatedContext {
  return {
    id,
    name,
    unitId: 'u1',
    unitLabel: 'Enhet 1',
    role,
    organisationId: ORG,
    principal: { id: 'person:' + id, kind: 'person' },
    capabilities,
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2099-01-01T00:00:00.000Z',
    authorize: async () => ({ version: 'v1' }),
  };
}
const boss = personaOf('boss', 'manager', 'Karin Chef');
const anna = personaOf('anna', 'employee', 'Anna Andersson');
const admin = personaOf('ada', 'employee', 'Ada Admin', ['admin.competence']);
const staffAnna: StaffPerson = {
  id: 'anna',
  name: 'Anna Andersson',
  userName: 'anna.a',
  email: null,
  role: 'employee',
  enabled: true,
};
const personas = new Map([boss, anna, admin].map(p => [p.id, p]));
const actorOf = (p: AuthenticatedContext): Actor => ({
  id: p.id,
  name: p.name,
  unitId: p.unitId,
  unitLabel: p.unitLabel,
  role: p.role,
});

let now: number;
let store: MemoryCompetenceStore;
let competence: CompetenceUsecases;
let refresh: ReturnType<typeof refreshUsecases>;
let threads: ReturnType<typeof memoryRefreshStore>;
/** What the scan answers: the connector's own observation, or, `legacy`, the drafts alone as the scan once gave them. */
let legacy = false;
beforeEach(() => {
  now = Date.parse('2026-11-10T09:00:00.000Z');
  let n = 0;
  legacy = false;
  store = memoryCompetenceStore({
    persons: [
      { id: 'anna', organisationId: ORG, name: 'Anna Andersson', userName: 'anna.a' },
      { id: 'boss', organisationId: ORG, name: 'Karin Chef', userName: 'boss' },
    ],
  });
  store.addUnit({ id: 'u1', organisationId: ORG, label: 'Enhet 1' });
  store.assign('anna', 'u1');
  const staff = new Map<string, StaffOverview>([
    ['boss', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [staffAnna] }] }],
  ]);
  competence = competenceUsecases({
    store,
    staff: async p => staff.get(p.id) ?? { units: [] },
    clock: () => new Date(now),
    ids: () => 'id-' + ++n,
  });
  const registry = new Registry().register(competenceConnector(competence, async a => personas.get(a.id)!));
  threads = memoryRefreshStore();
  refresh = refreshUsecases({
    store: threads,
    clock: () => new Date(now),
    ids: () => 'thread-' + ++n,
    key: (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex'),
    current: async id => personas.get(id),
    sources: async () => ['competence'],
    system: () => 'Kompetens',
    scan: async (p, id): Promise<ScanObservation> => {
      const observed = await registry.scanOne(actorOf(p), id);
      return legacy ? { drafts: observed.drafts.map(({ occurrences: _o, ...d }) => d) } : observed;
    },
  });
});
/** A scan of the person a minute after the last: every refresh that is due is run, the person's among them. */
async function scan(p: AuthenticatedContext) {
  now += 60_001;
  await refresh.request(p);
  while (await refresh.tick());
}
const cards = (personId: string) =>
  threads.threads
    .dump()
    .filter(t => t.personId === personId)
    .map(t => t.thread);
const audited = (action: string) => threads.threads.audit.filter(a => a.action === action);
/** Socionomexamen required of everyone on Enhet 1, which Anna is placed on. */
async function required() {
  const degree = await competence.addType(admin, { name: 'Socionomexamen', area: 'Examen', kind: 'degree' });
  await competence.addRequirement(admin, { typeId: degree, unitId: 'u1' });
  return degree;
}

describe('the competence cards (D108 item 12, D47)', () => {
  test('a missing card opens, stands unchanged through later scans, and is resolved once the certificate is registered', async () => {
    const degree = await required();
    await scan(anna);
    expect(cards('anna').map(c => [c.title, c.state])).toEqual([['Socionomexamen saknas', 'open']]);
    // The cause stands: the same card, not reopened, not duplicated, not rewritten.
    await scan(anna);
    await scan(anna);
    expect(cards('anna').map(c => [c.title, c.state])).toEqual([['Socionomexamen saknas', 'open']]);
    expect(audited('thread.pushed')).toHaveLength(1);
    expect(audited('thread.refreshed')).toEqual([]);
    // The cause goes: the next scan resolves the card, and a scan after it leaves it so.
    await competence.registerHolding(boss, 'anna', { typeId: degree, issuedOn: '2015-06-05' });
    await scan(anna);
    expect(cards('anna').map(c => [c.title, c.state])).toEqual([['Socionomexamen saknas', 'handled']]);
    expect(audited('thread.source_resolved')).toHaveLength(1);
    await scan(anna);
    expect(cards('anna')).toHaveLength(1);
    expect(threads.dump().every(o => o.sourceState === 'resolved')).toBe(true);
  });

  test('removing the requirement resolves the card; a dismissed card stays dismissed while its cause stands', async () => {
    const degree = await required();
    await scan(anna);
    const [card] = cards('anna');
    await threads.threads.transaction(tx => tx.updateThread(card!.id, { state: 'dismissed' }));
    await scan(anna);
    expect(cards('anna').map(c => c.state)).toEqual(['dismissed']);
    const { rows } = await competence.requirements(admin);
    await competence.removeRequirement(admin, rows.find(r => r.typeId === degree)!.id);
    await scan(anna);
    expect(threads.dump().map(o => o.sourceState)).toEqual(['resolved']);
    expect(cards('anna')).toHaveLength(1);
  });

  test("an expiring holding's card reopens when it runs out, and the manager's card goes when nothing is due", async () => {
    const hlr = await competence.addType(admin, { name: 'HLR', area: 'Akut', kind: 'course', validityMonths: 24 });
    // Ends 2027-01-10, 61 days ahead: expiring.
    await competence.registerHolding(boss, 'anna', { typeId: hlr, issuedOn: '2025-01-10' });
    await scan(anna);
    await scan(boss);
    expect(cards('anna').map(c => [c.title, c.state])).toEqual([['HLR går ut 10 januari', 'open']]);
    expect(cards('boss').map(c => c.title)).toEqual(['Intyg att åtgärda bland dina medarbetare']);
    await threads.threads.transaction(tx => tx.updateThread(cards('anna')[0]!.id, { state: 'handled' }));
    // Two months on it has run out: the same occurrence in a new state, so the same card opens again and says why.
    now = Date.parse('2027-01-11T09:00:00.000Z');
    await scan(anna);
    expect(cards('anna').map(c => [c.title, c.state, c.trigger.reason])).toEqual([
      ['HLR gick ut 10 januari', 'open', 'Källan har ändrat uppgiften. Har gått ut'],
    ]);
    // Renewed: both the person's card and the manager's are resolved.
    await competence.registerHolding(boss, 'anna', { typeId: hlr, issuedOn: '2027-01-11' });
    await scan(anna);
    await scan(boss);
    expect(cards('anna').map(c => c.state)).toEqual(['handled']);
    expect(cards('boss').map(c => c.state)).toEqual(['handled']);
    expect(threads.threads.dump()).toHaveLength(2);
  });

  test('an open card from when the scan named topics alone is taken over, unchanged, and then resolves like any other', async () => {
    const degree = await required();
    legacy = true;
    await scan(anna);
    expect(threads.dump().map(o => [o.legacy, o.sourceState])).toEqual([[true, 'open']]);
    const [old] = cards('anna');
    legacy = false;
    await scan(anna);
    // One card, the same one, still open and not marked as changed; the legacy occurrence is retired.
    expect(cards('anna').map(c => [c.id, c.state, c.trigger.reason])).toEqual([[old!.id, 'open', 'Saknas']]);
    expect(audited('work.adopted')).toHaveLength(1);
    expect(
      threads
        .dump()
        .map(o => [o.legacy, o.sourceState])
        .sort(),
    ).toEqual([
      [false, 'open'],
      [true, 'resolved'],
    ]);
    await competence.registerHolding(boss, 'anna', { typeId: degree, issuedOn: '2015-06-05' });
    await scan(anna);
    expect(cards('anna').map(c => [c.id, c.state])).toEqual([[old!.id, 'handled']]);
  });
});
