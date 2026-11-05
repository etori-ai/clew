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

describe('the human decision', () => {
  test('re-validates, writes the events, confirms the chosen proposals, declines the rest and opens a ten-minute undo window', async () => {
    const w = world();
    const t = (await w.ensureProposalThread(hillevi))!;
    const [a, b, ...rest] = t.proposals;
    const done = await w.confirm(hillevi, t.id, [a!.id, b!.id]);
    expect(done).toMatchObject({ state: 'open', handledAt: null, waitingOn: 'svar från 2 medarbetare' });
    expect(w.calendar.events.map(e => [e.title, e.participants[0]!.email]).sort()).toEqual([a, b].map(p => [`Utvecklingssamtal · ${p!.participant.name}`, p!.participant.email]).sort());
    const undoUntil = new Date(Date.parse(T0) + 10 * MINUTE).toISOString();
    expect(done.proposals.filter(p => p.status === 'confirmed').map(p => p.id).sort()).toEqual([a!.id, b!.id].sort());
    expect(done.proposals.find(p => p.id === a!.id)).toMatchObject({ undoUntil, eventRef: 'memory:clew-samtal-' + a!.id });
    expect(done.proposals.filter(p => p.status === 'declined').map(p => p.id).sort()).toEqual(rest.map(p => p.id).sort());
    expect(done.items.map(i => i.selected)).toEqual(t.proposals.map(p => [a!.id, b!.id].includes(p.id)));
    expect(done.messages.slice(-2).map(m => m.body)).toEqual(['Bekräftade 2 tider', '2 inbjudningar är skickade. Du kan ångra till 08:10. Jag påminner den som inte svarat efter 2 arbetsdagar, högst 2 gånger, och lägger resten hos dig fre 6 nov. 06:00.']);
    expect(w.store.audit.at(-1)).toEqual({ actor: 'person:hillevi', action: 'proposals.confirmed', subject: 'thread:' + t.id, at: T0, details: { proposals: [a!.id, b!.id], unknown: 0, undoUntil, replaced: [] } });
    expect(w.obligations.started).toEqual([{ threadId: t.id, personId: 'hillevi' }]);
    expect(w.store.jobs).toEqual([{ id: `undo-expiry:${t.id}:${Date.parse(T0)}`, kind: 'undo-expiry', runAt: undoUntil, payload: { threadId: t.id, personId: 'hillevi' } }]);
    // The invitations are in the calendar now, so the status counts them as held rather than booked.
    expect(await w.samtalStatus(hillevi)).toEqual({ held: 2, booked: 0, deadline: '28 november' });
    await expect(w.confirm(hillevi, t.id, [a!.id])).rejects.toThrow('Något förslag är inte längre aktuellt. Läs om sidan.');
  });
  test('refuses a stale proposal and a time that now collides with the manager\'s calendar', async () => {
    const w = world();
    const t = (await w.ensureProposalThread(hillevi))!;
    const a = t.proposals[0]!;
    await expect(w.confirm(hillevi, t.id, [a.id, 'gone'])).rejects.toThrow('Något förslag är inte längre aktuellt. Läs om sidan.');
    w.calendar.events.push(occurrence({ uid: 'late', title: 'Akut', start: a.start, end: a.end }, account));
    await expect(w.confirm(hillevi, t.id, [a.id])).rejects.toThrow(/krockar numera med din kalender/);
    expect(w.calendar.events.filter(e => e.title.startsWith('Utvecklingssamtal'))).toEqual([]);
    expect(actions(w.store, t.id)).toEqual(['thread.pushed']);
  });
  test('records a lost calendar reply as unknown instead of pretending', async () => {
    const w = world();
    const t = (await w.ensureProposalThread(hillevi))!;
    w.calendar.options.failCreate = true;
    const done = await w.confirm(hillevi, t.id, [t.proposals[0]!.id]);
    expect(done.messages.at(-1)!.body).toBe('0 inbjudningar är skickade. 1 fick inget svar från kalendern; kontrollera dem i kalendern innan du försöker igen.');
    expect(w.store.audit.at(-1)!.details).toMatchObject({ unknown: 1 });
  });
});

