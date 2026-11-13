import { afterAll, beforeAll, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { journal, position, upgradeDatabase, type Entry, type UpgradeDatabase } from './upgrade';

/**
 * An upgrade through the migration that keys a planning proposal by person (`person_keys_and_participants`: N3, D122,
 * S4, L13) on a database with rows behind it. Drizzle runs every pending migration in one transaction, so the run here
 * has one migration before it that writes a person and one after it that alters every table it writes: neither may meet
 * deferred trigger events still queued ("pending trigger events", 55006). A decision on its way for a planning card is
 * retired as `scripts/fixture-maintenance.ts` retires one, with its audit row and its time; the card goes with its
 * `thread.removed` row and everything that hangs on it; nothing else moves. Run with `bun run test:db` inside the
 * devcontainer: the database is created beside the suite's and dropped afterwards.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');

let installation: UpgradeDatabase;
let upgrade: () => Promise<void>;

beforeAll(async () => {
  installation = await upgradeDatabase();
  const entries = await journal(),
    at = position(entries, 'person_keys_and_participants');
  const before = entries.slice(0, at),
    target = entries[at]!;
  await installation.migrate(before);
  await installation.db.execute(sql.raw(SEED));
  // One migration before the target that writes a person, and one after it that alters every table the target writes
  // or removes rows from, run with it in the one transaction Drizzle runs every pending migration in.
  const previous = before.at(-1)!;
  if (previous.when + 1 >= target.when) throw new Error('No room in the journal for a migration before the target.');
  const writes: Entry = { ...previous, when: previous.when + 1, tag: 'upgrade_probe_before' },
    alters: Entry = { ...target, idx: target.idx + 1, when: target.when + 1, tag: 'upgrade_probe_after' };
  const probes = {
    upgrade_probe_before: `UPDATE "auth_person" SET "name" = "name" || '' WHERE "id" = 'mgr-hillevi';`,
    upgrade_probe_after: ['thread', 'execution', 'timer_intent', 'followup_policy', 'attention_delivery', 'auth_person']
      .map(table => `ALTER TABLE "${table}" ADD COLUMN "upgrade_probe" text;`)
      .join('--> statement-breakpoint\n'),
  };
  upgrade = () => installation.migrate([...before, writes, target, alters], probes);
}, 60_000);
afterAll(() => installation?.drop());

/** The rows before the upgrade: a planning card with what hangs on it, and decisions on their way or done. */
const SEED = `
INSERT INTO auth_person (id, organisation_id, name, external_id, user_name, email) VALUES
 ('mgr-hillevi', 'org', 'Hillevi', 'ext-h', 'hillevi', 'hillevi@clew.test'),
 ('emp-anna', 'org', 'Anna', NULL, 'anna', 'anna@clew.test'),
 ('emp-sara', 'org', 'Sara', NULL, 'sara', 'sara@clew.test');
INSERT INTO thread (id, person_id, kind, topic, title, state, trigger, connector, area, created_at, updated_at) VALUES
 ('card-plan', 'mgr-hillevi', 'pushed', 'utvecklingssamtal', 'Planera utvecklingssamtal', 'open', '{}', 'calendar', 'utvecklingssamtal', '2026-01-10T06:00:00Z', '2026-01-10T06:00:00Z'),
 ('card-other', 'mgr-hillevi', 'pushed', 'something-else', 'Another card', 'open', '{}', 'hr', 'hr', '2026-01-10T06:00:00Z', '2026-01-10T06:00:00Z');
INSERT INTO thread_message (id, thread_id, role, body) VALUES ('msg-plan', 'card-plan', 'assistant', 'Två samtal saknar tid.');
INSERT INTO proposal (id, thread_id, person_id, status, participant_email, participant_name, start, "end", confirmed_at) VALUES
 ('p-anna', 'card-plan', 'mgr-hillevi', 'confirmed', 'anna@clew.test', 'Anna', '2026-01-18T09:00:00Z', '2026-01-18T10:00:00Z', '2026-01-12T10:00:00Z'),
 ('p-sara', 'card-plan', 'mgr-hillevi', 'proposed', 'sara@clew.test', 'Sara', '2026-01-19T09:00:00Z', '2026-01-19T10:00:00Z', NULL);
INSERT INTO execution (id, decision_id, person_id, principal, unit_id, authorization_version, connector, operation, digest, payload, safety, state, reason, attempt, created_at, updated_at, expires_at, dispatched_at, lease_until, presentation) VALUES
 ('x-sent', 'd-1', 'mgr-hillevi', 'person:mgr-hillevi', 'unit-1', 'v1', 'calendar', 'calendar.confirm', 'dg1', '{}', '{"strategy":"deduplicated"}', 'running', NULL, 1, '2026-01-12T09:59:00Z', '2026-01-12T10:00:00Z', '2027-01-13T09:59:00Z', '2026-01-12T10:00:01Z', '2027-01-12T10:05:00Z', '{"threadId":"card-plan","version":"v1","actionId":"confirm"}'),
 ('x-waiting', 'd-2', 'mgr-hillevi', 'person:mgr-hillevi', 'unit-1', 'v1', 'calendar', 'calendar.confirm', 'dg2', '{}', '{"strategy":"deduplicated"}', 'pending', NULL, 0, '2026-01-12T11:00:00Z', '2026-01-12T11:00:00Z', '2027-01-13T11:00:00Z', NULL, NULL, '{"threadId":"card-plan","version":"v2","actionId":"confirm"}'),
 ('x-done', 'd-3', 'mgr-hillevi', 'person:mgr-hillevi', 'unit-1', 'v1', 'calendar', 'calendar.confirm', 'dg3', '{}', '{"strategy":"deduplicated"}', 'succeeded', NULL, 1, '2026-01-11T09:00:00Z', '2026-01-11T09:00:00Z', '2027-01-12T09:00:00Z', '2026-01-11T09:00:01Z', NULL, '{"threadId":"card-plan","version":"v0","actionId":"confirm"}'),
 ('x-reset', 'd-4', 'mgr-hillevi', 'person:mgr-hillevi', 'unit-1', 'v1', 'calendar', 'calendar.confirm', 'dg4', '{}', '{"strategy":"deduplicated"}', 'unknown', 'source-reset', 2, '2026-01-11T08:00:00Z', '2026-01-11T08:00:00Z', '2026-01-11T08:00:00Z', '2026-01-11T08:00:01Z', NULL, '{"threadId":"card-plan","version":"v0","actionId":"confirm"}'),
 ('x-other', 'd-5', 'mgr-hillevi', 'person:mgr-hillevi', 'unit-1', 'v1', 'hr', 'hr.approve', 'dg5', '{}', '{"strategy":"deduplicated"}', 'running', NULL, 1, '2026-01-12T09:00:00Z', '2026-01-12T09:00:00Z', '2027-01-13T09:00:00Z', NULL, '2027-01-12T09:05:00Z', '{"threadId":"card-other","version":"v1","actionId":"approve"}');
INSERT INTO dispatch_outbox (id, execution_id, next_at) VALUES
 ('o-waiting', 'x-waiting', '2026-01-12T11:00:00Z'),
 ('o-other', 'x-other', '2026-01-12T09:00:00Z');
INSERT INTO followup_policy (thread_id, person_id, unit_id, authorization_version, execution_id, proposal_ids, max_reminders, after_workdays, expires_at, state) VALUES
 ('card-plan', 'mgr-hillevi', 'unit-1', 'v1', 'x-sent', '["p-anna"]', 2, 2, '2027-01-12T10:00:00Z', 'active');
INSERT INTO timer_intent (id, person_id, thread_id, kind, generation, unit_id, authorization_version, due_at, requested_at, state, next_at) VALUES
 ('followup:card-plan', 'mgr-hillevi', 'card-plan', 'followup', 1, 'unit-1', 'v1', '2026-01-14T06:00:00Z', '2026-01-12T10:00:00Z', 'active', '2026-01-14T06:00:00Z');
INSERT INTO attention_delivery (id, person_id, thread_id, kind, batch, due_at, state, created_at) VALUES
 ('ad-plan', 'mgr-hillevi', 'card-plan', 'pushed', 'b1', '2026-01-10T06:00:00Z', 'pending', '2026-01-10T06:00:00Z');
`;
const rows = async <T>(query: string) => (await installation.db.execute(sql.raw(query))) as unknown as T[];
/** A time as an ISO instant, whatever the session's time zone. */
const instant = (column: string) => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

test('an upgrade with rows runs in one transaction with the migrations around it, retires the planning decisions with their audit rows and removes only the planning card', async () => {
  // Before the fix the run failed here: the person index met the events of the write before it, and a later ALTER
  // met the events of the target's own writes, both with "pending trigger events".
  await upgrade();
  const executions = await rows<{
    id: string;
    state: string;
    reason: string | null;
    attempt: number;
    lease: string | null;
    expires: string;
    updated: string;
  }>(
    `select id, state, reason, attempt, ${instant('lease_until')} as lease, ${instant('expires_at')} as expires,
       ${instant('updated_at')} as updated from execution order by id`,
  );
  const audit = await rows<{ action: string; subject: string; details: unknown; at: string }>(
    `select action, subject, details, ${instant('created_at')} as at from audit where actor = 'system:migration' order by id`,
  );
  // What the decisions on their way became: failed if never sent, unknown if sent, each at the migration's own time,
  // its lease and approval over and its attempt moved on; what was done, or already retired, stays as it was.
  const retiredAt = audit.find(a => a.subject === 'execution:x-sent')?.at;
  expect(retiredAt).toBeDefined();
  expect(executions).toEqual([
    {
      id: 'x-done',
      state: 'succeeded',
      reason: null,
      attempt: 1,
      lease: null,
      expires: '2027-01-12T09:00:00.000Z',
      updated: '2026-01-11T09:00:00.000Z',
    },
    {
      id: 'x-other',
      state: 'running',
      reason: null,
      attempt: 1,
      lease: '2027-01-12T09:05:00.000Z',
      expires: '2027-01-13T09:00:00.000Z',
      updated: '2026-01-12T09:00:00.000Z',
    },
    {
      id: 'x-reset',
      state: 'unknown',
      reason: 'source-reset',
      attempt: 2,
      lease: null,
      expires: '2026-01-11T08:00:00.000Z',
      updated: '2026-01-11T08:00:00.000Z',
    },
    {
      id: 'x-sent',
      state: 'unknown',
      reason: 'source-reset',
      attempt: 2,
      lease: null,
      expires: retiredAt!,
      updated: retiredAt!,
    },
    {
      id: 'x-waiting',
      state: 'failed',
      reason: 'source-reset',
      attempt: 1,
      lease: null,
      expires: retiredAt!,
      updated: retiredAt!,
    },
  ]);
  expect(audit.map(({ at: _, ...row }) => row)).toEqual([
    {
      action: 'execution.source_reset',
      subject: 'execution:x-sent',
      details: { previousState: 'running', state: 'unknown', dispatched: true },
    },
    {
      action: 'execution.source_reset',
      subject: 'execution:x-waiting',
      details: { previousState: 'pending', state: 'failed', dispatched: false },
    },
    { action: 'thread.removed', subject: 'thread:card-plan', details: { reason: 'migration' } },
  ]);
  // A start not yet handed over ends with the decision it would have started; another decision's stays.
  expect(
    await rows(`select id, delivered_at is not null as delivered, last_error from dispatch_outbox order by id`),
  ).toEqual([
    { id: 'o-other', delivered: false, last_error: null },
    { id: 'o-waiting', delivered: true, last_error: 'source-reset' },
  ]);
  // The planning card goes with everything that hangs on it; the other card, and every person, stay.
  expect(await rows(`select id from thread order by id`)).toEqual([{ id: 'card-other' }]);
  for (const table of ['thread_message', 'proposal', 'followup_policy', 'timer_intent', 'attention_delivery'])
    expect(await rows(`select count(*)::int as n from ${table}`)).toEqual([{ n: 0 }]);
  expect(await rows(`select id from auth_person order by id`)).toEqual([
    { id: 'emp-anna' },
    { id: 'emp-sara' },
    { id: 'mgr-hillevi' },
  ]);
  // The migration after it ran in the same transaction.
  expect(
    await rows(
      `select count(*)::int as n from information_schema.columns where column_name = 'upgrade_probe' and table_schema = 'public'`,
    ),
  ).toEqual([{ n: 6 }]);
});
