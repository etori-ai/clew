import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { memoryCalendar, occurrence } from '../../packages/calendar/src/memory';
import { localInstant } from '../../packages/calendar/src/dates';
import type { UnitMember } from '../../packages/calendar/src/accounts';
import { memoryObligations, memoryProposalStore } from '../../apps/server/src/modules/calendar/adapters/memory';
import type { NotifyDraft } from '../../apps/server/src/modules/calendar/model';
import { FOLLOW_UP, nextCheck, nextReminderAt, obligationPlan, returnAt } from '../../apps/server/src/modules/calendar/usecases/obligation';
import { dayLoad, unplacedReasons, planWeek } from '../../packages/calendar/src/proposals';
import { obligationStep, replySummary } from '../../packages/contracts/src/index';
import { calendarUsecases, TOPIC } from '../../apps/server/src/modules/calendar/usecases/samtal';

/**
 * The utvecklingssamtal path end to end without Nextcloud or Postgres (D25): the real planner over a calendar in
 * memory, the proposal store in memory, a clock the test owns. From the nightly draw to the human decision, the
 * undo window and the timer that makes it final.
 */
const persona = (id: string, role: 'manager' | 'employee'): AuthenticatedContext => ({ id, name: id === 'hillevi' ? 'Hillevi Berg' : 'Hassan Ali', unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role,
  organisationId: 'sundsvall', principal: { id: 'person:' + id, kind: 'person' }, capabilities: [], authorizationVersion: 'v1', sessionBinding: 'test', expiresAt: '2099-01-01T00:00:00.000Z', async authorize() { return { version: 'v1' }; } });
const hillevi = persona('hillevi', 'manager'), hassan = persona('hassan', 'employee');
const account = { ref: 'memory:account:hillevi', email: 'hillevi@clew.test', name: 'Hillevi Berg' };
const members: UnitMember[] = ['Anna Lindqvist', 'Erik Sandström', 'Maria Källström', 'Johan Byström'].map(name => {
  const first = name.split(' ')[0]!.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  return { personId: first, ref: 'memory:account:' + first, email: first + '@clew.test', name };
});
const T0 = '2026-11-04T07:00:00.000Z'; // a Wednesday; the next week starts 2026-11-09
const MINUTE = 60_000;
function fakeClock(start = T0) { let now = Date.parse(start); const clock = () => new Date(now); return Object.assign(clock, { advance(ms: number) { now += ms; } }); }
function world() {
  const calendar = memoryCalendar(account), store = memoryProposalStore(), clock = fakeClock(), obligations = memoryObligations();
  const notified: Array<{ personId: string; draft: NotifyDraft }> = [];
  let n = 0;
  const deps = { store, bind: (p: AuthenticatedContext) => ({ provider: calendar, members: p.role === 'manager' ? members : [] }), clock, ids: () => `id-${++n}`,
    people: { personaFor: async (id: string) => id === 'hillevi' ? hillevi : undefined }, notify: async (personId: string, draft: NotifyDraft) => { notified.push({ personId, draft }); return 'card-' + notified.length; }, obligations };
  const usecases = calendarUsecases(deps);
  return { calendar, store, clock, obligations, notified, deps, ...usecases };
}
async function seedConfirmed(w: ReturnType<typeof world>, threadId: string, ids: string[]) {
  const current = (await w.store.readThread(hillevi.id, threadId))!;
  for (const p of current.proposals.filter(p => ids.includes(p.id))) {
    const e = await w.calendar.create('fixture-' + p.id, { title: 'Utvecklingssamtal · ' + p.participant.name, start: p.start, end: p.end, participants: [p.participant.email] });
    await w.store.transaction(async tx => { await tx.updateProposals([p.id], { status: 'confirmed', eventRef: e.ref, eventUid: e.uid, eventRevision: e.revision, confirmedAt: T0 }); await tx.updateThread(threadId, { waitingOn: 'svar från medarbetarna' }); });
  }
  return (await w.store.readThread(hillevi.id, threadId))!.thread;
}
const actions = (store: ReturnType<typeof memoryProposalStore>, id: string) => store.audit.filter(e => e.subject === 'thread:' + id).map(e => e.action);
const held = (name: string, day: string) => occurrence({ uid: 'held-' + name, title: 'Utvecklingssamtal · ' + name, start: localInstant(`${day}T13:00`), end: localInstant(`${day}T14:00`),
  participants: [{ email: name.split(' ')[0]!.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '') + '@clew.test', name, response: 'accepted', resource: false }] }, account);

