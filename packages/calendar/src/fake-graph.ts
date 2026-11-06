/**
 * A local fake of the part of Microsoft Graph v1.0 that the `microsoft365` adapter calls (D69), written from Microsoft's
 * public documentation. State lives in memory. It runs on Web `Request`/`Response`, so a test serves it on loopback and
 * `scripts/fake-graph.ts` serves it in the devcontainer. It is a test double: it proves the adapter agrees with our
 * reading of the documentation, not that Microsoft behaves this way. A call it does not implement answers 501 on purpose.
 */
import { sameEmail as same } from './model';
import { fakeGraphToken } from './accounts';

export { fakeGraphToken };

export interface FakePerson {
  email: string;
  name: string;
}
export interface FakeRoom extends FakePerson {
  capacity: number;
  equipment: string[];
}
export interface FakeGraphOptions {
  people: FakePerson[];
  rooms: FakeRoom[];
  /** How long a room takes to answer. With 0 it answers before the next request is served. */
  roomDelayMs?: number;
  now?: () => number;
}
export interface FakeGraph {
  fetch(request: Request): Promise<Response>;
  /** The next request, or the next with this method, answers this status without touching state. */
  failNext(status: number, options?: { method?: string; headers?: Record<string, string> }): void;
}

type Response_ = 'none' | 'organizer' | 'tentativelyAccepted' | 'accepted' | 'declined' | 'notResponded';
interface Attendee extends FakePerson {
  type: 'required' | 'optional' | 'resource';
  response: Response_;
}
interface Meeting {
  iCalUId: string;
  subject: string;
  start: number;
  end: number;
  organizer: FakePerson;
  attendees: Attendee[];
  location?: { displayName?: string; locationEmailAddress?: string };
  extended: { id: string; value: string }[];
  transactionId?: string;
  version: number;
  cancelled: boolean;
  roomsDue?: number;
  /** One event id per mailbox that holds a copy, by lower-case address. */
  copies: Map<string, string>;
}
const graphError = (status: number, code: string, message: string, headers?: Record<string, string>) =>
  Response.json({ error: { code, message } }, { status, ...(headers ? { headers } : {}) });
const notImplemented = (what: string) => graphError(501, 'FakeNotImplemented', `The fake does not implement ${what}.`);
const wire = (at: number) => ({
  dateTime: new Date(at).toISOString().replace(/\.(\d{3})Z$/, '.$10000'),
  timeZone: 'UTC',
});
const instant = (value: unknown) => {
  const { dateTime, timeZone } = (value ?? {}) as { dateTime?: unknown; timeZone?: unknown };
  if (typeof dateTime !== 'string' || timeZone !== 'UTC') return Number.NaN;
  return Date.parse(/[zZ]$/.test(dateTime) ? dateTime : `${dateTime}Z`);
};
const overlaps = (m: { start: number; end: number }, start: number, end: number) => m.start < end && start < m.end;
const selectIn = (query: URLSearchParams, event: Record<string, unknown>) => {
  const select = query.get('$select');
  if (!select) return event;
  const kept = new Set(['id', '@odata.etag', 'singleValueExtendedProperties', ...select.split(',')]);
  return Object.fromEntries(Object.entries(event).filter(([key]) => kept.has(key)));
};

