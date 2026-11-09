import { randomUUID } from 'node:crypto';
import { launchDurable, shutdownDurable, type DurableOptions } from '../src/dbos/runtime';

/**
 * One engine per test process, under its own application name: DBOS keeps applications apart in a shared system
 * database, so the development server's workflows, queues and version promotion are never touched. The heartbeat is
 * off unless a test measures it.
 */
export async function launchTestEngine(label: string, options: Partial<DurableOptions> = {}) {
  const name = options.name ?? `clew-test-${label}-${randomUUID().slice(0, 8)}`;
  const info = await launchDurable({ heartbeat: false, executorID: `${label}-parent`, ...options, name });
  return { ...info, shutdown: shutdownDurable };
}
