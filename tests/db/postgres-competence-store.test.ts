import { afterAll } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { competenceStoreWithCards } from '../../apps/server/src/composition/competence';
import { competenceStoreContract } from '../competence-store-contract';
import { forgetTestWorkflows, testDurable } from './durable';

/**
 * The competence store contract on Postgres (D108), over the store composition builds: the competence tables and the
 * person's own competence cards on one thread-store transaction (`competenceStoreWithCards`), with the test's own engine
 * queue. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
const prefixes: string[] = [];
afterAll(async () => {
  const db = database();
  for (const p of prefixes) {
    await db.delete(schema.competenceHoldings).where(like(schema.competenceHoldings.id, p + '%'));
    await db.delete(schema.competenceTypes).where(like(schema.competenceTypes.id, p + '%'));
    await db.delete(schema.threads).where(like(schema.threads.id, p + '%'));
    await db.delete(schema.audit).where(like(schema.audit.subject, '%:' + p + '%'));
    await db.delete(schema.people).where(like(schema.people.id, p + '%'));
  }
  await forgetTestWorkflows();
});
const store = competenceStoreWithCards({ durable: testDurable, cancel: async () => undefined });

competenceStoreContract('postgres', async () => {
  const prefix = 'test-comp-' + randomUUID().slice(0, 8);
  prefixes.push(prefix);
  return {
    store,
    prefix,
    async seedPerson(person) {
      await database().insert(schema.people).values(person);
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
  };
});
