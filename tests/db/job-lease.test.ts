import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { durableJobs } from '../../apps/server/src/scheduler/adapters/durable-postgres';
import { JOB_LEASE_MS } from '../../apps/server/src/scheduler/model';
import { reliabilityCounts } from '../../apps/server/src/modules/operations/adapters/postgres';

/**
 * A job's claim on PostgreSQL (D47, D85): the attempt that holds the job renews its lease, so the workflow's next
 * attempt finds the job claimed for as long as the run lasts. Once another attempt has claimed it, the first can neither
 * renew nor complete it, and only the attempt that holds it writes `job.completed`. A job whose run stopped without
 * completing shows in the operator's reliability counts. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const id = 'job-lease-test-' + randomUUID(),
  stalledIds: string[] = [];
afterAll(async () => {
  await database()
    .delete(schema.audit)
    .where(eq(schema.audit.subject, 'job:' + id));
  for (const job of [id, ...stalledIds]) await database().delete(schema.jobs).where(eq(schema.jobs.id, job));
});
/** `seconds` after the job's run time, on a clock in 2098, so the row is this test's own. */
const at = (seconds: number) => new Date(Date.parse('2098-11-05T09:00:00.000Z') + seconds * 1000).toISOString();
const row = async () =>
  (
    await database()
      .select({ status: schema.jobs.status, attempts: schema.jobs.attempts, leaseUntil: schema.jobs.leaseUntil })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, id))
  )[0];
const audit = async () =>
  database()
    .select({ action: schema.audit.action, details: schema.audit.details })
    .from(schema.audit)
    .where(eq(schema.audit.subject, 'job:' + id));

test('the attempt that holds a job renews its lease; one that lost it can neither renew nor complete it, and the holder completes it once', async () => {
  // A row the engine owns, due now. Written directly: its workflow is not what this test reads.
  await database()
    .insert(schema.jobs)
    .values({ id, kind: 'receipt-final', runAt: new Date(at(0)) });
  expect(await durableJobs.claimExecution(id, at(0))).toMatchObject({ id, attempt: 1 });
  expect(await row()).toEqual({ status: 'executing', attempts: 1, leaseUntil: new Date(at(JOB_LEASE_MS / 1000)) });

  // Renewed at 90 seconds: at 150, past the first lease, the job is still claimed.
  expect(await durableJobs.renew(id, 1, at(90))).toBe(true);
  expect((await row())?.leaseUntil).toEqual(new Date(at(90 + JOB_LEASE_MS / 1000)));
  expect(await durableJobs.claimExecution(id, at(150))).toBe('busy');

  // Not renewed again, as when the run's process has stopped: past the renewed lease, another attempt claims it.
  expect(await durableJobs.claimExecution(id, at(211))).toMatchObject({ id, attempt: 2 });
  expect(await durableJobs.renew(id, 1, at(212))).toBe(false);
  expect(await durableJobs.completed(id, 1, at(213))).toBe(false);
  expect(await row()).toEqual({
    status: 'executing',
    attempts: 2,
    leaseUntil: new Date(at(211 + JOB_LEASE_MS / 1000)),
  });
  expect(await audit()).toEqual([]);

  // The holder completes it with its row, once; nothing renews or completes it afterwards.
  expect(await durableJobs.completed(id, 2, at(214))).toBe(true);
  expect(await durableJobs.renew(id, 2, at(215))).toBe(false);
  expect(await durableJobs.completed(id, 2, at(216))).toBe(false);
  expect(await row()).toEqual({ status: 'done', attempts: 2, leaseUntil: null });
  expect(await audit()).toEqual([{ action: 'job.completed', details: { attempt: 2 } }]);
});

test('a job whose run stopped without completing is counted for the operator until it is claimed again', async () => {
  const stalled = id + '-stalled',
    now = Date.now();
  const counted = async () => (await reliabilityCounts()).stalledJobs;
  const before = await counted();
  // Claimed by a run whose lease ended six minutes ago: nothing renewed it, and nothing has claimed it again.
  await database()
    .insert(schema.jobs)
    .values({
      id: stalled,
      kind: 'receipt-final',
      runAt: new Date(now - 10 * 60_000),
      status: 'executing',
      attempts: 1,
      leaseUntil: new Date(now - 6 * 60_000),
    });
  stalledIds.push(stalled);
  expect(await counted()).toBe(before + 1);
  // The job's workflow claims it again, under a new lease, and it is no longer counted.
  expect(await durableJobs.claimExecution(stalled, new Date(now).toISOString())).toMatchObject({ attempt: 2 });
  expect(await counted()).toBe(before);
});
