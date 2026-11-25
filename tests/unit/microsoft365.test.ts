import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { AuthenticatedContext } from '../../packages/contracts/src';
import { fakeGraph, fakeGraphToken, type FakeGraphOptions } from '../../packages/calendar/src/fake-graph';
import { Microsoft365Provider } from '../../packages/calendar/src/microsoft365';
import { createCalendarProvider } from '../../packages/calendar/src/adapters';
import { CalendarError, FREE_BUSY_TARGETS, type MeetingInput } from '../../packages/calendar/src/model';
import { calendarExecutionSource } from '../../apps/server/src/modules/calendar/usecases/decisions';
import { memoryExecutionStore } from '../../apps/server/src/modules/executions/adapters/memory';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import { calendarProviderContract } from '../calendar-provider-contract';
import { bindCalendar } from '../../packages/calendar/src/accounts';
import { memoryProposalStore } from '../../apps/server/src/modules/calendar/adapters/memory';
import type { ProposalRecord } from '../../apps/server/src/modules/calendar/model';
import { eventUsecases } from '../../apps/server/src/modules/calendar/usecases/events';

const directory = {
  people: [
    { email: 'hillevi@clew.test', name: 'Hillevi Berg' },
    { email: 'anna@clew.test', name: 'Anna Lindqvist' },
  ],
  rooms: [{ email: 'eken@clew.test', name: 'Eken', capacity: 6, equipment: ['whiteboard'] }],
};
const servers: { stop(close: boolean): Promise<void> }[] = [];
afterAll(async () => {
  await Promise.all(servers.map(server => server.stop(true)));
});
function serve(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch });
  servers.push(server);
  return `${server.url.origin}/v1.0`;
}
const person = (url: string, email: string) =>
  new Microsoft365Provider(
    async () => fakeGraphToken(email),
    { email, name: directory.people.find(p => p.email === email)?.name ?? email },
    url,
  );
function world(options: Partial<FakeGraphOptions> = {}) {
  const graph = fakeGraph({ ...directory, ...options });
  const url = serve(graph.fetch);
  return { graph, url, hillevi: person(url, 'hillevi@clew.test'), anna: person(url, 'anna@clew.test') };
}
const start = '2030-05-06T09:00:00.000Z',
  end = '2030-05-06T10:00:00.000Z';
const dayStart = '2030-05-06T00:00:00.000Z',
  dayEnd = '2030-05-07T00:00:00.000Z';

let uids = 0;
const contract = world();
calendarProviderContract('Microsoft 365 over the local fake', {
  organizer: () => contract.hillevi,
  guest: () => contract.anna,
  guestEmail: 'anna@clew.test',
  uid: () => `contract-${++uids}`,
});

test('the factory builds the adapter from a credential, with the live address as the default', async () => {
  const provider = createCalendarProvider({
    kind: 'microsoft365',
    token: async () => 'token',
    account: { email: 'a@clew.test', name: 'A' },
  });
  expect(provider).toBeInstanceOf(Microsoft365Provider);
  expect(provider.account).toEqual({ ref: 'microsoft365:account:a@clew.test', email: 'a@clew.test', name: 'A' });
  expect(await provider.eventRef('uid-1')).toStartWith('microsoft365:uid:');
});

