import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { memoryCalendar, occurrence, type MemoryCalendar } from '../../packages/calendar/src/memory';
import { FREE_BUSY_TARGETS } from '../../packages/calendar/src/model';
import { localInstant } from '../../packages/calendar/src/dates';
import { memoryObligations, memoryProposalStore } from '../../apps/server/src/modules/calendar/adapters/memory';
import type { ProposalRecord, UnitMember } from '../../apps/server/src/modules/calendar/model';
import { InputError } from '../../apps/server/src/context';
import { calendarUsecases } from '../../apps/server/src/modules/calendar/usecases/samtal';
import { eventUsecases } from '../../apps/server/src/modules/calendar/usecases/events';

/**
 * A person's own bookings and proposal moves (D28) without Nextcloud or Postgres (D25): the memory calendar refuses
 * what the CalDAV adapter refuses (stale revision, someone else's event), the store is in memory, the clock is the test's.
 */
const persona = (id: string, role: 'manager' | 'employee'): AuthenticatedContext => ({
  id,
  name: id === 'hillevi' ? 'Hillevi Berg' : 'Hassan Ali',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role,
  organisationId: 'sundsvall',
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  async authorize() {
    return { version: 'v1' };
  },
});
const hillevi = persona('hillevi', 'manager');
const account = { ref: 'memory:account:hillevi', email: 'hillevi@clew.test', name: 'Hillevi Berg' };
const members: UnitMember[] = ['Anna Lindqvist', 'Erik Sandström'].map(name => {
  const first = name
    .split(' ')[0]!
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z]/g, '');
  return { personId: first, ref: 'memory:account:' + first, email: first + '@clew.test', name };
});
const anna = members[0]!;
const T0 = '2026-11-04T07:00:00.000Z'; // a Wednesday; the next week starts 2026-11-09
const at = (local: string) => localInstant(local);
function fakeClock(start = T0) {
  let now = Date.parse(start);
  const clock = () => new Date(now);
  return Object.assign(clock, {
    advance(ms: number) {
      now += ms;
    },
  });
}
function world() {
  const calendar = memoryCalendar(account),
    store = memoryProposalStore(),
    clock = fakeClock();
  let n = 0;
  // Hillevi's calendar, and any other person's a test gives them.
  const calendars = new Map<string, MemoryCalendar>();
  const bind = (p: AuthenticatedContext) => ({ provider: calendars.get(p.id) ?? calendar });
  // The team as the directory has it now; a test may change an address.
  const setting = { team: members };
  const team = async (p: AuthenticatedContext) => (p.role === 'manager' ? setting.team : []);
  const ids = () => `id-${++n}`;
  const samtal = calendarUsecases({
    store,
    bind,
    team,
    round: async () => ({
      label: 'Utvecklingssamtal 2026',
      opensOn: '2026-09-01',
      dueOn: '2026-11-28',
      held: [],
      booked: [],
    }),
    clock,
    ids,
    people: { personaFor: async () => hillevi },
    notify: async () => undefined,
    obligations: memoryObligations(),
  });
  return { calendar, calendars, store, clock, samtal, setting, ...eventUsecases({ store, bind, team, clock, ids }) };
}
const booking = {
  title: 'Ledningsgrupp',
  start: at('2026-11-05T10:00'),
  end: at('2026-11-05T11:00'),
  participants: [anna.email],
};