export function fakeGraph(options: FakeGraphOptions): FakeGraph {
  const now = options.now ?? (() => Date.now());
  const delay = options.roomDelayMs ?? 0;
  const meetings: Meeting[] = [];
  const failures: { status: number; method?: string; headers?: Record<string, string> }[] = [];
  let sequence = 0;
  const nextId = () => `AAMk=${++sequence}`;
  const person = (email: string) => options.people.find(p => same(p.email, email));
  const room = (email: string) => options.rooms.find(r => same(r.email, email));
  const roomHolds = (email: string, m: Meeting) =>
    m.attendees.some(a => a.type === 'resource' && same(a.email, email) && a.response === 'accepted');

  /** The resource booking assistant: a room accepts unless it already holds an overlapping meeting. */
  function settleRooms() {
    for (const m of meetings) {
      if (m.cancelled || m.roomsDue === undefined || m.roomsDue > now()) continue;
      m.roomsDue = undefined;
      for (const a of m.attendees.filter(a => a.type === 'resource' && a.response === 'none')) {
        const taken = meetings.some(
          other => other !== m && !other.cancelled && overlaps(other, m.start, m.end) && roomHolds(a.email, other),
        );
        a.response = taken ? 'declined' : 'accepted';
        m.version++;
      }
    }
  }
  const copyOf = (mailbox: string, id: string) => meetings.find(m => m.copies.get(mailbox.toLowerCase()) === id);
  function render(m: Meeting, mailbox: FakePerson, query: URLSearchParams) {
    const organizer = same(m.organizer.email, mailbox.email);
    const own = m.attendees.find(a => same(a.email, mailbox.email));
    const expanded = query.get('$expand') ?? '';
    return selectIn(query, {
      '@odata.etag': `W/"${m.version}"`,
      id: m.copies.get(mailbox.email.toLowerCase()),
      iCalUId: m.iCalUId,
      changeKey: String(m.version),
      subject: m.subject,
      type: 'singleInstance',
      isAllDay: false,
      isCancelled: m.cancelled,
      isOrganizer: organizer,
      start: wire(m.start),
      end: wire(m.end),
      ...(m.location ? { location: m.location } : {}),
      organizer: { emailAddress: { name: m.organizer.name, address: m.organizer.email } },
      responseStatus: { response: organizer ? 'organizer' : (own?.response ?? 'none') },
      // Only the organizer's copy tracks everyone's answers; an attendee's copy of the list stays as it was sent.
      attendees: m.attendees.map(a => ({
        type: a.type,
        status: { response: organizer ? a.response : 'none' },
        emailAddress: { name: a.name, address: a.email },
      })),
      ...(organizer && expanded.includes('singleValueExtendedProperties')
        ? {
            singleValueExtendedProperties: m.extended.filter(p =>
              expanded.toLowerCase().includes(`'${p.id.toLowerCase()}'`),
            ),
          }
        : {}),
    });
  }
  function page(url: URL, items: unknown[], defaultTop: number) {
    const top = Number(url.searchParams.get('$top') ?? defaultTop);
    const skip = Number(url.searchParams.get('$skip') ?? 0);
    const more = skip + top < items.length;
    const next = new URL(url);
    next.searchParams.set('$skip', String(skip + top));
    return Response.json({ value: items.slice(skip, skip + top), ...(more ? { '@odata.nextLink': next.href } : {}) });
  }

  async function events(request: Request, mailbox: FakePerson, url: URL) {
    const query = url.searchParams;
    if (request.method === 'GET') {
      const filter = query.get('$filter');
      if (!filter) return notImplemented('listing events without a filter');
      const match = /^singleValueExtendedProperties\/Any\(ep: ep\/id eq '(.+?)' and ep\/value eq '(.*)'\)$/.exec(
        filter,
      );
      if (!match) return notImplemented(`the filter ${filter}`);
      const [, id, value] = match;
      // The property lives on the organizer's event; an invitation is the attendee's own copy without it.
      const found = meetings.filter(
        m =>
          same(m.organizer.email, mailbox.email) &&
          m.copies.has(mailbox.email.toLowerCase()) &&
          m.extended.some(p => same(p.id, id!) && p.value === value!.replaceAll("''", "'")),
      );
      return page(
        url,
        found.map(m => render(m, mailbox, query)),
        10,
      );
    }
    if (request.method !== 'POST') return notImplemented(`${request.method} on events`);
    const body = (await request.json()) as Record<string, unknown>;
    const start = instant(body.start),
      end = instant(body.end);
    if (typeof body.subject !== 'string' || !(start < end))
      return graphError(400, 'ErrorInvalidRequest', 'An event needs a subject and a UTC start before its end.');
    const transactionId = typeof body.transactionId === 'string' ? body.transactionId : undefined;
    const repeat =
      transactionId &&
      meetings.find(
        m => m.transactionId === transactionId && m.copies.has(mailbox.email.toLowerCase()) && !m.cancelled,
      );
    if (repeat) return Response.json(render(repeat, mailbox, query), { status: 201 });
    const attendees = ((body.attendees as Record<string, any>[] | undefined) ?? []).map(a => {
      const email = String(a.emailAddress?.address ?? '');
      return {
        email,
        name: String(a.emailAddress?.name ?? person(email)?.name ?? room(email)?.name ?? email),
        type: a.type ?? 'required',
        response: 'none',
      } as Attendee;
    });
    const meeting: Meeting = {
      iCalUId: `fake-ical-${sequence + 1}`,
      subject: body.subject,
      start,
      end,
      organizer: { email: mailbox.email, name: mailbox.name },
      attendees,
      ...(body.location ? { location: body.location as Meeting['location'] } : {}),
      extended: (body.singleValueExtendedProperties as Meeting['extended'] | undefined) ?? [],
      ...(transactionId ? { transactionId } : {}),
      version: 1,
      cancelled: false,
      ...(attendees.some(a => a.type === 'resource') ? { roomsDue: now() + delay } : {}),
      copies: new Map([[mailbox.email.toLowerCase(), nextId()]]),
    };
    for (const a of attendees)
      if (a.type !== 'resource' && person(a.email)) meeting.copies.set(a.email.toLowerCase(), nextId());
    meetings.push(meeting);
    return Response.json(render(meeting, mailbox, query), { status: 201 });
  }

  async function event(request: Request, mailbox: FakePerson, url: URL, id: string, action?: string) {
    const m = copyOf(mailbox.email, id);
    if (!m) return graphError(404, 'ErrorItemNotFound', 'The specified object was not found in the store.');
    const organizer = same(m.organizer.email, mailbox.email);
    const match = request.headers.get('if-match');
    if (request.method !== 'GET' && match && match !== `W/"${m.version}"`)
      return graphError(412, 'ErrorIrresolvableConflict', 'The change key does not match the current version.');
    if (request.method === 'GET' && !action) return Response.json(render(m, mailbox, url.searchParams));
    if (request.method === 'POST' && action === 'accept') {
      const own = m.attendees.find(a => same(a.email, mailbox.email));
      if (organizer || !own)
        return graphError(400, 'ErrorInvalidRequest', 'Only an attendee can answer an invitation.');
      own.response = 'accepted';
      m.version++;
      return new Response(null, { status: 202 });
    }
    if (request.method === 'PATCH' && !action) {
      if (!organizer) return graphError(403, 'ErrorAccessDenied', 'Only the organizer can change a meeting.');
      const body = (await request.json()) as Record<string, unknown>;
      const unknown = Object.keys(body).filter(key => !['start', 'end'].includes(key));
      if (unknown.length) return notImplemented(`patching ${unknown.join(', ')}`);
      const start = body.start ? instant(body.start) : m.start,
        end = body.end ? instant(body.end) : m.end;
      if (!(start < end)) return graphError(400, 'ErrorInvalidRequest', 'A UTC start must come before the end.');
      Object.assign(m, { start, end, version: m.version + 1 });
      for (const a of m.attendees) a.response = 'none';
      if (m.attendees.some(a => a.type === 'resource')) m.roomsDue = now() + delay;
      return Response.json(render(m, mailbox, url.searchParams));
    }
    if (request.method === 'DELETE' && !action) {
      if (!organizer) return notImplemented('an attendee deleting their copy');
      m.cancelled = true;
      m.version++;
      m.copies.delete(mailbox.email.toLowerCase());
      return new Response(null, { status: 204 });
    }
    return notImplemented(`${request.method} on an event${action ? ` with ${action}` : ''}`);
  }

  async function schedule(request: Request) {
    const body = (await request.json()) as { schedules?: string[]; startTime?: unknown; endTime?: unknown };
    const start = instant(body.startTime),
      end = instant(body.endTime);
    if (!Array.isArray(body.schedules) || !(start < end))
      return graphError(400, 'ErrorInvalidRequest', 'A schedule needs addresses and a UTC window.');
    const status = (m: Meeting, email: string) => {
      if (same(m.organizer.email, email)) return 'busy';
      const a = m.attendees.find(a => same(a.email, email));
      return !a || a.response === 'declined' ? undefined : a.response === 'accepted' ? 'busy' : 'tentative';
    };
    return Response.json({
      value: body.schedules.map(email => {
        if (!person(email) && !room(email))
          return {
            scheduleId: email,
            availabilityView: '',
            error: { message: 'The mailbox was not found.', responseCode: 'ErrorMailRecipientNotFound' },
          };
        return {
          scheduleId: email,
          availabilityView: '',
          scheduleItems: meetings.flatMap(m => {
            const state = !m.cancelled && overlaps(m, start, end) ? status(m, email) : undefined;
            return state ? [{ status: state, start: wire(m.start), end: wire(m.end) }] : [];
          }),
        };
      }),
    });
  }

  async function route(request: Request, url: URL) {
    const failing = failures.findIndex(f => !f.method || f.method === request.method);
    const [failure] = failing < 0 ? [] : failures.splice(failing, 1);
    if (failure) return graphError(failure.status, 'FakeFailure', 'Injected by the test.', failure.headers);
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    const mailbox = options.people.find(p => fakeGraphToken(p.email) === token);
    if (!mailbox) return graphError(401, 'InvalidAuthenticationToken', 'Access token is empty or invalid.');
    const timezone = request.headers.get('prefer');
    if (timezone && timezone !== 'outlook.timezone="UTC"') return notImplemented(`the preference ${timezone}`);
    settleRooms();
    const [version, ...path] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const key = `${request.method} ${path.join('/')}`;
    if (version !== 'v1.0') return notImplemented(`the version ${version}`);
    if (key === 'GET me')
      return Response.json({ id: `user-${mailbox.email}`, mail: mailbox.email, displayName: mailbox.name });
    if (key === 'GET me/calendar') return Response.json({ id: `calendar-${mailbox.email}`, name: 'Calendar' });
    if (key === 'POST me/calendar/getSchedule') return schedule(request);
    if (key === 'GET places/microsoft.graph.room')
      return page(
        url,
        options.rooms.map(r => ({
          id: `room-${r.email}`,
          displayName: r.name,
          emailAddress: r.email,
          capacity: r.capacity,
          tags: r.equipment,
        })),
        100,
      );
    if (key === 'GET me/calendarView') {
      const start = Date.parse(url.searchParams.get('startDateTime') ?? ''),
        end = Date.parse(url.searchParams.get('endDateTime') ?? '');
      if (!(start < end)) return graphError(400, 'ErrorInvalidRequest', 'A calendar view needs a start and an end.');
      const found = meetings
        .filter(m => m.copies.has(mailbox.email.toLowerCase()) && overlaps(m, start, end))
        .sort((a, b) => a.start - b.start)
        .map(m => render(m, mailbox, url.searchParams));
      return page(url, found, 10);
    }
    if (path[0] === 'me' && path[1] === 'events') {
      if (path.length === 2) return events(request, mailbox, url);
      if (path.length <= 4) return event(request, mailbox, url, path[2]!, path[3]);
    }
    return notImplemented(key);
  }

  return {
    fetch: request => route(request, new URL(request.url)),
    failNext: (status, failure) => void failures.push({ status, ...failure }),
  };
}