describe('ångra and the timer', () => {
  test('within the window the events are cancelled and the proposals come back; after it the confirmation is final', async () => {
    const w = world();
    const t = (await w.ensureProposalThread(hillevi))!;
    const ids = t.proposals.slice(0, 2).map(p => p.id);
    await w.confirm(hillevi, t.id, ids);
    w.clock.advance(9 * MINUTE);
    const back = await w.undo(hillevi, t.id);
    expect(back).toMatchObject({ state: 'open', handledAt: null, waitingOn: null });
    expect(back.proposals.filter(p => ids.includes(p.id)).every(p => p.status === 'proposed' && p.eventRef === null && p.undoUntil === null)).toBe(true);
    expect(w.calendar.cancelled).toHaveLength(2);
    expect(w.calendar.events.filter(e => e.title.startsWith('Utvecklingssamtal'))).toEqual([]);
    expect(actions(w.store, t.id)).toEqual(['thread.pushed', 'proposals.confirmed', 'proposals.undone']);
    await expect(w.undo(hillevi, t.id)).rejects.toThrow('Det finns inget att ångra.');
    await w.confirm(hillevi, t.id, ids);
    w.clock.advance(11 * MINUTE);
    await expect(w.undo(hillevi, t.id)).rejects.toThrow('Ångerfönstret på tio minuter har gått ut.');
    await w.closeUndoWindow(t.id);
    expect((await w.store.readThread('hillevi', t.id))!.proposals.filter(p => ids.includes(p.id)).every(p => p.status === 'final')).toBe(true);
    expect(w.store.audit.at(-1)).toMatchObject({ actor: 'assistant:timer', action: 'proposals.final', details: { proposals: ids } });
    const audit = w.store.audit.length;
    await w.closeUndoWindow(t.id);
    expect(w.store.audit.length).toBe(audit);
  });
  test('a failed write after the audit row leaves the calendar undone and nothing in the store', async () => {
    const w = world();
    const t = (await w.ensureProposalThread(hillevi))!;
    const faulty = { ...w.store, transaction: <T,>(fn: (tx: Parameters<Parameters<typeof w.store.transaction>[0]>[0]) => Promise<T>) =>
      w.store.transaction(tx => fn({ ...tx, async scheduleJob() { throw new Error('job table away'); } })) };
    const usecases = calendarUsecases({ ...w.deps, store: faulty, ids: () => 'x' });
    await expect(usecases.confirm(hillevi, t.id, [t.proposals[0]!.id])).rejects.toThrow('job table away');
    expect((await w.store.readThread('hillevi', t.id))!.thread).toMatchObject({ state: 'open', messages: t.messages });
    expect(actions(w.store, t.id)).toEqual(['thread.pushed']);
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
    const done = await w.confirm(hillevi, t.id, t.proposals.map(p => p.id));
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
  test('a no draws two other times for that one person and puts the thread back under Nu; sending one removes the old invitation', async () => {
    const w = world();
    const t = (await w.ensureProposalThread(hillevi))!;
    await w.confirm(hillevi, t.id, t.proposals.map(p => p.id));
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
    const old = back.proposals.find(p => p.status === 'declined-by-invitee')!;
    const rebooked = await w.confirm(hillevi, t.id, [alternatives[0]!.id]);
    expect(w.calendar.cancelled).toEqual([old.eventRef!]);
    expect(rebooked.proposals.find(p => p.id === alternatives[0]!.id)!.status).toBe('confirmed');
    expect(rebooked.proposals.find(p => p.id === old.id)).toBeUndefined();
    expect(w.store.audit.at(-1)).toMatchObject({ action: 'proposals.confirmed', details: { replaced: [old.id] } });
  });
  test('the follow-up: a card in the invitee\'s own stream two workdays later, at most twice, then the thread comes back on the Friday review', async () => {
    const w = world();
    const t = (await w.ensureProposalThread(hillevi))!;
    const sent = await w.confirm(hillevi, t.id, t.proposals.map(p => p.id));
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
    // The workflow reminds: one card per silent invitee, in their own stream, with the Friday as its deadline.
    w.clock.advance(2 * 24 * 60 * MINUTE);
    const check = await w.obligationCheck(t.id);
    expect(check).toMatchObject({ action: 'return', why: 'deadline' });
    await w.remindInvitees(t.id, 'assistant:obligation');
    expect(w.notified.map(n => n.personId).sort()).toEqual(['anna', 'erik', 'johan', 'maria']);
    expect(w.notified[0]!.draft).toMatchObject({ topic: 'samtal-svar:' + sent.proposals[0]!.id, area: 'kalender', title: 'Svara på inbjudan till utvecklingssamtal', deadline: '2026-11-06', actions: [] });
    expect(w.notified[0]!.draft.summary).toMatch(/^Hillevi Berg väntar på ditt svar om utvecklingssamtalet .* Svara i din kalender\.$/);
    const reminded = (await w.store.readThread('hillevi', t.id))!.proposals;
    expect(reminded.every(p => p.reminders === 1 && p.remindedAt === w.clock().toISOString())).toBe(true);
    expect(w.store.audit.at(-1)).toMatchObject({ actor: 'assistant:obligation', action: 'obligation.reminded', details: { pushed: sent.proposals.map(p => p.id), skipped: [] } });
    // The manager may remind by hand too, as themselves; a stranger may not.
    await w.remindInvitees(t.id, hillevi);
    expect(w.store.audit.at(-1)).toMatchObject({ actor: 'person:hillevi', action: 'obligation.reminded' });
    await expect(w.remindInvitees(t.id, hassan)).rejects.toThrow('Kortet finns inte.');
    // The Friday review: the thread is back under Nu with the sum and the names of the silent.
    await w.returnObligation(t.id, 'deadline');
    const returned = (await w.store.readThread('hillevi', t.id))!.thread;
    expect(returned).toMatchObject({ state: 'open', handledAt: null, deadline: '2026-11-06' });
    expect(returned.summary).toBe('0 av 4 har svarat ja. 4 har inte svarat efter 2 påminnelser: Anna Lindqvist, Erik Sandström, Maria Källström, Johan Byström.');
    expect(w.store.audit.at(-1)).toMatchObject({ actor: 'assistant:obligation', action: 'obligation.returned', details: { why: 'deadline', step: 'inbjudningar' } });
    // Everyone answered: the sum is written and the thread stays handled.
    const w2 = world();
    const t2 = (await w2.ensureProposalThread(hillevi))!;
    await w2.confirm(hillevi, t2.id, t2.proposals.map(p => p.id));
    for (const m of members) accept(w2, m.email, 'accepted');
    await w2.readReplies(t2.id);
    expect(await w2.obligationCheck(t2.id)).toMatchObject({ action: 'return', why: 'answered' });
    await w2.returnObligation(t2.id, 'answered');
    expect((await w2.store.readThread('hillevi', t2.id))!.thread).toMatchObject({ state: 'handled', waitingOn: null, summary: 'Alla 4 har svarat: 4 ja.' });
  });
  test('ångra on the confirmation ends the follow-ups', async () => {
    const w = world();
    const t = (await w.ensureProposalThread(hillevi))!;
    await w.confirm(hillevi, t.id, t.proposals.map(p => p.id));
    await w.undo(hillevi, t.id);
    expect(w.obligations.cancelled).toEqual([t.id]);
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
