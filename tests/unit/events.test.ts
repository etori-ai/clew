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
    w.calendar.events.push(occurrence({ uid: 'seed', title: booking.title, start: booking.start, end: booking.end }, account));
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
    w.calendar.events.push(occurrence({ uid: 'seed', title: booking.title, start: booking.start, end: booking.end }, account));
    const result = await w.checkAvailability(hillevi, { start: booking.start, end: booking.end, participants: [anna.email, members[1]!.email], room: 'room:a12' });
    expect(result).toEqual({ mine: 'busy', participants: [{ email: anna.email, name: 'Anna Lindqvist', state: 'busy' }, { email: members[1]!.email, name: 'Erik Sandström', state: 'unknown' }], room: { ref: 'room:a12', name: 'A12', state: 'free' } });
    expect(await w.listMembers(hillevi)).toEqual(members.map(m => ({ name: m.name, email: m.email })));
    expect(await w.listRooms(hillevi)).toEqual([{ ref: 'room:a12', name: 'A12', capacity: 8, equipment: [] }]);
  });
});
