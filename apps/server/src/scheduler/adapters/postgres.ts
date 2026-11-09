import { database, schema } from '@clew/db';
import type { DurableQueue } from '@clew/db/durable';
import { claimJob, finishJob, scheduleJob } from '@clew/db/jobs';
import { systemContext } from '../../system-context';
import type { JobQueue, People } from '../model';

/** The job queue in Postgres (D15): `schedule` writes the row and starts its `scheduledJob` workflow in one transaction (D86). */
export function postgresJobQueue(durable: DurableQueue): JobQueue {
  return {
    async claim(now) {
      const row = await claimJob(new Date(now));
      return row ? { id: row.id, kind: row.kind, payload: row.payload } : undefined;
    },
    finish: (id, error) => finishJob(id, error),
    schedule: job =>
      scheduleJob({ id: job.id, kind: job.kind, runAt: new Date(job.runAt), payload: job.payload }, durable),
  };
}
export function postgresPeople(): People {
  return {
    async granted() {
      return (await database().select({ id: schema.accessGrants.personId }).from(schema.accessGrants)).map(r => r.id);
    },
    personaFor: id => systemContext(id),
  };
}
