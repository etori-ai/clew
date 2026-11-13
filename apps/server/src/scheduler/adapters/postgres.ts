import { and, eq } from 'drizzle-orm';
import { database, schema } from '@clew/db';
import type { DurableQueue } from '@clew/db/durable';
import { jobWorkflowId, scheduleJob } from '@clew/db/jobs';
import { systemContext } from '../../system-context';
import type { JobQueue, People } from '../model';

/**
 * The job queue in Postgres (D15): `schedule` writes the row and starts its `scheduledJob` workflow in one transaction
 * (D86). `move` is the engine's hand-over of workflows waiting under another version to the running one, on the queue
 * named (`moveToRunningVersion` in `dbos/start.ts`, bound in the composition).
 */
export function postgresJobQueue(options: {
  durable: DurableQueue;
  move: (workflowIDs: string[], queue: string) => Promise<string[]>;
}): JobQueue {
  const { durable, move } = options;
  return {
    schedule: job =>
      scheduleJob({ id: job.id, kind: job.kind, runAt: new Date(job.runAt), payload: job.payload }, durable),
    async takeOver(ids) {
      const moved = new Set(await move(ids.map(jobWorkflowId), durable.queue));
      return ids.filter(id => moved.has(jobWorkflowId(id)));
    },
  };
}
export function postgresPeople(): People {
  return {
    async granted() {
      // Enabled people with a grant who can sign in: a whole municipality may be provisioned (D68) without ever
      // having logged in, and the nightly scan does not run for them.
      const rows = await database()
        .selectDistinct({ id: schema.accessGrants.personId })
        .from(schema.accessGrants)
        .innerJoin(schema.people, eq(schema.people.id, schema.accessGrants.personId))
        .innerJoin(schema.identityBindings, eq(schema.identityBindings.personId, schema.accessGrants.personId))
        .where(and(eq(schema.people.enabled, true)));
      return rows.map(r => r.id);
    },
    personaFor: id => systemContext(id),
  };
}
