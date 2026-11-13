import { afterAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { eq, inArray, or } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import type { AuthenticatedContext, StaffOverview } from '../../packages/contracts/src/index';
import { talkHolders, talkManages, talkStoreWithCards } from '../../apps/server/src/composition/talks';
import { dueTimerId } from '../../apps/server/src/composition/talk-work-items';
import { talkUsecases } from '../../apps/server/src/modules/talks/usecases';
import type { TalkStore } from '../../apps/server/src/modules/talks/model';
import { enqueuedWorkflows, forgetTestWorkflows, testDurable } from './durable';

/**
 * The talks module end to end on Postgres (D96): the use cases over the store composition builds
 * (`talkStoreWithCards`: the talks tables and the owner's card on one thread-store transaction), with the test's own
 * engine queue instead of the server's. An action point, its sealed text, its card, delivery, message, `due` timer,
 * workflow start and audit rows commit or roll back together; done and reopened move the card and the timer; the timer
 * firing brings the card back only at its active generation; erasure leaves nothing; the export carries the text and
 * its audit row does not. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');

const TEXT = 'Gå kursen i arbetsrätt före sommaren';
const tag = Math.random().toString(36).slice(2, 8);
const ORG = `talks-e2e-${tag}`;
const manager = `talks-e2e-${tag}-manager`,
  employee = `talks-e2e-${tag}-employee`,
  unitId = `unit-e2e-${tag}`;
// The people the seam's lookup is asked about (M2): one with a user name, one provisioned without, one elsewhere.
const named = `talks-e2e-${tag}-named`,
  nameless = `talks-e2e-${tag}-nameless`,
  foreign = `talks-e2e-${tag}-foreign`;
// The people whose assignments the live Manages lookup reads (Q12): a current manager, one who moved to another unit,
// one deactivated, and their employee; with the two units they are assigned to.
const current = `talks-e2e-${tag}-current`,
  moved = `talks-e2e-${tag}-moved`,
  gone = `talks-e2e-${tag}-gone`,
  staffer = `talks-e2e-${tag}-staffer`,
  unitA = `unit-e2e-${tag}-a`,
  unitB = `unit-e2e-${tag}-b`;
const assigned = [current, moved, gone, staffer];
const cancelled: string[] = [];
const options = { durable: testDurable, cancel: async (id: string) => void cancelled.push(id) };
let now = new Date('2026-03-02T09:00:00.000Z');
const clock = () => now;
let n = 0;
const ids = () => `talks-e2e-${tag}-${++n}`;
const persona = (id: string, role: 'manager' | 'employee'): AuthenticatedContext => ({
  id,
  name: id,
  unitId,
  unitLabel: 'Enheten',
  role,
  organisationId: ORG,
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
});
const boss = persona(manager, 'manager');
const overview: StaffOverview = {
  units: [
    {
      unitId,
      unitLabel: 'Enheten',
      people: [
        {
          id: employee,
          name: 'Synthetic Anställd',
          userName: `e2e.${tag}`,
          email: null,
          role: 'employee',
          enabled: true,
        },
      ],
    },
  ],
};
const store = talkStoreWithCards(options, { clock });
const usecases = (s: TalkStore) =>
  talkUsecases({
    store: s,
    staff: async p => (p.id === manager ? overview : { units: [] }),
    manages: async (managerId, employeeId) => managerId === manager && employeeId === employee,
    bookings: async () => new Map(),
    clock,
    ids,
  });
const talks = usecases(store);
const threadIds: string[] = [];

afterAll(async () => {
  const db = database();
  const rounds = (
    await db
      .select({ id: schema.talkRounds.id })
      .from(schema.talkRounds)
      .where(eq(schema.talkRounds.organisationId, ORG))
  ).map(r => r.id);
  await db
    .delete(schema.audit)
    .where(
      or(
        inArray(schema.audit.subject, [
          `organisation:${ORG}`,
          `person:${employee}`,
          ...rounds.map(id => `round:${id}`),
          ...threadIds.flatMap(id => [`thread:${id}`, `timer:${dueTimerId(id)}`]),
        ]),
        inArray(
          schema.audit.subject,
          Array.from({ length: n }, (_, i) => [
            `commitment:talks-e2e-${tag}-${i + 1}`,
            `talk:talks-e2e-${tag}-${i + 1}`,
          ]).flat(),
        ),
      ),
    );
  if (rounds.length) {
    await db.delete(schema.talkCommitments).where(inArray(schema.talkCommitments.roundId, rounds));
    await db.delete(schema.talks).where(inArray(schema.talks.roundId, rounds));
    await db.delete(schema.talkRounds).where(inArray(schema.talkRounds.id, rounds));
  }
  await db.delete(schema.workOccurrences).where(inArray(schema.workOccurrences.personId, [manager, employee]));
  await db.delete(schema.threads).where(inArray(schema.threads.personId, [manager, employee]));
  await db.delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, [manager, employee, ...assigned]));
  await db.delete(schema.assignments).where(inArray(schema.assignments.personId, assigned));
  await db.delete(schema.units).where(inArray(schema.units.id, [unitA, unitB]));
  await db
    .delete(schema.people)
    .where(inArray(schema.people.id, [manager, employee, named, nameless, foreign, ...assigned]));
  await forgetTestWorkflows();
  await closeDatabase();
});

async function card(threadId: string) {
  const db = database();
  const [thread] = await db.select().from(schema.threads).where(eq(schema.threads.id, threadId));
  const messages = await db.select().from(schema.threadMessages).where(eq(schema.threadMessages.threadId, threadId));
  const deliveries = await db.select().from(schema.deliveries).where(eq(schema.deliveries.threadId, threadId));
  const [timer] = await db
    .select()
    .from(schema.timerIntents)
    .where(eq(schema.timerIntents.id, dueTimerId(threadId)));
  return { thread, messages, deliveries, timer };
}
const commitmentRow = async (id: string) =>
  (await database().select().from(schema.talkCommitments).where(eq(schema.talkCommitments.id, id)))[0];
const auditOf = (subjects: string[]) =>
  database().select().from(schema.audit).where(inArray(schema.audit.subject, subjects)).orderBy(schema.audit.id);

describe('the talks module on Postgres through the composition store (D96)', () => {
  test('setup: two synthetic people with grants and an open round', async () => {
    await database()
      .insert(schema.people)
      .values([
        { id: manager, organisationId: ORG, name: `Synthetic Chef ${tag}` },
        { id: employee, organisationId: ORG, name: 'Synthetic Anställd', userName: `e2e.${tag}` },
      ]);
    await database()
      .insert(schema.accessGrants)
      .values([
        { personId: manager, unitId, unitLabel: 'Enheten', role: 'manager', capabilities: [] },
        { personId: employee, unitId, unitLabel: 'Enheten', role: 'employee', capabilities: [] },
      ]);
    await talks.openRound('operator:cli', {
      organisationId: ORG,
      label: 'Omgång',
      opensOn: '2026-01-01',
      dueOn: '2026-06-30',
    });
  });

  test('a throw inside the same transaction leaves no action point, card, timer, workflow or audit row', async () => {
    const failing: TalkStore = {
      transaction: fn =>
        store.transaction(async tx => {
          await fn(tx);
          throw new Error('after the action point');
        }),
    };
    const before = n;
    await expect(
      usecases(failing).addCommitment(boss, employee, { owner: 'employee', text: TEXT, dueOn: '2026-03-05' }),
    ).rejects.toThrow('after the action point');
    // The use case drew the action point's id and then the card's.
    const id = `talks-e2e-${tag}-${before + 1}`,
      threadId = `talks-e2e-${tag}-${before + 2}`;
    threadIds.push(threadId);
    expect(await commitmentRow(id)).toBeUndefined();
    const c = await card(threadId);
    expect([c.thread, c.timer, c.messages, c.deliveries]).toEqual([undefined, undefined, [], []]);
    expect(await auditOf([`commitment:${id}`, `thread:${threadId}`])).toEqual([]);
    expect(await enqueuedWorkflows(dueTimerId(threadId))).toEqual([]);
  });

  let id = '',
    threadId = '';
  test('adding an action point commits the row with its text sealed, the owner’s card, delivery, message, due timer, workflow and both audit rows', async () => {
    id = await talks.addCommitment(boss, employee, { owner: 'employee', text: TEXT, dueOn: '2026-03-05' });
    const row = (await commitmentRow(id))!;
    threadId = row.threadId!;
    threadIds.push(threadId);
    expect(row).toMatchObject({ employeeId: employee, ownerId: employee, ownerRole: 'employee', dueOn: '2026-03-05' });
    expect(row.textSealed).not.toBe(TEXT);
    expect(row.textSealed).not.toContain('arbetsrätt');
    const c = await card(threadId);
    expect(c.thread).toMatchObject({ personId: employee, state: 'open', connector: 'talks', deadline: '2026-03-05' });
    expect(c.deliveries.map(d => [d.id, d.kind])).toEqual([[`delivery:${threadId}`, 'automatic']]);
    expect(c.messages).toHaveLength(1);
    expect(c.timer).toMatchObject({ kind: 'due', state: 'active', generation: 1, personId: employee, unitId });
    expect((await enqueuedWorkflows(dueTimerId(threadId))).map(w => [w.id, w.status])).toEqual([
      [`${dueTimerId(threadId)}:v2:1`, 'ENQUEUED'],
    ]);
    expect((await auditOf([`commitment:${id}`, `thread:${threadId}`])).map(a => [a.action, a.subject])).toEqual([
      ['thread.pushed', `thread:${threadId}`],
      ['talks.commitment_added', `commitment:${id}`],
    ]);
    // The card and the audit rows carry no text and no name.
    const stored = JSON.stringify({ c, audit: await auditOf([`commitment:${id}`, `thread:${threadId}`]) });
    expect(stored).not.toContain('arbetsrätt');
    expect(stored).not.toContain('Synthetic');
    // The use case reads the text back opened.
    expect((await talks.commitments(boss, { person: `e2e.${tag}` })).rows.map(r => r.text)).toEqual([TEXT]);
  });

  test('done hands the card over and cancels its timer; reopened brings both back', async () => {
    now = new Date('2026-03-03T09:00:00.000Z');
    await talks.completeCommitment(persona(employee, 'employee'), id);
    let c = await card(threadId);
    expect((await commitmentRow(id))!.doneBy).toBe(employee);
    expect(c.thread).toMatchObject({ state: 'handled' });
    expect(c.timer).toMatchObject({ state: 'cancelled', generation: 1 });
    expect(cancelled).toContain(`${dueTimerId(threadId)}:v2:1`);
    // The employee's own point is hers to open again; her manager is refused (Q12).
    await expect(talks.reopenCommitment(boss, id)).rejects.toThrow('Du kan inte ändra den här åtgärdspunkten.');
    await talks.reopenCommitment(persona(employee, 'employee'), id);
    c = await card(threadId);
    expect((await commitmentRow(id))!.doneAt).toBeNull();
    expect(c.thread).toMatchObject({ state: 'open', handledAt: null });
    expect(c.timer).toMatchObject({ state: 'active', generation: 2 });
    expect((await auditOf([`commitment:${id}`])).map(a => a.action)).toEqual([
      'talks.commitment_added',
      'talks.commitment_done',
      'talks.commitment_reopened',
    ]);
  });

  test('the due timer at its active generation brings the card back once; a stale generation does nothing', async () => {
    now = new Date('2026-03-06T06:00:00.000Z'); // 07:00 in Stockholm, after the 06:00 on the day after the due date
    expect(await talks.commitmentDue(threadId, 1)).toBe(false);
    expect((await card(threadId)).timer).toMatchObject({ state: 'active', generation: 2 });
    expect(await talks.commitmentDue(threadId, 2)).toBe(true);
    const c = await card(threadId);
    expect(c.timer).toMatchObject({ state: 'fired', generation: 2 });
    expect(c.thread!.remindedAt?.toISOString()).toBe(now.toISOString());
    expect(c.deliveries.map(d => d.id).sort()).toEqual([`delivery:${threadId}`, `due:${threadId}:2`].sort());
    expect(await talks.commitmentDue(threadId, 2)).toBe(false);
    expect((await auditOf([`commitment:${id}`])).filter(a => a.action === 'talks.commitment_due')).toHaveLength(1);
  });

  test('the export carries the text; its audit row carries counts only', async () => {
    await talks.markHeld(boss, employee, { heldOn: '2026-03-02' });
    const document = await talks.exportDomain('operator:cli', ORG);
    expect(document.format).toBe('clew.talks/1');
    expect(document.commitments.map(c => c.text)).toEqual([TEXT]);
    expect(document.talks.map(t => t.employeeId)).toEqual([employee]);
    const [row] = await auditOf([`organisation:${ORG}`]);
    expect(row).toMatchObject({ actor: 'operator:cli', action: 'talks.exported' });
    expect(row!.details).toEqual({ rounds: 1, talks: 1, commitments: 1 });
  });

  test('erasing the employee leaves no talk, action point or card of theirs in any table', async () => {
    expect(await talks.erasePerson('operator:cli', employee)).toEqual({
      talks: 1,
      commitments: 1,
      cleared: 0,
      cards: 1,
    });
    const db = database();
    expect(await db.select().from(schema.talks).where(eq(schema.talks.employeeId, employee))).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.talkCommitments)
        .where(or(eq(schema.talkCommitments.employeeId, employee), eq(schema.talkCommitments.ownerId, employee))),
    ).toEqual([]);
    const c = await card(threadId);
    expect([c.thread, c.timer, c.messages, c.deliveries]).toEqual([undefined, undefined, [], []]);
    expect(await db.select().from(schema.threads).where(eq(schema.threads.personId, employee))).toEqual([]);
    const [erased] = await auditOf([`person:${employee}`]);
    expect(erased).toMatchObject({
      action: 'talks.person_erased',
      details: { talks: 1, commitments: 1, cleared: 0, cards: 1 },
    });
  });

  test('the seam finds the employee of a former manager’s point by user name in any case, or by id for a person provisioned without one, in the reader’s organisation only (M2)', async () => {
    await database()
      .insert(schema.people)
      .values([
        { id: named, organisationId: ORG, name: 'Synthetic Namngiven', userName: `e2e.named.${tag}` },
        { id: nameless, organisationId: ORG, name: 'Synthetic Utan användarnamn' },
        { id: foreign, organisationId: `${ORG}-other`, name: 'Synthetic Annan organisation' },
      ]);
    const reader = { id: manager, name: 'Synthetic Chef', unitId, unitLabel: 'Enheten', role: 'manager' as const };
    const found = await talkHolders(reader, [`E2E.Named.${tag}`, nameless, foreign, `nobody-${tag}`]);
    expect(Object.fromEntries(found)).toEqual({ [`E2E.Named.${tag}`]: named, [nameless]: nameless });
    // A reader the people table does not hold finds nobody.
    expect((await talkHolders({ ...reader, id: `missing-${tag}` }, [`e2e.named.${tag}`, nameless])).size).toBe(0);
  });

  test('whether an action point’s owner still manages the employee is read from their assignments and grant now (Q12)', async () => {
    const db = database();
    await db.insert(schema.people).values([
      { id: current, organisationId: ORG, name: 'Synthetic Nuvarande chef' },
      { id: moved, organisationId: ORG, name: 'Synthetic Flyttad chef' },
      { id: gone, organisationId: ORG, name: 'Synthetic Avaktiverad chef', enabled: false },
      { id: staffer, organisationId: ORG, name: 'Synthetic Medarbetare', userName: `e2e.staffer.${tag}` },
    ]);
    await db.insert(schema.units).values([
      { id: unitA, organisationId: ORG, label: 'Enhet A' },
      { id: unitB, organisationId: ORG, label: 'Enhet B' },
    ]);
    // The deactivated manager keeps her assignment and grant: only her being active is gone.
    await db.insert(schema.assignments).values([
      { personId: current, unitId: unitA, role: 'manager' },
      { personId: gone, unitId: unitA, role: 'manager' },
      { personId: moved, unitId: unitB, role: 'manager' },
      { personId: staffer, unitId: unitA, role: 'employee' },
    ]);
    await db.insert(schema.accessGrants).values([
      { personId: current, unitId: unitA, unitLabel: 'Enhet A', role: 'manager', capabilities: [] },
      { personId: gone, unitId: unitA, unitLabel: 'Enhet A', role: 'manager', capabilities: [] },
      { personId: moved, unitId: unitB, unitLabel: 'Enhet B', role: 'manager', capabilities: [] },
      { personId: staffer, unitId: unitA, unitLabel: 'Enhet A', role: 'employee', capabilities: [] },
    ]);
    expect(await talkManages(current, staffer)).toBe(true);
    // A manager moved to another unit, a deactivated one, someone unknown and the employee herself manage nobody here.
    expect(await talkManages(moved, staffer)).toBe(false);
    expect(await talkManages(gone, staffer)).toBe(false);
    expect(await talkManages(`nobody-${tag}`, staffer)).toBe(false);
    expect(await talkManages(staffer, staffer)).toBe(false);
    expect(await talkManages(current, current)).toBe(false);
    // The moved manager comes back to the unit: she manages the employee again at once.
    await db.insert(schema.assignments).values({ personId: moved, unitId: unitA, role: 'manager' });
    expect(await talkManages(moved, staffer)).toBe(true);
    // A deactivated employee is nobody's to manage.
    await db.update(schema.people).set({ enabled: false }).where(eq(schema.people.id, staffer));
    expect(await talkManages(current, staffer)).toBe(false);
  });
});
