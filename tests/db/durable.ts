import { sql } from 'drizzle-orm';
import { database } from '../../packages/db/src/index';
import type { DurableQueue, WorkflowStart } from '../../packages/db/src/durable';

/**
 * The engine's side of the Postgres tests (D86). The stores enqueue into this application, which no runner serves,
 * so a committed start stays `ENQUEUED` for the test to read and the development server never dequeues it. The schema
 * exists because `bun run db:init` migrates the engine's tables beside Clew's.
 */
export const testDurable: DurableQueue = { application: 'clew-test-db', queue: 'clew-test-db.ledger' };
/** The workflow rows the ledger committed under ids with this prefix, as the starts that made them. */
export async function enqueuedWorkflows(prefix: string): Promise<Array<WorkflowStart & { status: string }>> {
  const rows = await database().execute<{ id: string; workflow: string; status: string; inputs: string | null }>(sql`
    select s.workflow_uuid as id, s.name as workflow, s.status, i.inputs
      from dbos.workflow_status s left join dbos.workflow_input i on i.workflow_uuid = s.workflow_uuid
     where s.application_name = ${testDurable.application} and s.workflow_uuid like ${prefix + '%'}
     order by s.created_at, s.workflow_uuid`);
  return [...rows].map(r => ({
    id: r.id,
    workflow: r.workflow,
    status: r.status,
    input: r.inputs ? (JSON.parse(r.inputs) as { positionalArgs: unknown[] }).positionalArgs[0] : undefined,
  }));
}
/** Remove everything the test application enqueued; the engine's foreign keys take the inputs with the status rows. */
export async function forgetTestWorkflows() {
  await database().execute(sql`delete from dbos.workflow_status where application_name = ${testDurable.application}`);
}
