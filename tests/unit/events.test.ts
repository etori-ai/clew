import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { memoryCalendar, occurrence } from '../../packages/calendar/src/memory';
import { localInstant } from '../../packages/calendar/src/dates';
import type { UnitMember } from '../../packages/calendar/src/accounts';
import { memoryObligations, memoryProposalStore } from '../../apps/server/src/modules/calendar/adapters/memory';
import { calendarUsecases } from '../../apps/server/src/modules/calendar/usecases/samtal';
import { eventUsecases } from '../../apps/server/src/modules/calendar/usecases/events';

/**
 * A person's own bookings and proposal moves (D28) without Nextcloud or Postgres (D25): the memory calendar refuses
 * what the CalDAV adapter refuses (stale revision, someone else's event), the store is in memory, the clock is the test's.
 */
const persona = (id: string, role: 'manager' | 'employee'): AuthenticatedContext => ({ id, name: id === 'hillevi' ? 'Hillevi Berg' : 'Hassan Ali', unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role,
  organisationId: 'sundsvall', principal: { id: 'person:' + id, kind: 'person' }, capabilities: [], authorizationVersion: 'v1', sessionBinding: 'test', expiresAt: '2099-01-01T00:00:00.000Z', async authorize() { return { version: 'v1' }; } });
const hillevi = persona('hillevi', 'manager');
const account = { ref: 'memory:account:hillevi', email: 'hillevi@clew.test', name: 'Hillevi Berg' };
const members: UnitMember[] = ['Anna Lindqvist', 'Erik Sandström'].map(name => {
  const first = name.split(' ')[0]!.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  return { personId: first, ref: 'memory:account:' + first, email: first + '@clew.test', name };
});
const anna = members[0]!;
const T0 = '2026-11-04T07:00:00.000Z'; // a Wednesday; the next week starts 2026-11-09
const at = (local: string) => localInstant(local);
function fakeClock(start = T0) { let now = Date.parse(start); const clock = () => new Date(now); return Object.assign(clock, { advance(ms: number) { now += ms; } }); }
function world() {
  const calendar = memoryCalendar(account), store = memoryProposalStore(), clock = fakeClock();
  let n = 0;
  const bind = (p: AuthenticatedContext) => ({ provider: calendar, members: p.role === 'manager' ? members : [] });
  const ids = () => `id-${++n}`;
  const samtal = calendarUsecases({ store, bind, clock, ids, people: { personaFor: async () => hillevi }, notify: async () => undefined, obligations: memoryObligations() });
  return { calendar, store, clock, samtal, ...eventUsecases({ store, bind, clock, ids }) };
}
const booking = { title: 'Ledningsgrupp', start: at('2026-11-05T10:00'), end: at('2026-11-05T11:00'), participants: [anna.email] };

