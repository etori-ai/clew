import { afterAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, like, sql } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import type { DurableQueue } from '../../packages/db/src/durable';
import { competenceStoreWithCards } from '../../apps/server/src/composition/competence';
import { postgresCompetenceStore } from '../../apps/server/src/modules/competence/adapters/postgres';
import { competenceStoreContract, copiedRow, typeRow } from '../competence-store-contract';

/**
 * The competence store contract on Postgres (D108), over the store composition builds: the competence tables and the
 * person's own competence cards on one thread-store transaction (`competenceStoreWithCards`), with this suite's own
 * engine application and queue. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
/** An application of its own, so the starts this suite commits are never dequeued by the development server. */
const application = 'clew-test-competence-' + randomUUID().slice(0, 8);
const durable: DurableQueue = { application, queue: application + '.ledger' };
const prefixes: string[] = [];
afterAll(async () => {
  const db = database();
  for (const p of prefixes) {
    await db.delete(schema.competenceReadLog).where(like(schema.competenceReadLog.id, p + '%'));
    await db.delete(schema.competenceErasures).where(like(schema.competenceErasures.personId, p + '%'));
    await db.delete(schema.competenceRetention).where(like(schema.competenceRetention.organisationId, p + '%'));
    await db.delete(schema.competenceRequirements).where(like(schema.competenceRequirements.id, p + '%'));
    await db.delete(schema.competenceShareTargets).where(like(schema.competenceShareTargets.id, p + '%'));
    await db.delete(schema.competenceHoldings).where(like(schema.competenceHoldings.id, p + '%'));
    await db.delete(schema.competenceSourceMappings).where(like(schema.competenceSourceMappings.connectorId, p + '%'));
    await db.delete(schema.competenceSources).where(like(schema.competenceSources.connectorId, p + '%'));
    await db.delete(schema.competenceTypes).where(like(schema.competenceTypes.id, p + '%'));
    await db.delete(schema.threads).where(like(schema.threads.id, p + '%'));
    await db.delete(schema.audit).where(like(schema.audit.subject, '%:' + p + '%'));
    await db.delete(schema.connectors).where(like(schema.connectors.id, p + '%'));
    await db.delete(schema.assignments).where(like(schema.assignments.personId, p + '%'));
    await db.delete(schema.personPositions).where(like(schema.personPositions.personId, p + '%'));
    await db.delete(schema.groups).where(like(schema.groups.id, p + '%'));
    await db.delete(schema.units).where(like(schema.units.id, p + '%'));
    await db.delete(schema.positions).where(like(schema.positions.id, p + '%'));
    await db.delete(schema.people).where(like(schema.people.id, p + '%'));
  }
  await db.execute(sql`delete from dbos.workflow_status where application_name = ${application}`);
});
const store = competenceStoreWithCards({ durable, cancel: async () => undefined });

