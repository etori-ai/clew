import { beforeEach, describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { memoryCalendar } from '../../packages/calendar/src/memory';
import { UnreadableEventError } from '../../packages/calendar/src/model';
import { memoryProposalStore } from '../../apps/server/src/modules/calendar/adapters/memory';
import type { ProposalRecord, UnitMember } from '../../apps/server/src/modules/calendar/model';
import { FOLLOW_MS, invitationUsecases } from '../../apps/server/src/modules/calendar/usecases/invitations';
import { memoryTalkStore } from '../../apps/server/src/modules/talks/adapters/memory';
import { talkInvitations, talkUsecases } from '../../apps/server/src/modules/talks/usecases';
import { ForbiddenError } from '../../apps/server/src/context';

/**
 * A sent invitation followed by its event's id (D133), on memory adapters: the calendar module's use cases over a
 * calendar in memory, with its invitations port bound to the talks module as composition binds it. The talk's booking
 * stands whatever the calendar holds, the difference is recorded beside it, and only the manager's decision changes the
 * invitation and the talk, each with its audit row. Nothing is found by a meeting's title.
 */
const ORG = 'org-1';
const persona = (id: string, role: 'manager' | 'employee', name: string): AuthenticatedContext => ({
  id,
  name,
  unitId: 'u1',
  unitLabel: 'Enhet 1',
  role,
  organisationId: ORG,
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
});
const boss = persona('boss', 'manager', 'Karin Chef'),
  co = persona('co', 'manager', 'Lena Chef'),
  asAnna = persona('anna', 'employee', 'Anna Andersson');
const member = (id: string, name: string): UnitMember => ({
  personId: id,
  ref: 'memory:account:' + id,
  email: id + '@clew.test',
  name,
});
const anna = member('anna', 'Anna Andersson'),
  dan = member('dan', 'Dan Dahl');
const BOOKED = { start: '2026-11-20T09:00:00.000Z', end: '2026-11-20T10:00:00.000Z' };
const MOVED = { start: '2026-11-23T12:00:00.000Z', end: '2026-11-23T13:00:00.000Z' };

let now: Date;
let n: number;
let teams: Map<string, UnitMember[]>;
function world() {
  const ids = () => 'id-' + ++n;
  const calendar = memoryCalendar({ ref: 'memory:account:boss', email: 'boss@clew.test', name: 'Karin Chef' });
  const talkStore = memoryTalkStore({
    persons: [
      ['boss', 'Karin Chef'],
      ['co', 'Lena Chef'],
      ['anna', 'Anna Andersson'],
      ['dan', 'Dan Dahl'],
    ].map(([id, name]) => ({ id: id!, organisationId: ORG, name: name!, userName: id!, enabled: true })),
  });
  const told = <T>(fn: (port: ReturnType<typeof talkInvitations>) => Promise<T>) =>
    talkStore.transaction(tx => fn(talkInvitations(tx, { ids })));
  const proposals = memoryProposalStore({
    invitations: {
      established: i => told(p => p.established(i)),
      observed: o => told(p => p.observed(o)),
      moved: m => told(p => p.moved(m)),
      ended: e => told(p => p.ended(e)),
    },
  });
  const staffOf = (id: string) => ({
    units: [
      {
        unitId: 'u1',
        unitLabel: 'Enhet 1',
        people: (teams.get(id) ?? []).map(m => ({
          id: m.personId,
          name: m.name,
          userName: m.personId,
          email: m.email,
          role: 'employee' as const,
          enabled: true,
        })),
      },
    ].filter(u => u.people.length),
  });
  const talks = talkUsecases({
    store: talkStore,
    staff: async p => staffOf(p.id),
    reports: async id => new Set((teams.get(id) ?? []).map(m => m.personId)),
    siteName: async () => 'Medarbetarwebben',
    clock: () => now,
    ids,
  });
  const invitations = invitationUsecases({
    store: proposals,
    bind: () => ({ provider: calendar }),
    team: async p => teams.get(p.id) ?? [],
    clock: () => now,
  });
  /** The manager's invitation to this person, sent and read back: a booked proposal with its event's id, and the talk booked by it. */
  async function invite(to: UnitMember, span = BOOKED, owner = boss) {
    const threadId = ids(),
      id = ids();
    const event = await calendar.create('clew-exec-' + id, {
      title: 'Utvecklingssamtal · ' + to.name,
      ...span,
      participants: [to.email],
    });
    const record: ProposalRecord = {
      id,
      threadId,
      personId: owner.id,
      status: 'confirmed',
      participant: { personId: to.personId, email: to.email, name: to.name },
      ...span,
      eventUid: event.uid,
      eventRef: event.ref,
      eventRevision: event.revision,
      eventIcalUid: event.icalUid,
      confirmedAt: now.toISOString(),
      undoUntil: null,
      reminders: 0,
      remindedAt: null,
    };
    await proposals.transaction(async tx => {
      await tx.insertThread({
        id: threadId,
        personId: owner.id,
        topic: 'utvecklingssamtal:' + threadId,
        title: 'Planera utvecklingssamtal',
        week: '2026-11-16',
        area: 'utvecklingssamtal',
        summary: '',
        trigger: { reason: 'Test', source: 'Test', at: now.toISOString() },
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      await tx.insertProposals([record]);
      await tx.invitations.established({
        actor: 'system:execution',
        invitationId: id,
        managerId: owner.id,
        employeeId: to.personId,
        ...span,
        at: now.toISOString(),
      });
    });
    return { id, threadId, ref: event.ref };
  }
  const proposal = async (id: string, threadId: string) =>
    (await proposals.readThreadById(threadId))!.proposals.find(p => p.id === id)!;
  const rowOf = async (manager: AuthenticatedContext, userName: string) =>
    (await talks.round(manager)).rows.find(r => r.userName === userName)!;
  const eventAt = (ref: string) => calendar.events.find(e => e.ref === ref)!;
  /** Someone moves the meeting in the calendar itself: Clew is not told. */
  const moveInCalendar = async (ref: string, span = MOVED) =>
    calendar.reschedule(ref, eventAt(ref).revision, span.start, span.end);
  const cancelInCalendar = async (ref: string) => calendar.cancel(ref, eventAt(ref).revision);
  return {
    calendar,
    talkStore,
    proposals,
    talks,
    invitations,
    invite,
    proposal,
    rowOf,
    moveInCalendar,
    cancelInCalendar,
  };
}
beforeEach(() => {
  now = new Date('2026-11-10T09:00:00.000Z');
  n = 0;
  teams = new Map([['boss', [anna, dan]]]);
});
const open = (w: ReturnType<typeof world>) =>
  w.talks.openRound('operator:cli', {
    organisationId: ORG,
    label: 'Utvecklingssamtal hösten 2026',
    opensOn: '2026-10-01',
    dueOn: '2026-11-28',
  });
const later = (ms: number) => {
  now = new Date(now.getTime() + ms);
};

describe('reading a sent invitation back by its event’s id (D133)', () => {
  test('a meeting moved in the calendar is told to the talks module, and the talk stands at its own time', async () => {
    const w = world();
    await open(w);
    const sent = await w.invite(dan);
    // The calendar agrees: the reading is told, and nothing differs.
    expect(await w.invitations.follow(boss)).toBe(1);
    expect(await w.rowOf(boss, 'dan')).not.toHaveProperty('calendar');
    await w.moveInCalendar(sent.ref);
    // Within the hour the calendar is not read again.
    later(FOLLOW_MS - 1000);
    expect(await w.invitations.follow(boss)).toBe(0);
    expect(await w.rowOf(boss, 'dan')).not.toHaveProperty('calendar');
    later(1000);
    expect(await w.invitations.follow(boss)).toBe(1);
    expect(await w.rowOf(boss, 'dan')).toMatchObject({
      state: 'booked',
      at: BOOKED.start,
      until: BOOKED.end,
      invited: true,
      own: true,
      calendar: MOVED,
    });
    // The invitation is as it was sent: nothing changed because the calendar did.
    expect(await w.proposal(sent.id, sent.threadId)).toMatchObject({ status: 'confirmed', ...BOOKED });
    expect(w.proposals.invitations.at(-1)).toEqual({
      op: 'observed',
      actor: 'assistant:scan',
      invitationId: sent.id,
      event: MOVED,
      at: now.toISOString(),
    });
    expect(w.talkStore.audit().at(-1)).toMatchObject({
      actor: 'assistant:scan',
      action: 'talks.calendar_differs',
      details: { employeeId: 'dan', invitationId: sent.id, calendar: MOVED },
    });
  });

  test('a meeting is found by its id whatever it is called, and another meeting with a talk’s title is nobody’s invitation', async () => {
    const w = world();
    await open(w);
    const sent = await w.invite(dan);
    // The meeting is renamed in the calendar, and another one carries the title a talk's invitation has.
    w.calendar.events = w.calendar.events.map(e => (e.ref === sent.ref ? { ...e, title: 'Avstämning' } : e));
    await w.calendar.create('by-hand', {
      title: 'Utvecklingssamtal · Dan Dahl',
      start: '2026-11-25T09:00:00.000Z',
      end: '2026-11-25T10:00:00.000Z',
      participants: [dan.email],
    });
    await w.invitations.follow(boss);
    expect(await w.rowOf(boss, 'dan')).toMatchObject({ state: 'booked', at: BOOKED.start });
    expect(await w.rowOf(boss, 'dan')).not.toHaveProperty('calendar');
    // Anna has no invitation: the meeting that looks like a talk books nothing for anyone.
    expect((await w.rowOf(boss, 'anna')).state).toBe('missing');
  });

  test('a meeting gone from the calendar is told as gone; a calendar that cannot be read tells nothing and is asked again an hour later', async () => {
    const w = world();
    await open(w);
    const sent = await w.invite(dan);
    await w.cancelInCalendar(sent.ref);
    const lookup = w.calendar.lookup.bind(w.calendar);
    w.calendar.lookup = async () => {
      throw new Error('The calendar did not answer.');
    };
    expect(await w.invitations.follow(boss)).toBe(0);
    expect(await w.rowOf(boss, 'dan')).not.toHaveProperty('calendar');
    w.calendar.lookup = lookup;
    later(FOLLOW_MS);
    expect(await w.invitations.follow(boss)).toBe(1);
    expect(await w.rowOf(boss, 'dan')).toMatchObject({ state: 'booked', at: BOOKED.start, calendar: { gone: true } });
  });

  test('only a manager’s own invitations that book someone are read: nothing for an employee, a manager without one, or a drawn time', async () => {
    const w = world();
    await open(w);
    let reads = 0;
    const lookup = w.calendar.lookup.bind(w.calendar);
    w.calendar.lookup = async ref => {
      reads++;
      return lookup(ref);
    };
    expect(await w.invitations.follow(asAnna)).toBe(0);
    expect(await w.invitations.follow(co)).toBe(0);
    const sent = await w.invite(dan);
    await w.proposals.transaction(tx => tx.updateProposals([sent.id], { status: 'proposed' }));
    expect(await w.invitations.follow(boss)).toBe(0);
    expect(reads).toBe(0);
  });
});

describe('the manager settles what the calendar holds (D133)', () => {
  test('adopt: the invitation and the talk take the time the meeting has now, each with its audit row', async () => {
    const w = world();
    await open(w);
    const sent = await w.invite(dan);
    const moved = await w.moveInCalendar(sent.ref);
    await w.invitations.follow(boss);
    later(60_000);
    await w.invitations.settle(boss, 'dan', 'adopt');
    expect(await w.proposal(sent.id, sent.threadId)).toMatchObject({
      status: 'confirmed',
      ...MOVED,
      eventRef: sent.ref,
      eventRevision: moved.revision,
    });
    const row = await w.rowOf(boss, 'dan');
    expect(row).toMatchObject({ state: 'booked', at: MOVED.start, until: MOVED.end, invited: true });
    expect(row).not.toHaveProperty('calendar');
    expect(w.proposals.audit.at(-1)).toEqual({
      actor: 'person:boss',
      action: 'proposals.moved',
      subject: 'thread:' + sent.threadId,
      at: now.toISOString(),
      details: { proposal: sent.id, ...MOVED, by: 'calendar' },
    });
    expect(w.talkStore.audit().at(-1)).toMatchObject({
      actor: 'person:boss',
      action: 'talks.booking_moved',
      details: { employeeId: 'dan', invitationId: sent.id, from: BOOKED, ...MOVED },
    });
    // Nothing was written to the calendar: the meeting is where the person put it.
    expect(w.calendar.events.find(e => e.ref === sent.ref)).toMatchObject(MOVED);
  });

  test('a meeting moved back in the calendar agrees again: there is nothing to decide, and what was recorded is cleared', async () => {
    const w = world();
    await open(w);
    const sent = await w.invite(dan);
    await w.moveInCalendar(sent.ref);
    await w.invitations.follow(boss);
    await w.moveInCalendar(sent.ref, BOOKED);
    await expect(w.invitations.settle(boss, 'dan', 'adopt')).rejects.toThrow(
      'Mötet i kalendern stämmer med samtalet. Läs om sidan.',
    );
    expect(await w.rowOf(boss, 'dan')).toMatchObject({ state: 'booked', at: BOOKED.start });
    expect(await w.rowOf(boss, 'dan')).not.toHaveProperty('calendar');
    expect(await w.proposal(sent.id, sent.threadId)).toMatchObject({ status: 'confirmed', ...BOOKED });
  });

  test('remove and keep: a meeting gone from the calendar ends the invitation; the talk lacks a time, or keeps it as one set by hand', async () => {
    const w = world();
    await open(w);
    const dans = await w.invite(dan);
    const annas = await w.invite(anna, MOVED);
    await w.cancelInCalendar(dans.ref);
    await w.cancelInCalendar(annas.ref);
    await w.invitations.follow(boss);
    await w.invitations.settle(boss, 'dan', 'remove');
    expect((await w.proposal(dans.id, dans.threadId)).status).toBe('undone');
    expect((await w.rowOf(boss, 'dan')).state).toBe('missing');
    expect(w.proposals.audit.at(-1)).toEqual({
      actor: 'person:boss',
      action: 'proposals.cancelled',
      subject: 'thread:' + dans.threadId,
      at: now.toISOString(),
      details: { proposal: dans.id, kept: false, by: 'calendar' },
    });
    expect(w.talkStore.audit().at(-1)).toMatchObject({
      actor: 'person:boss',
      action: 'talks.booking_removed',
      details: { invitationId: dans.id, why: 'cancelled' },
    });
    await w.invitations.settle(boss, 'anna', 'keep');
    expect((await w.proposal(annas.id, annas.threadId)).status).toBe('undone');
    const row = await w.rowOf(boss, 'anna');
    expect(row).toMatchObject({ state: 'booked', at: MOVED.start, until: MOVED.end, invited: false, own: true });
    expect(row).not.toHaveProperty('calendar');
    expect(w.proposals.audit.at(-1)).toMatchObject({ details: { proposal: annas.id, kept: true } });
    expect(w.talkStore.audit().at(-1)).toMatchObject({ actor: 'person:boss', action: 'talks.booking_kept' });
    // It is a time set by hand now, which the manager changes on the talk.
    await w.talks.unbook(boss, 'anna');
    expect((await w.rowOf(boss, 'anna')).state).toBe('missing');
  });

  test('missed: when the meeting’s time has passed without a talk, the invitation is over and the talk lacks a time, with nothing read from the calendar (D134)', async () => {
    const w = world();
    await open(w);
    const sent = await w.invite(dan);
    // Before its time has passed there is nothing to call missed.
    await expect(w.invitations.settle(boss, 'dan', 'missed')).rejects.toThrow(
      'Tiden för samtalet har inte passerat än.',
    );
    now = new Date('2026-11-21T07:00:00.000Z');
    w.calendar.lookup = async () => {
      throw new Error('The calendar is not read for this.');
    };
    await w.invitations.settle(boss, 'dan', 'missed');
    expect((await w.proposal(sent.id, sent.threadId)).status).toBe('undone');
    expect((await w.rowOf(boss, 'dan')).state).toBe('missing');
    expect(w.proposals.audit.at(-1)).toEqual({
      actor: 'person:boss',
      action: 'proposals.missed',
      subject: 'thread:' + sent.threadId,
      at: now.toISOString(),
      details: { proposal: sent.id },
    });
    expect(w.talkStore.audit().at(-1)).toMatchObject({
      actor: 'person:boss',
      action: 'talks.booking_removed',
      details: { employeeId: 'dan', invitationId: sent.id, why: 'missed' },
    });
    // The meeting stays in the calendar as what was once planned.
    expect(w.calendar.events).toHaveLength(1);
    // An older invitation whose talk was held is never the one that was missed: with a newer one still to come there
    // is nothing to call missed, and the old one is left as it is.
    const old = await w.invite(anna, { start: '2026-11-12T09:00:00.000Z', end: '2026-11-12T10:00:00.000Z' });
    const next = await w.invite(anna, { start: '2026-11-27T09:00:00.000Z', end: '2026-11-27T10:00:00.000Z' });
    await expect(w.invitations.settle(boss, 'anna', 'missed')).rejects.toThrow(
      'Tiden för samtalet har inte passerat än.',
    );
    expect((await w.proposal(old.id, old.threadId)).status).toBe('confirmed');
    expect((await w.proposal(next.id, next.threadId)).status).toBe('confirmed');
    // Settled once: there is no invitation left to answer for.
    await expect(w.invitations.settle(boss, 'dan', 'missed')).rejects.toThrow(
      'Samtalet har ingen inbjudan från dig att ändra. Läs om sidan.',
    );
  });

  test('a decision that does not fit what the calendar holds now is refused, and what it holds is recorded', async () => {
    const w = world();
    await open(w);
    const sent = await w.invite(dan);
    await w.moveInCalendar(sent.ref);
    // The page was read while the meeting was gone, or so it thinks: the meeting is there, at another time.
    for (const decision of ['remove', 'keep'] as const)
      await expect(w.invitations.settle(boss, 'dan', decision)).rejects.toThrow(
        'Mötet finns kvar i kalendern. Läs om sidan.',
      );
    expect(await w.rowOf(boss, 'dan')).toMatchObject({ state: 'booked', at: BOOKED.start, calendar: MOVED });
    await w.cancelInCalendar(sent.ref);
    await expect(w.invitations.settle(boss, 'dan', 'adopt')).rejects.toThrow(
      'Mötet finns inte längre i kalendern. Läs om sidan.',
    );
    expect(await w.rowOf(boss, 'dan')).toMatchObject({ calendar: { gone: true } });
    expect((await w.proposal(sent.id, sent.threadId)).status).toBe('confirmed');
    expect(w.proposals.audit).toEqual([]);
  });

  test('only the manager whose invitation it is settles it, for someone they manage; a calendar that cannot be read is said so', async () => {
    const w = world();
    await open(w);
    const sent = await w.invite(dan);
    await w.moveInCalendar(sent.ref);
    await w.invitations.follow(boss);
    // Lena manages Dan too, but the invitation is Karin's.
    teams.set('co', [dan]);
    await expect(w.invitations.settle(co, 'dan', 'adopt')).rejects.toThrow(
      'Samtalet har ingen inbjudan från dig att ändra. Läs om sidan.',
    );
    await expect(w.invitations.settle(asAnna, 'dan', 'adopt')).rejects.toBeInstanceOf(ForbiddenError);
    teams.set('boss', [anna]);
    await expect(w.invitations.settle(boss, 'dan', 'adopt')).rejects.toBeInstanceOf(ForbiddenError);
    teams.set('boss', [anna, dan]);
    w.calendar.lookup = async () => {
      throw new Error('The calendar did not answer.');
    };
    await expect(w.invitations.settle(boss, 'dan', 'adopt')).rejects.toThrow(
      'Kalendern kunde inte läsas just nu. Försök igen om en stund.',
    );
    expect(await w.proposal(sent.id, sent.threadId)).toMatchObject({ status: 'confirmed', ...BOOKED });
    expect(await w.rowOf(boss, 'dan')).toMatchObject({ at: BOOKED.start, calendar: MOVED });
  });

  test('a meeting the calendar holds but Clew cannot read is said so in the calendar’s own words, not as a calendar that did not answer', async () => {
    const w = world();
    await open(w);
    const sent = await w.invite(dan);
    await w.moveInCalendar(sent.ref);
    await w.invitations.follow(boss);
    const zone = 'Mötet har en tidszon som kalendern inte beskriver.';
    w.calendar.lookup = async () => {
      throw new UnreadableEventError(zone);
    };
    await expect(w.invitations.settle(boss, 'dan', 'adopt')).rejects.toThrow(zone);
    expect(await w.proposal(sent.id, sent.threadId)).toMatchObject({ status: 'confirmed', ...BOOKED });
    expect(w.proposals.audit).toEqual([]);
  });
});

describe('a meeting made all-day or recurring in the calendar (DE-L15)', () => {
  test('an all-day meeting is told as the days it holds in Clew’s zone, never from midnight UTC, and is not adopted', async () => {
    const w = world();
    await open(w);
    const sent = await w.invite(dan);
    // Someone makes the meeting all-day on Monday 23 November in the calendar itself.
    w.calendar.events = w.calendar.events.map(e =>
      e.ref === sent.ref ? { ...e, allDay: true, start: '2026-11-23', end: '2026-11-24', revision: 'r-all-day' } : e,
    );
    const day = { start: '2026-11-22T23:00:00.000Z', end: '2026-11-23T23:00:00.000Z' };
    expect(await w.invitations.follow(boss)).toBe(1);
    expect(w.proposals.invitations.at(-1)).toMatchObject({ op: 'observed', invitationId: sent.id, event: day });
    expect(await w.rowOf(boss, 'dan')).toMatchObject({ state: 'booked', at: BOOKED.start, calendar: day });
    later(60_000);
    await expect(w.invitations.settle(boss, 'dan', 'adopt')).rejects.toThrow(
      'Mötet i kalendern gäller hela dagen. Ge det en tid i kalendern innan samtalet flyttas dit.',
    );
    // The talk keeps the time it was booked for, the invitation is as it was sent, and nothing is audited as moved.
    expect(await w.proposal(sent.id, sent.threadId)).toMatchObject({ status: 'confirmed', ...BOOKED });
    expect(await w.rowOf(boss, 'dan')).toMatchObject({ state: 'booked', at: BOOKED.start, until: BOOKED.end });
    expect(w.proposals.audit).toEqual([]);
    expect(w.talkStore.audit().some(a => a.action === 'talks.booking_moved')).toBe(false);
    // Given a time again in the calendar, the meeting is adopted as any moved meeting is.
    w.calendar.events = w.calendar.events.map(e => (e.ref === sent.ref ? { ...e, allDay: false, ...MOVED } : e));
    await w.invitations.settle(boss, 'dan', 'adopt');
    expect(await w.proposal(sent.id, sent.threadId)).toMatchObject({ status: 'confirmed', ...MOVED });
  });

  test('an all-day meeting whose days are the very instants the talk was booked for still differs, and is not adopted', async () => {
    const w = world();
    await open(w);
    // A talk booked from midnight UTC to midnight UTC: the instants an all-day date reads as when parsed as UTC.
    const midnights = { start: '2026-11-23T00:00:00.000Z', end: '2026-11-24T00:00:00.000Z' };
    const sent = await w.invite(dan, midnights);
    w.calendar.events = w.calendar.events.map(e =>
      e.ref === sent.ref ? { ...e, allDay: true, start: '2026-11-23', end: '2026-11-24', revision: 'r-all-day' } : e,
    );
    await w.invitations.follow(boss);
    // Told as an all-day meeting to give a time, never as a meeting that agrees with the talk.
    await expect(w.invitations.settle(boss, 'dan', 'adopt')).rejects.toThrow(
      'Mötet i kalendern gäller hela dagen. Ge det en tid i kalendern innan samtalet flyttas dit.',
    );
    expect(await w.proposal(sent.id, sent.threadId)).toMatchObject({ status: 'confirmed', ...midnights });
    expect(w.proposals.audit).toEqual([]);
  });

  test('a meeting made recurring has no one time to take, and is not adopted', async () => {
    const w = world();
    await open(w);
    const sent = await w.invite(dan);
    w.calendar.events = w.calendar.events.map(e => (e.ref === sent.ref ? { ...e, recurring: true, ...MOVED } : e));
    await w.invitations.follow(boss);
    await expect(w.invitations.settle(boss, 'dan', 'adopt')).rejects.toThrow(
      'Mötet i kalendern återkommer. Gör det till ett enstaka möte i kalendern innan samtalet flyttas dit.',
    );
    expect(await w.proposal(sent.id, sent.threadId)).toMatchObject({ status: 'confirmed', ...BOOKED });
    expect(await w.rowOf(boss, 'dan')).toMatchObject({ state: 'booked', at: BOOKED.start, calendar: MOVED });
    expect(w.proposals.audit).toEqual([]);
  });
});