describe('the nightly draw', () => {
  test('pushes one proposal thread for a manager with a slot per member, items and an audit row; nothing for an employee', async () => {
    const w = world();
    expect(await w.ensureProposalThread(hassan)).toBeUndefined();
    const t = (await w.ensureProposalThread(hillevi))!;
    expect(t).toMatchObject({ topic: TOPIC, state: 'open', week: '2026-11-09', title: 'Planera utvecklingssamtal vecka 46', connector: 'calendar', area: 'utvecklingssamtal', createdAt: T0, trigger: { reason: '4 samtal saknar tid före 28 november', source: 'Nattlig genomgång 06:00', at: T0 } });
    expect(t.proposals.map(p => p.participant.name).sort()).toEqual(members.map(m => m.name).sort());
    expect(t.items.map(i => [i.ref, i.selected])).toEqual(t.proposals.map(p => ['proposal:' + p.id, true]));
    expect(t.messages.map(m => m.body)).toEqual([t.summary]);
    expect(t.summary).toContain('4 utvecklingssamtal återstår före 28 november, om 24 dagar. Jag har ritat in 4 förslag vecka 46');
    expect(w.store.audit).toEqual([{ actor: 'assistant:scan', action: 'thread.pushed', subject: 'thread:' + t.id, at: T0, details: { topic: TOPIC, week: '2026-11-09', proposals: 4, owner: 'hillevi' } }]);
    expect((await w.ensureProposalThread(hillevi))!.id).toBe(t.id);
    expect(w.store.audit.length).toBe(1);
  });
  test('leaves out members who already have a samtal in the calendar, and reports the status', async () => {
    const w = world();
    w.calendar.events.push(held('Anna Lindqvist', '2026-11-05'));
    const t = (await w.ensureProposalThread(hillevi))!;
    expect(t.proposals.map(p => p.participant.name)).not.toContain('Anna Lindqvist');
    expect(t.proposals).toHaveLength(3);
    expect(await w.samtalStatus(hillevi)).toEqual({ held: 1, booked: 0, deadline: '28 november' });
  });
  test('plans around the manager\'s meetings and the members\' busy time, and refuses when a member\'s calendar cannot be read', async () => {
    const w = world();
    for (const day of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']) w.calendar.events.push(occurrence({ uid: 'm-' + day, title: 'Ledning', start: localInstant(`${day}T09:00`), end: localInstant(`${day}T12:00`) }, account));
    // Anna is busy every afternoon, so with the manager's mornings taken she only fits Friday morning.
    w.calendar.options.busy['memory:account:anna'] = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map(day => ({ start: localInstant(`${day}T13:00`), end: localInstant(`${day}T17:00`) }));
    const t = (await w.ensureProposalThread(hillevi))!;
    expect(t.proposals).toHaveLength(4);
    for (const p of t.proposals) expect(w.calendar.events.some(e => Date.parse(e.start) < Date.parse(p.end) && Date.parse(p.start) < Date.parse(e.end))).toBe(false);
    const anna = t.proposals.find(p => p.participant.name === 'Anna Lindqvist')!;
    expect(anna.start >= localInstant('2026-11-13T09:00') && anna.end <= localInstant('2026-11-13T12:00')).toBe(true);
    const unreadable = world();
    unreadable.calendar.options.busy['memory:account:erik'] = 'unknown';
    await expect(unreadable.ensureProposalThread(hillevi)).rejects.toThrow('Medarbetarnas kalendrar kunde inte läsas just nu.');
    expect(unreadable.store.audit).toEqual([]);
  });
});

describe('another week', () => {
  test('supersedes the drawn proposals, redraws them and keeps the thread; a past or mid-week date is refused', async () => {
    const w = world();
    const t = (await w.ensureProposalThread(hillevi))!;
    const old = t.proposals.map(p => p.id);
    w.clock.advance(60 * MINUTE);
    const re = await w.replan(hillevi, t.id, '2026-11-16');
    expect(re).toMatchObject({ id: t.id, week: '2026-11-16', title: 'Planera utvecklingssamtal vecka 47', state: 'open' });
    expect(re.proposals.every(p => !old.includes(p.id) && p.start.startsWith('2026-11-1'))).toBe(true);
    expect(re.items).toHaveLength(re.proposals.length);
    expect((await w.store.readThread('hillevi', t.id))!.proposals.filter(p => old.includes(p.id)).every(p => p.status === 'superseded')).toBe(true);
    expect(re.messages.slice(-2).map(m => m.body)).toEqual(['Vecka 47 i stället', expect.stringContaining('vecka 47')]);
    expect(w.store.audit.at(-1)).toEqual({ actor: 'person:hillevi', action: 'proposals.replanned', subject: 'thread:' + t.id, at: new Date(Date.parse(T0) + 60 * MINUTE).toISOString(), details: { week: '2026-11-16', proposals: 4 } });
    await expect(w.replan(hillevi, t.id, '2026-10-26')).rejects.toThrow('Välj en kommande vecka.');
    await expect(w.replan(hillevi, t.id, '2026-11-17')).rejects.toThrow('Välj en kommande vecka.');
    await expect(w.replan(hassan, t.id, '2026-11-16')).rejects.toThrow('Kortet är redan hanterat.');
  });
});

describe('avfärda and the week', () => {
  test('declines every drawn time and dismisses the thread', async () => {
    const w = world();
    const t = (await w.ensureProposalThread(hillevi))!;
    const gone = await w.dismiss(hillevi, t.id);
    expect(gone).toMatchObject({ state: 'dismissed', handledAt: T0, proposals: t.proposals.map(() => expect.objectContaining({ status: 'declined' })) });
    expect(w.store.audit.at(-1)).toEqual({ actor: 'person:hillevi', action: 'thread.dismissed', subject: 'thread:' + t.id, at: T0 });
    await expect(w.dismiss(hillevi, t.id)).rejects.toThrow('Kortet är redan hanterat.');
  });
  test('the week overview carries the events as names and the live proposals; today lists the day with its gaps', async () => {
    const w = world();
    w.calendar.events.push(occurrence({ uid: 'wed', title: 'APT', start: localInstant('2026-11-04T10:00'), end: localInstant('2026-11-04T11:00'), participants: [{ email: 'anna@clew.test', name: 'anna', response: 'accepted', resource: false }] }, account));
    const t = (await w.ensureProposalThread(hillevi))!;
    const week = await w.weekOverview(hillevi);
    expect(week.from).toBe('2026-11-02');
    expect(week.events.map(e => [e.title, e.mine, e.participants])).toEqual([['APT', true, ['Anna Lindqvist']]]);
    expect(week.proposals.map(p => p.id).sort()).toEqual(t.proposals.map(p => p.id).sort());
    expect((await w.weekOverview(hillevi, '2026-11-11')).events).toEqual([]);
    const today = await w.readToday(hillevi);
    expect(today.date).toBe('2026-11-04');
    expect(today.events).toHaveLength(1);
    expect(today.gaps.length).toBeGreaterThan(0);
    expect((await w.weekView(hillevi, '2026-11-12')).from).toBe('2026-11-09');
  });
});

describe('the obligation (D30)', () => {
  const accept = (w: ReturnType<typeof world>, email: string, response: 'accepted' | 'declined') => {
    const event = w.calendar.events.find(e => e.participants.some(p => p.email === email))!;
    event.participants = event.participants.map(p => p.email === email ? { ...p, response } : p);
  };
  test('the judgement calls: whoever got no slot is a row with a reason, and the step reads from the proposals', async () => {
    const w = world();
    // Anna is busy every working hour of the week; the planner cannot place her and says why.
    const anna = members.find(m => m.name === 'Anna Lindqvist')!;
    w.calendar.options.busy[anna.ref] = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map(day => ({ start: localInstant(`${day}T07:00`), end: localInstant(`${day}T18:00`) }));
    const t = (await w.ensureProposalThread(hillevi))!;
    expect(t.proposals.map(p => p.participant.name)).not.toContain('Anna Lindqvist');
    expect(t.items.filter(i => i.ref.startsWith('unplaced:'))).toEqual([{ ref: 'unplaced:anna@clew.test', label: 'Anna Lindqvist', detail: 'upptagen hela veckan', selectable: false, selected: false }]);
    expect(obligationStep(t.proposals)).toBe('forslag');
  });
  test('replies are read back from the calendar: a yes becomes accepted, the sum is written, the step moves on', async () => {
    const w = world();
    const t = (await w.ensureProposalThread(hillevi))!;
    const done = await seedConfirmed(w, t.id, t.proposals.map(p => p.id));
    expect(obligationStep(done.proposals)).toBe('inbjudningar');
    expect(await w.readReplies(t.id)).toEqual({ accepted: [], declined: [] });
    accept(w, 'anna@clew.test', 'accepted');
    accept(w, 'erik@clew.test', 'accepted');
    const read = await w.readReplies(t.id);
    expect(read.accepted.length).toBe(2);
    const after = (await w.store.readThread('hillevi', t.id))!;
    expect(after.thread).toMatchObject({ state: 'open', waitingOn: 'svar från 2 medarbetare' });
    expect(after.proposals.filter(p => p.status === 'accepted').map(p => p.participant.email).sort()).toEqual(['anna@clew.test', 'erik@clew.test']);
    expect(obligationStep(after.thread.proposals)).toBe('svar');
    expect(replySummary(after.thread.proposals)).toEqual({ accepted: 2, declined: 0, waiting: 2, total: 4 });
    expect(after.thread.messages.at(-1)!.body).toBe('2 av 4 har svarat ja. 2 har inte svarat ännu.');
    expect(w.store.audit.at(-1)).toMatchObject({ actor: 'assistant:obligation', action: 'proposals.replies', subject: 'thread:' + t.id, details: { accepted: read.accepted, declined: [], alternatives: [] } });
    expect(await w.readReplies(t.id)).toEqual({ accepted: [], declined: [] });
    expect(await w.samtalStatus(hillevi)).toEqual({ held: 4, booked: 0, deadline: '28 november' });
  });
  test('a no draws two other times for that one person and puts the thread back under Nu', async () => {
    const w = world();
    const t = (await w.ensureProposalThread(hillevi))!;
    await seedConfirmed(w, t.id, t.proposals.map(p => p.id));
    accept(w, 'anna@clew.test', 'declined');
    const read = await w.readReplies(t.id);
    expect(read.declined.length).toBe(1);
    const back = (await w.store.readThread('hillevi', t.id))!;
    expect(back.thread).toMatchObject({ state: 'open', handledAt: null, deadline: '2026-11-04' });
    const alternatives = back.thread.proposals.filter(p => p.status === 'proposed');
    expect(alternatives.map(p => p.participant.email)).toEqual(['anna@clew.test', 'anna@clew.test']);
    expect(alternatives[0]!.start).not.toBe(alternatives[1]!.start);
    expect(back.thread.summary).toMatch(/^Anna Lindqvist kan inte .* Jag har ritat två andra tider som är lediga för er båda; välj en så skickar jag en ny inbjudan och tar bort den gamla\.$/);
    expect(back.thread.items.filter(i => i.ref.startsWith('proposal:')).map(i => i.selected)).toEqual([true, false]);
    expect(obligationStep(back.thread.proposals)).toBe('forslag');
  });
  test('the follow-up policy calculates workdays, office hours, reminder limits and the Friday review', async () => {
    const w = world();
    const t = (await w.ensureProposalThread(hillevi))!;
    const sent = await seedConfirmed(w, t.id, t.proposals.map(p => p.id));
    // Sent Wednesday 08:00: the first reminder is due Friday 06:00, the thread comes back the Friday after that (two workdays after Wednesday is Friday, so the review that Friday).
    const confirmed = (await w.store.readThread('hillevi', t.id))!.proposals;
    expect(nextReminderAt(confirmed[0]!, T0)).toBe('2026-11-06T05:00:00.000Z');
    expect(returnAt(confirmed, T0)).toBe('2026-11-06T05:00:00.000Z');
    expect(nextCheck(T0)).toBe('2026-11-04T08:00:00.000Z');
    expect(nextCheck('2026-11-04T16:30:00.000Z')).toBe('2026-11-05T07:00:00.000Z');
    expect(nextCheck('2026-11-06T16:30:00.000Z')).toBe('2026-11-09T07:00:00.000Z');
    expect(obligationPlan(T0, confirmed)).toMatchObject({ action: 'wait', why: 'waiting', next: '2026-11-04T08:00:00.000Z' });
    // A late check on Thursday evening: still waiting, and the next look is the Friday review itself, not Friday 08:00.
    expect(obligationPlan('2026-11-05T16:30:00.000Z', confirmed)).toMatchObject({ action: 'wait', next: '2026-11-06T05:00:00.000Z' });
    // Monday-sent invitations get a Friday reminder before the thread returns: reminder Wednesday 06:00, return Friday 06:00.
    const monday = confirmed.map(p => ({ ...p, confirmedAt: '2026-11-02T07:00:00.000Z' }));
    expect(obligationPlan('2026-11-04T05:00:00.000Z', monday)).toMatchObject({ action: 'remind', why: 'overdue' });
    expect(obligationPlan('2026-11-04T05:00:00.000Z', monday).due).toHaveLength(4);
    expect(obligationPlan('2026-11-06T05:00:00.000Z', monday)).toMatchObject({ action: 'return', why: 'deadline' });
    expect(obligationPlan(T0, confirmed.map(p => ({ ...p, status: 'accepted' as const })))).toMatchObject({ action: 'return', why: 'answered' });
  });
  test('the load of a day is the busy share of 08–17, merged', () => {
    const day = '2026-11-09';
    expect(dayLoad(day, [])).toEqual({ busyMinutes: 0, share: 0 });
    expect(dayLoad(day, [{ start: localInstant(`${day}T09:00`), end: localInstant(`${day}T10:00`) }, { start: localInstant(`${day}T09:30`), end: localInstant(`${day}T11:00`) }])).toEqual({ busyMinutes: 120, share: 120 / 540 });
    expect(dayLoad(day, [{ start: localInstant(`${day}T06:00`), end: localInstant(`${day}T20:00`) }])).toEqual({ busyMinutes: 540, share: 1 });
  });
  test('the planner names why someone got no slot', () => {
    const week = '2026-11-09', notBefore = T0;
    const free = { email: 'a@clew.test', name: 'A' }, busy = { email: 'b@clew.test', name: 'B' };
    const allWeek = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map(day => ({ start: localInstant(`${day}T07:00`), end: localInstant(`${day}T18:00`) }));
    const input = { week, managerBusy: [], candidates: [{ participant: free, busy: [] }, { participant: busy, busy: allWeek }], notBefore };
    const planned = planWeek(input);
    expect(unplacedReasons(input, planned)).toEqual([{ participant: busy, reason: 'upptagen hela veckan' }]);
    const managerGone = { ...input, managerBusy: allWeek, candidates: [{ participant: free, busy: [] }] };
    expect(unplacedReasons(managerGone, planWeek(managerGone))).toEqual([{ participant: free, reason: 'dina lediga timmar räckte inte' }]);
    expect(FOLLOW_UP.maxReminders).toBe(2);
  });
});
