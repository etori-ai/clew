import { afterAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { database, databaseAnswers, schema, closeDatabase } from '../../packages/db/src';
import { memoryCalendar } from '../../packages/calendar/src/memory';
import type { AuthenticatedContext } from '../../packages/contracts/src';
import { postgresProposalStore } from '../../apps/server/src/modules/calendar/adapters/postgres';
import { postgresExecutionStore } from '../../apps/server/src/modules/executions/adapters/postgres';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import {
  calendarDecisions,
  calendarExecutionSource,
  type CalendarCommand,
} from '../../apps/server/src/modules/calendar/usecases/decisions';
import { bookedElsewhere, teamsOf } from '../../apps/server/src/modules/calendar/usecases/booked';
import type { PlanningRound, UnitMember } from '../../apps/server/src/modules/calendar/model';
import { projectExecution } from '../../apps/server/src/composition/execution-projection';
import { invitationTeams } from '../../apps/server/src/composition/calendar';
import { forgetTestWorkflows, testDurable } from './durable';
import { sealSecret, openSecret } from '../../apps/server/src/auth-crypto';
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;
const people: string[] = [],
  at = '2098-11-05T09:00:00.000Z';
/** The directory: whom each manager of this file has in their team now, by the manager's id. */
const teams = new Map<string, UnitMember[]>();
/** The rows a test wrote to Clew's own directory, as Personal reads it: units, and the people placed on them. */
const directory = { units: [] as string[], people: [] as string[] };
afterAll(async () => {
  const placed = [...people, ...directory.people];
  if (placed.length) {
    await database().delete(schema.assignments).where(inArray(schema.assignments.personId, placed));
    await database().delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, placed));
  }
  if (directory.units.length) await database().delete(schema.units).where(inArray(schema.units.id, directory.units));
  if (directory.people.length)
    await database().delete(schema.people).where(inArray(schema.people.id, directory.people));
  if (people.length) {
    const executions = await database()
      .select()
      .from(schema.executions)
      .where(inArray(schema.executions.personId, people));
    const threads = await database().select().from(schema.threads).where(inArray(schema.threads.personId, people));
    const ids = executions.map(e => e.id);
    if (ids.length) {
      await database().delete(schema.dispatchOutbox).where(inArray(schema.dispatchOutbox.executionId, ids));
      await database()
        .delete(schema.jobs)
        .where(
          inArray(
            schema.jobs.id,
            ids.flatMap(id => ['receipt-final:' + id, 'undo-expiry:' + id]),
          ),
        );
      await database().delete(schema.executions).where(inArray(schema.executions.id, ids));
    }
    const subjects = [...ids.map(id => 'execution:' + id), ...threads.map(t => 'thread:' + t.id)];
    if (subjects.length) await database().delete(schema.audit).where(inArray(schema.audit.subject, subjects));
    await database().delete(schema.threads).where(inArray(schema.threads.personId, people));
    await database().delete(schema.people).where(inArray(schema.people.id, people));
  }
  await forgetTestWorkflows();
  await closeDatabase();
});
/**
 * One manager's world. `teams` binds whom the approval's projection asks another manager manages: by default this
 * file's directory in memory, or the binding composition uses, over Clew's own directory tables.
 */
