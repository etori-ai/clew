import { afterAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { eq, inArray, like, or } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { postgresThreadStore, withThreadTx } from '../../apps/server/src/threads/adapters/postgres';
import { reminderUsecases } from '../../apps/server/src/threads/usecases/reminders';
import { boardingTimerId, boardingWorkItems } from '../../apps/server/src/composition/boarding-work-items';
import { boardingStoreWithCards } from '../../apps/server/src/composition/boarding';
import type { Report, WorkItemTx } from '../../apps/server/src/modules/boarding/model';
import { boardingUsecases } from '../../apps/server/src/modules/boarding/usecases';
import { enqueuedWorkflows, forgetTestWorkflows, testDurable } from './durable';

/**
 * The owner's card of a plan's item (D124) against Postgres: `boardingWorkItems` over the thread store's transaction,
 * and the use cases end to end over the store composition builds (`boardingStoreWithCards`), with the test's own engine
 * queue. Run with `bun run test:db` inside the devcontainer. Every test gets its own synthetic people, and everything
 * they owned is removed at the end; the development database is never this one (the wrapper points at the worktree's).
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');

const TYPED = 'Visa Synthetic hur journalen fungerar';
const created: string[] = [];
const organisations: string[] = [];
const tags: string[] = [];
const threadsMade: string[] = [];
const cancelled: string[] = [];
const options = { durable: testDurable, cancel: async (id: string) => void cancelled.push(id) };
let now = new Date('2026-03-01T09:00:00.000Z');
const clock = () => now;
const run = <T>(fn: (items: WorkItemTx) => Promise<T>) =>
  withThreadTx(options, (tx, thread) => fn(boardingWorkItems(tx, thread, { clock })));

afterAll(async () => {
  const db = database();
  if (organisations.length) {
    const plans = await db
      .select({ id: schema.boardingPlans.id })
      .from(schema.boardingPlans)
      .where(inArray(schema.boardingPlans.organisationId, organisations));
    if (plans.length) {
      await db.delete(schema.boardingItems).where(
        inArray(
          schema.boardingItems.planId,
          plans.map(p => p.id),
        ),
      );
      await db.delete(schema.boardingPlans).where(
        inArray(
          schema.boardingPlans.id,
          plans.map(p => p.id),
        ),
      );
    }
    await db.delete(schema.boardingLayers).where(inArray(schema.boardingLayers.organisationId, organisations));
    await db
      .delete(schema.audit)
      .where(or(...organisations.map(o => like(schema.audit.subject, `organisation:${o}%`))));
  }
  if (created.length) {
    const owned = await db
      .select({ id: schema.threads.id })
      .from(schema.threads)
      .where(inArray(schema.threads.personId, created));
    const ids = [...owned.map(r => r.id), ...threadsMade];
    if (ids.length)
      await db.delete(schema.audit).where(
        inArray(
          schema.audit.subject,
          ids.flatMap(id => [`thread:${id}`, `timer:${boardingTimerId(id)}`]),
        ),
      );
    await db.delete(schema.audit).where(or(...created.map(p => like(schema.audit.subject, `%${p}%`))));
    // The end-to-end run's plans and items are named by its own ids.
    for (const tag of tags) await db.delete(schema.audit).where(like(schema.audit.subject, `%:boarding-e2e-${tag}-%`));
    await db.delete(schema.jobs).where(or(...created.map(p => like(schema.jobs.id, `attention:automatic:${p}:%`))));
    await db.delete(schema.workOccurrences).where(inArray(schema.workOccurrences.personId, created));
    await db.delete(schema.threads).where(inArray(schema.threads.personId, created));
    await db.delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, created));
    await db.delete(schema.people).where(inArray(schema.people.id, created));
  }
  await forgetTestWorkflows();
  await closeDatabase();
});

async function people() {
  const tag = Math.random().toString(36).slice(2, 8);
  const organisationId = `boarding-test-${tag}`;
  const [owner, manager, hire, buddy] = ['owner', 'manager', 'hire', 'buddy'].map(r => `boarding-test-${tag}-${r}`);
  const names = { owner: `Synthetic Ägare ${tag}`, manager: `Synthetic Chef ${tag}`, hire: `Synthetic Ny ${tag}` };
  await database()
    .insert(schema.people)
    .values([
      { id: owner!, organisationId, name: names.owner },
      { id: manager!, organisationId, name: names.manager, userName: `chef.${tag}` },
      // The new hire has no grant yet: they cannot sign in, and their cards still wait for them.
      { id: hire!, organisationId, name: names.hire, userName: `ny.${tag}` },
      { id: buddy!, organisationId, name: `Synthetic Fadder ${tag}`, userName: `fadder.${tag}` },
    ]);
  await database()
    .insert(schema.accessGrants)
    .values({ personId: owner!, unitId: `unit-${tag}`, unitLabel: 'Enheten', role: 'employee', capabilities: [] });
  created.push(owner!, manager!, hire!, buddy!);
  organisations.push(organisationId);
  tags.push(tag);
  return {
    owner: owner!,
    manager: manager!,
    hire: hire!,
    buddy: buddy!,
    names,
    organisationId,
    unitId: `unit-${tag}`,
    tag,
  };
}
const card = () => {
  const id = `boarding-card-${crypto.randomUUID()}`;
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
    .where(inArray(schema.audit.subject, [`thread:${threadId}`, `timer:${boardingTimerId(threadId)}`]))
    .orderBy(schema.audit.id);
  const [timer] = await db
    .select()
    .from(schema.timerIntents)
    .where(eq(schema.timerIntents.id, boardingTimerId(threadId)));
  return { thread, messages, deliveries, audit, timer };
}
const open = (threadId: string, personId: string, dueOn: string, title: string | null = 'Beställ dator') =>
  run(items =>
    items.open({
      threadId,
      personId,
      itemId: `item-${threadId}`,
      planId: `plan-${threadId}`,
      event: 'introduction',
      title,
      dueOn,
      at: now.toISOString(),
    }),
  );

describe('the card of a plan’s item (D124)', () => {
  test('open writes the card, its delivery, message, audit row and timer with its workflow in one transaction; a throw leaves none', async () => {
    const { owner, unitId } = await people();
    const rolledBack = card();
    await expect(
      run(async items => {
        await items.open({
          threadId: rolledBack,
          personId: owner,
          itemId: 'i',
          planId: 'p',
          event: 'introduction',
          title: 'Beställ dator',
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
    expect(await enqueuedWorkflows(boardingTimerId(rolledBack))).toEqual([]);

    const id = card();
    await open(id, owner, '2026-03-12');
    const { thread, messages, deliveries, audit, timer } = await rows(id);
    expect(thread).toMatchObject({
      personId: owner,
      kind: 'pushed',
      state: 'open',
      connector: 'boarding',
      area: 'boarding',
      topic: `boarding:item:item-${id}`,
      deadline: '2026-03-12',
      sourceAuthorization: null,
      title: 'Beställ dator',
      summary: 'Uppgiften ingår i en introduktion och ska vara klar senast 12 mars.',
      trigger: { reason: 'En introduktion startades', source: 'Introduktion och avslut' },
      actions: [{ capability: 'boarding.plan', kind: 'read', input: { plan: `plan-${id}` } }],
    });
    expect(messages.map(m => [m.role, m.body])).toEqual([
      ['assistant', 'Uppgiften ingår i en introduktion och ska vara klar senast 12 mars.'],
    ]);
    expect(deliveries.map(d => [d.id, d.kind])).toEqual([[`delivery:${id}`, 'automatic']]);
    expect(audit.map(a => [a.actor, a.action, a.subject])).toEqual([
      ['boarding:item', 'thread.pushed', `thread:${id}`],
    ]);
    expect(timer).toMatchObject({ kind: 'boarding', state: 'active', generation: 1, personId: owner, unitId });
    expect(timer!.dueAt.toISOString()).toBe('2026-03-13T05:00:00.000Z');
    expect(await enqueuedWorkflows(boardingTimerId(id))).toEqual([
      {
        id: `${boardingTimerId(id)}:v2:1`,
        workflow: 'durableReminder',
        status: 'ENQUEUED',
        input: { id: boardingTimerId(id), generation: 1, dueAt: timer!.dueAt.toISOString() },
      },
    ]);
  });

  test('a card for someone without a grant waits in their stream; a typed item’s card has a fixed title', async () => {
    const { hire } = await people();
    const id = card();
    await open(id, hire, '2026-03-12', null);
    const { thread, timer } = await rows(id);
    expect(thread).toMatchObject({ personId: hire, state: 'open', title: 'En uppgift i en introduktion' });
    expect(thread!.trigger).toMatchObject({ reason: 'Lades till i planen' });
    expect(timer).toMatchObject({ kind: 'boarding', unitId: '', authorizationVersion: '' });
    expect((await postgresThreadStore(options).readThread(hire, id))?.state).toBe('open');
  });

  test('close hands the card over and cancels its timer; reopen brings both back; fire works only at the active generation', async () => {
    const { owner } = await people();
    const id = card();
    await open(id, owner, '2026-03-12');
    await run(items => items.close(id, '2026-03-05T10:00:00.000Z', 'done'));
    let r = await rows(id);
    expect(r.thread).toMatchObject({ state: 'handled' });
    expect(r.timer).toMatchObject({ state: 'cancelled', generation: 1 });
    expect(r.messages.at(-1)?.body).toBe('Uppgiften är klar.');
    await run(items => items.close('boarding-card-missing', '2026-03-05T10:00:00.000Z', 'closed'));
    await run(items => items.reopen(id, '2026-03-12', '2026-03-06T10:00:00.000Z'));
    r = await rows(id);
    expect(r.thread).toMatchObject({ state: 'open', deadline: '2026-03-12' });
    expect(r.timer).toMatchObject({ state: 'active', generation: 2 });
    expect(r.messages.at(-1)?.body).toBe('Uppgiften är öppen igen och ska vara klar senast 12 mars.');
    expect(await run(items => items.fire(id, 1, '2026-03-14T08:00:00.000Z'))).toBe(false);
    expect(await run(items => items.fire(id, 2, '2026-03-13T04:59:00.000Z'))).toBe(false);
    expect(await run(items => items.fire(id, 2, '2026-03-13T05:00:00.000Z'))).toBe(true);
    r = await rows(id);
    expect(r.timer).toMatchObject({ state: 'fired', generation: 2 });
    expect(r.messages.at(-1)?.body).toBe('Uppgiften skulle vara klar 12 mars.');
    expect(r.deliveries.map(d => [d.id, d.kind])).toEqual([
      [`boarding:${id}:2`, 'reminder'],
      [`delivery:${id}`, 'automatic'],
    ]);
    await run(items => items.close(id, '2026-03-14T08:00:00.000Z', 'closed'));
    expect((await rows(id)).messages.at(-1)?.body).toBe('Planen är avslutad.');
  });

  test('a boarding timer handed to the reminder path is skipped and writes nothing', async () => {
    const { owner } = await people();
    const id = card();
    await open(id, owner, '2026-03-12');
    const before = await rows(id);
    const reminders = reminderUsecases({
      store: postgresThreadStore(options),
      clock: () => new Date('2026-03-14T08:00:00.000Z'),
      authorized: async () => true,
    });
    expect(await reminders.fire(boardingTimerId(id), 1)).toBe('skipped');
    expect(await rows(id)).toEqual(before);
  });

  test('remove leaves no card, timer or delivery, ends their waits after commit, and touches no other connector’s card', async () => {
    const { owner } = await people();
    const first = card(),
      kept = card();
    for (const id of [first, kept]) await open(id, owner, '2026-03-12');
    const before = cancelled.length;
    await run(items => items.remove([first, 'boarding-card-missing']));
    expect((await rows(first)).thread).toBeUndefined();
    expect((await rows(first)).timer).toBeUndefined();
    expect(cancelled.slice(before)).toEqual([`${boardingTimerId(first)}:v2:1`]);
    expect((await rows(kept)).thread).toBeDefined();
  });
});

describe('the use cases end to end on the composed store (D124)', () => {
  test('a plan, its typed item, ticks, the timer, closing and erasure: cards, timers and rows commit together, and no name or typed title reaches a card or an audit row', async () => {
    const w = await people();
    now = new Date('2026-11-13T09:00:00.000Z');
    let n = 0;
    const ids = () => `boarding-e2e-${w.tag}-${++n}`;
    const store = boardingStoreWithCards(options, { clock });
    const report = (id: string, name: string, userName: string): Report => ({
      id,
      name,
      userName,
      enabled: true,
      unitIds: [w.unitId],
      positionCodes: [],
      employments: [],
    });
    const boarding = boardingUsecases({
      store,
      staff: async p =>
        p.id === w.manager
          ? {
              manages: true,
              reports: [
                report(w.hire, w.names.hire, `ny.${w.tag}`),
                report(w.buddy, 'Synthetic Fadder', `fadder.${w.tag}`),
              ],
              tree: [{ id: w.unitId, parentId: null }],
            }
          : { manages: false, reports: [], tree: [] },
      clock,
      ids,
    });
    const persona = (id: string): AuthenticatedContext => ({
      id,
      name: id,
      unitId: w.unitId,
      unitLabel: 'Enheten',
      role: 'manager',
      organisationId: w.organisationId,
      principal: { id: 'person:' + id, kind: 'person' },
      capabilities: [],
      authorizationVersion: 'v1',
      sessionBinding: 'test',
      expiresAt: '2099-01-01T00:00:00.000Z',
      authorize: async () => ({ version: 'v1' }),
    });
    const boss = persona(w.manager);
    await boarding.seedLayers('operator:test', w.organisationId, [
      {
        row: 2,
        layer: 'Alla',
        event: 'introduction',
        condition: 'all',
        value: null,
        title: 'Beställ dator',
        kind: 'order',
        owner: 'manager',
        offsetDays: -14,
        tiedTo: null,
      },
      {
        row: 3,
        layer: 'Alla',
        event: 'introduction',
        condition: 'all',
        value: null,
        title: 'Lunch',
        kind: 'meeting',
        owner: 'buddy',
        offsetDays: 1,
        tiedTo: null,
      },
      {
        row: 4,
        layer: 'Alla',
        event: 'introduction',
        condition: 'all',
        value: null,
        title: 'Läs rutinerna',
        kind: 'acknowledge',
        owner: 'person',
        offsetDays: 3,
        tiedTo: null,
      },
    ]);
    const { id } = await boarding.startPlan(boss, {
      personId: w.hire,
      event: 'introduction',
      anchorOn: '2026-12-04',
      buddyId: w.buddy,
    });
    const items = await store.transaction(tx => tx.items([id]));
    expect(items.map(i => [i.title, i.ownerId])).toEqual([
      ['Beställ dator', w.manager],
      ['Lunch', w.buddy],
      ['Läs rutinerna', w.hire],
    ]);
    for (const i of items)
      expect((await rows(i.threadId!)).thread).toMatchObject({ personId: i.ownerId, state: 'open' });
    // The hire's card is about them by key, and waits although they cannot sign in.
    expect((await postgresThreadStore(options).readThread(w.hire, items[2]!.threadId!))?.subjects).toEqual([
      { entity: 'person', key: `ny.${w.tag}` },
    ]);
    const added = await boarding.addItem(boss, id, {
      title: TYPED,
      kind: 'todo',
      ownerRole: 'manager',
      dueOn: '2026-11-30',
    });
    const [stored] = await database().select().from(schema.boardingItems).where(eq(schema.boardingItems.id, added.id));
    expect(stored!.title).toBeNull();
    expect(stored!.textSealed).not.toContain('journalen');
    expect((await boarding.plan(boss, id)).rows.find(r => r.id === added.id)?.title).toBe(TYPED);

    await boarding.setDone(persona(w.buddy), items[1]!.id);
    expect((await rows(items[1]!.threadId!)).thread?.state).toBe('handled');
    // The order's timer fires the morning after its day, at its generation; a stale one is harmless.
    now = new Date('2026-11-21T05:00:00.000Z');
    expect(await boarding.itemDue(items[0]!.threadId!, 2)).toBe(false);
    expect(await boarding.itemDue(items[0]!.threadId!, 1)).toBe(true);
    expect((await rows(items[0]!.threadId!)).timer).toMatchObject({ state: 'fired' });

    await boarding.closePlan(boss, id);
    for (const i of [...items, { threadId: (await store.transaction(tx => tx.item(added.id)))!.threadId }])
      expect((await rows(i.threadId!)).thread?.state).toBe('handled');

    const cards = (
      await database()
        .select()
        .from(schema.threads)
        .where(inArray(schema.threads.personId, [w.manager, w.hire, w.buddy]))
    ).filter(t => t.connector === 'boarding');
    const messages = await database()
      .select()
      .from(schema.threadMessages)
      .where(
        inArray(
          schema.threadMessages.threadId,
          cards.map(c => c.id),
        ),
      );
    const auditRows = await database()
      .select()
      .from(schema.audit)
      .where(
        or(like(schema.audit.subject, `plan:${id}`), like(schema.audit.subject, 'item:boarding-e2e-' + w.tag + '%')),
      );
    expect(auditRows.map(a => a.action).sort()).toEqual(
      [
        'boarding.item_added',
        'boarding.item_done',
        'boarding.item_due',
        'boarding.plan_closed',
        'boarding.plan_started',
      ].sort(),
    );
    const visible = JSON.stringify({ cards, messages, audit: auditRows.map(a => a.details) });
    expect(visible).not.toContain('journalen');
    for (const name of Object.values(w.names)) expect(visible).not.toContain(name);

    const erased = await boarding.erasePerson('operator:test', w.hire);
    expect(erased).toMatchObject({ plans: 1, items: 4, cards: 4 });
    expect(await store.transaction(tx => tx.plan(id))).toBeUndefined();
    for (const c of cards) expect((await rows(c.id)).thread).toBeUndefined();
  });
});
