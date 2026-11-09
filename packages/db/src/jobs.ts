import { and, eq, lte, sql } from 'drizzle-orm';
import { database, type Transaction } from './index';
import { enqueueWorkflow, type DurableQueue } from './durable';
import { audit, jobs } from './schema';

export type JobRow = typeof jobs.$inferSelect;
/**
 * Idempotent: a job id is a natural key such as `scan:hillevi:2026-11-04`, so repeated scheduling is harmless. The
 * row's `scheduledJob` workflow (`job:<id>`) is enqueued in the same transaction (D86); the row keeps the engine's
 * ownership status (`temporal`, the historical name) and remains the evidence of what was scheduled.
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
/** Claim one due job with a row lock so several server processes never run the same job twice. */
export async function claimJob(now = new Date()): Promise<JobRow | undefined> {
  return database().transaction(async tx => {
    const [row] = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, 'due'), lte(jobs.runAt, now)))
      .orderBy(jobs.runAt)
      .limit(1)
      .for('update', { skipLocked: true });
    if (!row) return undefined;
    const [claimed] = await tx
      .update(jobs)
      .set({ status: 'running', startedAt: now, attempts: sql`${jobs.attempts} + 1` })
      .where(eq(jobs.id, row.id))
      .returning();
    return claimed;
  });
}
export async function finishJob(id: string, error?: string) {
  await database()
    .update(jobs)
    .set({ status: error ? 'failed' : 'done', lastError: error ?? null, finishedAt: new Date() })
    .where(eq(jobs.id, id));
}
