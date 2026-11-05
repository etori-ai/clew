import { and, eq, lte, sql } from 'drizzle-orm';
import { database, type Transaction } from './index';
import { audit, jobs } from './schema';

export type JobRow = typeof jobs.$inferSelect;
/** Idempotent: a job id is a natural key such as `scan:hillevi:2026-11-04`, so repeated scheduling is harmless. */
export async function scheduleJob(input: { id: string; kind: string; runAt: Date; payload?: Record<string, unknown> }, tx?: Transaction) {
  const write = async (transaction: Transaction) => {
    const inserted = await transaction.insert(jobs).values({ id: input.id, kind: input.kind, runAt: input.runAt, payload: input.payload ?? {} }).onConflictDoNothing().returning({ id: jobs.id });
    if (inserted.length) await transaction.insert(audit).values({ actor: 'system:scheduler', action: 'job.scheduled', subject: `job:${input.id}`, details: { kind: input.kind, runAt: input.runAt.toISOString() } });
  };
  if (tx) await write(tx); else await database().transaction(write);
}
/** Claim one due job with a row lock so several server processes never run the same job twice. */
export async function claimJob(now = new Date()): Promise<JobRow | undefined> {
  return database().transaction(async tx => {
    const [row] = await tx.select().from(jobs).where(and(eq(jobs.status, 'due'), lte(jobs.runAt, now))).orderBy(jobs.runAt).limit(1).for('update', { skipLocked: true });
    if (!row) return undefined;
    const [claimed] = await tx.update(jobs).set({ status: 'running', startedAt: now, attempts: sql`${jobs.attempts} + 1` }).where(eq(jobs.id, row.id)).returning();
    return claimed;
  });
}
export async function finishJob(id: string, error?: string) {
  await database().update(jobs).set({ status: error ? 'failed' : 'done', lastError: error ?? null, finishedAt: new Date() }).where(eq(jobs.id, id));
}
