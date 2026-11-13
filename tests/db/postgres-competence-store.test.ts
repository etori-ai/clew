import { afterAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, like, sql } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import type { DurableQueue } from '../../packages/db/src/durable';
import { competenceStoreWithCards } from '../../apps/server/src/composition/competence';
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
    await db.delete(schema.competenceHoldings).where(like(schema.competenceHoldings.id, p + '%'));
    await db.delete(schema.competenceSourceMappings).where(like(schema.competenceSourceMappings.connectorId, p + '%'));
    await db.delete(schema.competenceSources).where(like(schema.competenceSources.connectorId, p + '%'));
    await db.delete(schema.competenceTypes).where(like(schema.competenceTypes.id, p + '%'));
    await db.delete(schema.threads).where(like(schema.threads.id, p + '%'));
    await db.delete(schema.audit).where(like(schema.audit.subject, '%:' + p + '%'));
    await db.delete(schema.connectors).where(like(schema.connectors.id, p + '%'));
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