async function world(options: { teams?: Parameters<typeof projectExecution>[1] } = {}) {
  const id = 'calendar-test-' + randomUUID();
  people.push(id);
  await database().insert(schema.people).values({ id, name: 'Synthetic calendar test', organisationId: 'test' });
  const actor = {
    id,
    name: 'Test',
    unitId: 'test',
    unitLabel: 'Test',
    role: 'manager',
    organisationId: 'test',
    principal: { id: 'person:' + id, kind: 'person' },
    authorizationVersion: 'v1',
    capabilities: [],
    sessionBinding: 'test',
    expiresAt: '2099-01-01',
    authorize: async () => ({ version: 'v1' }),
  } as AuthenticatedContext;
  const provider = memoryCalendar({ ref: 'test', email: 'owner@example.test', name: 'Test' });
  const bind = () => ({ provider });
  // The team as the directory has it now; a test may change an address.
  const members = [1, 2].map(n => ({
    ref: 'guest' + n,
    personId: 'guest' + n,
    email: `guest${n}@example.test`,
    name: 'Guest ' + n,
  }));
  teams.set(id, members);
  const team = async (p: AuthenticatedContext) => teams.get(p.id) ?? [];
  // The open round, the other managers' identities for a person with two managers (M1), none by default; the time; and
  // the identity the ledger finds for this manager when it sends.
  const setting = {
    round: null as PlanningRound | null,
    personas: new Map<string, AuthenticatedContext>(),
    now: at,
    current: actor,
  };
  const clock = () => new Date(setting.now);
  const round = async () => setting.round;
  const owners = { personaFor: async (id: string) => setting.personas.get(id) };
  const proposals = postgresProposalStore(testDurable);
  let failCommit = false;
  const project = projectExecution(testDurable, options.teams ?? (() => teamsOf({ team, people: owners })));
  const store = postgresExecutionStore({ seal: sealSecret, open: openSecret }, testDurable, async (tx, e, stage) => {
    await project(tx, e, stage);
    if (failCommit && e.state === 'succeeded') {
      failCommit = false;
      throw new Error('simulated database receipt failure');
    }
  });
  const uc = executionUsecases({
    store,
    source: {
      ...calendarExecutionSource(bind, team, bookedElsewhere({ store: proposals, team, people: owners })),
      current: async () => setting.current,
    },
    clock,
    ids: randomUUID,
    digest: x => JSON.stringify(canonical(x)),
  });
  const decisions = calendarDecisions({
    store: proposals,
    bind,
    team,
    round,
    people: owners,
    clock,
    ids: randomUUID,
    approve: uc.approve,
    previous: async (p, id) => {
      const e = await store.readDecision(p.id, id);
      return e ? { operation: e.operation, payload: e.payload as CalendarCommand } : undefined;
    },
  });
  const input = {
    decisionId: randomUUID(),
    title: 'Synthetic booking',
    start: '2098-11-10T09:00:00.000Z',
    end: '2098-11-10T10:00:00.000Z',
    participants: ['guest1@example.test'],
  };
  return {
    id,
    actor,
    provider,
    members,
    setting,
    store,
    proposals,
    uc,
    decisions,
    input,
    failNextCommit: () => {
      failCommit = true;
    },
  };
}
test('calendar approval creates its card atomically; a source commit before a failed receipt commit is read back', async () => {
  const w = await world();
  const [a, b] = await Promise.all([
    w.decisions.createEvent(w.actor, w.input),
    w.decisions.createEvent(w.actor, w.input),
  ]);
  expect(a.id).toBe(b.id);
  expect(a.execution?.state).toBe('pending');
  expect(w.provider.events).toHaveLength(0);
  w.failNextCommit();
  await w.uc.progress(a.execution!.id);
  expect((await w.store.read(a.execution!.id))?.state).toBe('unknown');
  expect(w.provider.events).toHaveLength(1);
  await w.uc.progress(a.execution!.id);
  expect((await w.store.read(a.execution!.id))?.state).toBe('succeeded');
  expect(w.provider.events).toHaveLength(1);
  expect((await w.proposals.readThread(w.id, a.id))?.thread.receipt?.rows[0]?.outcome).toBe('done');
  await expect(w.decisions.createEvent(w.actor, { ...w.input, title: 'Different approval' })).rejects.toThrow(
    'annat innehåll',
  );
  const event = w.provider.events[0]!,
    cancel = { decisionId: randomUUID(), ref: event.ref, revision: event.revision };
  const cancelled = await w.decisions.cancelEvent(w.actor, cancel);
  await w.uc.progress(cancelled.execution!.id);
  expect(w.provider.events).toHaveLength(0);
  expect((await w.decisions.cancelEvent(w.actor, cancel)).execution?.state).toBe('succeeded');
});
/** A planning thread with one drawn proposal for each guest. */
async function seedThread(w: Awaited<ReturnType<typeof world>>) {
  const threadId = randomUUID();
  await w.proposals.transaction(async tx => {
    await tx.insertThread({
      id: threadId,
      personId: w.id,
      topic: threadId,
      title: 'Samtal',
      week: '2098-11-10',
      area: 'calendar',
      summary: '',
      trigger: { reason: 'Test', source: 'Test', at },
      createdAt: at,
      updatedAt: at,
    });
    await tx.insertProposals(
      [1, 2].map(n => ({
        id: threadId + ':p' + n,
        threadId,
        personId: w.id,
        status: 'proposed',
        participant: { personId: 'guest' + n, email: `guest${n}@example.test`, name: 'Guest ' + n },
        start: `2098-11-10T${8 + n}:00:00.000Z`.replace('T9:', 'T09:'),
        end: `2098-11-10T${9 + n}:00:00.000Z`,
        eventRef: null,
        eventUid: null,
        eventRevision: null,
        confirmedAt: null,
        undoUntil: null,
        reminders: 0,
        remindedAt: null,
      })),
    );
  });
  return threadId;
}
test('partial confirmation persists per-item evidence and policy; reconciliation never repeats successful items', async () => {
  const w = await world(),
    threadId = await seedThread(w);
  const create = w.provider.create.bind(w.provider);
  w.provider.create = async (uid, input) => {
    if (uid.endsWith(':p2')) throw new Error('offline');
    return create(uid, input);
  };
  const selected = [1, 2].map(n => threadId + ':p' + n);
  const [a, b] = await Promise.all([
    w.decisions.confirm(w.actor, threadId, selected),
    w.decisions.confirm(w.actor, threadId, selected),
  ]);
  expect(a.execution?.id).toBe(b.execution?.id);
  expect(
    (await database().select().from(schema.followupPolicies).where(eq(schema.followupPolicies.threadId, threadId)))[0]
      ?.maxReminders,
  ).toBe(2);
  await w.uc.progress(a.execution!.id);
  const result = (await w.proposals.readThread(w.id, threadId))!;
  expect(result.thread.execution?.state).toBe('unknown');
  expect(result.proposals.map(p => p.status)).toEqual(['confirmed', 'proposed']);
  expect(result.thread.receipt?.rows.map(r => r.outcome)).toEqual(['done', 'unknown']);
  await w.uc.progress(a.execution!.id);
  expect(w.provider.events).toHaveLength(1);
});
test('a proposal keeps its invitee and address through approval and skips a reassigned address at dispatch', async () => {
  const w = await world(),
    threadId = await seedThread(w);
  const t = (await w.proposals.readThread(w.id, threadId))!.thread;
  // An approval whose invitee is not the proposal's, though on the team, is refused at the projection.
  const forged: CalendarCommand = {
    items: [
      {
        id: threadId + ':p1',
        proposalId: threadId + ':p1',
        personId: 'guest2',
        label: 'Guest 1',
        action: 'create',
        input: {
          title: 'Utvecklingssamtal · Guest 1',
          start: '2098-11-10T09:00:00.000Z',
          end: '2098-11-10T10:00:00.000Z',
          participants: ['guest1@example.test'],
        },
      },
    ],
    threadId,
    followup: { afterWorkdays: 2, maxReminders: 2, expiresAt: '2098-12-05T09:00:00.000Z' },
  };
  await expect(
    w.uc.approve(w.actor, {
      decisionId: 'forged:' + threadId,
      operation: 'calendar.confirmProposals',
      payload: forged,
      presentation: { threadId, version: t.updatedAt, actionId: 'confirm' },
    }),
  ).rejects.toThrow('Förslaget har ändrats. Läs om sidan.');
  const approved = await w.decisions.confirm(w.actor, threadId, [threadId + ':p1']);
  w.members[0] = { ...w.members[0]!, ref: 'guest1-new', email: 'guest1.new@example.test' };
  w.members[1] = { ...w.members[1]!, ref: 'guest1-old', email: 'guest1@example.test' };
  await w.uc.progress(approved.execution!.id);
  const after = (await w.proposals.readThread(w.id, threadId))!;
  expect(after.thread).toMatchObject({ state: 'open', execution: { state: 'failed' } });
  expect(after.proposals.find(p => p.id === threadId + ':p1')).toMatchObject({
    status: 'proposed',
    participant: { personId: 'guest1', email: 'guest1@example.test', name: 'Guest 1' },
  });
  expect(w.provider.events).toEqual([]);
});
test('uncertain calendar compensation retains the original receipt and remains discoverable', async () => {
  const w = await world(),
    approved = await w.decisions.createEvent(w.actor, w.input);
  await w.uc.progress(approved.execution!.id);
  const before = (await w.proposals.readThread(w.id, approved.id))!.thread.receipt;
  const undo = await w.decisions.undo(w.actor, approved.id);
  w.provider.cancel = async () => {
    throw new Error('offline');
  };
  await w.uc.progress(undo.execution!.id);
  const current = (await w.proposals.readThread(w.id, approved.id))!.thread;
  expect(current.execution?.state).toBe('unknown');
  expect(current.receipt).toEqual(before);
  expect(w.provider.events).toHaveLength(1);
});
/** A planning card of this world's manager with one drawn time for this person. */
async function cardFor(w: Awaited<ReturnType<typeof world>>, member: UnitMember, start: string) {
  const threadId = randomUUID();
  await w.proposals.transaction(async tx => {
    await tx.insertThread({
      id: threadId,
      personId: w.id,
      topic: threadId,
      title: 'Samtal',
      week: '2098-11-10',
      area: 'calendar',
      summary: '',
      trigger: { reason: 'Test', source: 'Test', at },
      createdAt: at,
      updatedAt: at,
    });
    await tx.insertProposals([
      {
        id: threadId + ':shared',
        threadId,
        personId: w.id,
        status: 'proposed',
        participant: { personId: member.personId, email: member.email, name: member.name },
        start,
        end: new Date(Date.parse(start) + 3_600_000).toISOString(),
        eventRef: null,
        eventUid: null,
        eventRevision: null,
        confirmedAt: null,
        undoUntil: null,
        reminders: 0,
        remindedAt: null,
      },
    ]);
  });
  return threadId;
}
/**
 * Two managers, A and B, of one person in the open round, each with a card drawn before either booked: each holds a time
 * for the shared person, A's on 11 November and B's on 12 November.
 */
