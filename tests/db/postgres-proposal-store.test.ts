import { afterAll } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import { readAudit } from '../../packages/db/src/threads';
import { postgresProposalStore } from '../../apps/server/src/modules/calendar/adapters/postgres';
import { proposalStoreContract } from '../proposal-store-contract';
import { forgetTestWorkflows, testDurable } from './durable';

/** The proposal store contract against Postgres (D25). `bun run test:db` inside the devcontainer. */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const created: string[] = [];
afterAll(async () => {
  if (created.length) {
    const owned = await database()
      .select({ id: schema.threads.id })
      .from(schema.threads)
      .where(inArray(schema.threads.personId, created));
    const ids = owned.map(r => r.id);
    if (ids.length) {
      await database()
        .delete(schema.audit)
        .where(
          inArray(
            schema.audit.subject,
            ids.map(id => 'thread:' + id),
          ),
        );
      await database()
        .delete(schema.jobs)
        .where(
          inArray(
            schema.jobs.id,
            ids.flatMap(id => ['undo-expiry:' + id, 'lost:' + id]),
          ),
        );
      await database().delete(schema.threads).where(inArray(schema.threads.id, ids));
    }
    await database().delete(schema.people).where(inArray(schema.people.id, created));
  }
  await forgetTestWorkflows();
  await closeDatabase();
});
proposalStoreContract('postgres', async () => {
  const run = Math.random().toString(36).slice(2, 8);
  const people: [string, string] = [`test-${run}-a`, `test-${run}-b`];
  await database()
    .insert(schema.people)
    .values(people.map(id => ({ id, organisationId: 'test', name: id })));
  created.push(...people);
  return {
    store: postgresProposalStore(testDurable),
    people,
    auditFor: async subject =>
      (await readAudit(subject)).map(r => ({
        actor: r.actor,
        action: r.action,
        subject: r.subject,
        at: r.createdAt.toISOString(),
        details: r.details,
      })),
    hasJob: async id =>
      (await database().select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.id, id))).length > 0,
  };
});
