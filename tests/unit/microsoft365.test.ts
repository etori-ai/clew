import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { AuthenticatedContext } from '../../packages/contracts/src';
import { fakeGraph, fakeGraphToken, type FakeGraphOptions } from '../../packages/calendar/src/fake-graph';
import { Microsoft365Provider } from '../../packages/calendar/src/microsoft365';
import { createCalendarProvider } from '../../packages/calendar/src/adapters';
import { CalendarError } from '../../packages/calendar/src/model';
import { calendarExecutionSource } from '../../apps/server/src/modules/calendar/usecases/decisions';
import { memoryExecutionStore } from '../../apps/server/src/modules/executions/adapters/memory';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import { calendarProviderContract } from '../calendar-provider-contract';

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

test('the approval flow books a room through the execution ledger and reads the booking back', async () => {
  const w = world();
  const room = (await w.hillevi.resources())[0]!;
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
    ...calendarExecutionSource(() => ({ provider: w.hillevi, members })),
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
  const input = { title: 'Planering', start, end, participants: ['anna@clew.test'], room: room.ref };
  const execution = await executions.approve(actor, {
    decisionId: 'book',
    operation: 'calendar.createEvent',
    payload: { items: [{ id: 'event', label: 'Planering', action: 'create', input }] },
  });
  await executions.progress(execution.id);
  expect(await executions.read(actor, execution.id)).toMatchObject({
    state: 'succeeded',
    result: { rows: [{ ref: 'event', outcome: 'done' }] },
  });
  const [booked] = await w.hillevi.list(dayStart, dayEnd);
  expect(booked).toMatchObject({ title: 'Planering', room: 'Eken', roomResponse: 'accepted' });
  expect(booked!.uid).toStartWith('clew-exec-');
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
    expect(event).toMatchObject({ title: 'Möte', uid: 'ical-1', recurring: true, canCancel: false });
    expect(event!.ref).toBe(`microsoft365:id:${Buffer.from('occurrence-1').toString('base64url')}`);
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
