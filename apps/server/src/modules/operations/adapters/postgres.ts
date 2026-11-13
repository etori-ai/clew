import { sql } from 'drizzle-orm';
import { database } from '@clew/db';
import type { ReliabilityCounts } from '../usecases';
/** Aggregate-only operational evidence: no identities, titles, tokens or source payloads. */
export async function reliabilityCounts(): Promise<ReliabilityCounts> {
  const rows = await database().execute(sql`
    select
      (select count(*)::int from execution where state in ('pending','running')) as "pendingExecutions",
      (select coalesce(greatest(0, extract(epoch from now() - min(created_at)))::int,0) from execution where state in ('pending','running')) as "oldestPendingSeconds",
      (select count(*)::int from execution where state = 'unknown') as "unknownExecutions",
      (select count(*)::int from timer_intent where state = 'active' and due_at < now() - interval '30 seconds') as "overdueTimers",
      (select count(*)::int from timer_intent where state = 'blocked') as "blockedTimers",
      (select count(*)::int from refresh_request where state <> 'blocked' and (last_success is null or last_success < now() - interval '5 minutes')) as "staleSources",
      (select count(*)::int from followup_policy where state = 'blocked') as "blockedFollowups",
      (select count(*)::int from job where status = 'legacy-running') as "legacyJobsAwaitingDrain",
      (select count(*)::int from job where status = 'executing' and lease_until < now() - interval '5 minutes') as "stalledJobs"
  `);
  return { ...(rows[0] as unknown as Omit<ReliabilityCounts, keyof EnqueuedCounts>), ...(await enqueuedCounts()) };
}
type EnqueuedCounts = Pick<ReliabilityCounts, 'undeliveredExecutions' | 'oldestOutboxSeconds' | 'queuedTimers'>;
/**
 * Workflows the ledger committed that no executor has taken yet (D86): rows still `ENQUEUED` in the engine's queue.
 * A fresh row is normal (the runner polls about once a second); one older than thirty seconds means no instance of
 * the application is running or dequeuing. The engine's schema exists once it has launched or `db:init` ran; before
 * that there is nothing enqueued to count.
 */
async function enqueuedCounts(): Promise<EnqueuedCounts> {
  try {
    const rows = await database().execute(sql`
      select
        (select count(*)::int from dbos.workflow_status where status = 'ENQUEUED' and name = 'approvedExecution' and created_at < (extract(epoch from now()) * 1000 - 30000)) as "undeliveredExecutions",
        (select coalesce(greatest(0, (extract(epoch from now()) * 1000 - min(created_at)) / 1000)::int, 0) from dbos.workflow_status where status = 'ENQUEUED' and name = 'approvedExecution') as "oldestOutboxSeconds",
        (select count(*)::int from dbos.workflow_status where status = 'ENQUEUED' and name = 'durableReminder' and created_at < (extract(epoch from now()) * 1000 - 30000)) as "queuedTimers"
    `);
    return rows[0] as unknown as EnqueuedCounts;
  } catch {
    return { undeliveredExecutions: 0, oldestOutboxSeconds: 0, queuedTimers: 0 };
  }
}