describe('a booking of one\'s own', () => {
  test('creates the event with the unit members as guests and writes one audit row on the event', async () => {
    const w = world();
    w.calendar.rooms.push({ ref: 'room:a12', name: 'A12', email: 'a12@clew.test', capacity: 8, equipment: ['skärm'] });
    const event = await w.createEvent(hillevi, { ...booking, room: 'room:a12' });
    expect(event).toMatchObject({ title: 'Ledningsgrupp', start: booking.start, end: booking.end, mine: true, canCancel: true, room: 'A12', participants: ['Anna Lindqvist'], organizer: 'Hillevi Berg', ref: 'memory:clew-event-id-1', revision: 'r1' });
    expect(w.calendar.events.map(e => e.uid)).toEqual(['clew-event-id-1']);
    expect(w.store.audit).toEqual([{ actor: 'person:hillevi', action: 'event.created', subject: 'event:memory:clew-event-id-1', at: T0, details: { uid: 'clew-event-id-1', start: booking.start, end: booking.end, participants: 1, room: 'A12', readBack: false } }]);
  });
  test('refuses an empty title, a window that ends first, a day-long window and a guest outside the unit, before anything is written', async () => {
    const w = world();
    await expect(w.createEvent(hillevi, { ...booking, title: '  ' })).rejects.toThrow('Ge mötet en rubrik.');
    await expect(w.createEvent(hillevi, { ...booking, end: booking.start })).rejects.toThrow('Sluttiden måste vara efter starttiden.');
    await expect(w.createEvent(hillevi, { ...booking, end: at('2026-11-06T11:00') })).rejects.toThrow('Ett möte kan vara högst ett dygn.');
    await expect(w.createEvent(hillevi, { ...booking, participants: ['someone@elsewhere.test'] })).rejects.toThrow('Deltagarna måste tillhöra din enhet.');
    await expect(w.createEvent(hillevi, { ...booking, room: 'room:nowhere' })).rejects.toThrow('Du får inte boka det valda rummet.');
    expect(w.calendar.events).toEqual([]);
    expect(w.store.audit).toEqual([]);
  });
  test('a lost reply is recorded as unknown and told in Swedish', async () => {
    const w = world();
    w.calendar.options.failCreate = true;
    await expect(w.createEvent(hillevi, booking)).rejects.toThrow('Bokningsresultatet är osäkert. Kontrollera kalendern innan du försöker igen.');
    expect(w.store.audit).toEqual([{ actor: 'person:hillevi', action: 'event.create_unknown', subject: 'event:clew-event-id-1', at: T0, details: { start: booking.start, end: booking.end, participants: 1, room: null, reason: 'The calendar did not answer.' } }]);
  });
  test('a reply lost after the write is read back by uid and counts as created', async () => {
    const w = world();
    const create = w.calendar.create.bind(w.calendar);
    w.calendar.create = async (uid, input) => { await create(uid, input); throw new Error('The calendar did not answer.'); };
    const event = await w.createEvent(hillevi, booking);
    expect(event.ref).toBe('memory:clew-event-id-1');
    expect(w.store.audit.map(e => [e.action, e.details?.readBack])).toEqual([['event.created', true]]);
  });
});

describe('moving and cancelling a booking', () => {
  test('moves a meeting the person organises at the revision they saw, and audits from and to', async () => {
    const w = world();
    const event = await w.createEvent(hillevi, booking);
    const moved = await w.rescheduleEvent(hillevi, { ref: event.ref, revision: event.revision, start: at('2026-11-05T13:00'), end: at('2026-11-05T14:00') });
    expect(moved).toMatchObject({ ref: event.ref, start: at('2026-11-05T13:00'), end: at('2026-11-05T14:00'), revision: 'r1+' });
    expect(w.store.audit.at(-1)).toEqual({ actor: 'person:hillevi', action: 'event.rescheduled', subject: 'event:' + event.ref, at: T0, details: { from: { start: booking.start, end: booking.end }, to: { start: at('2026-11-05T13:00'), end: at('2026-11-05T14:00') }, revision: 'r1' } });
  });
  test('refuses a stale revision, someone else\'s meeting, a recurring one and a vanished one, with no audit row', async () => {
    const w = world();
    const event = await w.createEvent(hillevi, booking);
    const rows = w.store.audit.length;
    const later = { start: at('2026-11-05T13:00'), end: at('2026-11-05T14:00') };
    await expect(w.rescheduleEvent(hillevi, { ref: event.ref, revision: 'old', ...later })).rejects.toThrow('Mötet har ändrats sedan sidan lästes. Läs om och försök igen.');
    w.calendar.events.push(occurrence({ uid: 'theirs', title: 'Deras möte', start: at('2026-11-06T09:00'), end: at('2026-11-06T10:00'), organizer: 'rektor@clew.test', canCancel: false }, account));
    await expect(w.rescheduleEvent(hillevi, { ref: 'memory:theirs', revision: 'r1', ...later })).rejects.toThrow('Du kan bara flytta möten du själv har bokat.');
    w.calendar.events.push(occurrence({ uid: 'weekly', title: 'Veckomöte', start: at('2026-11-06T09:00'), end: at('2026-11-06T10:00'), recurring: true }, account));
    await expect(w.rescheduleEvent(hillevi, { ref: 'memory:weekly', revision: 'r1', ...later })).rejects.toThrow('Bara enstaka möten med klockslag kan flyttas.');
    await expect(w.rescheduleEvent(hillevi, { ref: 'memory:gone', revision: 'r1', ...later })).rejects.toThrow('Mötet finns inte längre.');
    await expect(w.cancelEvent(hillevi, { ref: 'memory:theirs', revision: 'r1' })).rejects.toThrow('Bara den som bokat mötet kan ställa in det.');
    await expect(w.cancelEvent(hillevi, { ref: event.ref, revision: 'old' })).rejects.toThrow('Mötet har ändrats sedan sidan lästes. Läs om och försök igen.');
    expect(w.store.audit.length).toBe(rows);
  });
  test('cancels a meeting the person organises and audits it', async () => {
    const w = world();
    const event = await w.createEvent(hillevi, booking);
    expect(await w.cancelEvent(hillevi, { ref: event.ref, revision: event.revision })).toEqual({ cancelled: true });
    expect(w.calendar.cancelled).toEqual([event.ref]);
    expect(w.store.audit.at(-1)).toEqual({ actor: 'person:hillevi', action: 'event.cancelled', subject: 'event:' + event.ref, at: T0, details: { start: booking.start, end: booking.end, participants: 1, revision: 'r1' } });
  });
});

