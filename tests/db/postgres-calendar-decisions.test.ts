import { afterAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { database, schema, closeDatabase } from '../../packages/db/src';
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
import { bookedInRound } from '../../apps/server/src/modules/calendar/usecases/booked';
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
  const team = async () => members;
  // The open round and the other managers' identities, for a person with two managers (M1); none by default.
  const setting = { round: null as PlanningRound | null, personas: new Map<string, AuthenticatedContext>() };
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
      ...calendarExecutionSource(bind, team, bookedInRound({ store: proposals, team, people: owners, round })),
      current: async () => actor,
    },
    clock: () => new Date(at),
    ids: randomUUID,
    digest: x => JSON.stringify(canonical(x)),
  });
  const decisions = calendarDecisions({
    store: proposals,
    bind,
    team,
    round,
    people: owners,
    clock: () => new Date(at),
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
test('a proposal is confirmed for its invitee by id after their address changed; a command naming another person is refused (N3)', async () => {
  const w = await world(),
    threadId = await seedThread(w);
  // Guest 1's address changes after the draw: the team has the new one, the proposal the one it was drawn with.
  w.members[0] = { ...w.members[0]!, ref: 'guest1-new', email: 'guest1.new@example.test' };
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
  const confirmed = await w.decisions.confirm(w.actor, threadId, [threadId + ':p1']);
  await w.uc.progress(confirmed.execution!.id);
  const after = (await w.proposals.readThread(w.id, threadId))!;
  expect(after.thread.execution?.state).toBe('succeeded');
  expect(after.proposals.find(p => p.id === threadId + ':p1')).toMatchObject({
    status: 'confirmed',
    participant: { personId: 'guest1', email: 'guest1@example.test', name: 'Guest 1' },
  });
  expect(w.provider.events.map(e => e.participants.map(p => p.email))).toEqual([['guest1@example.test']]);
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
test('two managers of one person confirm at once: one invitation is approved and sent, the other refused by name with nothing written (M1, Q12)', async () => {
  const a = await world(),
    b = await world();
  const key = 'shared-' + randomUUID();
  const shared: UnitMember = { personId: key, ref: key, email: key + '@example.test', name: 'Delad Medarbetare' };
  const round: PlanningRound = { label: 'Synthetic round', opensOn: '2098-11-01', dueOn: '2098-11-30', held: [] };
  for (const w of [a, b]) {
    w.members.push(shared);
    w.setting.round = round;
    w.setting.personas.set(a.id, a.actor).set(b.id, b.actor);
  }
  // Both cards were drawn before either manager booked: each holds a time for the shared person.
  const cards = await Promise.all([
    cardFor(a, shared, '2098-11-11T09:00:00.000Z'),
    cardFor(b, shared, '2098-11-12T09:00:00.000Z'),
  ]);
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
