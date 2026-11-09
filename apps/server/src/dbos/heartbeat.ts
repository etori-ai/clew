import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { database } from '@clew/db';

/**
 * Executor liveness and takeover (D85). DBOS recovers a crashed executor's PENDING workflows only when an executor
 * with the same id starts again; a replaced instance with a new id would leave them waiting until an operator acted.
 * Each instance therefore records a heartbeat under its executor id, and any live instance that finds a heartbeat
 * older than `DEAD_AFTER_MS` claims that row (one claimant, by deleting it) and re-enqueues the dead executor's
 * workflows into its own application through the engine's recovery routine, which the package does not export.
 * The table is engine bookkeeping, not business state: it lives beside DBOS's own schema and outside the Drizzle
 * migrations, created on launch the way DBOS creates its tables.
 */
export const HEARTBEAT_MS = 10_000;
export const SWEEP_MS = 30_000;
export const DEAD_AFTER_MS = 90_000;

export async function ensureHeartbeatTable() {
  await database().execute(sql`create schema if not exists clew_durable`);
  await database().execute(sql`
    create table if not exists clew_durable.executor (
      application text not null,
      executor_id text not null,
      seen_at timestamptz not null,
      primary key (application, executor_id)
    )`);
}
export async function beat(application: string, executorID: string, at = new Date()) {
  await database().execute(sql`
    insert into clew_durable.executor (application, executor_id, seen_at) values (${application}, ${executorID}, ${at.toISOString()}::timestamptz)
    on conflict (application, executor_id) do update set seen_at = excluded.seen_at`);
}
/** The executors of this application whose heartbeat lapsed, claimed by this one call: a second sweeper finds nothing. */
export async function claimDead(application: string, me: string, now = new Date(), deadAfterMs = DEAD_AFTER_MS) {
  const before = new Date(now.getTime() - deadAfterMs);
  const rows = await database().execute<{ executor_id: string }>(sql`
    delete from clew_durable.executor
     where application = ${application} and executor_id <> ${me} and seen_at < ${before.toISOString()}::timestamptz
     returning executor_id`);
  return [...rows].map(r => r.executor_id);
}
export async function forgetExecutor(application: string, executorID: string) {
  await database().execute(
    sql`delete from clew_durable.executor where application = ${application} and executor_id = ${executorID}`,
  );
}

type Recoverer = { recoverPendingWorkflows(executorIDs?: string[]): Promise<Array<{ workflowID: string }>> };
/** The engine's recovery routine, reached beside the package's entry point because the package does not export it. Pinned with the SDK version; the runtime test covers it. */
function recoverer(): Recoverer {
  const require = createRequire(import.meta.url);
  const internal = require(join(dirname(require.resolve('@dbos-inc/dbos-sdk')), 'dbos-executor.js')) as {
    DBOSExecutor: { globalInstance?: Recoverer };
  };
  const instance = internal.DBOSExecutor.globalInstance;
  if (!instance) throw new Error('The durable engine is not launched');
  return instance;
}
/** Adopt dead executors' PENDING workflows of this application and version: they are re-enqueued and run here or on any peer. */
export async function adoptExecutors(executorIDs: string[]) {
  if (!executorIDs.length) return [];
  const handles = await recoverer().recoverPendingWorkflows(executorIDs);
  return handles.map(h => h.workflowID);
}

/** Beat every ten seconds, sweep every thirty; the returned function stops both and removes this executor's row. */
export async function startHeartbeat(application: string, executorID: string, log = console.log) {
  await ensureHeartbeatTable();
  await beat(application, executorID);
  const beating = setInterval(() => {
    beat(application, executorID).catch(error =>
      console.error('durable heartbeat failed:', error instanceof Error ? error.message : error),
    );
  }, HEARTBEAT_MS);
  beating.unref();
  const sweeping = setInterval(() => {
    claimDead(application, executorID)
      .then(async dead => {
        if (!dead.length) return;
        const adopted = await adoptExecutors(dead);
        log(`durable engine: adopted ${adopted.length} workflow(s) from dead executor(s) ${dead.join(', ')}`);
      })
      .catch(error => console.error('durable sweep failed:', error instanceof Error ? error.message : error));
  }, SWEEP_MS);
  sweeping.unref();
  return async () => {
    clearInterval(beating);
    clearInterval(sweeping);
    await forgetExecutor(application, executorID).catch(() => undefined);
  };
}
