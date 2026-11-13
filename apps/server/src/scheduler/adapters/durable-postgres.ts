import { and, eq } from 'drizzle-orm';
import { database, schema } from '@clew/db';
import { JOB_LEASE_MS, type Job, type JobExecutions } from '../model';
const jobs = schema.jobs;
/** The attempt's own row while it still holds the job: executing, and not claimed again since. */
const held = (id: string, attempt: number) =>
  and(eq(jobs.id, id), eq(jobs.status, 'executing'), eq(jobs.attempts, attempt));
/**
 * The engine's side of the job table (D47, D85): a `scheduledJob` workflow, enqueued with the row (D86), claims the
 * execution under a lease, which its run renews while it lasts, and completes it with its audit. The status `temporal`
 * is the engine owner's historical name; `dispatched` and the delivery columns belong to the retired outbox and are
 * left as evidence.
 */
export const durableJobs: JobExecutions = {
  claimExecution: (id: string, at: string) =>
    database().transaction(async tx => {
      const [j] = await tx.select().from(jobs).where(eq(jobs.id, id)).for('update');
      if (!j || ['done', 'legacy-running', 'running', 'due'].includes(j.status)) return undefined;
      if (j.runAt.toISOString() > at || (j.status === 'executing' && j.leaseUntil && j.leaseUntil.toISOString() > at))
        return 'busy' as const;
      await tx
        .update(jobs)
        .set({
          status: 'executing',
          attempts: j.attempts + 1,
          leaseUntil: new Date(Date.parse(at) + JOB_LEASE_MS),
          startedAt: new Date(at),
        })
        .where(eq(jobs.id, id));
      return { id, kind: j.kind, payload: j.payload, attempt: j.attempts + 1 } satisfies Job & { attempt: number };
    }),
  async renew(id: string, attempt: number, at: string) {
    const renewed = await database()
      .update(jobs)
      .set({ leaseUntil: new Date(Date.parse(at) + JOB_LEASE_MS) })
      .where(held(id, attempt))
      .returning({ id: jobs.id });
    return renewed.length > 0;
  },
  completed: (id: string, attempt: number, at: string) =>
    database().transaction(async tx => {
      const done = await tx
        .update(jobs)
        .set({ status: 'done', leaseUntil: null, finishedAt: new Date(at), lastError: null })
        .where(held(id, attempt))
        .returning({ id: jobs.id });
      if (!done.length) return false;
      await tx.insert(schema.audit).values({
        actor: 'system:scheduler',
        action: 'job.completed',
        subject: `job:${id}`,
        createdAt: new Date(at),
        details: { attempt },
      });
      return true;
    }),
};
