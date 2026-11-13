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
import type { CompetenceStore } from '../../apps/server/src/modules/competence/model';
import { memoryRefreshStore } from '../../apps/server/src/threads/adapters/refresh-memory';
import { refreshUsecases } from '../../apps/server/src/threads/usecases/refresh';
import { legacyCardsUsecases } from '../../apps/server/src/threads/usecases/legacy-cards';
import { Registry } from '../registry';

/**
 * The competence cards through the real refresh use case (D108 item 12, D47), on memory adapters. The scan is a complete
 * observation and every card one occurrence: a card closes when its cause is gone, stays as it is while its cause stands,
 * and a cause that comes back is a new card; a person's card follows the person and the type, not a holding's row; the
 * manager's card is one occurrence that names nobody; and a scan that cannot read says nothing rather than "nothing".
 * Then the operator's reset of cards from when the scan named topics alone.
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
/** The staff port fails, as when the directory cannot be read. */
let staffFails = false;
/** The competence store fails, as when the database cannot be reached. */
let storeFails = false;
beforeEach(() => {
  now = Date.parse('2026-11-10T09:00:00.000Z');
  let n = 0;
  legacy = staffFails = storeFails = false;
  store = memoryCompetenceStore({
    persons: [
      { id: 'anna', organisationId: ORG, name: 'Anna Andersson', userName: 'anna.a' },
      { id: 'boss', organisationId: ORG, name: 'Karin Chef', userName: 'boss' },
    ],
  });
  store.addUnit({ id: 'u1', organisationId: ORG, label: 'Enhet 1' });
  store.assign('anna', 'u1');
  store.addPosition({ id: 'pos-usk', organisationId: ORG, code: 'usk', label: 'Undersköterska' });
  store.holdPosition('anna', 'pos-usk');
  const staff = new Map<string, StaffOverview>([
    ['boss', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [staffAnna] }] }],
  ]);
  const failing: CompetenceStore = {
    transaction: fn => (storeFails ? Promise.reject(new Error('the database is away')) : store.transaction(fn)),
  };
  competence = competenceUsecases({
    store: failing,
    staff: async p => {
      if (staffFails) throw new Error('the directory is away');
      return staff.get(p.id) ?? { units: [] };
    },
    clock: () => new Date(now),
    ids: () => 'id-' + ++n,
    // As composition hands it in, so the stored identity is what production stores.
    digest: text => createHash('sha256').update(text).digest('hex'),
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
    .map(t => t.thread)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
const states = (personId: string) => cards(personId).map(c => [c.title, c.state]);
const audited = (action: string) => threads.threads.audit.filter(a => a.action === action);
const handle = (id: string, state: 'handled' | 'dismissed') =>
  threads.threads.transaction(tx => tx.updateThread(id, { state }));
/** A type, required of everyone in the undersköterska position, which Anna holds. */
async function requiredOfAnna(name = 'Socionomexamen') {
  const typeId = await competence.addType(admin, { name, area: 'Examen', kind: 'degree' });
  const requirementId = await competence.addRequirement(admin, { typeId, positionCode: 'usk' });
  return { typeId, requirementId };
}

describe('a person’s cards close, stay and come back (D108 item 12, D47)', () => {
  test('a missing card opens, stands unchanged through scans, closes when registered, and a revocation opens a new one', async () => {
    const { typeId } = await requiredOfAnna();
    await scan(anna);
    expect(states('anna')).toEqual([['Socionomexamen saknas', 'open']]);
    await scan(anna);
    await scan(anna);
    expect(states('anna')).toEqual([['Socionomexamen saknas', 'open']]);
    expect(audited('thread.pushed')).toHaveLength(1);
    expect(audited('thread.refreshed')).toEqual([]);
    const holding = await competence.registerHolding(boss, 'anna', { typeId, issuedOn: '2015-06-05' });
    await scan(anna);
    expect(states('anna')).toEqual([['Socionomexamen saknas', 'handled']]);
    await scan(anna);
    expect(cards('anna')).toHaveLength(1);
    // The certificate is revoked: the cause is back, and it is a new card, not the handled one left as it was.
    now += 60_000;
    await competence.revokeHolding(boss, holding);
    await scan(anna);
    expect(states('anna')).toEqual([
      ['Socionomexamen saknas', 'handled'],
      ['Socionomexamen saknas', 'open'],
    ]);
  });

  test('a requirement removed closes the card; set again it is a new requirement and a new card', async () => {
    const { typeId, requirementId } = await requiredOfAnna();
    await scan(anna);
    await competence.removeRequirement(admin, requirementId);
    await scan(anna);
    expect(states('anna')).toEqual([['Socionomexamen saknas', 'handled']]);
    await competence.addRequirement(admin, { typeId, positionCode: 'usk' });
    await scan(anna);
    expect(states('anna')).toEqual([
      ['Socionomexamen saknas', 'handled'],
      ['Socionomexamen saknas', 'open'],
    ]);
  });

  test('the known limit: a position gone and back under the same code is the same cause, so its handled card stays handled', async () => {
    await requiredOfAnna();
    await scan(anna);
    store.removePosition('pos-usk');
    await scan(anna);
    expect(states('anna')).toEqual([['Socionomexamen saknas', 'handled']]);
    store.addPosition({ id: 'pos-usk-again', organisationId: ORG, code: 'usk', label: 'Undersköterska' });
    store.holdPosition('anna', 'pos-usk-again');
    await scan(anna);
    expect(states('anna')).toEqual([['Socionomexamen saknas', 'handled']]);
  });

  test('a renewal closes the card; revoked, the older holding decides again and a new card opens', async () => {
    const hlr = await competence.addType(admin, { name: 'HLR', area: 'Akut', kind: 'course', validityMonths: 24 });
    await competence.registerHolding(boss, 'anna', { typeId: hlr, issuedOn: '2024-01-10' }); // ran out 2026-01-10
    await scan(anna);
    expect(states('anna')).toEqual([['HLR gick ut 10 januari', 'open']]);
    const renewal = await competence.registerHolding(boss, 'anna', { typeId: hlr, issuedOn: '2026-11-01' });
    await scan(anna);
    expect(states('anna')).toEqual([['HLR gick ut 10 januari', 'handled']]);
    now += 60_000;
    await competence.revokeHolding(boss, renewal);
    await scan(anna);
    expect(states('anna')).toEqual([
      ['HLR gick ut 10 januari', 'handled'],
      ['HLR gick ut 10 januari', 'open'],
    ]);
  });

  test('an expiring card handled by the person is a new card when the holding runs out', async () => {
    const hlr = await competence.addType(admin, { name: 'HLR', area: 'Akut', kind: 'course', validityMonths: 24 });
    await competence.registerHolding(boss, 'anna', { typeId: hlr, issuedOn: '2025-01-10' }); // ends 2027-01-10
    await scan(anna);
    await handle(cards('anna')[0]!.id, 'handled');
    // The same holding a day later: the same card, still handled.
    await scan(anna);
    expect(states('anna')).toEqual([['HLR går ut 10 januari', 'handled']]);
    now = Date.parse('2027-01-11T09:00:00.000Z');
    await scan(anna);
    expect(states('anna')).toEqual([
      ['HLR går ut 10 januari', 'handled'],
      ['HLR gick ut 10 januari', 'open'],
    ]);
  });

  test('a card follows the person and the type: a copied row read again under a new id keeps the card and its dismissal', async () => {
    const hlr = await competence.addType(admin, { name: 'HLR', area: 'Akut', kind: 'course' });
    const copied = (id: string) => ({
      id,
      personId: 'anna',
      typeId: hlr,
      issuedOn: '2024-01-10',
      expiresOn: '2027-01-10',
      evidence: 'system' as const,
      state: 'valid' as const,
      registeredBy: null,
      createdAt: new Date(now).toISOString(),
      revokedAt: null,
      revokedBy: null,
      decidedBy: null,
      decidedAt: null,
      threadId: null,
      level: null,
      interest: false,
      validatedBy: null,
      validatedAt: null,
      copy: {
        connectorId: 'lms',
        sourceId: 'row-' + id,
        sourceType: 'hlr',
        sourceLabel: 'HLR',
        readAt: '2026-11-10T04:00:00.000Z',
      },
    });
    await store.transaction(async tx => {
      await tx.putSource({
        connectorId: 'lms',
        source: 'Lärplattformen',
        run: null,
        claimedAt: null,
        leaseUntil: null,
        startedAt: null,
        finishedAt: null,
        outcome: null,
        counts: null,
      });
      await tx.putCopied([copied('c1')]);
    });
    await scan(anna);
    await handle(cards('anna')[0]!.id, 'dismissed');
    // The source answers the same holding under a new row id: the old row goes, the new one comes.
    await store.transaction(async tx => {
      await tx.removeCopied('lms', ['c1']);
      await tx.putCopied([copied('c2')]);
    });
    await scan(anna);
    expect(states('anna')).toEqual([['HLR går ut 10 januari', 'dismissed']]);
  });

  test('a new validity of the type moves the end date: the card for the old date closes and one for the new date opens', async () => {
    const hlr = await competence.addType(admin, { name: 'HLR', area: 'Akut', kind: 'course', validityMonths: 24 });
    await competence.registerHolding(boss, 'anna', { typeId: hlr, issuedOn: '2025-01-10' }); // ends 2027-01-10
    await scan(anna);
    await competence.updateType(admin, hlr, { validityMonths: 23 }); // ends 2026-12-10
    await scan(anna);
    expect(states('anna')).toEqual([
      ['HLR går ut 10 januari', 'handled'],
      ['HLR går ut 10 december', 'open'],
    ]);
  });
});

describe('the manager’s card (D108 item 12)', () => {
  const occurrencesOf = (personId: string) =>
    threads
      .dump()
      .filter(o => o.personId === personId)
      .map(o => [o.sourceKey, o.period, o.revision, o.sourceState]);

  test('one occurrence that names nobody: its period a digest of what is due, so nothing of a person or a type is stored', async () => {
    await requiredOfAnna();
    await scan(boss);
    expect(states('boss')).toEqual([['Intyg att åtgärda bland dina medarbetare', 'open']]);
    const [card] = cards('boss');
    const [occurrence] = occurrencesOf('boss');
    expect(occurrence).toEqual(['competence:attention', expect.stringMatching(/^[0-9a-f]{64}$/), '1|0', 'open']);
    // Nothing about Anna or the type in the card, its occurrence or the audit rows written for it.
    const said = JSON.stringify([
      card,
      occurrencesOf('boss'),
      threads.threads.audit.filter(a => a.subject === 'thread:' + card!.id),
    ]);
    for (const word of ['anna', 'Anna', 'Andersson', 'Socionomexamen', store.state.types.keys().next().value!])
      expect(said).not.toContain(word);
  });

  test('a set of things due that stands is the same card: handled, it stays handled, and it is never duplicated', async () => {
    await requiredOfAnna();
    await scan(boss);
    const [card] = cards('boss');
    await handle(card!.id, 'handled');
    await scan(boss);
    await scan(boss);
    expect(states('boss')).toEqual([['Intyg att åtgärda bland dina medarbetare', 'handled']]);
    expect(occurrencesOf('boss')).toHaveLength(1);
  });

  test('work that comes back at the same counts is a new card: missing, registered, then revoked', async () => {
    const { typeId } = await requiredOfAnna();
    await scan(boss);
    const holding = await competence.registerHolding(boss, 'anna', { typeId, issuedOn: '2015-06-05' });
    await scan(boss);
    expect(states('boss')).toEqual([['Intyg att åtgärda bland dina medarbetare', 'handled']]);
    now += 60_000;
    await competence.revokeHolding(boss, holding);
    await scan(boss);
    // The same counts as before (1|0), and a new card: the old one stays handled with its occurrence resolved.
    expect(states('boss')).toEqual([
      ['Intyg att åtgärda bland dina medarbetare', 'handled'],
      ['Intyg att åtgärda bland dina medarbetare', 'open'],
    ]);
    expect(occurrencesOf('boss').map(([, , revision, state]) => [revision, state])).toEqual([
      ['1|0', 'resolved'],
      ['1|0', 'open'],
    ]);
  });

  test('a new set of things due is a new card, and the card for the set that went closes', async () => {
    await requiredOfAnna();
    await scan(boss);
    await requiredOfAnna('Fallskydd');
    await scan(boss);
    expect(states('boss')).toEqual([
      ['Intyg att åtgärda bland dina medarbetare', 'handled'],
      ['Intyg att åtgärda bland dina medarbetare', 'open'],
    ]);
    expect(occurrencesOf('boss').map(([, , revision, state]) => [revision, state])).toEqual([
      ['1|0', 'resolved'],
      ['2|0', 'open'],
    ]);
  });

  test('nothing due closes it', async () => {
    const { typeId } = await requiredOfAnna();
    await scan(boss);
    await competence.registerHolding(boss, 'anna', { typeId, issuedOn: '2015-06-05' });
    await scan(boss);
    expect(states('boss')).toEqual([['Intyg att åtgärda bland dina medarbetare', 'handled']]);
  });
});

describe('a person’s card comes back only for a new cause (D108 item 12)', () => {
  test('a second requirement on a type already missing, an administrator’s requirement on a unit, and the later of two removed leave a dismissed card as it is', async () => {
    const { typeId } = await requiredOfAnna();
    await scan(anna);
    await handle(cards('anna')[0]!.id, 'dismissed');
    // Her manager requires it of her too, and an administrator of everyone on her unit.
    const onAnna = await competence.addRequirement(boss, { typeId, personId: 'anna' });
    await scan(anna);
    await competence.addRequirement(admin, { typeId, unitId: 'u1' });
    await scan(anna);
    expect(states('anna')).toEqual([['Socionomexamen saknas', 'dismissed']]);
    // The later of the requirements removed: the type has been required of her as long as before.
    await competence.removeRequirement(boss, onAnna);
    await scan(anna);
    expect(states('anna')).toEqual([['Socionomexamen saknas', 'dismissed']]);
    expect(audited('thread.pushed')).toHaveLength(1);
  });

  test('a duplicate revoked that never decided leaves a dismissed card as it is; a revocation that decides is a new card', async () => {
    const hlr = await competence.addType(admin, { name: 'HLR', area: 'Akut', kind: 'course' });
    await competence.registerHolding(boss, 'anna', { typeId: hlr, issuedOn: '2025-01-10', expiresOn: '2027-01-10' });
    const duplicate = await competence.registerHolding(boss, 'anna', {
      typeId: hlr,
      issuedOn: '2024-12-20',
      expiresOn: '2026-12-20',
    });
    await scan(anna);
    expect(states('anna')).toEqual([['HLR går ut 10 januari', 'open']]);
    await handle(cards('anna')[0]!.id, 'dismissed');
    now += 60_000;
    await competence.revokeHolding(boss, duplicate);
    await scan(anna);
    expect(states('anna')).toEqual([['HLR går ut 10 januari', 'dismissed']]);
  });

  test('a copied row its source withdraws and answers again under a new id gives the card back its identity', async () => {
    const hlr = await competence.addType(admin, { name: 'HLR', area: 'Akut', kind: 'course' });
    const copied = (id: string, extra: object = {}) => ({
      id,
      personId: 'anna',
      typeId: hlr,
      issuedOn: '2024-01-10',
      expiresOn: '2027-01-10',
      evidence: 'system' as const,
      state: 'valid' as const,
      registeredBy: null,
      createdAt: new Date(now).toISOString(),
      revokedAt: null,
      revokedBy: null,
      decidedBy: null,
      decidedAt: null,
      threadId: null,
      level: null,
      interest: false,
      validatedBy: null,
      validatedAt: null,
      copy: {
        connectorId: 'lms',
        sourceId: 'row-' + id,
        sourceType: 'hlr',
        sourceLabel: 'HLR',
        readAt: '2026-11-10T04:00:00.000Z',
      },
      ...extra,
    });
    await store.transaction(async tx => {
      await tx.putSource({
        connectorId: 'lms',
        source: 'Lärplattformen',
        run: null,
        claimedAt: null,
        leaseUntil: null,
        startedAt: null,
        finishedAt: null,
        outcome: null,
        counts: null,
      });
      await tx.putCopied([copied('c1')]);
    });
    await scan(anna);
    await handle(cards('anna')[0]!.id, 'dismissed');
    // The source withdraws its row, then answers the same holding under a new row id: the withdrawn row stays revoked.
    await store.transaction(tx =>
      tx.putCopied([copied('c1', { state: 'revoked', revokedAt: new Date(now).toISOString() })]),
    );
    await scan(anna);
    await store.transaction(tx => tx.putCopied([copied('c2')]));
    await scan(anna);
    expect(states('anna')).toEqual([['HLR går ut 10 januari', 'dismissed']]);
    expect(audited('thread.pushed')).toHaveLength(1);
  });
});

describe('a scan that cannot read says nothing', () => {
  test('a directory or a store that fails is a failed scan: open cards stay open, nothing is resolved', async () => {
    await requiredOfAnna();
    await scan(boss);
    await scan(anna);
    staffFails = true;
    await scan(boss);
    storeFails = true;
    await scan(anna);
    expect(states('boss')).toEqual([['Intyg att åtgärda bland dina medarbetare', 'open']]);
    expect(states('anna')).toEqual([['Socionomexamen saknas', 'open']]);
    expect(audited('thread.source_resolved')).toEqual([]);
    expect(threads.dump().every(o => o.sourceState === 'open')).toBe(true);
    expect(audited('refresh.failed').length).toBeGreaterThanOrEqual(2);
  });
});

describe('the reset of cards from topic-only scans (D47)', () => {
  test('a dry run counts; with confirm each open topic-only card is resolved and handled, its timers ended, one audit row each', async () => {
    const { typeId } = await requiredOfAnna();
    legacy = true;
    await scan(anna);
    await scan(boss);
    const [annas] = cards('anna');
    const [boss1] = cards('boss');
    expect(threads.dump().map(o => o.legacy)).toEqual([true, true]);
    // Anna snoozed hers; the boss dismissed his, which is left as it is.
    await threads.threads.transaction(tx =>
      tx.scheduleTimer({
        id: 'snooze:' + annas!.id,
        personId: 'anna',
        threadId: annas!.id,
        kind: 'snooze',
        unitId: 'u1',
        authorizationVersion: 'v1',
        dueAt: '2026-11-20T07:00:00.000Z',
        requestedAt: new Date(now).toISOString(),
      }),
    );
    await handle(boss1!.id, 'dismissed');
    const reset = legacyCardsUsecases({ store: threads, clock: () => new Date(now) });
    expect(await reset.reset('competence', 'operator:cli', { confirm: false })).toEqual({
      cards: 1,
      occurrences: 1,
      skipped: 0,
      left: 1,
    });
    expect(states('anna')).toEqual([['Socionomexamen saknas', 'open']]);
    expect(await reset.reset('competence', 'operator:cli', { confirm: true })).toEqual({
      cards: 1,
      occurrences: 1,
      skipped: 0,
      left: 1,
    });
    expect(states('anna')).toEqual([['Socionomexamen saknas', 'handled']]);
    expect(await threads.threads.transaction(tx => tx.readTimer('snooze:' + annas!.id))).toMatchObject({
      state: 'cancelled',
    });
    expect(audited('thread.source_resolved')).toEqual([
      {
        actor: 'operator:cli',
        action: 'thread.source_resolved',
        subject: 'thread:' + annas!.id,
        at: new Date(now).toISOString(),
        details: { connector: 'competence', reason: 'legacy-reset', occurrences: 1 },
      },
    ]);
    // A second run finds nothing more to do.
    expect(await reset.reset('competence', 'operator:cli', { confirm: true })).toMatchObject({ cards: 0 });
    // The next scan pushes a fresh card for the cause that still stands, which then closes like any other.
    legacy = false;
    await scan(anna);
    expect(states('anna')).toEqual([
      ['Socionomexamen saknas', 'handled'],
      ['Socionomexamen saknas', 'open'],
    ]);
    await competence.registerHolding(boss, 'anna', { typeId, issuedOn: '2015-06-05' });
    await scan(anna);
    expect(states('anna').map(([, state]) => state)).toEqual(['handled', 'handled']);
  });

  test('a card with a write under way is skipped and counted, never touched', async () => {
    await requiredOfAnna();
    legacy = true;
    await scan(anna);
    const [card] = cards('anna');
    await threads.threads.transaction(tx =>
      tx.updateThread(card!.id, { execution: { id: 'x', state: 'pending' } } as never),
    );
    const reset = legacyCardsUsecases({ store: threads, clock: () => new Date(now) });
    expect(await reset.reset('competence', 'operator:cli', { confirm: true })).toEqual({
      cards: 0,
      occurrences: 0,
      skipped: 1,
      left: 0,
    });
    expect(states('anna')).toEqual([['Socionomexamen saknas', 'open']]);
  });
});
