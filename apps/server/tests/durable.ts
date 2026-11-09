import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { database } from '@clew/db';
import type { DurableQueue } from '@clew/db/durable';
import { launchDurable, shutdownDurable, ledgerQueue, type DurableOptions } from '../src/dbos/runtime';

/**
 * One engine per test process, under its own application name: DBOS keeps applications apart in a shared system
 * database, so the development server's workflows, queues and version promotion are never touched, and what a test's
 * stores enqueue (D86) is dequeued by this engine alone. The name exists before the launch, so a test can commit
 * starts first and launch afterwards: the rows wait in the queue until the runner is there. The heartbeat is off
 * unless a test measures it.
 */
export function testEngine(label: string) {
  const name = `clew-test-${label}-${randomUUID().slice(0, 8)}`;
  const durable: DurableQueue = { application: name, queue: ledgerQueue(name) };
  return {
    name,
    durable,
    async launch(options: Partial<DurableOptions> = {}) {
      const info = await launchDurable({ heartbeat: false, executorID: `${label}-parent`, ...options, name });
      return { ...info, shutdown: shutdownDurable };
    },
    /** The engine's own row for a workflow, readable before the engine is launched. */
    async row(workflowID: string) {
      const rows = await database().execute<{ status: string; executor_id: string | null; queue_name: string | null }>(
        sql`select status, executor_id, queue_name from dbos.workflow_status where workflow_uuid = ${workflowID} and application_name = ${name}`,
      );
      return [...rows][0];
    },
    /** Everything this application enqueued or ran, and its queue, gone with the test. */
    async forget() {
      await database().execute(sql`delete from dbos.workflow_status where application_name = ${name}`);
      await database().execute(sql`delete from dbos.queues where name = ${durable.queue}`);
    },
  };
}
