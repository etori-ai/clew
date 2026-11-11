import { afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresCompetenceStore } from '../../apps/server/src/modules/competence/adapters/postgres';
import { competenceStoreContract } from '../competence-store-contract';

/** The competence store contract on Postgres (D107). Run with `bun run test:db` inside the devcontainer. */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const prefixes: string[] = [];
afterAll(async () => {
  const db = database();
  for (const p of prefixes) {
    await db.delete(schema.competenceHoldings).where(like(schema.competenceHoldings.id, p + '%'));
    await db.delete(schema.competenceTypes).where(like(schema.competenceTypes.id, p + '%'));
    await db.delete(schema.audit).where(like(schema.audit.subject, '%:' + p + '%'));
    await db.delete(schema.people).where(like(schema.people.id, p + '%'));
  }
});

competenceStoreContract('postgres', async () => {
  const prefix = 'test-comp-' + randomUUID().slice(0, 8);
  prefixes.push(prefix);
  return {
    store: postgresCompetenceStore(),
    prefix,
    async seedPerson(person) {
      await database().insert(schema.people).values(person);
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
