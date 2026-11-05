import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { database, schema } from '@clew/db';
import type { Job } from '../model';
const jobs = schema.jobs;
export const durableJobs = {
  claimDelivery: (at: string) => database().transaction(async tx => {
    const [j] = await tx.select().from(jobs).where(and(eq(jobs.status, 'temporal'), lte(jobs.nextAttemptAt, new Date(at)), or(isNull(jobs.leaseUntil), lte(jobs.leaseUntil, new Date(at))))).orderBy(jobs.runAt).for('update', { skipLocked: true }).limit(1);
    if (!j) return undefined;
    const [claimed] = await tx.update(jobs).set({ dispatchAttempt: j.dispatchAttempt + 1, leaseUntil: new Date(Date.parse(at) + 30_000) }).where(eq(jobs.id, j.id)).returning();
    return { id: j.id, dueAt: j.runAt.toISOString(), attempt: claimed!.dispatchAttempt };
  }),
  async delivered(id: string, attempt: number, at: string, error?: string) {
    await database().update(jobs).set({ ...(error ? {} : { status: 'dispatched' as const }), leaseUntil: null, nextAttemptAt: new Date(Date.parse(at) + 10_000), lastError: error ?? null })
      .where(and(eq(jobs.id, id), eq(jobs.status, 'temporal'), eq(jobs.dispatchAttempt, attempt)));
  },
  claimExecution: (id: string, at: string) => database().transaction(async tx => {
    const [j] = await tx.select().from(jobs).where(eq(jobs.id, id)).for('update');
    if (!j || ['done', 'legacy-running', 'running', 'due'].includes(j.status)) return undefined;
    if (j.runAt.toISOString() > at || j.status === 'executing' && j.leaseUntil && j.leaseUntil.toISOString() > at) return 'busy' as const;
    await tx.update(jobs).set({ status: 'executing', attempts: j.attempts + 1, leaseUntil: new Date(Date.parse(at) + 120_000), startedAt: new Date(at) }).where(eq(jobs.id, id));
    return { id, kind: j.kind, payload: j.payload, attempt: j.attempts + 1 } satisfies Job & { attempt: number };
  }),
  async completed(id: string, attempt: number, at: string) {
    await database().transaction(async tx => {
      const done = await tx.update(jobs).set({ status: 'done', leaseUntil: null, finishedAt: new Date(at), lastError: null }).where(and(eq(jobs.id, id), eq(jobs.status, 'executing'), eq(jobs.attempts, attempt))).returning();
      if (done.length) await tx.insert(schema.audit).values({ actor: 'system:scheduler', action: 'job.completed', subject: `job:${id}`, createdAt: new Date(at), details: { attempt } });
    });
  },
};
