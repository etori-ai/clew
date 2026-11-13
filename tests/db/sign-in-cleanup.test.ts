import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { removeExpiredSignIns } from '../../packages/db/src/auth';
import { postgresJobQueue } from '../../apps/server/src/scheduler/adapters/postgres';
import { createScheduler, SIGN_IN_CLEANUP } from '../../apps/server/src/scheduler/usecases';
import { enqueuedWorkflows, forgetTestWorkflows, testDurable } from './durable';

/**
 * The nightly clean-up of sign-in machinery on PostgreSQL (D117; L3 of the 2026-11-12 users review). Every session past
 * either expiry goes with its sealed tokens, one that was still open with an `expired` row in the authentication log;
 * login transactions and logout receipts past theirs go too. Live sessions, sessions ended earlier that have not yet
 * expired and the authentication log itself stay: how long sign-in history is kept is the organisation's decision.
 * The job is scheduled for each night under its own id, with its workflow in the same commit (D86), and a night's run
 * schedules the next before it cleans. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const person = 'cleanup-test-' + randomUUID(),
  issuer = 'https://idp.example.test/' + person;
// The scheduling case runs on a clock in 2098, so the jobs it schedules are its own.
const jobs = SIGN_IN_CLEANUP + ':2098-%';
beforeAll(async () => {
  await database().insert(schema.people).values({ id: person, organisationId: 'test', name: 'Synthetic clean-up' });
});
afterAll(async () => {
  await database().delete(schema.sessions).where(eq(schema.sessions.personId, person));
  await database()
    .delete(schema.authenticationAudit)
    .where(eq(schema.authenticationAudit.actor, 'person:' + person));
  await database()
    .delete(schema.loginTransactions)
    .where(like(schema.loginTransactions.digest, person + '%'));
  await database().delete(schema.logoutReceipts).where(eq(schema.logoutReceipts.issuer, issuer));
  await database()
    .delete(schema.audit)
    .where(like(schema.audit.subject, 'job:' + jobs));
  await database().delete(schema.jobs).where(like(schema.jobs.id, jobs));
  await forgetTestWorkflows();
  await database().delete(schema.people).where(eq(schema.people.id, person));
});

test('sessions past either expiry go, an open one with an expired row; live data and the authentication log stay', async () => {
  const now = new Date(),
    hour = 3600_000;
  const at = (ms: number) => new Date(now.getTime() + ms);
  const session = (name: string, values: Partial<typeof schema.sessions.$inferInsert> = {}) => ({
    digest: person + ':' + name,
    personId: person,
    issuer,
    subject: 'subject-' + person,
    clientId: 'clew',
    csrf: 'csrf',
    tokens: 'sealed-' + name,
    tokenExpiresAt: at(-hour),
    idleExpiresAt: at(hour),
    expiresAt: at(hour),
    ...values,
  });
  await database()
    .insert(schema.sessions)
    .values([
      // Open, past the absolute expiry: the browser stopped sending its cookie, so nothing else would end it.
      session('absolute', { expiresAt: at(-hour) }),
      // Open, past the idle expiry.
      session('idle', { idleExpiresAt: at(-hour) }),
      // Signed out earlier, and now past its expiry: it goes, and its logout was its row.
      session('signed-out-expired', { expiresAt: at(-hour), revokedAt: at(-2 * hour), tokens: '' }),
      session('live'),
      // Signed out, not yet past its expiry: it stays until the night after it expires.
      session('signed-out', { revokedAt: at(-hour), tokens: '' }),
    ]);
  await database()
    .insert(schema.loginTransactions)
    .values(
      ['expired', 'live'].map(name => ({
        digest: person + ':' + name,
        state: 'state',
        nonce: 'nonce',
        verifier: 'verifier',
        returnTo: '/',
        expiresAt: at(name === 'expired' ? -60_000 : 60_000),
      })),
    );
  await database()
    .insert(schema.logoutReceipts)
    .values([
      { issuer, jti: 'expired', expiresAt: at(-60_000) },
      { issuer, jti: 'live', expiresAt: at(60_000) },
    ]);
  // Sign-in history older than the thirty days the old clean-up kept.
  await database()
    .insert(schema.authenticationAudit)
    .values({ actor: 'person:' + person, action: 'login', createdAt: at(-40 * 24 * hour) });

  await removeExpiredSignIns(now);

  const sessions = await database()
    .select({ digest: schema.sessions.digest, tokens: schema.sessions.tokens, revokedAt: schema.sessions.revokedAt })
    .from(schema.sessions)
    .where(eq(schema.sessions.personId, person))
    .orderBy(schema.sessions.digest);
  expect(sessions).toEqual([
    { digest: person + ':live', tokens: 'sealed-live', revokedAt: null },
    { digest: person + ':signed-out', tokens: '', revokedAt: at(-hour) },
  ]);
  const log = await database()
    .select({ action: schema.authenticationAudit.action })
    .from(schema.authenticationAudit)
    .where(eq(schema.authenticationAudit.actor, 'person:' + person))
    .orderBy(schema.authenticationAudit.id);
  expect(log.map(row => row.action)).toEqual(['login', 'expired', 'expired']);
  const transactions = await database()
    .select({ digest: schema.loginTransactions.digest })
    .from(schema.loginTransactions)
    .where(like(schema.loginTransactions.digest, person + '%'));
  expect(transactions).toEqual([{ digest: person + ':live' }]);
  const receipts = await database()
    .select({ jti: schema.logoutReceipts.jti })
    .from(schema.logoutReceipts)
    .where(eq(schema.logoutReceipts.issuer, issuer));
  expect(receipts).toEqual([{ jti: 'live' }]);

  // A second run the same night finds nothing more to do and writes nothing.
  await removeExpiredSignIns(now);
  const again = await database()
    .select({ action: schema.authenticationAudit.action })
    .from(schema.authenticationAudit)
    .where(eq(schema.authenticationAudit.actor, 'person:' + person));
  expect(again).toHaveLength(3);
});

test('the clean-up is scheduled once a night with its workflow in the same commit, and a run schedules the next night', async () => {
  let time = Date.parse('2098-11-05T10:00:00.000Z');
  const cleaned: string[] = [];
  const scheduler = createScheduler({
    // No engine runs here, so nothing is taken over from another release.
    jobs: postgresJobQueue({
      durable: testDurable,
      move: async () => {
        throw new Error('no durable engine runs in this test');
      },
    }),
    people: { granted: async () => [], personaFor: async () => undefined },
    threads: { ensureThreads: async () => undefined, closeReceiptWindow: async () => undefined },
    calendar: { closeUndoWindow: async () => undefined },
    // The clean-up itself is the case above: on this clock it would remove every session in the database.
    signIns: {
      removeExpired: async now => {
        cleaned.push(now.toISOString());
      },
    },
    clock: () => new Date(time),
    log: () => undefined,
  });
  // Every process schedules it at start; one row and one workflow come of it.
  await scheduler.scheduleCleanup();
  await scheduler.scheduleCleanup();
  const rows = await database()
    .select({ id: schema.jobs.id, kind: schema.jobs.kind, runAt: schema.jobs.runAt, status: schema.jobs.status })
    .from(schema.jobs)
    .where(like(schema.jobs.id, jobs));
  // 03:00 in Stockholm, an hour ahead of UTC in November.
  expect(rows).toEqual([
    {
      id: SIGN_IN_CLEANUP + ':2098-11-06',
      kind: SIGN_IN_CLEANUP,
      runAt: new Date('2098-11-06T02:00:00.000Z'),
      status: 'temporal',
    },
  ]);
  expect(await enqueuedWorkflows('job:' + SIGN_IN_CLEANUP + ':2098-')).toEqual([
    {
      id: 'job:' + SIGN_IN_CLEANUP + ':2098-11-06',
      workflow: 'scheduledJob',
      status: 'ENQUEUED',
      input: { id: SIGN_IN_CLEANUP + ':2098-11-06', dueAt: '2098-11-06T02:00:00.000Z' },
    },
  ]);
  const scheduled = await database()
    .select({ action: schema.audit.action, details: schema.audit.details })
    .from(schema.audit)
    .where(eq(schema.audit.subject, 'job:' + SIGN_IN_CLEANUP + ':2098-11-06'));
  expect(scheduled).toEqual([
    { action: 'job.scheduled', details: { kind: SIGN_IN_CLEANUP, runAt: '2098-11-06T02:00:00.000Z' } },
  ]);

  // The night's run, as the engine's step runs it: the next night is scheduled, and the clean-up runs on its clock.
  time = Date.parse('2098-11-06T02:00:05.000Z');
  await scheduler.run({ id: SIGN_IN_CLEANUP + ':2098-11-06', kind: SIGN_IN_CLEANUP, payload: {} });
  expect(cleaned).toEqual(['2098-11-06T02:00:05.000Z']);
  expect((await enqueuedWorkflows('job:' + SIGN_IN_CLEANUP + ':2098-')).map(w => [w.id, w.input])).toEqual([
    [
      'job:' + SIGN_IN_CLEANUP + ':2098-11-06',
      { id: SIGN_IN_CLEANUP + ':2098-11-06', dueAt: '2098-11-06T02:00:00.000Z' },
    ],
    [
      'job:' + SIGN_IN_CLEANUP + ':2098-11-07',
      { id: SIGN_IN_CLEANUP + ':2098-11-07', dueAt: '2098-11-07T02:00:00.000Z' },
    ],
  ]);
  const ids = (await database().select({ id: schema.jobs.id }).from(schema.jobs).where(like(schema.jobs.id, jobs))).map(
    r => r.id,
  );
  expect(ids.sort()).toEqual([SIGN_IN_CLEANUP + ':2098-11-06', SIGN_IN_CLEANUP + ':2098-11-07']);
});