describe('a room answers after the booking', () => {
  const booked = async (w: ReturnType<typeof world>) => {
    const room = (await w.hillevi.resources())[0]!;
    return w.hillevi.create('room-1', { title: 'Möte', start, end, participants: [], room: room.ref });
  };
  test('create returns pending, and a later read shows the answer', async () => {
    let now = 0;
    const w = world({ roomDelayMs: 2000, now: () => now });
    const event = await booked(w);
    expect(event).toMatchObject({ room: 'Eken', roomResponse: 'pending' });
    expect((await w.hillevi.lookup(event.ref))?.roomResponse).toBe('pending');
    now = 2000;
    expect((await w.hillevi.lookup(event.ref))?.roomResponse).toBe('accepted');
  });
  test('the answer changes the revision, so a stale undo is refused and a fresh one works', async () => {
    let now = 0;
    const w = world({ roomDelayMs: 2000, now: () => now });
    const event = await booked(w);
    now = 2000;
    await expect(w.hillevi.cancel(event.ref, event.revision)).rejects.toThrow('Mötet har ändrats');
    const fresh = (await w.hillevi.lookup(event.ref))!;
    await w.hillevi.cancel(fresh.ref, fresh.revision);
    expect(await w.hillevi.lookup(event.ref)).toBeNull();
  });
  test('moving a meeting asks the room again', async () => {
    let now = 0;
    const w = world({ roomDelayMs: 2000, now: () => now });
    const event = await booked(w);
    now = 2000;
    const answered = (await w.hillevi.lookup(event.ref))!;
    const moved = await w.hillevi.reschedule(answered.ref, answered.revision, dayEnd, '2030-05-07T01:00:00.000Z');
    expect(moved.roomResponse).toBe('pending');
  });
});

async function approved(w: ReturnType<typeof world>, input: MeetingInput) {
  const actor: AuthenticatedContext = {
    id: 'hillevi',
    name: 'Hillevi Berg',
    role: 'manager',
    unitId: 'unit',
    unitLabel: 'Unit',
    organisationId: 'org',
    principal: { id: 'person:hillevi', kind: 'person' },
    capabilities: [],
    authorizationVersion: '1',
    sessionBinding: 'test',
    expiresAt: '2099-01-01T00:00:00.000Z',
    authorize: async () => ({ version: '1' }),
  };
  const members = [{ ref: 'anna', personId: 'anna', email: 'anna@clew.test', name: 'Anna' }];
  const source = {
    ...calendarExecutionSource(
      () => ({ provider: w.hillevi }),
      async () => members,
      async () => new Set(),
    ),
    current: async () => actor,
  };
  let n = 0;
  const store = memoryExecutionStore();
  const executions = executionUsecases({
    store,
    source,
    clock: () => new Date('2030-05-01T12:00:00.000Z'),
    ids: () => `e${++n}`,
    digest: value => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  });
  const execution = await executions.approve(actor, {
    decisionId: 'book',
    operation: 'calendar.createEvent',
    payload: { items: [{ id: 'event', label: 'Planering', action: 'create', input }] },
  });
  await executions.progress(execution.id);
  return executions.read(actor, execution.id);
}
const planning = { title: 'Planering', start, end, participants: ['anna@clew.test'] };

test('the approval flow books a room through the execution ledger and reads the booking back', async () => {
  const w = world();
  const room = (await w.hillevi.resources())[0]!;
  expect(await approved(w, { ...planning, room: room.ref })).toMatchObject({
    state: 'succeeded',
    result: { rows: [{ ref: 'event', outcome: 'done' }] },
  });
  const [booked] = await w.hillevi.list(dayStart, dayEnd);
  expect(booked).toMatchObject({ title: 'Planering', room: 'Eken', roomResponse: 'accepted' });
  expect(booked!.uid).toStartWith('clew-exec-');
});

test('a booking offers no undo while its room has yet to answer, since the answer changes the revision', async () => {
  const w = world({ roomDelayMs: 2000, now: () => 0 });
  const room = (await w.hillevi.resources())[0]!;
  const waiting = await approved(w, { ...planning, room: room.ref });
  expect(waiting).toMatchObject({ state: 'succeeded' });
  expect(waiting?.result?.undoCapability).toBeUndefined();
  // The receipt is the read-back: it says why there is no undo (principle 5).
  expect(waiting?.result?.rows[0]?.detail).toBe(
    'Kontrollerat i kalendern. Rummet har inte svarat än, så bokningen kan inte ångras härifrån.',
  );
  expect((await approved(world(), planning))?.result?.undoCapability).toBe('calendar.undoProposals');
});

