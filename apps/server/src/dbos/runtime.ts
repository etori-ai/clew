import { hostname } from 'node:os';
import { DBOS } from '@dbos-inc/dbos-sdk';
import './workflows';
import { startHeartbeat } from './heartbeat';

/**
 * The durable engine (D85): DBOS Transact in the BFF process, checkpointing to Clew's own PostgreSQL database (the
 * `dbos` schema). There is no separate service. Configuration:
 *  - `DATABASE_URL`: the system database is Clew's database, so a workflow can be started inside a ledger transaction.
 *  - `CLEW_EXECUTOR_ID`: a stable name per instance (default: the host name). Recovery and takeover key on it.
 *  - `CLEW_RELEASE`: the application version; unset, DBOS hashes the workflow source. Workflows are tagged with the
 *    version that started them and are recovered only by executors of that version; an operator moves the rest with
 *    `forkWorkflow`. Only the latest registered version dequeues, so the version that launches promotes itself.
 */
export const DEFAULT_APPLICATION = 'clew';
export interface DurableOptions {
  name?: string;
  executorID?: string;
  applicationVersion?: string;
  databaseUrl?: string;
  /** The heartbeat and takeover sweep (heartbeat.ts); a test of one executor turns it off. */
  heartbeat?: boolean;
}
let stopHeartbeat: (() => Promise<void>) | undefined;

export async function launchDurable(options: DurableOptions = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set. Start the development environment.');
  const name = options.name ?? DEFAULT_APPLICATION;
  const executorID = options.executorID ?? process.env.CLEW_EXECUTOR_ID ?? hostname();
  const applicationVersion = options.applicationVersion ?? process.env.CLEW_RELEASE;
  DBOS.setConfig({
    name,
    systemDatabaseUrl: databaseUrl,
    executorID,
    ...(applicationVersion ? { applicationVersion } : {}),
    logLevel: process.env.DBOS_LOG_LEVEL ?? 'warn',
    systemDatabasePoolSize: 5,
  });
  await DBOS.launch();
  await promoteCurrentVersion();
  if (options.heartbeat !== false) stopHeartbeat = await startHeartbeat(name, executorID);
  return { name, executorID, applicationVersion: DBOS.applicationVersion };
}
export async function shutdownDurable() {
  await stopHeartbeat?.();
  stopHeartbeat = undefined;
  await DBOS.shutdown();
}
/** Only executors on the application's latest registered version dequeue and recover, and "latest" is by registration time: the version that is running is the one that should. */
async function promoteCurrentVersion() {
  const latest = await DBOS.getLatestApplicationVersion().catch(() => undefined);
  if (latest?.versionName !== DBOS.applicationVersion) await DBOS.setLatestApplicationVersion(DBOS.applicationVersion);
}

const RETRY_MS = 30_000;
/** Launch beside the server; if the database is unreachable the page still works (D8) and the launch retries. */
export function startDurableRuntime() {
  launchDurable()
    .then(info =>
      console.log(`Durable engine (DBOS) launched: executor ${info.executorID}, version ${info.applicationVersion}`),
    )
    .catch(async error => {
      console.error(
        `durable engine unavailable, retrying in ${RETRY_MS / 1000} s:`,
        error instanceof Error ? error.message : error,
      );
      await DBOS.shutdown().catch(() => undefined);
      setTimeout(startDurableRuntime, RETRY_MS).unref();
    });
}