describe('a proposal moved by the person', () => {
  const draw = async (w: ReturnType<typeof world>) => {
    const t = (await w.samtal.ensureProposalThread(hillevi))!;
    return { t, p: t.proposals.find(p => p.participant.email === anna.email)! };
  };
  test('takes the new time, keeps the length, rewrites the row, tells the thread and audits from and to; nothing is sent', async () => {
    const w = world();
    const { t, p } = await draw(w);
    const start = at('2026-11-11T14:00'), end = at('2026-11-11T15:00');
    const thread = await w.moveProposal(hillevi, t.id, p.id, { start, end });
    expect(thread.proposals.find(x => x.id === p.id)).toMatchObject({ status: 'proposed', start, end, eventRef: null });
    expect(thread.items.find(i => i.ref === 'proposal:' + p.id)).toMatchObject({ label: 'Anna Lindqvist', detail: 'ons 11 nov. 14:00–15:00', selected: true });
    expect(thread.messages.slice(-2).map(m => [m.role, m.body])).toEqual([['user', 'Flytta Anna Lindqvist till ons 11 nov. 14:00–15:00'], ['assistant', 'Anna Lindqvists samtal ligger nu ons 11 nov. 14:00–15:00. Inget är skickat förrän du bekräftar.']]);
    expect(w.store.audit.at(-1)).toEqual({ actor: 'person:hillevi', action: 'proposal.moved', subject: 'thread:' + t.id, at: T0, details: { proposal: p.id, from: { start: p.start, end: p.end }, to: { start, end } } });
    expect(w.calendar.events).toEqual([]);
  });
  test('refuses a changed length, a past time, a clash with the manager, a clash with the invitee and an unreadable calendar', async () => {
    const w = world();
    const { t, p } = await draw(w);
    const rows = w.store.audit.length;
    await expect(w.moveProposal(hillevi, t.id, p.id, { start: at('2026-11-11T14:00'), end: at('2026-11-11T14:30') })).rejects.toThrow('Samtalet behåller sin längd. Ange en ny starttid.');
    await expect(w.moveProposal(hillevi, t.id, p.id, { start: at('2026-11-03T14:00'), end: at('2026-11-03T15:00') })).rejects.toThrow('Välj en kommande tid.');
    w.calendar.events.push(occurrence({ uid: 'busy', title: 'Upptaget', start: at('2026-11-11T14:30'), end: at('2026-11-11T15:30') }, account));
    await expect(w.moveProposal(hillevi, t.id, p.id, { start: at('2026-11-11T14:00'), end: at('2026-11-11T15:00') })).rejects.toThrow('Tiden ons 11 nov. 14:00–15:00 krockar med din kalender.');
    const other = t.proposals.find(x => x.id !== p.id)!;
    await expect(w.moveProposal(hillevi, t.id, p.id, { start: other.start, end: other.end })).rejects.toThrow('krockar med din kalender');
    w.calendar.options.busy[anna.ref] = [{ start: at('2026-11-12T13:00'), end: at('2026-11-12T14:00') }];
    await expect(w.moveProposal(hillevi, t.id, p.id, { start: at('2026-11-12T13:30'), end: at('2026-11-12T14:30') })).rejects.toThrow('Anna Lindqvist är upptagen tors 12 nov. 13:30–14:30.');
    w.calendar.options.busy[anna.ref] = 'unknown';
    await expect(w.moveProposal(hillevi, t.id, p.id, { start: at('2026-11-12T15:00'), end: at('2026-11-12T16:00') })).rejects.toThrow('Medarbetarens kalender kunde inte läsas just nu.');
    await expect(w.moveProposal(hillevi, t.id, 'nope', { start: at('2026-11-12T15:00'), end: at('2026-11-12T16:00') })).rejects.toThrow('Förslaget är inte längre aktuellt. Läs om sidan.');
    expect(w.store.audit.length).toBe(rows);
    expect((await w.store.readThread(hillevi.id, t.id))!.proposals.find(x => x.id === p.id)).toMatchObject({ start: p.start, end: p.end });
  });
});