competenceStoreContract('postgres', async () => {
  // A connector's id is lower case (`connector_id` check), and every id this run writes starts with it.
  const prefix = 'test-comp-' + randomUUID().slice(0, 8);
  prefixes.push(prefix);
  return {
    store,
    prefix,
    async seedPerson(person) {
      await database().insert(schema.people).values(person);
    },
    async deactivate(personId) {
      await database().update(schema.people).set({ enabled: false }).where(eq(schema.people.id, personId));
    },
    async seedConnector(id) {
      await database()
        .insert(schema.connectors)
        .values({ id, url: 'http://' + id + '.test', secret: 'sealed', createdBy: 'test', updatedBy: 'test' });
    },
    async seedCard(id, personId, connector) {
      const at = new Date('2026-11-10T08:00:00.000Z');
      await database()
        .insert(schema.threads)
        .values({
          id,
          personId,
          kind: 'pushed',
          topic: `${connector}:${id}`,
          title: 'HLR gick ut 1 juni',
          state: 'open',
          connector,
          area: connector,
          trigger: { reason: 'Behörigheten har gått ut', source: 'Kompetens', at: at.toISOString() },
          createdAt: at,
          updatedAt: at,
        });
    },
    async cardsOf(personId) {
      const rows = await database()
        .select({ id: schema.threads.id })
        .from(schema.threads)
        .where(eq(schema.threads.personId, personId))
        .orderBy(schema.threads.id);
      return rows.map(r => r.id);
    },
    async auditFor(subject) {
      return database()
        .select({ actor: schema.audit.actor, action: schema.audit.action })
        .from(schema.audit)
        .where(eq(schema.audit.subject, subject))
        .orderBy(schema.audit.id);
    },
    async enqueued() {
      const rows = await database().execute<{ id: string }>(
        sql`select workflow_uuid as id from dbos.workflow_status where application_name = ${application} order by workflow_uuid`,
      );
      return [...rows].map(r => r.id);
    },
    async seedPosition(position) {
      await database().insert(schema.positions).values(position);
    },
    async holdPosition(personId, positionId) {
      await database().insert(schema.personPositions).values({ personId, positionId });
    },
    async seedUnit({ parentId = null, pushed = true, ...unit }) {
      await database().insert(schema.units).values(unit);
      if (pushed)
        await database()
          .insert(schema.groups)
          .values({
            id: unit.id + '-group',
            organisationId: unit.organisationId,
            externalId: 'unit:' + unit.id,
            label: unit.label,
            parentUnitId: parentId,
          });
    },
    async place(personId, unitId) {
      await database().insert(schema.assignments).values({ personId, unitId, role: 'employee' });
    },
  };
});

/**
 * The database's own hook for D108 item 9: when an administrator removes a connector, its row goes, and with it every
 * holding copied from it, its mappings and the record of its reads (`ON DELETE CASCADE`), in the removal's transaction.
 * Rows registered in Clew and another connector's stay.
 */
test('removing a connector removes what it put in the competence register, and nothing else', async () => {
  const p = 'test-comp-' + randomUUID().slice(0, 8);
  prefixes.push(p);
  const store = competenceStoreWithCards({ durable, cancel: async () => undefined });
  const db = database();
  await db.insert(schema.people).values({ id: p + '-anna', organisationId: p + '-org', name: 'Synthetic' });
  for (const id of [p + '-lms', p + '-hr'])
    await db
      .insert(schema.connectors)
      .values({ id, url: 'http://x.test', secret: 's', createdBy: 't', updatedBy: 't' });
  const blank = (connectorId: string) => ({
    connectorId,
    source: 'Lärplattformen',
    run: null,
    claimedAt: null,
    leaseUntil: null,
    startedAt: null,
    finishedAt: null,
    outcome: null,
    counts: null,
  });
  await store.transaction(async tx => {
    await tx.insertType(typeRow(p + '-t1', p + '-org'));
    // The copy writes a source's row before any copied row, which refers to it.
    await tx.putSource(blank(p + '-lms'));
    await tx.putSource(blank(p + '-hr'));
    await tx.putCopied([
      copiedRow(p + '-c1', p + '-anna', p + '-t1', { connectorId: p + '-lms', sourceId: 's1' }),
      copiedRow(p + '-c2', p + '-anna', null, { connectorId: p + '-hr', sourceId: 's1' }),
    ]);
    await tx.putMapping({
      connectorId: p + '-lms',
      organisationId: p + '-org',
      sourceType: 'course:1',
      typeId: p + '-t1',
      mappedBy: 't',
      mappedAt: new Date().toISOString(),
    });
  });
  await db.delete(schema.connectors).where(eq(schema.connectors.id, p + '-lms'));
  expect(await store.transaction(tx => tx.copiedFrom(p + '-lms'))).toEqual([]);
  expect(await store.transaction(tx => tx.mappingsOf(p + '-lms'))).toEqual([]);
  expect(await store.transaction(tx => tx.source(p + '-lms'))).toBeUndefined();
  expect((await store.transaction(tx => tx.copiedFrom(p + '-hr'))).map(h => h.id)).toEqual([p + '-c2']);
});

