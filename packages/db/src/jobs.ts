import { database, type Transaction } from './index';
import { enqueueWorkflow, type DurableQueue } from './durable';
import { audit, jobs } from './schema';

/**
 * Idempotent: a job id is a natural key such as `scan:2026-11-04`, so repeated scheduling is harmless. A job id never
 * carries a person's name or user name, at most their id, as `attention:automatic:<personId>:<dueAt>` does, because it
 * is written as `job:<id>` into the audit row's subject and the workflow id on the durable engine's spans. The row's
 * `scheduledJob` workflow (`job:<id>`) is enqueued in the same transaction (D86); the row keeps the engine's ownership
 * status (`temporal`, the historical name) and remains the evidence of what was scheduled. A job runs only through that
 * workflow; nothing polls the table.
 */
export async function scheduleJob(
  input: { id: string; kind: string; runAt: Date; payload?: Record<string, unknown> },
  durable: DurableQueue,
  tx?: Transaction,
) {
  const write = async (transaction: Transaction) => {
    const inserted = await transaction
      .insert(jobs)
      .values({ id: input.id, kind: input.kind, runAt: input.runAt, payload: input.payload ?? {} })
      .onConflictDoNothing()
      .returning({ id: jobs.id });
    if (inserted.length) {
      await enqueueWorkflow(transaction, durable, jobStart(input.id, input.runAt));
      await transaction.insert(audit).values({
        actor: 'system:scheduler',
        action: 'job.scheduled',
        subject: `job:${input.id}`,
        details: { kind: input.kind, runAt: input.runAt.toISOString() },
      });
    }
  };
  if (tx) await write(tx);
  else await database().transaction(write);
}
/** The `scheduledJob` workflow of a job row: idempotent by the job's natural id, waiting until its run time. */
export const jobStart = (id: string, runAt: Date) => ({
  workflow: 'scheduledJob',
  id: `job:${id}`,
  input: { id, dueAt: runAt.toISOString() },
});