test('a room that says no is on the receipt, and the meeting has no room', async () => {
  const w = world();
  const room = (await w.hillevi.resources())[0]!;
  // Anna holds the room at that hour. The dispatch refuses a room it can see is taken, so the case a receipt can
  // meet is a room that looked free when checked and said no anyway: the check is answered free, the room decides.
  await w.anna.create('taken', { title: 'Upptaget', start, end, participants: [], room: room.ref });
  const roomLooksFree = Object.create(w.hillevi, {
    availability: {
      value: async (_s: string, _e: string, targets: { ref: string }[]) =>
        targets.map(t => ({ ref: t.ref, state: 'free' })),
    },
  }) as typeof w.hillevi;
  const refused = await approved({ ...w, hillevi: roomLooksFree }, { ...planning, participants: [], room: room.ref });
  expect(refused).toMatchObject({ state: 'succeeded', result: { rows: [{ ref: 'event', outcome: 'done' }] } });
  expect(refused?.result?.rows[0]?.detail).toBe('Kontrollerat i kalendern. Rummet tackade nej, så mötet saknar rum.');
  // The room has answered, so the revision is settled and the booking can be undone.
  expect(refused?.result?.undoCapability).toBe('calendar.undoProposals');
  const booked = (await w.hillevi.list(dayStart, dayEnd)).find(e => e.title === 'Planering');
  expect(booked).toMatchObject({ room: '', roomResponse: 'declined' });
});