/**
 * D108 item 6, amended: a requirement and a share target name a position by its code and a unit by its id, not by a row.
 * A provisioner that removes a position group and pushes it again (a new row, a new id) leaves them standing: while the
 * position is gone they count for nobody, and when it comes back under the same code its holders are under them again.
 * Removing a unit's group or row takes nothing either. A person's own requirement still goes with the person's row.
 */
test('a requirement and a share target outlive their position and unit rows, and apply again when the code comes back', async () => {
  const p = 'test-comp-' + randomUUID().slice(0, 8);
  prefixes.push(p);
  const store = postgresCompetenceStore(durable);
  const db = database();
  const org = p + '-org';
  await db.insert(schema.people).values({ id: p + '-anna', organisationId: org, name: 'Synthetic' });
  await db.insert(schema.positions).values({ id: p + '-usk', organisationId: org, code: 'usk', label: 'Usk' });
  await db.insert(schema.personPositions).values({ personId: p + '-anna', positionId: p + '-usk' });
  await db.insert(schema.units).values({ id: p + '-u1', organisationId: org, label: 'Enhet' });
  const at = new Date().toISOString();
  const requirement = (id: string, target: { positionCode?: string; unitId?: string; personId?: string }) => ({
    id,
    organisationId: org,
    typeId: p + '-t1',
    positionCode: null,
    unitId: null,
    personId: null,
    minLevel: null,
    createdBy: 't',
    createdAt: at,
    ...target,
  });
  await store.transaction(async tx => {
    await tx.insertType(typeRow(p + '-t1', org));
    await tx.insertRequirement(requirement(p + '-r1', { positionCode: 'usk' }));
    await tx.insertRequirement(requirement(p + '-r2', { personId: p + '-anna' }));
    await tx.insertRequirement(requirement(p + '-r3', { unitId: p + '-u1' }));
    await tx.insertShareTarget({
      id: p + '-s1',
      organisationId: org,
      typeId: p + '-t1',
      positionCode: 'usk',
      unitId: null,
      minShare: 40,
      createdBy: 't',
      createdAt: at,
    });
  });
  // The position group is removed: its row goes, and with it who held it. The requirement and the target stay.
  await db.delete(schema.positions).where(eq(schema.positions.id, p + '-usk'));
  await db.delete(schema.units).where(eq(schema.units.id, p + '-u1'));
  expect((await store.transaction(tx => tx.requirements(org))).map(r => r.id).sort()).toEqual(
    [p + '-r1', p + '-r2', p + '-r3'].sort(),
  );
  expect((await store.transaction(tx => tx.shareTargets(org))).map(t => t.id)).toEqual([p + '-s1']);
  expect(await store.transaction(tx => tx.placesOf(org, [p + '-anna']))).toEqual([
    { personId: p + '-anna', unitIds: [], positionCodes: [] },
  ]);
  // Pushed again under the same code: a new row, and the holder is under the position's requirement again.
  await db.insert(schema.positions).values({ id: p + '-usk-again', organisationId: org, code: 'usk', label: 'Usk' });
  await db.insert(schema.personPositions).values({ personId: p + '-anna', positionId: p + '-usk-again' });
  expect(await store.transaction(tx => tx.placesOf(org, [p + '-anna']))).toEqual([
    { personId: p + '-anna', unitIds: [], positionCodes: ['usk'] },
  ]);
  expect(await store.transaction(tx => tx.positionHolders(org, ['usk']))).toEqual([
    { personId: p + '-anna', code: 'usk' },
  ]);
  await db.delete(schema.people).where(eq(schema.people.id, p + '-anna'));
  expect((await store.transaction(tx => tx.requirements(org))).map(r => r.id).sort()).toEqual(
    [p + '-r1', p + '-r3'].sort(),
  );
});
