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
      (select count(*)::int from dispatch_outbox where delivered_at is null) as "undeliveredExecutions",
      (select coalesce(greatest(0, extract(epoch from now() - min(e.created_at)))::int,0) from dispatch_outbox o join execution e on e.id = o.execution_id where o.delivered_at is null) as "oldestOutboxSeconds",
      (select count(*)::int from timer_intent where state in ('active','cancelled') and (delivered_generation is distinct from generation or delivered_state is distinct from state)) as "queuedTimers",
      (select count(*)::int from timer_intent where state = 'active' and due_at < now() - interval '30 seconds') as "overdueTimers",
      (select count(*)::int from timer_intent where state = 'blocked') as "blockedTimers",
      (select count(*)::int from refresh_request where state <> 'blocked' and (last_success is null or last_success < now() - interval '5 minutes')) as "staleSources",
      (select count(*)::int from followup_policy where state = 'blocked') as "blockedFollowups",
      (select count(*)::int from job where status = 'legacy-running') as "legacyJobsAwaitingDrain"
  `);
  return rows[0] as unknown as ReliabilityCounts;
}