describe('the day and the free-busy check', () => {
  test('a day view holds that day\'s events and proposals only', async () => {
    const w = world();
    const { t } = await draw(w);
    await w.createEvent(hillevi, booking);
    const day = await w.dayView(hillevi, '2026-11-05');
    expect(day.from).toBe('2026-11-05');
    expect(day.events.map(e => e.title)).toEqual(['Ledningsgrupp']);
    expect(day.proposals).toEqual([]);
    const first = t.proposals[0]!;
    expect((await w.dayView(hillevi, first.start.slice(0, 10))).proposals.map(p => p.id)).toContain(first.id);
    await expect(w.dayView(hillevi, 'next week')).rejects.toThrow('Ogiltigt datum.');
    async function draw(w: ReturnType<typeof world>) { return { t: (await w.samtal.ensureProposalThread(hillevi))! }; }
  });
  test('says who is free, who is busy, who cannot be read, and whether the person is free themselves', async () => {
    const w = world();
    w.calendar.rooms.push({ ref: 'room:a12', name: 'A12', email: 'a12@clew.test', capacity: 8, equipment: [] });
    w.calendar.options.busy[anna.ref] = [{ start: at('2026-11-05T10:30'), end: at('2026-11-05T11:30') }];
    w.calendar.options.busy[members[1]!.ref] = 'unknown';
    await w.createEvent(hillevi, { ...booking, participants: [] });
    const result = await w.checkAvailability(hillevi, { start: booking.start, end: booking.end, participants: [anna.email, members[1]!.email], room: 'room:a12' });
    expect(result).toEqual({ mine: 'busy', participants: [{ email: anna.email, name: 'Anna Lindqvist', state: 'busy' }, { email: members[1]!.email, name: 'Erik Sandström', state: 'unknown' }], room: { ref: 'room:a12', name: 'A12', state: 'free' } });
    expect(await w.listMembers(hillevi)).toEqual(members.map(m => ({ name: m.name, email: m.email })));
    expect(await w.listRooms(hillevi)).toEqual([{ ref: 'room:a12', name: 'A12', capacity: 8, equipment: [] }]);
  });
});