async function sharedPair(options: Parameters<typeof world>[0] = {}) {
  const a = await world(options),
    b = await world(options);
  const key = 'shared-' + randomUUID();
  const shared: UnitMember = { personId: key, ref: key, email: key + '@example.test', name: 'Delad Medarbetare' };
  const round: PlanningRound = { label: 'Synthetic round', opensOn: '2098-11-01', dueOn: '2098-11-30', held: [] };
  for (const w of [a, b]) {
    w.members.push(shared);
    w.setting.round = round;
    w.setting.personas.set(a.id, a.actor).set(b.id, b.actor);
  }
  const cards = await Promise.all([
    cardFor(a, shared, '2098-11-11T09:00:00.000Z'),
    cardFor(b, shared, '2098-11-12T09:00:00.000Z'),
  ]);
  const confirm = (w: typeof a, card: string) => w.decisions.confirm(w.actor, card, [card + ':shared']);
  return { a, b, shared, cards, confirmA: () => confirm(a, cards[0]), confirmB: () => confirm(b, cards[1]) };
}
const sentTo = (w: Awaited<ReturnType<typeof world>>) => w.provider.events.map(e => e.participants.map(p => p.email));
test('two managers of one person confirm at once: one invitation is approved and sent, the other refused by name with nothing written (M1, Q12)', async () => {
  const { a, b, shared, cards } = await sharedPair();
  const results = await Promise.allSettled([
    a.decisions.confirm(a.actor, cards[0], [cards[0] + ':shared']),
    b.decisions.confirm(b.actor, cards[1], [cards[1] + ':shared']),
  ]);
  expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  const won = results.findIndex(r => r.status === 'fulfilled');
  const [winner, loser] = won === 0 ? [a, b] : [b, a];
  const [winning, losing] = won === 0 ? cards : [cards[1], cards[0]];
  expect((results[1 - won] as PromiseRejectedResult).reason.message).toBe(
    'Delad Medarbetare bjuds redan in till ett utvecklingssamtal av en annan chef.',
  );
  // The refused approval wrote nothing: no execution, no audit row, no follow-up policy, its card and proposal as drawn.
  const executionsOf = (id: string) =>
    database().select().from(schema.executions).where(eq(schema.executions.personId, id));
  expect(await executionsOf(loser.id)).toEqual([]);
  expect(await database().select().from(schema.audit).where(eq(schema.audit.actor, loser.actor.principal.id))).toEqual(
    [],
  );
  expect(
    await database().select().from(schema.followupPolicies).where(eq(schema.followupPolicies.threadId, losing)),
  ).toEqual([]);
  const refused = (await loser.proposals.readThread(loser.id, losing))!;
  expect(refused.thread.execution ?? null).toBeNull();
  expect(refused.proposals.map(p => p.status)).toEqual(['proposed']);
  // The approved one is sent once, to the shared person, and books them.
  const [approved] = await executionsOf(winner.id);
  expect(
    (
      await database()
        .select()
        .from(schema.audit)
        .where(eq(schema.audit.subject, 'execution:' + approved!.id))
    ).map(x => x.action),
  ).toContain('execution.approved');
  await winner.uc.progress(approved!.id);
  expect(winner.provider.events.map(e => e.participants.map(p => p.email))).toEqual([[shared.email]]);
  expect(loser.provider.events).toEqual([]);
  expect((await winner.proposals.readThread(winner.id, winning))!.proposals.map(p => p.status)).toEqual(['confirmed']);
  // Once it is booked, the other manager's confirmation is refused before anything is approved, by the booking.
  await expect(loser.decisions.confirm(loser.actor, losing, [losing + ':shared'])).rejects.toThrow(
    'Delad Medarbetare har redan ett utvecklingssamtal bokat med en annan chef.',
  );
  expect(await executionsOf(loser.id)).toEqual([]);
  expect(loser.provider.events).toEqual([]);
});
test('an invitation the dispatch refused because the time is no longer free was never sent: it holds nobody, the other manager sends one, and the first card can be decided again (M1)', async () => {
  const pair = await sharedPair(),
    { a, b, shared, cards } = pair;
  // When A's approved invitation is about to be sent, the shared person is busy at A's time.
  a.provider.options.busy[shared.ref] = [{ start: '2098-11-11T09:00:00.000Z', end: '2098-11-11T10:00:00.000Z' }];
  const first = await pair.confirmA();
  await a.uc.progress(first.execution!.id);
  const refused = (await a.proposals.readThread(a.id, cards[0]))!;
  expect(refused.thread).toMatchObject({
    state: 'open',
    execution: { state: 'failed', reason: null },
    receipt: { rows: [{ outcome: 'skipped', detail: 'Inget skickades: tiden kunde inte bekräftas som ledig.' }] },
  });
  expect(refused.proposals.map(p => p.status)).toEqual(['proposed']);
  expect(a.provider.events).toEqual([]);
  // B confirms in the same round, and the invitation is sent.
  const second = await pair.confirmB();
  expect(second.execution?.state).toBe('pending');
  await b.uc.progress(second.execution!.id);
  expect(sentTo(b)).toEqual([[shared.email]]);
  // A's card waits for no decision: A may decide again, and B's booking now refuses a second talk.
  await expect(pair.confirmA()).rejects.toThrow(
    'Delad Medarbetare har redan ett utvecklingssamtal bokat med en annan chef.',
  );
});
test('an approval whose manager lost the authority to send it before it was sent holds nobody (M1)', async () => {
  const pair = await sharedPair(),
    { a, b, shared } = pair;
  const first = await pair.confirmA();
  // A's grants change before the invitation is sent: the ledger settles it unsent, and nothing will send it.
  a.setting.current = { ...a.actor, authorizationVersion: 'v2' };
  await a.uc.progress(first.execution!.id);
  expect(await a.store.read(first.execution!.id)).toMatchObject({ state: 'pending', reason: 'authority-revoked' });
  const second = await pair.confirmB();
  await b.uc.progress(second.execution!.id);
  expect(sentTo(a)).toEqual([]);
  expect(sentTo(b)).toEqual([[shared.email]]);
});
test('an invitation whose result is unknown holds the person for its approval’s 24 hours, inside its round, and while its manager manages them (M1)', async () => {
  /** A's invitation goes to the calendar, which loses the answer and has nothing to read back: it may have been sent. */
  async function uncertain() {
    const pair = await sharedPair();
    pair.a.provider.create = async () => {
      throw new Error('offline');
    };
    const first = await pair.confirmA();
    await pair.a.uc.progress(first.execution!.id);
    expect(await pair.a.store.read(first.execution!.id)).toMatchObject({ state: 'unknown', reason: null });
    return pair;
  }
  const refusal = 'Delad Medarbetare bjuds redan in till ett utvecklingssamtal av en annan chef.';
  // While it may have been sent, the other manager is refused, and after the approval's 24 hours is not.
  const held = await uncertain();
  await expect(held.confirmB()).rejects.toThrow(refusal);
  held.b.setting.now = new Date(Date.parse(at) + 24 * 3_600_000 + 60_000).toISOString();
  expect((await held.confirmB()).execution?.state).toBe('pending');
  // A manager who no longer manages the person holds nothing for them.
  const moved = await uncertain();
  teams.set(
    moved.a.id,
    moved.a.members.filter(m => m.personId !== moved.shared.personId),
  );
  expect((await moved.confirmB()).execution?.state).toBe('pending');
  // Nor does an invitation in another round than the one the confirmation is in.
  const later = await uncertain();
  later.b.setting.round = { label: 'Next round', opensOn: '2098-12-01', dueOn: '2098-12-31', held: [] };
  const next = await cardFor(later.b, later.shared, '2098-12-10T09:00:00.000Z');
  expect((await later.b.decisions.confirm(later.b.actor, next, [next + ':shared'])).execution?.state).toBe('pending');
});
test('more approvals at once that find another manager’s invitation on its way than the pool has connections all finish: the directory is read through the approval’s own transaction (M1, L1)', async () => {
  const refusal = 'Delad Medarbetare bjuds redan in till ett utvecklingssamtal av en annan chef.';
  /**
   * A pair whose manager A has the shared person on a unit in Clew's own directory, as Personal reads it, and whose
   * approved invitation to them is unknown: it may still be sent, so B's confirmation must ask whom A manages.
   */
  async function onItsWay() {
    const pair = await sharedPair({ teams: invitationTeams });
    const unit = 'unit-calendar-test-' + randomUUID();
    directory.units.push(unit);
    directory.people.push(pair.shared.personId);
    const db = database();
    await db
      .insert(schema.people)
      .values({ id: pair.shared.personId, organisationId: 'test', name: pair.shared.name, email: pair.shared.email });
    await db.insert(schema.units).values({ id: unit, organisationId: 'test', label: 'Synthetic unit' });
    await db.insert(schema.assignments).values([
      { personId: pair.a.id, unitId: unit, role: 'manager' },
      { personId: pair.shared.personId, unitId: unit, role: 'employee' },
    ]);
    await db
      .insert(schema.accessGrants)
      .values({ personId: pair.a.id, unitId: unit, unitLabel: 'Synthetic unit', role: 'manager', capabilities: [] });
    pair.a.provider.create = async () => {
      throw new Error('offline');
    };
    const first = await pair.confirmA();
    await pair.a.uc.progress(first.execution!.id);
    expect(await pair.a.store.read(first.execution!.id)).toMatchObject({ state: 'unknown', reason: null });
    return pair;
  }
  /** What the confirmations came to, or "stuck" when they had not all finished after ten seconds. */
  const settled = <T>(work: Promise<T>) =>
    Promise.race([work, new Promise<'stuck'>(resolve => setTimeout(() => resolve('stuck'), 10_000))]);
  const reasons = (results: PromiseSettledResult<unknown>[]) =>
    results.map(r => (r.status === 'rejected' ? (r.reason as Error).message : 'approved'));
  // Twice the pool's five connections, each B confirming while its A's invitation is on its way. Each approval holds a
  // connection and its invitee's lock while it asks whom A manages: an ask that waited for a connection of its own would
  // wait for good once five of them held every one.
  const pairs: Awaited<ReturnType<typeof onItsWay>>[] = [];
  for (let i = 0; i < 10; i++) pairs.push(await onItsWay());
  const all = await settled(Promise.allSettled(pairs.map(pair => pair.confirmB())));
  expect(all).not.toBe('stuck');
  if (all === 'stuck') return;
  expect(reasons(all)).toEqual(pairs.map(() => refusal));
  // One card confirmed six times at once: the first approval asks while the other five wait for its lock, each holding a
  // connection.
  const one = await onItsWay();
  const same = await settled(Promise.allSettled(Array.from({ length: 6 }, () => one.confirmB())));
  expect(same).not.toBe('stuck');
  if (same === 'stuck') return;
  expect(reasons(same)).toEqual(Array.from({ length: 6 }, () => refusal));
  // Nothing was approved for any B, and the pool serves the next request.
  for (const { b } of [...pairs, one])
    expect(await database().select().from(schema.executions).where(eq(schema.executions.personId, b.id))).toEqual([]);
  expect(await databaseAnswers(1000)).toBe(true);
  // A leaves the unit and manages none: Personal's overview refuses inside the approval's transaction, A manages nobody,
  // and B's confirmation is approved in the same transaction.
  await database().delete(schema.assignments).where(eq(schema.assignments.personId, one.a.id));
  expect((await one.confirmB()).execution?.state).toBe('pending');
}, 60_000);
