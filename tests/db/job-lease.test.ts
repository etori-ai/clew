import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { durableJobs } from '../../apps/server/src/scheduler/adapters/durable-postgres';
import { reliabilityCounts } from '../../apps/server/src/modules/operations/adapters/postgres';

/**
 * A job's claim in the operator's reliability counts (D47, D85): a job whose run stopped without completing, and one
 * whose run has held it for ten minutes, show there. The claim itself, its lease, renewal and completion, is the job
 * table's contract (`tests/job-store-contract.ts`, run here by `postgres-job-store.test.ts`). Run with `bun run test:db`
 * inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
// Every job of this file has an id that begins with this one.
const id = 'job-lease-test-' + randomUUID();
afterAll(async () => {
  await database()
    .delete(schema.audit)
    .where(like(schema.audit.subject, 'job:' + id + '%'));
  await database()
    .delete(schema.jobs)
    .where(like(schema.jobs.id, id + '%'));
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
  expect(await counted()).toBe(before + 1);
  // The job's workflow claims it again, under a new lease, and it is no longer counted.
  expect(await durableJobs.claimExecution(stalled, new Date(now).toISOString())).toMatchObject({ attempt: 2 });
  expect(await counted()).toBe(before);
});

test('a job whose run has held its claim for ten minutes is counted for the operator until the run settles', async () => {
  const now = Date.now(),
    minutes = (n: number) => new Date(now + n * 60_000);
  const counted = async () => (await reliabilityCounts()).longRunningJobs;
  const before = await counted();
  const claimed = (suffix: string, startedAt: Date, leaseUntil: Date) => ({
    id: id + suffix,
    kind: 'receipt-final',
    runAt: minutes(-20),
    status: 'executing' as const,
    attempts: 1,
    startedAt,
    leaseUntil,
  });
  await database()
    .insert(schema.jobs)
    .values([
      // Claimed eleven minutes ago, and its lease renewed since: a live run that has not settled.
      claimed('-long', minutes(-11), minutes(1.5)),
      // Claimed nine minutes ago: not yet.
      claimed('-recent', minutes(-9), minutes(1.5)),
      // Claimed eleven minutes ago, its lease ended a minute ago: its run stopped, which is `stalledJobs`' to count.
      claimed('-ended', minutes(-11), minutes(-1)),
    ]);
  expect(await counted()).toBe(before + 1);
  // The run settles and completes the job, which is no longer counted.
  expect(await durableJobs.completed(id + '-long', 1, new Date(now).toISOString())).toBe(true);
  expect(await counted()).toBe(before);
});
