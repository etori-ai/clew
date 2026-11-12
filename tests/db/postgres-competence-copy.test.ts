import { afterAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, like, sql } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import type { DurableQueue } from '../../packages/db/src/durable';
import { organisationInAudiences, readAudienceFacts } from '../../packages/db/src/auth';
import { inAudience } from '../../packages/connectors/src/index';
import type { ConnectorAudience } from '../../packages/contracts/src/index';
import { postgresCompetenceStore } from '../../apps/server/src/modules/competence/adapters/postgres';
import type { HoldingsPort, SourceHoldingsPage } from '../../apps/server/src/modules/competence/model';
import { competenceUsecases, COPY_ACTOR } from '../../apps/server/src/modules/competence/usecases';
import { copiedRow, typeRow } from '../competence-store-contract';

/**
 * The copy of D108 item 9 on Postgres, where the memory store cannot show it: what a `text` column refuses from a
 * source, the order in which the writers of copied rows take their locks when two run at once, and the audience rule
 * asked of the database. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const application = 'clew-test-competence-copy-' + randomUUID().slice(0, 8);
const durable: DurableQueue = { application, queue: application + '.ledger' };
const prefixes: string[] = [];
afterAll(async () => {
  const db = database();
  for (const p of prefixes) {
    await db.delete(schema.competenceHoldings).where(like(schema.competenceHoldings.personId, p + '%'));
    await db.delete(schema.competenceSourceMappings).where(like(schema.competenceSourceMappings.connectorId, p + '%'));
    await db.delete(schema.competenceSources).where(like(schema.competenceSources.connectorId, p + '%'));
    await db.delete(schema.competenceTypes).where(like(schema.competenceTypes.id, p + '%'));
    await db.delete(schema.audit).where(like(schema.audit.subject, '%' + p + '%'));
    await db.delete(schema.groupMembers).where(like(schema.groupMembers.personId, p + '%'));
    await db.delete(schema.groups).where(like(schema.groups.id, p + '%'));
    await db.delete(schema.accessGrants).where(like(schema.accessGrants.personId, p + '%'));
    await db.delete(schema.connectors).where(like(schema.connectors.id, p + '%'));
    await db.delete(schema.people).where(like(schema.people.id, p + '%'));
  }
  await db.execute(sql`delete from dbos.workflow_status where application_name = ${application}`);
});
/** A world of its own: an organisation, two active people with access, a connector and a catalogue type. */
async function world() {
  const p = 'test-copy-' + randomUUID().slice(0, 8);
  prefixes.push(p);
  const org = p + '-org',
    lms = p + '-lms',
    anna = p + '-anna',
    bo = p + '-bo';
  const db = database();
  for (const [id, userName] of [
    [anna, p + '.anna'],
    [bo, p + '.bo'],
  ] as const) {
    await db.insert(schema.people).values({ id, organisationId: org, name: 'Synthetic', userName });
    await db
      .insert(schema.accessGrants)
      .values({ personId: id, unitId: p + '-unit', unitLabel: 'Enhet', role: 'employee', capabilities: [] });
  }
  await db
    .insert(schema.connectors)
    .values({ id: lms, url: 'http://x.test', secret: 's', createdBy: 't', updatedBy: 't' });
  const store = postgresCompetenceStore(durable);
  await store.transaction(tx => tx.insertType(typeRow(p + '-t1', org)));
  return { p, org, lms, anna, bo, store };
}
/** The copy over the Postgres store, reading one page; everyone active is admitted. */
function copyOver(store: ReturnType<typeof postgresCompetenceStore>, page: SourceHoldingsPage) {
  const port: HoldingsPort = {
    switchedOn: async () => true,
    holdingsSources: async () => [],
    readHoldings: async () => page,
    admitted: async (_id, personIds) => new Set(personIds),
    reaches: async () => true,
  };
  return competenceUsecases({
    store,
    staff: async () => ({ units: [] }),
    clock: () => new Date('2026-11-12T10:00:00Z'),
    ids: () => randomUUID(),
    holdings: port,
  });
}

