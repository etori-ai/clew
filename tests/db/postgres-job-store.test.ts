import { afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { asc, eq, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { durableJobs } from '../../apps/server/src/scheduler/adapters/durable-postgres';
import { postgresJobQueue } from '../../apps/server/src/scheduler/adapters/postgres';
import { jobStoreContract } from '../job-store-contract';
import { testDurable } from './durable';

/**
 * The job table's contract on Postgres (D47, D85): `durableJobs`, and `postgresJobQueue`'s reads. Nothing here schedules
 * or takes over a job, so no workflow starts. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const prefixes: string[] = [];
afterAll(async () => {
  for (const prefix of prefixes) {
    await database()
      .delete(schema.audit)
      .where(like(schema.audit.subject, 'job:' + prefix + '%'));
    await database()
      .delete(schema.jobs)
      .where(like(schema.jobs.id, prefix + '%'));
  }
});
jobStoreContract('postgres', async () => {
  const prefix = 'job-store-test-' + randomUUID();
  prefixes.push(prefix);
  return {
    executions: durableJobs,
    unfinished: postgresJobQueue({
      durable: testDurable,
      move: () => Promise.reject(new Error('the contract takes nothing over')),
    }).unfinished,
    prefix,
    async seed(row) {
      await database()
        .insert(schema.jobs)
        .values({
          id: row.id,
          kind: row.kind,
          runAt: new Date(row.runAt),
          status: row.status ?? 'temporal',
          attempts: row.attempts ?? 0,
          leaseUntil: row.leaseUntil ? new Date(row.leaseUntil) : null,
        });
    },
    async row(id) {
      const [row] = await database()
        .select({ status: schema.jobs.status, attempts: schema.jobs.attempts, leaseUntil: schema.jobs.leaseUntil })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, id));
      return row && { status: row.status, attempts: row.attempts, leaseUntil: row.leaseUntil?.toISOString() ?? null };
    },
    async audit(id) {
      return database()
        .select({ action: schema.audit.action, details: schema.audit.details })
        .from(schema.audit)
        .where(eq(schema.audit.subject, 'job:' + id))
        .orderBy(asc(schema.audit.id));
    },
  };
});
