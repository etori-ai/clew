import { sql } from 'drizzle-orm';
import type { Transaction } from './index';

/**
 * The durable engine's start as a ledger write (D86). DBOS Transact checkpoints to the `dbos` schema of Clew's own
 * database (D85), so a workflow can be enqueued by its PL/pgSQL function on the same connection as the intent row:
 * both commit or neither does, and no outbox or polling loop stands between them. The queue runner of the named
 * application dequeues the row once it is committed; a workflow id that already exists is left as it is.
 */
export interface DurableQueue {
  /** The application name the engine launched with: the runner dequeues only its own application's rows. */
  application: string;
  /** The queue registered by the runtime; it has no concurrency limit, because a sleeping workflow holds its slot. */
  queue: string;
}
/** A workflow start as a use case decides it: the registered workflow's name, its stable id and one JSON input. */
export interface WorkflowStart {
  workflow: string;
  id: string;
  input: unknown;
}
export async function enqueueWorkflow(tx: Transaction, queue: DurableQueue, start: WorkflowStart) {
  await tx.execute(
    sql`select dbos.enqueue_workflow(
      workflow_name => ${start.workflow},
      queue_name => ${queue.queue},
      positional_args => array[${JSON.stringify(start.input)}::json],
      workflow_id => ${start.id},
      application_name => ${queue.application}
    )`,
  );
}