describe('a proposal moved by the person', () => {
  const draw = async (w: ReturnType<typeof world>) => {
    const t = (await w.samtal.ensureProposalThread(hillevi))!;
    return { t, p: t.proposals.find(p => p.participant.email === anna.email)! };
  };
  test('takes the new time, keeps the length, rewrites the row, tells the thread and audits from and to; nothing is sent', async () => {
    const w = world();
    const { t, p } = await draw(w);
    const start = at('2026-11-11T14:00'),
      end = at('2026-11-11T15:00');
    const thread = await w.moveProposal(hillevi, t.id, p.id, { start, end });
    expect(thread.proposals.find(x => x.id === p.id)).toMatchObject({ status: 'proposed', start, end, eventRef: null });
    expect(thread.items.find(i => i.ref === 'proposal:' + p.id)).toMatchObject({
      label: 'Anna Lindqvist',
      detail: 'ons 11 nov. 14:00–15:00',
      selected: true,
    });
    expect(thread.messages.slice(-2).map(m => [m.role, m.body])).toEqual([
      ['user', 'Flytta Anna Lindqvist till ons 11 nov. 14:00–15:00'],
      ['assistant', 'Anna Lindqvists samtal ligger nu ons 11 nov. 14:00–15:00. Inget är skickat förrän du bekräftar.'],
    ]);
    expect(w.store.audit.at(-1)).toEqual({
      actor: 'person:hillevi',
      action: 'proposal.moved',
      subject: 'thread:' + t.id,
      at: T0,
      details: { proposal: p.id, from: { start: p.start, end: p.end }, to: { start, end } },
    });
    expect(w.calendar.events).toEqual([]);
  });
  test('refuses a changed length, a past time, a clash with the manager, a clash with the invitee and an unreadable calendar', async () => {
    const w = world();
    const { t, p } = await draw(w);
    const rows = w.store.audit.length;
    await expect(
      w.moveProposal(hillevi, t.id, p.id, { start: at('2026-11-11T14:00'), end: at('2026-11-11T14:30') }),
    ).rejects.toThrow('Samtalet behåller sin längd. Ange en ny starttid.');
    await expect(
      w.moveProposal(hillevi, t.id, p.id, { start: at('2026-11-03T14:00'), end: at('2026-11-03T15:00') }),
    ).rejects.toThrow('Välj en kommande tid.');
    w.calendar.events.push(
      occurrence(
        { uid: 'busy', title: 'Upptaget', start: at('2026-11-11T14:30'), end: at('2026-11-11T15:30') },
        account,
      ),
    );
    await expect(
      w.moveProposal(hillevi, t.id, p.id, { start: at('2026-11-11T14:00'), end: at('2026-11-11T15:00') }),
    ).rejects.toThrow('Tiden ons 11 nov. 14:00–15:00 krockar med din kalender.');
    const other = t.proposals.find(x => x.id !== p.id)!;
    await expect(w.moveProposal(hillevi, t.id, p.id, { start: other.start, end: other.end })).rejects.toThrow(
      'krockar med din kalender',
    );
    w.calendar.options.busy[anna.ref] = [{ start: at('2026-11-12T13:00'), end: at('2026-11-12T14:00') }];
    await expect(
      w.moveProposal(hillevi, t.id, p.id, { start: at('2026-11-12T13:30'), end: at('2026-11-12T14:30') }),
    ).rejects.toThrow('Anna Lindqvist är upptagen tors 12 nov. 13:30–14:30.');
    w.calendar.options.busy[anna.ref] = 'unknown';
    await expect(
      w.moveProposal(hillevi, t.id, p.id, { start: at('2026-11-12T15:00'), end: at('2026-11-12T16:00') }),
    ).rejects.toThrow('Medarbetarens kalender kunde inte läsas just nu.');
    await expect(
      w.moveProposal(hillevi, t.id, 'nope', { start: at('2026-11-12T15:00'), end: at('2026-11-12T16:00') }),
    ).rejects.toThrow('Förslaget är inte längre aktuellt. Läs om sidan.');
    expect(w.store.audit.length).toBe(rows);
    expect((await w.store.readThread(hillevi.id, t.id))!.proposals.find(x => x.id === p.id)).toMatchObject({
      start: p.start,
      end: p.end,
    });
  });
});

describe('a proposal whose invitee changed address since the draw (N3)', () => {
  test('is checked against the calendar the person has now, found by id, and keeps the address it was drawn with', async () => {
    const w = world();
    const t = (await w.samtal.ensureProposalThread(hillevi))!;
    const p = t.proposals.find(x => x.participant.email === anna.email)!;
    w.setting.team = members.map(m =>
      m.personId === anna.personId ? { ...m, email: 'anna.lindqvist@clew.test', ref: 'memory:account:anna-new' } : m,
    );
    w.calendar.options.busy['memory:account:anna-new'] = [
      { start: at('2026-11-12T13:00'), end: at('2026-11-12T14:00') },
    ];
    await expect(
      w.moveProposal(hillevi, t.id, p.id, { start: at('2026-11-12T13:30'), end: at('2026-11-12T14:30') }),
    ).rejects.toThrow('Anna Lindqvist är upptagen tors 12 nov. 13:30–14:30.');
    const start = at('2026-11-12T15:00');
    const thread = await w.moveProposal(hillevi, t.id, p.id, { start, end: at('2026-11-12T16:00') });
    expect(thread.proposals.find(x => x.id === p.id)).toMatchObject({
      start,
      participant: { email: 'anna@clew.test', name: 'Anna Lindqvist' },
    });
    expect(w.store.audit.at(-1)).toMatchObject({ action: 'proposal.moved', details: { proposal: p.id } });
  });
});

