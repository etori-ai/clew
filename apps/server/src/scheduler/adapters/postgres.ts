import { database, schema } from '@clew/db';
import { claimJob, finishJob, scheduleJob } from '@clew/db/jobs';
import { systemContext } from '../../system-context';
import type { JobQueue, People } from '../model';

export function postgresJobQueue(): JobQueue {
  return {
    async claim(now) { const row = await claimJob(new Date(now)); return row ? { id: row.id, kind: row.kind, payload: row.payload } : undefined; },
    finish: (id, error) => finishJob(id, error),
    schedule: job => scheduleJob({ id: job.id, kind: job.kind, runAt: new Date(job.runAt), payload: job.payload }),
  };
}
export function postgresPeople(): People {
  return {
    async granted() { return (await database().select({ id: schema.accessGrants.personId }).from(schema.accessGrants)).map(r => r.id); },
    personaFor: id => systemContext(id),
  };
}
