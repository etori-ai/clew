import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { memoryCalendar, occurrence } from '../../packages/calendar/src/memory';
import { localInstant } from '../../packages/calendar/src/dates';
import type { UnitMember } from '../../packages/calendar/src/accounts';
import { memoryProposalStore } from '../../apps/server/src/modules/calendar/adapters/memory';
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
  const calendar = memoryCalendar(account), store = memoryProposalStore(), clock = fakeClock();
  let n = 0;
  const usecases = calendarUsecases({ store, bind: p => ({ provider: calendar, members: p.role === 'manager' ? members : [] }), clock, ids: () => `id-${++n}` });
  return { calendar, store, clock, ...usecases };
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
    await expect(w.replan(hassan, t.id, '2026-11-16')).rejects.toThrow('Tråden är redan hanterad.');
  });
});

describe('the human decision', () => {
  test('re-validates, writes the events, confirms the chosen proposals, declines the rest and opens a ten-minute undo window', async () => {
    const w = world();
    const t = (await w.ensureProposalThread(hillevi))!;
    const [a, b, ...rest] = t.proposals;
    const done = await w.confirm(hillevi, t.id, [a!.id, b!.id]);
    expect(done).toMatchObject({ state: 'handled', handledAt: T0 });
    expect(w.calendar.events.map(e => [e.title, e.participants[0]!.email]).sort()).toEqual([a, b].map(p => [`Utvecklingssamtal · ${p!.participant.name}`, p!.participant.email]).sort());
    const undoUntil = new Date(Date.parse(T0) + 10 * MINUTE).toISOString();
    expect(done.proposals.filter(p => p.status === 'confirmed').map(p => p.id).sort()).toEqual([a!.id, b!.id].sort());
    expect(done.proposals.find(p => p.id === a!.id)).toMatchObject({ undoUntil, eventRef: 'memory:clew-samtal-' + a!.id });
    expect(done.proposals.filter(p => p.status === 'declined').map(p => p.id).sort()).toEqual(rest.map(p => p.id).sort());
    expect(done.items.map(i => i.selected)).toEqual(t.proposals.map(p => [a!.id, b!.id].includes(p.id)));
    expect(done.messages.slice(-2).map(m => m.body)).toEqual(['Bekräftade 2 tider', '2 inbjudningar är skickade. Du kan ångra till 08:10.']);
    expect(w.store.audit.at(-1)).toEqual({ actor: 'person:hillevi', action: 'proposals.confirmed', subject: 'thread:' + t.id, at: T0, details: { proposals: [a!.id, b!.id], unknown: 0, undoUntil } });
    expect(w.store.jobs).toEqual([{ id: `undo-expiry:${t.id}:${Date.parse(T0)}`, kind: 'undo-expiry', runAt: undoUntil, payload: { threadId: t.id, personId: 'hillevi' } }]);
    // The invitations are in the calendar now, so the status counts them as held rather than booked.
    expect(await w.samtalStatus(hillevi)).toEqual({ held: 2, booked: 0, deadline: '28 november' });
    await expect(w.confirm(hillevi, t.id, [a!.id])).rejects.toThrow('Tråden är redan hanterad.');
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
    expect(back).toMatchObject({ state: 'open', handledAt: null });
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
    const usecases = calendarUsecases({ store: faulty, bind: () => ({ provider: w.calendar, members }), clock: w.clock, ids: () => 'x' });
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
    await expect(w.dismiss(hillevi, t.id)).rejects.toThrow('Tråden är redan hanterad.');
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