describe('the day and the free-busy check', () => {
  test("a day view holds that day's events and proposals only", async () => {
    const w = world();
    const { t } = await draw(w);
    w.calendar.events.push(
      occurrence({ uid: 'seed', title: booking.title, start: booking.start, end: booking.end }, account),
    );
    const day = await w.dayView(hillevi, '2026-11-05');
    expect(day.from).toBe('2026-11-05');
    expect(day.events.map(e => e.title)).toEqual(['Ledningsgrupp']);
    expect(day.proposals).toEqual([]);
    const first = t.proposals[0]!;
    expect((await w.dayView(hillevi, first.start.slice(0, 10))).proposals.map(p => p.id)).toContain(first.id);
    await expect(w.dayView(hillevi, 'next week')).rejects.toThrow('Ogiltigt datum.');
    async function draw(w: ReturnType<typeof world>) {
      return { t: (await w.samtal.ensureProposalThread(hillevi))! };
    }
  });
  test('says who is free, who is busy, who cannot be read, and whether the person is free themselves', async () => {
    const w = world();
    w.calendar.rooms.push({ ref: 'room:a12', name: 'A12', email: 'a12@clew.test', capacity: 8, equipment: [] });
    w.calendar.options.busy[anna.ref] = [{ start: at('2026-11-05T10:30'), end: at('2026-11-05T11:30') }];
    w.calendar.options.busy[members[1]!.ref] = 'unknown';
    w.calendar.events.push(
      occurrence({ uid: 'seed', title: booking.title, start: booking.start, end: booking.end }, account),
    );
    const result = await w.checkAvailability(hillevi, {
      start: booking.start,
      end: booking.end,
      participants: [anna.email, members[1]!.email],
      room: 'room:a12',
    });
    expect(result).toEqual({
      mine: 'busy',
      participants: [
        { email: anna.email, name: 'Anna Lindqvist', state: 'busy' },
        { email: members[1]!.email, name: 'Erik Sandström', state: 'unknown' },
      ],
      room: { ref: 'room:a12', name: 'A12', state: 'free' },
    });
    expect(await w.listMembers(hillevi)).toEqual(members.map(m => ({ name: m.name, email: m.email })));
    expect(await w.listRooms(hillevi)).toEqual([{ ref: 'room:a12', name: 'A12', capacity: 8, equipment: [] }]);
  });
});

describe('a date that does not exist, and a meeting of eight and a room (DE-L16)', () => {
  test('a day or a last day with the shape of a date that does not exist is the person’s mistake, not the server’s', async () => {
    const w = world();
    for (const work of [
      w.dayView(hillevi, '2026-02-30'),
      w.freeTimes(hillevi, { durationMinutes: 30, before: '2026-13-01' }),
    ]) {
      await expect(work).rejects.toBeInstanceOf(InputError);
    }
    await expect(w.dayView(hillevi, '2026-02-30')).rejects.toThrow('Ogiltigt datum.');
    expect((await w.dayView(hillevi, '2028-02-29')).from).toBe('2028-02-29');
  });
  test('eight members and a room are answered in one request of nine, more than a limit of eight would take', async () => {
    const w = world();
    const eight: UnitMember[] = Array.from({ length: 8 }, (_, i) => ({
      personId: 'p' + i,
      ref: 'memory:account:p' + i,
      email: `p${i}@clew.test`,
      name: `Person ${i}`,
    }));
    w.setting.team = eight;
    w.calendar.rooms.push({ ref: 'room:a12', name: 'A12', email: 'a12@clew.test', capacity: 12, equipment: [] });
    w.calendar.options.busy['memory:account:p7'] = [{ start: booking.start, end: booking.end }];
    const asked: number[] = [];
    const availability = w.calendar.availability.bind(w.calendar);
    w.calendar.availability = (start, end, targets) => {
      asked.push(targets.length);
      return availability(start, end, targets);
    };
    const result = await w.checkAvailability(hillevi, {
      start: booking.start,
      end: booking.end,
      participants: eight.map(m => m.email),
      room: 'room:a12',
    });
    expect(asked).toEqual([9]);
    expect(result.participants.map(p => p.state)).toEqual([...Array(7).fill('free'), 'busy']);
    expect(result.room).toEqual({ ref: 'room:a12', name: 'A12', state: 'free' });
  });
  test('the memory calendar answers as many targets as one request takes, and refuses one more, as the adapters do', async () => {
    const w = world();
    const targets = Array.from({ length: FREE_BUSY_TARGETS + 1 }, (_, i) => ({
      ref: `p${i}`,
      email: `p${i}@clew.test`,
    }));
    const full = targets.slice(0, FREE_BUSY_TARGETS);
    expect(FREE_BUSY_TARGETS).toBe(20);
    expect((await w.calendar.freeBusy(booking.start, booking.end, full)).map(b => b.ref)).toEqual(full.map(t => t.ref));
    expect((await w.calendar.availability(booking.start, booking.end, full)).map(b => b.ref)).toEqual(
      full.map(t => t.ref),
    );
    await expect(w.calendar.freeBusy(booking.start, booking.end, targets)).rejects.toThrow(
      'Ogiltig tillgänglighetsperiod.',
    );
    await expect(w.calendar.availability(booking.start, booking.end, targets)).rejects.toThrow(
      'Ogiltig tillgänglighetsperiod.',
    );
  });
});