describe('failures of the source', () => {
  const input = { title: 'Möte', start, end, participants: [] };
  test('a refused write is uncertain, and the repeat books once', async () => {
    const w = world();
    w.graph.failNext(500, { method: 'POST' });
    await expect(w.hillevi.create('refused-1', input)).rejects.toThrow('Bokningsresultatet är osäkert');
    expect(await w.hillevi.list(dayStart, dayEnd)).toEqual([]);
    await w.hillevi.create('refused-1', input);
    await w.hillevi.create('refused-1', input);
    expect(await w.hillevi.list(dayStart, dayEnd)).toHaveLength(1);
  });
  test('a write that landed but lost its reply is found by its reference and never doubled', async () => {
    const graph = fakeGraph(directory);
    let lose = true;
    const url = serve(async request => {
      const reply = await graph.fetch(request);
      if (request.method !== 'POST' || !lose) return reply;
      lose = false;
      return new Response('', { status: 500 });
    });
    const hillevi = person(url, 'hillevi@clew.test');
    await expect(hillevi.create('lost-1', input)).rejects.toThrow('Bokningsresultatet är osäkert');
    expect((await hillevi.lookup(await hillevi.eventRef('lost-1')))?.uid).toBe('lost-1');
    await hillevi.create('lost-1', input);
    expect(await hillevi.list(dayStart, dayEnd)).toHaveLength(1);
  });
  test('a throttled read waits for Retry-After, and a throttled write does not repeat', async () => {
    const w = world();
    w.graph.failNext(429, { headers: { 'Retry-After': '0' } });
    expect(await w.hillevi.list(dayStart, dayEnd)).toEqual([]);
    w.graph.failNext(429, { method: 'POST', headers: { 'Retry-After': '0' } });
    await expect(w.hillevi.create('t-1', input)).rejects.toThrow(CalendarError);
    expect(await w.hillevi.list(dayStart, dayEnd)).toEqual([]);
  });
  test('a long Retry-After is not waited for', async () => {
    const w = world();
    w.graph.failNext(429, { headers: { 'Retry-After': '120' } });
    await expect(w.hillevi.list(dayStart, dayEnd)).rejects.toThrow('Mötena kunde inte hämtas.');
  });
  test('a refused token reads as an error, and free-busy as unknown', async () => {
    const w = world();
    const stranger = new Microsoft365Provider(async () => 'wrong', directory.people[0]!, w.url);
    await expect(stranger.list(dayStart, dayEnd)).rejects.toThrow('Mötena kunde inte hämtas.');
    await expect(stranger.primaryCalendar()).rejects.toThrow('Kalenderkontot är inte tillgängligt.');
    expect(await stranger.freeBusy(dayStart, dayEnd, [{ ref: 'x', email: 'anna@clew.test' }])).toEqual([
      { ref: 'x', state: 'unknown', busy: [] },
    ]);
    expect(await person(w.url, 'hillevi@clew.test').primaryCalendar()).toBe('calendar-hillevi@clew.test');
  });
  test('a reference that is not ours is refused before any request', async () => {
    const w = world();
    await expect(w.hillevi.lookup('nextcloud:abc')).rejects.toThrow('Ogiltig kalenderreferens.');
    await expect(w.hillevi.lookup('microsoft365:id:ab=c')).rejects.toThrow('Ogiltig kalenderreferens.');
  });
  test('an accepted invitation reads as accepted while Graph has only queued the answer', async () => {
    const graph = fakeGraph(directory);
    const url = serve(request =>
      new URL(request.url).pathname.endsWith('/accept') ? new Response(null, { status: 202 }) : graph.fetch(request),
    );
    const hillevi = person(url, 'hillevi@clew.test'),
      anna = person(url, 'anna@clew.test');
    await hillevi.create('queued-1', { ...input, participants: ['anna@clew.test'] });
    const [invitation] = await anna.list(dayStart, dayEnd);
    const accepted = await anna.accept(invitation!.ref, invitation!.revision);
    expect(accepted.participants.find(p => p.email === 'anna@clew.test')?.response).toBe('accepted');
  });
  test('a booking under an address Graph knows the mailbox by otherwise is still the organiser’s own', async () => {
    const w = world();
    // The directory holds an alias; the mailbox signs in as itself and organises under its own address.
    const alias = new Microsoft365Provider(
      async () => fakeGraphToken('hillevi@clew.test'),
      { email: 'Hillevi.Berg@kommun.example', name: 'Hillevi Berg' },
      w.url,
    );
    const booked = await alias.create('alias-1', input);
    expect(booked).toMatchObject({ uid: 'alias-1', organizer: 'hillevi@clew.test', canCancel: true });
    await alias.cancel(booked.ref, booked.revision);
    expect(await alias.lookup(booked.ref)).toBeNull();
  });
  test('Graph answers twenty schedules in one request and refuses twenty-one, as the fake says it does', async () => {
    const w = world();
    const ask = (count: number) =>
      fetch(`${w.url}/me/calendar/getSchedule`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${fakeGraphToken('hillevi@clew.test')}`,
          'Content-Type': 'application/json',
          Prefer: 'outlook.timezone="UTC"',
        },
        body: JSON.stringify({
          schedules: Array.from({ length: count }, (_, i) => `p${i}@clew.test`),
          startTime: { dateTime: '2030-05-06T09:00:00', timeZone: 'UTC' },
          endTime: { dateTime: '2030-05-06T10:00:00', timeZone: 'UTC' },
        }),
      });
    const twenty = await ask(FREE_BUSY_TARGETS);
    expect(twenty.status).toBe(200);
    expect(((await twenty.json()) as { value: unknown[] }).value).toHaveLength(FREE_BUSY_TARGETS);
    expect((await ask(FREE_BUSY_TARGETS + 1)).status).toBe(400);
  });
  test('the fake answers a call it does not implement with 501', async () => {
    const w = world();
    const response = await fetch(`${w.url}/me/messages`, {
      headers: { Authorization: `Bearer ${fakeGraphToken('hillevi@clew.test')}` },
    });
    expect(response.status).toBe(501);
  });
});

describe('the Graph vocabulary, from the documented response shapes', () => {
  const organizer = { emailAddress: { name: 'Anna', address: 'anna@clew.test' } };
  const base = {
    '@odata.etag': 'W/"1"',
    id: 'occurrence-1',
    iCalUId: 'ical-1',
    subject: '',
    isAllDay: false,
    isOrganizer: false,
    start: { dateTime: '2030-05-06T09:00:00.0000000', timeZone: 'UTC' },
    end: { dateTime: '2030-05-06T10:00:00.0000000', timeZone: 'UTC' },
    organizer,
    attendees: [],
  };
  const replying = (value: unknown[], extra: Record<string, unknown> = {}) =>
    serve(() => Response.json({ value, ...extra }));
  const provider = (url: string) =>
    new Microsoft365Provider(async () => 'token', { email: 'hillevi@clew.test', name: 'Hillevi' }, url);

  test('an occurrence of a series is recurring, keeps its own id and cannot be cancelled', async () => {
    const [event] = await provider(replying([{ ...base, type: 'occurrence' }])).list(dayStart, dayEnd);
    expect(event).toMatchObject({ title: 'Möte', uid: 'ical-1', icalUid: 'ical-1', recurring: true, canCancel: false });
    expect(event!.ref).toBe(`microsoft365:id:${Buffer.from('occurrence-1').toString('base64url')}`);
  });
  test('whose copy it is comes from isOrganizer, never from comparing addresses', async () => {
    const mine = { emailAddress: { name: 'Hillevi', address: 'hillevi@clew.test' } };
    const [named, flagged] = await provider(
      replying([
        // Names the account as organiser, but Graph says this mailbox is not the one that organises it.
        { ...base, id: 'named', type: 'singleInstance', organizer: mine, isOrganizer: false },
        // Organised under another address of the same mailbox (an alias), which Graph says is this one.
        { ...base, id: 'flagged', type: 'singleInstance', isOrganizer: true },
      ]),
    ).list(dayStart, dayEnd);
    expect(named).toMatchObject({ organizer: 'hillevi@clew.test', canCancel: false });
    expect(flagged).toMatchObject({ organizer: 'anna@clew.test', canCancel: true });
  });
  test('an all-day event is a date with an exclusive end', async () => {
    const [event] = await provider(
      replying([
        {
          ...base,
          type: 'singleInstance',
          isAllDay: true,
          start: { dateTime: '2030-05-06T00:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2030-05-07T00:00:00.0000000', timeZone: 'UTC' },
        },
      ]),
    ).list(dayStart, dayEnd);
    expect(event).toMatchObject({ allDay: true, start: '2030-05-06', end: '2030-05-07' });
  });
  test('an all-day time that is not a UTC midnight is refused rather than moved to another day', async () => {
    const shifted = {
      ...base,
      type: 'singleInstance',
      isAllDay: true,
      start: { dateTime: '2030-05-05T22:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2030-05-06T22:00:00.0000000', timeZone: 'UTC' },
    };
    await expect(provider(replying([shifted])).list(dayStart, dayEnd)).rejects.toThrow('ogiltiga tider');
  });
  test('a cancelled copy is gone, and a time outside UTC is refused rather than guessed', async () => {
    expect(await provider(replying([{ ...base, isCancelled: true }])).list(dayStart, dayEnd)).toEqual([]);
    const shifted = { ...base, start: { dateTime: '2030-05-06T09:00:00', timeZone: 'Pacific Standard Time' } };
    await expect(provider(replying([shifted])).list(dayStart, dayEnd)).rejects.toThrow('ogiltiga tider');
  });
  test('answers translate, and my own answer comes from responseStatus on an invitation', async () => {
    const attendee = (address: string, response: string, type = 'required') => ({
      type,
      status: { response, time: '0001-01-01T00:00:00Z' },
      emailAddress: { name: address, address },
    });
    const [event] = await provider(
      replying([
        {
          ...base,
          responseStatus: { response: 'tentativelyAccepted' },
          attendees: [
            attendee('hillevi@clew.test', 'none'),
            attendee('a@clew.test', 'accepted'),
            attendee('b@clew.test', 'declined'),
            attendee('c@clew.test', 'notResponded'),
            attendee('d@clew.test', 'somethingNew'),
            attendee('rum@clew.test', 'tentativelyAccepted', 'resource'),
          ],
        },
      ]),
    ).list(dayStart, dayEnd);
    expect(event!.participants.map(p => p.response)).toEqual([
      'tentative',
      'accepted',
      'declined',
      'needs-action',
      'unknown',
      'tentative',
    ]);
    expect(event).toMatchObject({ room: 'rum@clew.test', roomResponse: 'pending' });
  });
  test('free-busy counts tentative and away as busy, working elsewhere as free, and clips to the window', async () => {
    const item = (status: string, from: string, to: string) => ({
      status,
      start: { dateTime: `2030-05-06T${from}:00.0000000`, timeZone: 'UTC' },
      end: { dateTime: `2030-05-06T${to}:00.0000000`, timeZone: 'UTC' },
    });
    const url = replying([
      {
        scheduleId: 'A@clew.test',
        scheduleItems: [
          item('busy', '07:00', '09:30'),
          item('tentative', '10:00', '10:30'),
          item('oof', '11:00', '11:30'),
          item('workingElsewhere', '12:00', '13:00'),
          item('free', '13:00', '14:00'),
        ],
      },
      { scheduleId: 'b@clew.test', scheduleItems: [item('unknown', '09:00', '10:00')] },
    ]);
    const [a, b, c] = await provider(url).freeBusy('2030-05-06T08:00:00.000Z', '2030-05-06T16:00:00.000Z', [
      { ref: 'a', email: 'a@clew.test' },
      { ref: 'b', email: 'b@clew.test' },
      { ref: 'c', email: 'c@clew.test' },
    ]);
    expect(a).toEqual({
      ref: 'a',
      state: 'known',
      busy: [
        { start: '2030-05-06T08:00:00.000Z', end: '2030-05-06T09:30:00.000Z' },
        { start: '2030-05-06T10:00:00.000Z', end: '2030-05-06T10:30:00.000Z' },
        { start: '2030-05-06T11:00:00.000Z', end: '2030-05-06T11:30:00.000Z' },
      ],
    });
    expect([b?.state, c?.state]).toEqual(['unknown', 'unknown']);
  });
  test('room equipment joins the device names and tags, and a room without an address is left out', async () => {
    const rooms = await provider(
      replying([
        {
          displayName: 'Tallen',
          emailAddress: 'tallen@clew.test',
          capacity: 12,
          videoDeviceName: 'Kamera',
          displayDeviceName: null,
          tags: ['whiteboard'],
        },
        { displayName: 'Utan adress' },
      ]),
    ).resources();
    expect(rooms.map(({ name, capacity, equipment }) => ({ name, capacity, equipment }))).toEqual([
      { name: 'Tallen', capacity: 12, equipment: ['Kamera', 'whiteboard'] },
    ]);
  });
  test('pages are followed on our own origin, and a next link elsewhere is refused', async () => {
    let calls = 0;
    const paged = serve(request => {
      calls++;
      return Response.json(
        new URL(request.url).searchParams.has('$skip')
          ? { value: [{ ...base, id: 'second', type: 'singleInstance' }] }
          : {
              value: [{ ...base, id: 'first', type: 'singleInstance' }],
              '@odata.nextLink': `${new URL(request.url).origin}/v1.0/me/calendarView?$skip=1`,
            },
      );
    });
    expect(await provider(paged).list(dayStart, dayEnd)).toHaveLength(2);
    expect(calls).toBe(2);
    await expect(
      provider(replying([], { '@odata.nextLink': 'https://elsewhere.example/v1.0/me/calendarView' })).list(
        dayStart,
        dayEnd,
      ),
    ).rejects.toThrow('Ogiltigt svar från kalendern.');
  });
  test('more than a hundred meetings asks for a shorter period', async () => {
    const value = Array.from({ length: 101 }, (_, i) => ({ ...base, id: `e${i}`, type: 'singleInstance' }));
    await expect(provider(replying(value)).list(dayStart, dayEnd)).rejects.toThrow('För många möten');
  });
});

describe('a talk’s meeting in the invitee’s calendar on Microsoft 365 (WA-L5)', () => {
  const as = (id: string, name: string, role: 'manager' | 'employee'): AuthenticatedContext => ({
    id,
    name,
    role,
    unitId: 'unit',
    unitLabel: 'Unit',
    organisationId: 'org',
    principal: { id: 'person:' + id, kind: 'person' },
    capabilities: [],
    authorizationVersion: '1',
    sessionBinding: 'test',
    expiresAt: '2099-01-01T00:00:00.000Z',
    authorize: async () => ({ version: '1' }),
  });
  const hillevi = as('hillevi', 'Hillevi Berg', 'manager'),
    anna = as('anna', 'Anna Lindqvist', 'employee');
  /** Hillevi's invitation to Anna's talk, sent and read back: what the ledger stores of it, with or without the shared id. */
  async function sent(w: ReturnType<typeof world>, keepsSharedId: boolean) {
    const event = await w.hillevi.create('clew-exec-talk', {
      title: 'Utvecklingssamtal',
      start,
      end,
      participants: ['anna@clew.test'],
    });
    const store = memoryProposalStore();
    const record: ProposalRecord = {
      id: 'invitation',
      threadId: 'talks',
      personId: hillevi.id,
      status: 'confirmed',
      participant: { personId: anna.id, email: 'anna@clew.test', name: anna.name },
      start,
      end,
      eventUid: event.uid,
      eventRef: event.ref,
      eventRevision: event.revision,
      eventIcalUid: keepsSharedId ? event.icalUid : null,
      confirmedAt: start,
      undoUntil: null,
      reminders: 0,
      remindedAt: null,
    };
    await store.transaction(async tx => {
      await tx.insertThread({
        id: 'talks',
        personId: hillevi.id,
        topic: 'utvecklingssamtal:talks',
        title: 'Planera utvecklingssamtal',
        week: '2030-05-06',
        area: 'utvecklingssamtal',
        summary: '',
        trigger: { reason: 'Test', source: 'Test', at: start },
        createdAt: start,
        updatedAt: start,
      });
      await tx.insertProposals([record]);
    });
    const reads = eventUsecases({
      store,
      bind: p => ({ provider: p.id === anna.id ? w.anna : w.hillevi }),
      team: async () => [],
      clock: () => new Date('2030-05-01T12:00:00.000Z'),
      ids: () => 'id',
    });
    return { event, reads };
  }
  test('is known by the id every copy carries, which the organiser’s copy gave when the invitation was read back', async () => {
    const w = world();
    const { event, reads } = await sent(w, true);
    const [copy] = await w.anna.list(dayStart, dayEnd);
    // Anna's copy has neither Clew's uid nor the organiser's reference: only the id Exchange gives every copy.
    expect(copy).toMatchObject({ icalUid: event.icalUid, canCancel: false });
    expect([copy!.uid, copy!.ref]).not.toContain(event.uid);
    expect(copy!.ref).not.toBe(event.ref);
    expect((await reads.dayView(anna, '2030-05-06')).events.map(e => [e.title, e.talk ?? false])).toEqual([
      ['Utvecklingssamtal', true],
    ]);
    expect((await reads.dayView(hillevi, '2030-05-06')).events.map(e => e.talk ?? false)).toEqual([true]);
  });
  test('without that id the invitee’s copy is not known, which is why it is stored', async () => {
    const { reads } = await sent(world(), false);
    expect((await reads.dayView(anna, '2030-05-06')).events.map(e => e.talk ?? false)).toEqual([false]);
  });
});

describe('the development sign-in to the fake of Graph (D69)', () => {
  test('is the person’s own login, never the address the directory holds for them', async () => {
    const w = world({
      people: [...directory.people, { email: 'mikael@clew.test', name: 'Mikael Lund' }],
    });
    const settings: Record<string, string | undefined> = {
      CLEW_POC: 'true',
      GRAPH_URL: w.url,
      CALENDAR_ADAPTER: 'microsoft365',
    };
    const before = Object.fromEntries(Object.keys(settings).map(k => [k, process.env[k]]));
    Object.assign(process.env, settings);
    try {
      // The directory holds Hillevi's address for Mikael by mistake: he still signs in to his own mailbox.
      const { provider } = bindCalendar({ id: 'mikael', name: 'Mikael Lund' }, 'hillevi@clew.test');
      expect(provider.account.email).toBe('hillevi@clew.test');
      expect(await provider.primaryCalendar()).toBe('calendar-mikael@clew.test');
    } finally {
      for (const [k, v] of Object.entries(before))
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
  });
});
