import { afterAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { eq, inArray, like, or } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import { withThreadTx } from '../../apps/server/src/threads/adapters/postgres';
import { dialogueDueTimerId, dialogueWorkItems } from '../../apps/server/src/composition/dialogue-work-items';
import type { DialogueWorkItems } from '../../apps/server/src/modules/dialogue/model';
import { enqueuedWorkflows, forgetTestWorkflows, testDurable } from './durable';

/**
 * The owner's card of an activity in the follow-up dialogue (D118 item 4) against Postgres: `dialogueWorkItems` over
 * the thread store's transaction. Run with `bun run test:db` inside the devcontainer. Every test gets its own synthetic
 * owner with a grant, and everything they owned is removed at the end.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');

const created: string[] = [];
const threadsMade: string[] = [];
const cancelled: string[] = [];
const options = { durable: testDurable, cancel: async (id: string) => void cancelled.push(id) };
const now = new Date('2026-03-01T09:00:00.000Z');
const clock = () => now;
const run = <T>(fn: (items: DialogueWorkItems) => Promise<T>) =>
  withThreadTx(options, (tx, thread) => fn(dialogueWorkItems(tx, thread, { clock })));

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
          ids.flatMap(id => [`thread:${id}`, `timer:${dialogueDueTimerId(id)}`]),
        ),
      );
    await database()
      .delete(schema.jobs)
      .where(or(...created.map(p => like(schema.jobs.id, `attention:automatic:${p}:%`))));
    await database().delete(schema.workOccurrences).where(inArray(schema.workOccurrences.personId, created));
    await database().delete(schema.threads).where(inArray(schema.threads.personId, created));
    await database().delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, created));
    await database().delete(schema.people).where(inArray(schema.people.id, created));
  }
  await forgetTestWorkflows();
  await closeDatabase();
});

async function owner() {
  const tag = Math.random().toString(36).slice(2, 8);
  const id = `dialogue-test-${tag}-owner`;
  await database()
    .insert(schema.people)
    .values({ id, organisationId: `dialogue-test-${tag}`, name: `Synthetic Ägare ${tag}` });
  await database()
    .insert(schema.accessGrants)
    .values({ personId: id, unitId: `unit-${tag}`, unitLabel: 'Enheten', role: 'manager', capabilities: [] });
  created.push(id);
  return { id, unitId: `unit-${tag}` };
}
const card = () => {
  const id = `dialogue-card-${crypto.randomUUID()}`;
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
    .where(inArray(schema.audit.subject, [`thread:${threadId}`, `timer:${dialogueDueTimerId(threadId)}`]))
    .orderBy(schema.audit.id);
  const [timer] = await db
    .select()
    .from(schema.timerIntents)
    .where(eq(schema.timerIntents.id, dialogueDueTimerId(threadId)));
  return { thread, messages, deliveries, audit, timer };
}
const open = (threadId: string, personId: string, unitId: string, dueOn: string | null) =>
  run(items =>
    items.open({
      threadId,
      personId,
      activityId: `activity-${threadId}`,
      dueOn,
      at: now.toISOString(),
      subject: { entity: 'unit', key: unitId },
    }),
  );

describe('the activity card (D118 item 4)', () => {
  test('a dated activity gets a card about the unit, its delivery, message, audit row and timer with its workflow', async () => {
    const { id: personId, unitId } = await owner();
    const id = card();
    await open(id, personId, unitId, '2026-03-12');
    const { thread, messages, deliveries, audit, timer } = await rows(id);
    expect(thread).toMatchObject({
      personId,
      kind: 'pushed',
      state: 'open',
      connector: 'dialogue',
      area: 'dialogue',
      deadline: '2026-03-12',
      title: 'Aktivitet från uppföljningsdialogen',
      summary: 'En aktivitet ska vara klar senast 12 mars.',
      subjects: [{ entity: 'unit', key: unitId }],
      trigger: { reason: 'Lades till i uppföljningsdialogen', source: 'Dialog' },
      actions: [{ capability: 'dialogue.activities', kind: 'read', target: 'panel' }],
    });
    expect(messages.map(m => m.body)).toEqual(['En aktivitet ska vara klar senast 12 mars.']);
    expect(deliveries.map(d => [d.id, d.kind])).toEqual([[`delivery:${id}`, 'automatic']]);
    expect(audit.map(a => [a.actor, a.action])).toEqual([['dialogue:activity', 'thread.pushed']]);
    expect(timer).toMatchObject({ kind: 'dialogue-due', state: 'active', generation: 1, personId, unitId });
    expect(timer!.dueAt.toISOString()).toBe('2026-03-13T05:00:00.000Z');
    expect((await enqueuedWorkflows(dialogueDueTimerId(id))).map(w => [w.workflow, w.status])).toEqual([
      ['durableReminder', 'ENQUEUED'],
    ]);
  });

  test('an undated activity gets a card that says it has no date, and no timer', async () => {
    const { id: personId, unitId } = await owner();
    const id = card();
    await open(id, personId, unitId, null);
    const r = await rows(id);
    expect(r.thread).toMatchObject({ deadline: null, summary: 'En aktivitet utan slutdatum.' });
    expect(r.timer).toBeUndefined();
    expect(await enqueuedWorkflows(dialogueDueTimerId(id))).toEqual([]);
  });

  test('retime moves the card’s date and timer, and taking the date away cancels the timer', async () => {
    const { id: personId, unitId } = await owner();
    const id = card();
    await open(id, personId, unitId, '2026-03-12');
    await run(items => items.retime(id, '2026-04-01', '2026-03-02T09:00:00.000Z'));
    let r = await rows(id);
    expect(r.thread).toMatchObject({ deadline: '2026-04-01', summary: 'En aktivitet ska vara klar senast 1 april.' });
    expect(r.timer).toMatchObject({ state: 'active', generation: 2 });
    expect(r.timer!.dueAt.toISOString()).toBe('2026-04-02T04:00:00.000Z');
    await run(items => items.retime(id, null, '2026-03-03T09:00:00.000Z'));
    r = await rows(id);
    expect(r.thread).toMatchObject({ deadline: null, summary: 'En aktivitet utan slutdatum.' });
    expect(r.timer).toMatchObject({ state: 'cancelled' });
    expect(r.audit.map(a => a.action)).toEqual(['thread.pushed', 'thread.retimed', 'thread.retimed']);
  });

  test('close, reopen, fire at the active generation, and remove', async () => {
    const { id: personId, unitId } = await owner();
    const id = card();
    await open(id, personId, unitId, '2026-03-12');
    await run(items => items.close(id, '2026-03-05T10:00:00.000Z'));
    let r = await rows(id);
    expect(r.thread).toMatchObject({ state: 'handled' });
    expect(r.timer).toMatchObject({ state: 'cancelled', generation: 1 });
    // A closed card's late workflow is harmless.
    expect(await run(items => items.fire(id, 1, '2026-03-14T08:00:00.000Z'))).toBe(false);
    await run(items => items.reopen(id, '2026-03-12', '2026-03-06T10:00:00.000Z'));
    r = await rows(id);
    expect(r.thread).toMatchObject({ state: 'open', deadline: '2026-03-12' });
    expect(r.timer).toMatchObject({ state: 'active', generation: 2 });
    expect(await run(items => items.fire(id, 1, '2026-03-14T08:00:00.000Z'))).toBe(false);
    expect(await run(items => items.fire(id, 2, '2026-03-13T04:59:00.000Z'))).toBe(false);
    expect(await run(items => items.fire(id, 2, '2026-03-13T05:00:00.000Z'))).toBe(true);
    r = await rows(id);
    expect(r.messages.at(-1)?.body).toBe('Aktiviteten skulle vara klar 12 mars.');
    expect(r.deliveries.map(d => d.kind)).toEqual(['automatic', 'reminder']);
    expect(r.timer).toMatchObject({ state: 'fired', generation: 2 });
    // Only the dialogue's own cards are removed.
    const foreign = `dialogue-card-foreign-${crypto.randomUUID()}`;
    threadsMade.push(foreign);
    await database()
      .insert(schema.threads)
      .values({
        id: foreign,
        personId,
        kind: 'pushed',
        topic: 'x',
        title: 'Annat',
        trigger: { reason: 'test', source: 'talks', at: now.toISOString() },
        connector: 'talks',
        area: 'talks',
      });
    await run(items => items.remove([id, foreign]));
    expect((await rows(id)).thread).toBeUndefined();
    expect((await rows(foreign)).thread).toBeDefined();
    await database().delete(schema.threads).where(eq(schema.threads.id, foreign));
  });
});