describe('what a text column refuses', () => {
  test('Postgres refuses a NUL in a copied row, and the copy takes a source answering one in its stride', async () => {
    const w = await world();
    // The hazard: the store writes what it is given, and Postgres refuses a NUL in `text` outright.
    const refused = await w.store
      .transaction(tx =>
        tx.putCopied([
          copiedRow(w.p + '-raw', w.anna, null, { connectorId: w.lms, sourceId: 's0', sourceLabel: 'HLR\u0000x' }),
        ]),
      )
      .then(
        () => null,
        error => error as Error,
      );
    expect(refused).not.toBeNull();
    const copy = copyOver(w.store, {
      rows: [
        {
          key: w.p + '.ANNA',
          holdings: [
            { id: 'c1', type: 't1', label: 'Hjärt-\u0000lungräddning', kind: 'course', issuedOn: '2025-11-01' },
            { id: 'c2\u0000', type: 't1', label: 'HLR', kind: 'course', issuedOn: '2025-11-01' },
            { id: 'c3', type: 't\ud800', label: 'HLR', kind: 'course', issuedOn: '2025-11-01' },
            { id: 'c4', type: 't1', label: 'HLR', kind: 'course', issuedOn: '2026-02-30' },
          ],
        },
        {
          key: w.p + '.bo\u0000',
          holdings: [{ id: 'c5', type: 't1', label: 'HLR', kind: 'course', issuedOn: '2025-11-01' }],
        },
      ],
      withdrawalsReported: false,
    });
    const result = await copy.copySource(COPY_ACTOR, 'run-1', { connectorId: w.lms, source: 'Lärplattformen' });
    expect(result).toMatchObject({ outcome: 'complete', counts: { read: 5, stored: 1, invalid: 4 } });
    const kept = await w.store.transaction(tx => tx.copiedFrom(w.lms));
    expect(kept.map(h => [h.copy!.sourceId, h.copy!.sourceLabel])).toEqual([['c1', 'Hjärt- lungräddning']]);
    expect((await w.store.transaction(tx => tx.source(w.lms)))?.run).toBeNull();
  });
});

describe('two writers of copied rows at once', () => {
  /**
   * A copy's write, by hand: the source's row first, then a pause the test controls, then the rows, one changed and one
   * new. The new one matters: inserting a row checks its foreign key and locks the row it refers to, which a change
   * that keeps the key does not.
   */
  async function copyWrite(w: Awaited<ReturnType<typeof world>>, gate: Promise<void>, locked: () => void) {
    return w.store.transaction(async tx => {
      await tx.source(w.lms);
      locked();
      await gate;
      await tx.putCopied([
        copiedRow(w.p + '-c1', w.anna, w.p + '-t1', { connectorId: w.lms, sourceId: 's1', sourceLabel: 'Ändrad' }),
        copiedRow(w.p + '-c2', w.anna, w.p + '-t1', { connectorId: w.lms, sourceId: 's2' }),
      ]);
    });
  }
  async function seeded() {
    const w = await world();
    await w.store.transaction(async tx => {
      await tx.putSource({
        connectorId: w.lms,
        source: 'Lärplattformen',
        run: null,
        claimedAt: null,
        leaseUntil: null,
        startedAt: null,
        finishedAt: null,
        outcome: null,
        counts: null,
      });
      await tx.putCopied([copiedRow(w.p + '-c1', w.anna, w.p + '-t1', { connectorId: w.lms, sourceId: 's1' })]);
    });
    let open!: () => void, locked!: () => void;
    const gate = new Promise<void>(resolve => (open = resolve));
    const hasLock = new Promise<void>(resolve => (locked = resolve));
    return { w, gate, open, locked, hasLock };
  }

  test('forgetting a source while a read writes it waits for the write, and neither deadlocks', async () => {
    const { w, gate, open, locked, hasLock } = await seeded();
    const writing = copyWrite(w, gate, locked);
    await hasLock;
    const forgetting = w.store.transaction(tx => tx.forgetSource(w.lms));
    // Give forgetting the time to take whatever it takes first, then let the write go on.
    await new Promise(resolve => setTimeout(resolve, 300));
    open();
    const [written, forgotten] = await Promise.allSettled([writing, forgetting]);
    expect(written.status).toBe('fulfilled');
    expect(forgotten).toEqual({ status: 'fulfilled', value: { holdings: 2, mappings: 0 } });
    expect(await w.store.transaction(tx => tx.copiedFrom(w.lms))).toEqual([]);
  });

  test('removing the connector while a read writes it waits for the write, and neither deadlocks', async () => {
    const { w, gate, open, locked, hasLock } = await seeded();
    const writing = copyWrite(w, gate, locked);
    await hasLock;
    // The administrator's removal, as the connector store does it: the connector's row, and the cascade from there.
    // `execute` sends it now; a query builder left alone would not run until awaited, after the write had gone on.
    const removing = database().delete(schema.connectors).where(eq(schema.connectors.id, w.lms)).execute();
    await new Promise(resolve => setTimeout(resolve, 300));
    open();
    const [written, removed] = await Promise.allSettled([writing, removing]);
    // A deadlock aborts one of the two with 40P01; the reason is in what fails here.
    expect(written).toMatchObject({ status: 'fulfilled' });
    expect(removed).toMatchObject({ status: 'fulfilled' });
    expect(await w.store.transaction(tx => tx.copiedFrom(w.lms))).toEqual([]);
    expect(await w.store.transaction(tx => tx.source(w.lms))).toBeUndefined();
  });

  test('erasing a person while a read writes their rows waits for the write, and their rows do not come back', async () => {
    const { w, gate, open, locked, hasLock } = await seeded();
    await database().update(schema.people).set({ enabled: false }).where(eq(schema.people.id, w.anna));
    const writing = copyWrite(w, gate, locked);
    await hasLock;
    const erasing = w.store.transaction(tx => tx.erasePerson(w.anna));
    await new Promise(resolve => setTimeout(resolve, 300));
    open();
    const [written, erased] = await Promise.allSettled([writing, erasing]);
    expect(written.status).toBe('fulfilled');
    expect(erased.status).toBe('fulfilled');
    expect(await w.store.transaction(tx => tx.holdingsOf([w.anna]))).toEqual([]);
  });
});

