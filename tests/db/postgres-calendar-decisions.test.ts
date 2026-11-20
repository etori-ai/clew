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
import { bookedElsewhere } from '../../apps/server/src/modules/calendar/usecases/booked';
import { FOLLOW_MS, invitationUsecases } from '../../apps/server/src/modules/calendar/usecases/invitations';
import { talkInvitationsOn } from '../../apps/server/src/composition/talk-invitations';
import type { PlanningRound, UnitMember } from '../../apps/server/src/modules/calendar/model';
import { projectExecution } from '../../apps/server/src/composition/execution-projection';
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
afterAll(async () => {
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
async function world() {
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
  // The open round, the other managers' identities for a person with two managers (M1), none by default; the time; and
  // the identity the ledger finds for this manager when it sends.
  const setting = {
    round: null as PlanningRound | null,
    personas: new Map<string, AuthenticatedContext>(),
    now: at,
    current: actor,
    teamUnavailable: false,
  };
  const team = async (p: AuthenticatedContext) => {
    if (setting.teamUnavailable) throw new Error('directory unavailable');
    return teams.get(p.id) ?? [];
  };
  const clock = () => new Date(setting.now);
  const round = async () => setting.round;
  const owners = { personaFor: async (id: string) => setting.personas.get(id) };
  const proposals = postgresProposalStore(testDurable);
  let failCommit = false;
  const project = projectExecution(testDurable);
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
  // What the item waits on, without the words every reader puts before it ("Väntar på …").
  expect(a.waitingOn).toBe('källans besked');
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
async function sharedPair() {
  const a = await world(),
    b = await world();
  const key = 'shared-' + randomUUID();
  const shared: UnitMember = { personId: key, ref: key, email: key + '@example.test', name: 'Delad Medarbetare' };
  const round: PlanningRound = {
    label: 'Synthetic round',
    opensOn: '2098-11-01',
    dueOn: '2098-11-30',
    held: [],
    booked: [],
  };
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
/**
 * A manager and an employee of one organisation with an open round of talks, and a card with one drawn time for the
 * employee on 11 November: what an invitation to a talk needs for the talks module to record it (D132).
 */
async function talkWorld() {
  const w = await world();
  const org = 'calendar-talks-' + randomUUID(),
    employeeId = 'calendar-test-' + randomUUID(),
    roundId = 'calendar-round-' + randomUUID();
  people.push(employeeId);
  await database().update(schema.people).set({ organisationId: org }).where(eq(schema.people.id, w.id));
  await database().insert(schema.people).values({ id: employeeId, name: 'Synthetic employee', organisationId: org });
  await database().insert(schema.talkRounds).values({
    id: roundId,
    organisationId: org,
    kind: 'development',
    label: 'Synthetic round',
    opensOn: '2098-11-01',
    dueOn: '2098-11-30',
    createdBy: 'operator:test',
  });
  const member: UnitMember = {
    personId: employeeId,
    ref: employeeId,
    email: employeeId + '@example.test',
    name: 'Synthetic employee',
  };
  w.members.push(member);
  w.setting.round = { label: 'Synthetic round', opensOn: '2098-11-01', dueOn: '2098-11-30', held: [], booked: [] };
  const card = await cardFor(w, member, '2098-11-11T09:00:00.000Z');
  const talk = async () =>
    (await database().select().from(schema.talks).where(eq(schema.talks.employeeId, employeeId)))[0];
  const audited = async () => {
    const row = await talk();
    return row
      ? database()
          .select()
          .from(schema.audit)
          .where(eq(schema.audit.subject, 'talk:' + row.id))
          .orderBy(schema.audit.id)
      : [];
  };
  /** The invitation is confirmed, sent and read back: the talk is booked by it. */
  const send = async () => {
    const confirmed = await w.decisions.confirm(w.actor, card, [card + ':shared']);
    await w.uc.progress(confirmed.execution!.id);
    return confirmed;
  };
  const cleanup = async () => {
    const rows = await database().select().from(schema.talks).where(eq(schema.talks.roundId, roundId));
    for (const row of rows)
      await database()
        .delete(schema.audit)
        .where(eq(schema.audit.subject, 'talk:' + row.id));
    await database().delete(schema.talks).where(eq(schema.talks.roundId, roundId));
    await database().delete(schema.talkRounds).where(eq(schema.talkRounds.id, roundId));
  };
  return { w, employeeId, roundId, card, talk, audited, send, cleanup };
}
test('an invitation read back from the calendar books the talk in the open round in the same commit, and undoing it takes the booking with it (D132)', async () => {
  const { w, employeeId, roundId, card, talk, audited, cleanup } = await talkWorld();
  try {
    const confirmed = await w.decisions.confirm(w.actor, card, [card + ':shared']);
    // Approved, not yet sent: nothing is booked.
    expect(await talk()).toBeUndefined();
    await w.uc.progress(confirmed.execution!.id);
    expect((await w.proposals.readThread(w.id, card))!.proposals.map(p => p.status)).toEqual(['confirmed']);
    const booked = (await talk())!;
    expect(booked).toMatchObject({ roundId, bookedBy: w.id, invitationId: card + ':shared', heldOn: null });
    expect([booked.bookedStart?.toISOString(), booked.bookedEnd?.toISOString()]).toEqual([
      '2098-11-11T09:00:00.000Z',
      '2098-11-11T10:00:00.000Z',
    ]);
    expect((await audited()).map(a => [a.actor, a.action, a.details])).toEqual([
      [
        'system:execution',
        'talks.booked',
        {
          roundId,
          employeeId,
          start: '2098-11-11T09:00:00.000Z',
          end: '2098-11-11T10:00:00.000Z',
          by: 'invitation',
          invitationId: card + ':shared',
          bookedBy: w.id,
          replaced: false,
        },
      ],
    ]);
    // A check of the same execution reads the invitation back again and books nothing twice.
    await w.uc.progress(confirmed.execution!.id);
    expect(await audited()).toHaveLength(1);
    // Undone inside the window: the invitation leaves the calendar and the talk lacks a time again.
    const undone = await w.decisions.undo(w.actor, card);
    await w.uc.progress(undone.execution!.id);
    expect(w.provider.events).toHaveLength(0);
    expect((await w.proposals.readThread(w.id, card))!.proposals.map(p => p.status)).toEqual(['undone']);
    expect(await talk()).toMatchObject({
      id: booked.id,
      bookedStart: null,
      bookedEnd: null,
      bookedBy: null,
      bookedAt: null,
      invitationId: null,
    });
    expect((await audited()).map(a => [a.action, (a.details as { why?: string }).why])).toEqual([
      ['talks.booked', undefined],
      ['talks.booking_removed', 'undone'],
    ]);
  } finally {
    await cleanup();
  }
});
test('a meeting moved or cancelled on the calendar page is found by its event’s ref: the invitation and the talk follow in the same commit (D133)', async () => {
  const { w, card, talk, audited, send, cleanup } = await talkWorld();
  try {
    await send();
    const event = w.provider.events[0]!;
    // The person moves the meeting on Clew's calendar page: a decision of its own, through the ledger.
    const moved = await w.decisions.rescheduleEvent(w.actor, {
      decisionId: randomUUID(),
      ref: event.ref,
      revision: event.revision,
      start: '2098-11-13T12:00:00.000Z',
      end: '2098-11-13T13:00:00.000Z',
    });
    // Approved, not yet carried out: the talk is where it was.
    expect((await talk())!.bookedStart?.toISOString()).toBe('2098-11-11T09:00:00.000Z');
    await w.uc.progress(moved.execution!.id);
    expect(w.provider.events[0]).toMatchObject({ start: '2098-11-13T12:00:00.000Z', end: '2098-11-13T13:00:00.000Z' });
    const proposal = async () => (await w.proposals.readThread(w.id, card))!.proposals[0]!;
    expect(await proposal()).toMatchObject({
      status: 'confirmed',
      start: '2098-11-13T12:00:00.000Z',
      end: '2098-11-13T13:00:00.000Z',
      eventRevision: w.provider.events[0]!.revision,
    });
    const after = (await talk())!;
    expect([after.bookedStart?.toISOString(), after.bookedEnd?.toISOString(), after.invitationId]).toEqual([
      '2098-11-13T12:00:00.000Z',
      '2098-11-13T13:00:00.000Z',
      card + ':shared',
    ]);
    // A check of the same execution reads the result again and moves nothing twice.
    await w.uc.progress(moved.execution!.id);
    expect((await audited()).map(a => a.action)).toEqual(['talks.booked', 'talks.booking_moved']);
    expect((await audited())[1]).toMatchObject({
      actor: 'system:execution',
      details: {
        invitationId: card + ':shared',
        from: { start: '2098-11-11T09:00:00.000Z', end: '2098-11-11T10:00:00.000Z' },
        start: '2098-11-13T12:00:00.000Z',
        end: '2098-11-13T13:00:00.000Z',
      },
    });
    const planning = await database()
      .select()
      .from(schema.audit)
      .where(eq(schema.audit.subject, 'thread:' + card))
      .orderBy(schema.audit.id);
    expect(planning.filter(a => a.action === 'proposals.moved').map(a => a.details)).toEqual([
      {
        proposal: card + ':shared',
        start: '2098-11-13T12:00:00.000Z',
        end: '2098-11-13T13:00:00.000Z',
        by: 'decision',
        executionId: moved.execution!.id,
      },
    ]);
    // Undoing the move is a move back, and takes the same path.
    const back = await w.decisions.undo(w.actor, moved.id);
    await w.uc.progress(back.execution!.id);
    expect((await talk())!.bookedStart?.toISOString()).toBe('2098-11-11T09:00:00.000Z');
    expect((await proposal()).start).toBe('2098-11-11T09:00:00.000Z');
    // Cancelling the meeting ends the invitation, and the talk lacks a time again.
    const current = w.provider.events[0]!;
    const cancelled = await w.decisions.cancelEvent(w.actor, {
      decisionId: randomUUID(),
      ref: current.ref,
      revision: current.revision,
    });
    await w.uc.progress(cancelled.execution!.id);
    expect(w.provider.events).toHaveLength(0);
    expect((await proposal()).status).toBe('undone');
    expect(await talk()).toMatchObject({ bookedStart: null, bookedEnd: null, invitationId: null });
    expect((await audited()).map(a => [a.action, (a.details as { why?: string }).why])).toEqual([
      ['talks.booked', undefined],
      ['talks.booking_moved', undefined],
      ['talks.booking_moved', undefined],
      ['talks.booking_removed', 'cancelled'],
    ]);
  } finally {
    await cleanup();
  }
});
test('a meeting changed in the calendar is read back by its id and settled by the manager, the invitation and the talk in one commit each (D133, D134)', async () => {
  const { w, employeeId, card, talk, audited, send, cleanup } = await talkWorld();
  // The calendar module's use cases over the proposal store as composition builds it: its invitations port is the talks
  // module's, on the store's own transaction.
  const invitations = invitationUsecases({
    store: postgresProposalStore(testDurable, { invitations: talkInvitationsOn }),
    bind: () => ({ provider: w.provider }),
    team: async () => w.members,
    clock: () => new Date(w.setting.now),
  });
  const later = (ms: number) => {
    w.setting.now = new Date(Date.parse(w.setting.now) + ms).toISOString();
  };
  const proposal = async () => (await w.proposals.readThread(w.id, card))!.proposals[0]!;
  try {
    await send();
    expect(await invitations.follow(w.actor)).toBe(1);
    expect(await talk()).toMatchObject({ calendarStart: null, calendarEnd: null, calendarGone: false });
    // Someone moves the meeting in the calendar itself.
    const event = w.provider.events[0]!;
    await w.provider.reschedule(event.ref, event.revision, '2098-11-13T12:00:00.000Z', '2098-11-13T13:00:00.000Z');
    later(FOLLOW_MS);
    expect(await invitations.follow(w.actor)).toBe(1);
    const differs = (await talk())!;
    // The difference is recorded beside the booking, which stands; the invitation is as it was sent.
    expect([differs.bookedStart, differs.calendarStart, differs.calendarEnd].map(d => d?.toISOString())).toEqual([
      '2098-11-11T09:00:00.000Z',
      '2098-11-13T12:00:00.000Z',
      '2098-11-13T13:00:00.000Z',
    ]);
    expect((await proposal()).start).toBe('2098-11-11T09:00:00.000Z');
    // The manager takes the meeting's time: the proposal and the talk move, and nothing differs.
    await invitations.settle(w.actor, employeeId, 'adopt');
    expect(await proposal()).toMatchObject({
      status: 'confirmed',
      start: '2098-11-13T12:00:00.000Z',
      end: '2098-11-13T13:00:00.000Z',
    });
    const adopted = (await talk())!;
    expect([adopted.bookedStart, adopted.bookedEnd].map(d => d?.toISOString())).toEqual([
      '2098-11-13T12:00:00.000Z',
      '2098-11-13T13:00:00.000Z',
    ]);
    expect(adopted).toMatchObject({ calendarStart: null, calendarEnd: null, calendarGone: false });
    // The meeting is then removed from the calendar: recorded as gone, and the manager keeps the time without it.
    const moved = w.provider.events[0]!;
    await w.provider.cancel(moved.ref, moved.revision);
    later(FOLLOW_MS);
    await invitations.follow(w.actor);
    expect(await talk()).toMatchObject({ calendarGone: true, invitationId: card + ':shared' });
    await invitations.settle(w.actor, employeeId, 'keep');
    expect((await proposal()).status).toBe('undone');
    const kept = (await talk())!;
    expect(kept).toMatchObject({ invitationId: null, bookedBy: w.id, calendarGone: false });
    expect(kept.bookedStart?.toISOString()).toBe('2098-11-13T12:00:00.000Z');
    expect((await audited()).map(a => [a.actor, a.action])).toEqual([
      ['system:execution', 'talks.booked'],
      ['assistant:scan', 'talks.calendar_differs'],
      ['person:' + w.id, 'talks.booking_moved'],
      ['assistant:scan', 'talks.calendar_differs'],
      ['person:' + w.id, 'talks.booking_kept'],
    ]);
    const planning = await database()
      .select()
      .from(schema.audit)
      .where(eq(schema.audit.subject, 'thread:' + card))
      .orderBy(schema.audit.id);
    expect(planning.map(a => a.action).filter(a => a.startsWith('proposals.'))).toEqual([
      'proposals.moved',
      'proposals.cancelled',
    ]);
  } finally {
    await cleanup();
  }
});
test('an invitation whose time passed without a talk is ended by its manager, and the talk lacks a time, in one commit (D134)', async () => {
  const { w, employeeId, card, talk, audited, send, cleanup } = await talkWorld();
  const invitations = invitationUsecases({
    store: postgresProposalStore(testDurable, { invitations: talkInvitationsOn }),
    bind: () => ({ provider: w.provider }),
    team: async () => w.members,
    clock: () => new Date(w.setting.now),
  });
  try {
    await send();
    await expect(invitations.settle(w.actor, employeeId, 'missed')).rejects.toThrow(
      'Tiden för samtalet har inte passerat än.',
    );
    w.setting.now = '2098-11-12T07:00:00.000Z';
    await invitations.settle(w.actor, employeeId, 'missed');
    expect((await w.proposals.readThread(w.id, card))!.proposals[0]!.status).toBe('undone');
    expect(await talk()).toMatchObject({ bookedStart: null, bookedEnd: null, invitationId: null });
    expect((await audited()).map(a => [a.action, (a.details as { why?: string }).why])).toEqual([
      ['talks.booked', undefined],
      ['talks.booking_removed', 'missed'],
    ]);
    // The meeting stays in the calendar as what was once planned.
    expect(w.provider.events).toHaveLength(1);
  } finally {
    await cleanup();
  }
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
test('a blocked approval keeps the invitee until its manager reconciles it and sends exactly one invitation', async () => {
  const { a, b, shared, confirmA, confirmB } = await sharedPair();
  const id = (await confirmA()).execution!.id;
  // The execution's team check fails once. B still finds both managers in the directory.
  a.setting.teamUnavailable = true;
  await a.uc.progress(id);
  a.setting.teamUnavailable = false;
  expect(await a.store.read(id)).toMatchObject({ state: 'pending', reason: 'authority-revoked', dispatchedAt: null });
  await expect(confirmB()).rejects.toThrow('Delad Medarbetare bjuds redan in');
  await a.uc.reconcile(a.actor, id);
  await a.uc.progress(id);
  expect(await a.store.read(id)).toMatchObject({ state: 'succeeded' });
  await expect(confirmB()).rejects.toThrow('Delad Medarbetare har redan ett utvecklingssamtal bokat');
  expect(sentTo(a)).toEqual([[shared.email]]);
  expect(sentTo(b)).toEqual([]);
  const audit = await database()
    .select()
    .from(schema.audit)
    .where(eq(schema.audit.subject, 'execution:' + id));
  expect(audit.filter(row => row.action === 'execution.reconciliation_requested')).toHaveLength(1);
  expect(audit.filter(row => row.action === 'execution.dispatched')).toHaveLength(1);
});
test('losing and regaining a team member cannot release a retryable invitation before expiry', async () => {
  const { a, b, shared, confirmA, confirmB } = await sharedPair();
  const id = (await confirmA()).execution!.id;
  teams.set(
    a.id,
    a.members.filter(m => m.personId !== shared.personId),
  );
  await a.uc.progress(id);
  expect(await a.store.read(id)).toMatchObject({ state: 'pending', reason: 'authority-revoked' });
  await expect(confirmB()).rejects.toThrow('Delad Medarbetare bjuds redan in');
  teams.set(a.id, a.members);
  await expect(confirmB()).rejects.toThrow('Delad Medarbetare bjuds redan in');
  a.setting.now = b.setting.now = new Date(Date.parse(at) + 24 * 3_600_000).toISOString();
  const second = await confirmB();
  await a.uc.reconcile(a.actor, id);
  await a.uc.progress(id);
  expect(await a.store.read(id)).toMatchObject({ state: 'failed', reason: 'approval-expired' });
  await b.uc.progress(second.execution!.id);
  expect(sentTo(a)).toEqual([]);
  expect(sentTo(b)).toEqual([[shared.email]]);
});
test('an invitation whose result is unknown holds the person for its approval’s 24 hours, inside its round (M1)', async () => {
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
  // A team change cannot release an invitation whose outcome remains uncertain.
  const moved = await uncertain();
  teams.set(
    moved.a.id,
    moved.a.members.filter(m => m.personId !== moved.shared.personId),
  );
  await expect(moved.confirmB()).rejects.toThrow(refusal);
  // A different round has its own reservation.
  const later = await uncertain();
  later.b.setting.round = { label: 'Next round', opensOn: '2098-12-01', dueOn: '2098-12-31', held: [], booked: [] };
  const next = await cardFor(later.b, later.shared, '2098-12-10T09:00:00.000Z');
  expect((await later.b.decisions.confirm(later.b.actor, next, [next + ':shared'])).execution?.state).toBe('pending');
});
test('concurrent approvals sharing invitee locks finish even when they outnumber the database connections', async () => {
  const refusal = 'Delad Medarbetare bjuds redan in till ett utvecklingssamtal av en annan chef.';
  async function onItsWay() {
    const pair = await sharedPair();
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
  // Twice the pool's five connections, each B confirming while its A's invitation is on its way.
  const pairs: Awaited<ReturnType<typeof onItsWay>>[] = [];
  for (let i = 0; i < 10; i++) pairs.push(await onItsWay());
  const all = await settled(Promise.allSettled(pairs.map(pair => pair.confirmB())));
  expect(all).not.toBe('stuck');
  if (all === 'stuck') return;
  expect(reasons(all)).toEqual(pairs.map(() => refusal));
  // Six confirmations of the same card also contend for the same invitee lock.
  const one = await onItsWay();
  const same = await settled(Promise.allSettled(Array.from({ length: 6 }, () => one.confirmB())));
  expect(same).not.toBe('stuck');
  if (same === 'stuck') return;
  expect(reasons(same)).toEqual(Array.from({ length: 6 }, () => refusal));
  // Nothing was approved for any B, and the pool serves the next request.
  for (const { b } of [...pairs, one])
    expect(await database().select().from(schema.executions).where(eq(schema.executions.personId, b.id))).toEqual([]);
  expect(await databaseAnswers(1000)).toBe(true);
}, 60_000);
