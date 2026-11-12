import { afterAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { eq, inArray, like, or } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import { postgresThreadStore, withThreadTx } from '../../apps/server/src/threads/adapters/postgres';
import { reminderUsecases } from '../../apps/server/src/threads/usecases/reminders';
import { reminderWorkflowId } from '../../apps/server/src/threads/domain';
import { dueTimerId, talkWorkItems } from '../../apps/server/src/composition/talk-work-items';
import type { WorkItemTx } from '../../apps/server/src/modules/talks/model';
import { enqueuedWorkflows, forgetTestWorkflows, testDurable } from './durable';

/**
 * The owner's card of an action point (D96 items 5 and 6) against Postgres: `talkWorkItems` over the thread store's
 * transaction. Run with `bun run test:db` inside the devcontainer. Every test gets its own synthetic people (an owner
 * with a grant and a manager whose name must never reach the card), and everything they owned is removed at the end.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
// The authorisation version is an HMAC under the master key; a test key when the environment has none.
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');

const ACTION_POINT_TEXT = 'Gå kursen i arbetsrätt före sommaren';
const created: string[] = [];
const organisations: string[] = [];
const threadsMade: string[] = [];
const cancelled: string[] = [];
const options = { durable: testDurable, cancel: async (id: string) => void cancelled.push(id) };
let now = new Date('2026-03-01T09:00:00.000Z');
const clock = () => now;
const run = <T>(fn: (items: WorkItemTx) => Promise<T>) =>
  withThreadTx(options, (tx, thread) => fn(talkWorkItems(tx, thread, { clock })));

afterAll(async () => {
  if (created.length) {
    const owned = await database()
      .select({ id: schema.threads.id })
      .from(schema.threads)
      .where(inArray(schema.threads.personId, created));
    const ids = [...owned.map(r => r.id), ...threadsMade];
    await database()
      .delete(schema.audit)
      .where(
        inArray(
          schema.audit.subject,
          ids.flatMap(id => [`thread:${id}`, `timer:${dueTimerId(id)}`]),
        ),
      );
    await database()
      .delete(schema.jobs)
      .where(or(...created.map(p => like(schema.jobs.id, `attention:automatic:${p}:%`))));
    // A deferred delivery's release job is scheduled with its audit row (D86).
    await database()
      .delete(schema.audit)
      .where(or(...created.map(p => like(schema.audit.subject, `job:attention:automatic:${p}:%`))));
    if (organisations.length) {
      const rounds = await database()
        .select({ id: schema.talkRounds.id })
        .from(schema.talkRounds)
        .where(inArray(schema.talkRounds.organisationId, organisations));
      if (rounds.length) {
        await database()
          .delete(schema.talkCommitments)
          .where(
            inArray(
              schema.talkCommitments.roundId,
              rounds.map(r => r.id),
            ),
          );
        await database()
          .delete(schema.talkRounds)
          .where(
            inArray(
              schema.talkRounds.id,
              rounds.map(r => r.id),
            ),
          );
      }
    }
    await database().delete(schema.workOccurrences).where(inArray(schema.workOccurrences.personId, created));
    await database().delete(schema.threads).where(inArray(schema.threads.personId, created));
    await database().delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, created));
    await database().delete(schema.people).where(inArray(schema.people.id, created));
  }
  await forgetTestWorkflows();
  await closeDatabase();
});

async function people() {
  const tag = Math.random().toString(36).slice(2, 8);
  const owner = `talks-test-${tag}-owner`,
    manager = `talks-test-${tag}-manager`,
    managerName = `Synthetic Chef ${tag}`;
  const organisationId = `talks-test-${tag}`;
  await database()
    .insert(schema.people)
    .values([
      { id: owner, organisationId, name: `Synthetic Ägare ${tag}` },
      { id: manager, organisationId, name: managerName },
    ]);
  await database()
    .insert(schema.accessGrants)
    .values({ personId: owner, unitId: `unit-${tag}`, unitLabel: 'Enheten', role: 'employee', capabilities: [] });
  created.push(owner, manager);
  organisations.push(organisationId);
  return { owner, manager, managerName, organisationId, unitId: `unit-${tag}` };
}
const card = () => {
  const id = `talks-card-${crypto.randomUUID()}`;
  threadsMade.push(id);
  return id;
};
async function rows(threadId: string) {
  const db = database();
  const [thread] = await db.select().from(schema.threads).where(eq(schema.threads.id, threadId));
  const messages = await db
    .select()
    .from(schema.threadMessages)
    .where(eq(schema.threadMessages.threadId, threadId))
    .orderBy(schema.threadMessages.createdAt, schema.threadMessages.seq);
  const deliveries = await db
    .select()
    .from(schema.deliveries)
    .where(eq(schema.deliveries.threadId, threadId))
    .orderBy(schema.deliveries.id);
  const audit = await db
    .select()
    .from(schema.audit)
    .where(inArray(schema.audit.subject, [`thread:${threadId}`, `timer:${dueTimerId(threadId)}`]))
    .orderBy(schema.audit.id);
  const [timer] = await db
    .select()
    .from(schema.timerIntents)
    .where(eq(schema.timerIntents.id, dueTimerId(threadId)));
  return { thread, messages, deliveries, audit, timer };
}
const open = (threadId: string, personId: string, dueOn: string, at = now.toISOString()) =>
  run(items => items.open({ threadId, personId, commitmentId: `commitment-${threadId}`, dueOn, at }));

describe('the action point card (D96 items 5 and 6)', () => {
  test('open writes the card, its delivery, message, audit row and due timer with its workflow in one transaction; a throw leaves none', async () => {
    const { owner, unitId } = await people();
    const rolledBack = card();
    await expect(
      run(async items => {
        await items.open({
          threadId: rolledBack,
          personId: owner,
          commitmentId: 'c-rolled-back',
          dueOn: '2026-03-12',
          at: now.toISOString(),
        });
        throw new Error('after open');
      }),
    ).rejects.toThrow('after open');
    const none = await rows(rolledBack);
    expect([none.thread, none.timer, none.messages, none.deliveries, none.audit]).toEqual([
      undefined,
      undefined,
      [],
      [],
      [],
    ]);
    expect(await enqueuedWorkflows(dueTimerId(rolledBack))).toEqual([]);

    const id = card();
    await open(id, owner, '2026-03-12');
    const { thread, messages, deliveries, audit, timer } = await rows(id);
    expect(thread).toMatchObject({
      personId: owner,
      kind: 'pushed',
      state: 'open',
      connector: 'talks',
      area: 'talks',
      deadline: '2026-03-12',
      sourceAuthorization: null,
      title: 'Åtgärdspunkt från utvecklingssamtal',
      summary: 'En åtgärdspunkt ska vara klar senast 12 mars.',
      trigger: { reason: 'Lades till efter ditt utvecklingssamtal' },
      actions: [{ capability: 'talks.commitments', kind: 'read' }],
    });
    expect(messages.map(m => [m.role, m.body])).toEqual([
      ['assistant', 'En åtgärdspunkt ska vara klar senast 12 mars.'],
    ]);
    expect(deliveries.map(d => [d.id, d.kind])).toEqual([[`delivery:${id}`, 'automatic']]);
    expect(audit.map(a => [a.actor, a.action, a.subject])).toEqual([
      ['talks:commitment', 'thread.pushed', `thread:${id}`],
    ]);
    expect(timer).toMatchObject({ kind: 'due', state: 'active', generation: 1, personId: owner, unitId });
    expect(timer!.authorizationVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(await enqueuedWorkflows(dueTimerId(id))).toEqual([
      {
        id: `${dueTimerId(id)}:v2:1`,
        workflow: 'durableReminder',
        status: 'ENQUEUED',
        input: { id: dueTimerId(id), generation: 1, dueAt: timer!.dueAt.toISOString() },
      },
    ]);
  });

  test('the stored card, messages and audit details carry no action-point text and no other person name', async () => {
    const { owner, managerName } = await people();
    const id = card();
    await open(id, owner, '2026-03-12');
    now = new Date('2026-03-14T08:00:00.000Z');
    await run(items => items.fire(id, 1, now.toISOString()));
    await run(items => items.close(id, now.toISOString()));
    await run(items => items.reopen(id, '2026-04-01', now.toISOString()));
    now = new Date('2026-03-01T09:00:00.000Z');
    const { thread, messages, audit } = await rows(id);
    const stored = JSON.stringify({ thread, messages, details: audit.map(a => a.details) });
    expect(stored).not.toContain(ACTION_POINT_TEXT);
    expect(stored).not.toContain(managerName);
    expect(stored).not.toContain('Synthetic');
    for (const a of audit)
      for (const value of Object.values(a.details))
        expect(['string', 'number', 'boolean'].includes(typeof value) || value === null).toBe(true);
  });

  test('the due timer is due at 06:00 Stockholm the day after, in winter, in summer and across both changes of time', async () => {
    const { owner } = await people();
    const cases = [
      ['2026-03-12', '2026-03-13T05:00:00.000Z'], // CET
      ['2026-06-10', '2026-06-11T04:00:00.000Z'], // CEST
      ['2026-03-28', '2026-03-29T04:00:00.000Z'], // summer time starts that night
      ['2026-10-24', '2026-10-25T05:00:00.000Z'], // summer time ends that night
    ] as const;
    for (const [dueOn, expected] of cases) {
      const id = card();
      await open(id, owner, dueOn, '2026-03-01T09:00:00.000Z');
      expect((await rows(id)).timer!.dueAt.toISOString()).toBe(expected);
    }
  });

  test('close hands the card over and cancels its timer; reopen brings both back at a higher generation; a past date is due at once', async () => {
    const { owner } = await people();
    const id = card();
    await open(id, owner, '2026-03-12');
    const closedAt = '2026-03-05T10:00:00.000Z';
    await run(items => items.close(id, closedAt));
    let r = await rows(id);
    expect(r.thread).toMatchObject({ state: 'handled', waitingOn: null, snoozedUntil: null });
    expect(r.thread!.handledAt?.toISOString()).toBe(closedAt);
    expect(r.timer).toMatchObject({ state: 'cancelled', generation: 1 });
    expect(cancelled).toContain(`${dueTimerId(id)}:v2:1`);
    expect((await postgresThreadStore(options).readThread(owner, id))?.state).toBe('handled');
    // Closing again and touching a card that does not exist are no errors.
    await run(items => items.close(id, closedAt));
    await run(items => items.close('talks-card-missing', closedAt));
    await run(items => items.reopen('talks-card-missing', '2026-03-12', closedAt));

    const reopenedAt = '2026-03-20T10:00:00.000Z';
    await run(items => items.reopen(id, '2026-03-12', reopenedAt));
    r = await rows(id);
    expect(r.thread).toMatchObject({ state: 'open', handledAt: null, deadline: '2026-03-12' });
    expect(r.timer).toMatchObject({ state: 'active', generation: 2 });
    expect(r.timer!.dueAt.toISOString()).toBe(reopenedAt);
    expect((await enqueuedWorkflows(dueTimerId(id))).map(w => w.id)).toEqual([
      `${dueTimerId(id)}:v2:1`,
      `${dueTimerId(id)}:v2:2`,
    ]);
    expect(r.audit.map(a => a.action)).toEqual(['thread.pushed', 'thread.handled', 'thread.reopened']);
  });

  test('fire at the active generation surfaces the card; a stale generation, a cancelled timer and a timer not yet due change nothing', async () => {
    const { owner } = await people();
    const id = card();
    await open(id, owner, '2026-03-12');
    const early = '2026-03-13T04:59:00.000Z';
    let before = await rows(id);
    expect(await run(items => items.fire(id, 1, early))).toBe(false);
    expect(await rows(id)).toEqual(before);
    expect(await run(items => items.fire(id, 2, '2026-03-14T08:00:00.000Z'))).toBe(false);
    expect(await rows(id)).toEqual(before);

    // The person had dismissed it meanwhile; the timer brings it back to the top of the stream anyway.
    await database()
      .update(schema.threads)
      .set({ state: 'dismissed', handledAt: new Date('2026-03-10T10:00:00.000Z') })
      .where(eq(schema.threads.id, id));
    const at = '2026-03-13T05:00:00.000Z';
    expect(await run(items => items.fire(id, 1, at))).toBe(true);
    const r = await rows(id);
    expect(r.thread).toMatchObject({ state: 'open', handledAt: null, waitingOn: null, snoozedUntil: null });
    expect(r.thread!.remindedAt?.toISOString()).toBe(at);
    expect(r.messages.at(-1)?.body).toBe('Åtgärdspunkten skulle vara klar 12 mars.');
    expect(r.deliveries.map(d => [d.id, d.kind])).toEqual([
      [`delivery:${id}`, 'automatic'],
      [`due:${id}:1`, 'reminder'],
    ]);
    expect(r.timer).toMatchObject({ state: 'fired', generation: 1 });
    expect(JSON.stringify(r)).not.toContain('Du bad');
    // A retried workflow finds the timer fired: nothing more.
    before = r;
    expect(await run(items => items.fire(id, 1, at))).toBe(false);
    expect(await rows(id)).toEqual(before);

    // A cancelled timer's late workflow is harmless.
    const other = card();
    await open(other, owner, '2026-03-12');
    await run(items => items.close(other, '2026-03-05T10:00:00.000Z'));
    before = await rows(other);
    expect(await run(items => items.fire(other, 1, at))).toBe(false);
    expect(await rows(other)).toEqual(before);
  });

  test('the thread as the browser reads it lists no due timer', async () => {
    const { owner } = await people();
    const id = card();
    await open(id, owner, '2026-03-12');
    const store = postgresThreadStore(options);
    expect((await store.readThread(owner, id))?.timers).toBeUndefined();
    expect((await store.listThreads(owner, now.toISOString())).find(t => t.id === id)?.timers).toBeUndefined();
  });

  test("the card is about the talk's employee by key on the thread, never on a row, and leaves the index with the card (D97)", async () => {
    const { owner } = await people();
    const id = card();
    const employee = { entity: 'person' as const, key: `Talks.Employee-${id}` };
    await run(items =>
      items.open({
        threadId: id,
        personId: owner,
        commitmentId: `commitment-${id}`,
        dueOn: '2026-03-12',
        at: now.toISOString(),
        subject: employee,
      }),
    );
    const store = postgresThreadStore(options);
    const read = (await store.readThread(owner, id))!;
    expect(read.subjects).toEqual([employee]);
    expect(read.items).toEqual([]);
    expect((await store.threadsNaming(owner, [employee])).map(n => n.thread.id)).toEqual([id]);
    await run(items => items.remove([id]));
    expect(await database().select().from(schema.threadSubjects).where(eq(schema.threadSubjects.threadId, id))).toEqual(
      [],
    );
  });

  test('a due timer handed to the reminder path is skipped and writes nothing', async () => {
    const { owner } = await people();
    const id = card();
    await open(id, owner, '2026-03-12');
    const before = await rows(id);
    const reminders = reminderUsecases({
      store: postgresThreadStore(options),
      clock: () => new Date('2026-03-14T08:00:00.000Z'),
      authorized: async () => true,
    });
    expect(await reminders.fire(dueTimerId(id), 1)).toBe('skipped');
    const after = await rows(id);
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain('Du bad');
  });

  test('remove leaves no row in any table that referenced the cards, and ends their waits after the commit', async () => {
    const { owner, manager, organisationId } = await people();
    const first = card(),
      second = card(),
      kept = card();
    for (const id of [first, second, kept]) await open(id, owner, '2026-03-12');
    const ids = [first, second];
    // A person's own snooze on one of them, an occurrence pointing at one and the action point that names it.
    await withThreadTx(options, async (_, thread) => {
      await thread.scheduleTimer({
        id: `snooze:${first}`,
        personId: owner,
        threadId: first,
        kind: 'snooze',
        unitId: 'unit',
        authorizationVersion: 'v1',
        dueAt: '2026-03-06T05:00:00.000Z',
        requestedAt: now.toISOString(),
      });
    });
    await database()
      .insert(schema.workOccurrences)
      .values({
        id: `occurrence-${first}`,
        personId: owner,
        connector: 'talks',
        assignment: 'a',
        sourceKey: 'k',
        period: 'p',
        revision: 'r',
        observedAt: now,
        sourceState: 'open',
        disposition: 'projected',
        threadId: first,
        legacy: false,
      });
    const roundId = `round-${organisationId}`;
    await database().insert(schema.talkRounds).values({
      id: roundId,
      organisationId,
      kind: 'development',
      label: 'Utvecklingssamtal',
      opensOn: '2026-02-01',
      dueOn: '2026-04-30',
      createdBy: 'operator:test',
    });
    await database()
      .insert(schema.talkCommitments)
      .values({
        id: `commitment-${second}`,
        roundId,
        employeeId: owner,
        ownerRole: 'employee',
        ownerId: owner,
        textSealed: 'sealed',
        dueOn: '2026-03-12',
        createdBy: manager,
        threadId: second,
      });
    const cancelsBefore = cancelled.length;
    await run(items => items.remove([...ids, 'talks-card-missing']));
    const db = database();
    const count = async (rowsFound: Promise<unknown[]>) => (await rowsFound).length;
    expect(await count(db.select().from(schema.threads).where(inArray(schema.threads.id, ids)))).toBe(0);
    expect(
      await count(db.select().from(schema.threadMessages).where(inArray(schema.threadMessages.threadId, ids))),
    ).toBe(0);
    expect(await count(db.select().from(schema.proposals).where(inArray(schema.proposals.threadId, ids)))).toBe(0);
    expect(await count(db.select().from(schema.timerIntents).where(inArray(schema.timerIntents.threadId, ids)))).toBe(
      0,
    );
    expect(await count(db.select().from(schema.deliveries).where(inArray(schema.deliveries.threadId, ids)))).toBe(0);
    expect(
      await count(db.select().from(schema.followupPolicies).where(inArray(schema.followupPolicies.threadId, ids))),
    ).toBe(0);
    expect(
      await count(
        db
          .select()
          .from(schema.workOccurrences)
          .where(eq(schema.workOccurrences.id, `occurrence-${first}`)),
      ),
    ).toBe(0);
    const [commitment] = await db
      .select()
      .from(schema.talkCommitments)
      .where(eq(schema.talkCommitments.id, `commitment-${second}`));
    expect(commitment?.threadId).toBeNull();
    expect(cancelled.slice(cancelsBefore).sort()).toEqual(
      [
        reminderWorkflowId({ id: dueTimerId(first), generation: 1 }),
        reminderWorkflowId({ id: dueTimerId(second), generation: 1 }),
        reminderWorkflowId({ id: `snooze:${first}`, generation: 1 }),
      ].sort(),
    );
    // The other card is untouched, and the erasure is audited by id alone.
    expect((await rows(kept)).thread).toBeDefined();
    const audit = await db
      .select()
      .from(schema.audit)
      .where(inArray(schema.audit.subject, [`thread:${first}`, `thread:${second}`]));
    expect(audit.filter(a => a.action === 'thread.removed').map(a => a.details)).toEqual([
      { reason: 'erasure' },
      { reason: 'erasure' },
    ]);
  });
});
