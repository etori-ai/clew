import { and, eq, gt } from 'drizzle-orm';
import { database, schema } from '@clew/db';
import type { DurableQueue } from '@clew/db/durable';
import { scheduleJob } from '@clew/db/jobs';
import { systemContext } from '../../system-context';
import type { JobQueue, People } from '../model';

/** The job queue in Postgres (D15): `schedule` writes the row and starts its `scheduledJob` workflow in one transaction (D86). */
export function postgresJobQueue(durable: DurableQueue): JobQueue {
  return {
    schedule: job =>
      scheduleJob({ id: job.id, kind: job.kind, runAt: new Date(job.runAt), payload: job.payload }, durable),
  };
}
export function postgresPeople(): People {
  return {
    async granted({ after, limit }) {
      // Enabled people with a grant who can sign in: a whole municipality may be provisioned (D68) without ever
      // having logged in, and the nightly scan does not run for them. A page continues after the last id of the one
      // before it, so a person added or removed between two pages moves no one else into or out of the night.
      const rows = await database()
        .selectDistinct({ id: schema.accessGrants.personId })
        .from(schema.accessGrants)
        .innerJoin(schema.people, eq(schema.people.id, schema.accessGrants.personId))
        .innerJoin(schema.identityBindings, eq(schema.identityBindings.personId, schema.accessGrants.personId))
        .where(
          and(
            eq(schema.people.enabled, true),
            after === undefined ? undefined : gt(schema.accessGrants.personId, after),
          ),
        )
        .orderBy(schema.accessGrants.personId)
        .limit(limit);
      return rows.map(r => r.id);
    },
    personaFor: id => systemContext(id),
  };
}