describe('whose meeting it is, and which is a talk’s (DE-M8, WA-L5)', () => {
  test('an appointment without an organiser is the person’s own; a talk’s meeting is marked by the id Clew stored, never by its title', async () => {
    const w = world();
    const day = (from: string, to: string) => ({ start: at(`2026-11-05T${from}`), end: at(`2026-11-05T${to}`) });
    w.calendar.events.push(
      occurrence(
        { uid: 'alone', title: 'Tandläkare', ...day('08:00', '09:00'), organizer: '', organizerName: '' },
        account,
      ),
      occurrence(
        {
          uid: 'theirs',
          title: 'Möte',
          ...day('10:00', '11:00'),
          organizer: anna.email,
          organizerName: 'A. L.',
          canCancel: false,
        },
        account,
      ),
      // Clew's invitation to Anna's talk, renamed in the calendar.
      occurrence({ uid: 'renamed', title: 'Avstämning', ...day('13:00', '14:00') }, account),
      // A unit's own meeting that carries a talk's title.
      occurrence({ uid: 'lookalike', title: 'Utvecklingssamtal · Anna Lindqvist', ...day('15:00', '16:00') }, account),
      // A meeting with guests that names no organiser: nobody's the calendar says, so neither Hillevi's nor movable.
      occurrence(
        {
          uid: 'unowned',
          title: 'Fika',
          ...day('16:00', '17:00'),
          organizer: '',
          organizerName: '',
          canCancel: false,
          participants: [{ email: anna.email, name: anna.name, response: 'accepted', resource: false }],
        },
        account,
      ),
    );
    const record: ProposalRecord = {
      id: 'invitation',
      threadId: 'talks',
      personId: hillevi.id,
      status: 'confirmed',
      participant: { personId: anna.personId, email: anna.email, name: anna.name },
      ...day('13:00', '14:00'),
      eventUid: 'renamed',
      eventRef: 'memory:renamed',
      eventRevision: 'r1',
      eventIcalUid: 'renamed',
      confirmedAt: T0,
      undoUntil: null,
      reminders: 0,
      remindedAt: null,
    };
    await w.store.transaction(async tx => {
      await tx.insertThread({
        id: 'talks',
        personId: hillevi.id,
        topic: 'utvecklingssamtal:talks',
        title: 'Planera utvecklingssamtal',
        week: '2026-11-02',
        area: 'utvecklingssamtal',
        summary: '',
        trigger: { reason: 'Test', source: 'Test', at: T0 },
        createdAt: T0,
        updatedAt: T0,
      });
      await tx.insertProposals([record]);
    });
    const seen = (events: { title: string; mine: boolean; organizer: string; talk?: true }[]) =>
      events.map(e => [e.title, e.mine, e.organizer, e.talk ?? false]);
    expect(seen((await w.dayView(hillevi, '2026-11-05')).events)).toEqual([
      ['Tandläkare', true, 'Hillevi Berg', false],
      ['Möte', false, 'Anna Lindqvist', false],
      ['Avstämning', true, 'Hillevi Berg', true],
      ['Utvecklingssamtal · Anna Lindqvist', true, 'Hillevi Berg', false],
      ['Fika', false, 'Okänd', false],
    ]);
    // Anna's copy of the invitation is her own event, with a reference of its own in her calendar: it is known by the
    // uid Clew gave the event, which every copy keeps, never by Hillevi's reference.
    const annaAccount = { ref: 'memory:account:anna', email: anna.email, name: anna.name };
    w.calendars.set(
      'anna',
      memoryCalendar(annaAccount, [
        occurrence(
          {
            uid: 'renamed',
            ref: 'memory:anna:invitation',
            title: 'Avstämning',
            ...day('13:00', '14:00'),
            organizer: account.email,
            organizerName: account.name,
            canCancel: false,
          },
          annaAccount,
        ),
        occurrence({ uid: 'own', ref: 'memory:renamed', title: 'Eget', ...day('15:00', '16:00') }, annaAccount),
      ]),
    );
    const asAnna = { ...persona('anna', 'employee'), name: 'Anna Lindqvist' };
    expect((await w.dayView(asAnna, '2026-11-05')).events.map(e => [e.title, e.talk ?? false])).toEqual([
      ['Avstämning', true],
      // Her own meeting that happens to sit under Hillevi's reference in her calendar is no talk's.
      ['Eget', false],
    ]);
    // The day's proposals and the talks' meetings are read from one read of the person's proposals.
    let reads = 0;
    const active = w.store.activeProposals.bind(w.store);
    w.store.activeProposals = personId => {
      reads++;
      return active(personId);
    };
    await w.dayView(hillevi, '2026-11-05');
    expect(reads).toBe(1);
  });
});