describe('the audience asked of the database', () => {
  test("a batch's facts and an organisation's reach follow the registry's own rule", async () => {
    const w = await world();
    const db = database();
    const group = w.p + '-g';
    await db
      .insert(schema.groups)
      .values({ id: group, organisationId: w.org, externalId: group + ':x', label: 'Grupp' });
    await db.insert(schema.groupMembers).values({ groupId: group, personId: w.bo });
    const cia = w.p + '-cia';
    await db.insert(schema.people).values({ id: cia, organisationId: w.org, name: 'Synthetic', enabled: false });
    const facts = await readAudienceFacts([w.anna, w.bo, cia, w.p + '-nobody']);
    expect(facts.map(f => [f.personId, f.role, f.unitId, f.groups]).sort()).toEqual(
      [
        [w.anna, 'employee', w.p + '-unit', []],
        [w.bo, 'employee', w.p + '-unit', [group + ':x']],
      ].sort(),
    );
    const audiences: ConnectorAudience[] = [
      { mode: 'all' },
      { mode: 'selected', groups: [group + ':x'] },
      { mode: 'selected', units: [w.p + '-unit'] },
      { mode: 'selected', roles: ['manager'] },
      { mode: 'selected' },
    ];
    for (const audience of audiences) {
      const inside = facts.filter(f =>
        inAudience(audience, {
          id: f.personId,
          name: '',
          unitId: f.unitId,
          unitLabel: '',
          role: f.role,
          groups: f.groups,
        }),
      );
      expect(await organisationInAudiences(w.org, [audience])).toBe(inside.length > 0);
    }
    expect(await organisationInAudiences(w.org, [{ mode: 'selected', groups: [group + ':x'] }, { mode: 'all' }])).toBe(
      true,
    );
    expect(
      await organisationInAudiences(w.org, [
        { mode: 'selected', groups: [group + ':x'] },
        { mode: 'selected', roles: ['manager'] },
      ]),
    ).toBe(false);
    expect(await organisationInAudiences(w.p + '-other', [{ mode: 'all' }])).toBe(false);
  });
});
