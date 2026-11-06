import {
  CalendarError,
  invitedParticipant,
  sameEmail,
  type Availability,
  type BusyPeriods,
  type CalendarAccount,
  type CalendarProvider,
  type EventOccurrence,
  type MeetingInput,
  type Participant,
  type ParticipantResponse,
  type Resource,
  type RoomResponse,
} from './model';
import { validWindow } from './dates';
import { readLimited } from './http';

/**
 * Microsoft 365 through Microsoft Graph v1.0 (D11). Only `/me` and `/places` are called, so a person reaches nothing
 * their token does not reach. Tested against `fake-graph.ts`; see D61 for what that does not prove.
 */
export const graphUrl = 'https://graph.microsoft.com/v1.0';
/** Holds Clew's uid on the organizer's event. Graph assigns the id, but the ledger needs a reference before it writes. */
const uidProperty = 'String {8f1c2d7e-3b54-4a6e-9c0d-5e7a1b2c4d60} Name clewUid';
const eventFields =
  'id,iCalUId,subject,type,isAllDay,isCancelled,isOrganizer,start,end,organizer,attendees,responseStatus';
const eventQuery = `$select=${eventFields}&$expand=${encodeURIComponent(`singleValueExtendedProperties($filter=id eq '${uidProperty}')`)}`;
const maxBody = 2_000_000;
const maxPages = 20;
const maxWaitSeconds = 5;

interface GraphTime {
  dateTime?: string;
  timeZone?: string;
}
interface GraphAddress {
  emailAddress?: { name?: string; address?: string };
}
interface GraphEvent {
  '@odata.etag'?: string;
  id?: string;
  iCalUId?: string;
  subject?: string;
  type?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  isOrganizer?: boolean;
  start?: GraphTime;
  end?: GraphTime;
  organizer?: GraphAddress;
  attendees?: (GraphAddress & { type?: string; status?: { response?: string } })[];
  responseStatus?: { response?: string };
  singleValueExtendedProperties?: { id?: string; value?: string }[];
}
interface GraphReply {
  status: number;
  json: Record<string, unknown>;
}
const encode = (value: string) => Buffer.from(value).toString('base64url');
const idRef = (id: string) => `microsoft365:id:${encode(id)}`;
const uidRef = (uid: string) => `microsoft365:uid:${encode(uid)}`;
const utc = (value: string) => ({ dateTime: new Date(value).toISOString().replace(/Z$/, ''), timeZone: 'UTC' });
function instant(time: GraphTime | undefined) {
  if (time?.timeZone !== 'UTC' || !time.dateTime) throw new CalendarError('Kalendern svarade med ogiltiga tider.');
  const at = Date.parse(/[zZ]$/.test(time.dateTime) ? time.dateTime : `${time.dateTime}Z`);
  if (Number.isNaN(at)) throw new CalendarError('Kalendern svarade med ogiltiga tider.');
  return new Date(at).toISOString();
}
/** The calendar's all-day form is a date with an exclusive end. Anything but a UTC midnight is refused, not guessed (D61). */
function allDayDate(time: GraphTime | undefined) {
  const value = time?.dateTime ?? '';
  if (time?.timeZone !== 'UTC' || !/^\d{4}-\d{2}-\d{2}T00:00:00(\.0+)?$/.test(value))
    throw new CalendarError('Kalendern svarade med ogiltiga tider.');
  return value.slice(0, 10);
}
/** Graph's response vocabulary to the provider-neutral one. */
function participantResponse(response: string | undefined): ParticipantResponse {
  switch (response) {
    case 'accepted':
    case 'organizer':
      return 'accepted';
    case 'declined':
      return 'declined';
    case 'tentativelyAccepted':
      return 'tentative';
    case 'none':
    case 'notResponded':
    case undefined:
      return 'needs-action';
    default:
      return 'unknown';
  }
}

export class Microsoft365Provider implements CalendarProvider {
  /** Whether a room refuses a conflict is a setting on its mailbox, which Clew cannot read. */
  capabilities = { create: true, cancel: true, accept: true, recurringRead: true, exclusiveRooms: false };
  account: CalendarAccount;
  private base: URL;
  constructor(
    private token: () => Promise<string>,
    account: { email: string; name: string },
    url = graphUrl,
  ) {
    this.base = new URL(url.replace(/\/+$/, ''));
    this.account = { ref: `microsoft365:account:${account.email}`, email: account.email, name: account.name };
  }
  private async send(
    target: string,
    method: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<GraphReply> {
    const url = new URL(target.startsWith('/') ? this.base.href + target : target);
    // A next link comes from the response, so it gets the same check as our own paths.
    if (url.origin !== this.base.origin || !url.pathname.startsWith(`${this.base.pathname}/`))
      throw new CalendarError('Ogiltigt svar från kalendern.');
    const reads = method === 'GET' || target.endsWith('/getSchedule');
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${await this.token()}`,
          Accept: 'application/json',
          Prefer: 'outlook.timezone="UTC"',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
      });
      const raw = await readLimited(response, maxBody);
      const wait = Number(response.headers.get('retry-after') ?? Number.NaN);
      // Only a read is repeated: a write that may have landed is settled by reading it back.
      if (reads && attempt < 2 && [429, 503].includes(response.status) && wait <= maxWaitSeconds) {
        await new Promise(resolve => setTimeout(resolve, wait * 1000));
        continue;
      }
      let json: Record<string, unknown> = {};
      try {
        json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        throw new CalendarError('Ogiltigt svar från kalendern.');
      }
      return { status: response.status, json };
    }
  }
  /** Every page of a collection, up to `limit` items; beyond it the caller gets `tooMany`. */
  private async collect<T>(path: string, limit: number, failed: string, tooMany: string) {
    const items: T[] = [];
    let next: string | undefined = path;
    for (let pages = 0; next; pages++) {
      if (pages === maxPages) throw new CalendarError(tooMany);
      const reply: GraphReply = await this.send(next, 'GET');
      if (reply.status !== 200 || !Array.isArray(reply.json.value)) throw new CalendarError(failed);
      items.push(...(reply.json.value as T[]));
      if (items.length > limit) throw new CalendarError(tooMany);
      next = typeof reply.json['@odata.nextLink'] === 'string' ? reply.json['@odata.nextLink'] : undefined;
    }
    return items;
  }
  private occurrence(event: GraphEvent): EventOccurrence {
    if (!event.id || !event['@odata.etag']) throw new CalendarError('Kalendern svarade med ogiltiga mötesuppgifter.');
    const recurring = (event.type ?? 'singleInstance') !== 'singleInstance';
    const clewUid = event.singleValueExtendedProperties?.find(p => sameEmail(p.id ?? '', uidProperty))?.value;
    const ref = clewUid && !recurring ? uidRef(clewUid) : idRef(event.id);
    const organizer = event.organizer?.emailAddress?.address ?? '';
    const participants: Participant[] = (event.attendees ?? []).map(attendee => {
      const email = attendee.emailAddress?.address ?? '';
      // An attendee's copy of the list goes stale; their own answer lives in responseStatus.
      const own = !event.isOrganizer && sameEmail(email, this.account.email);
      return {
        email,
        name: attendee.emailAddress?.name ?? '',
        resource: attendee.type === 'resource',
        response: participantResponse(own ? event.responseStatus?.response : attendee.status?.response),
      };
    });
    const room = participants.find(p => p.resource);
    const roomResponse: RoomResponse = !room
      ? 'none'
      : room.response === 'accepted' || room.response === 'declined'
        ? room.response
        : 'pending';
    const allDay = Boolean(event.isAllDay);
    return {
      id: ref,
      ref,
      revision: event['@odata.etag'],
      uid: clewUid ?? event.iCalUId ?? event.id,
      title: event.subject || 'Möte',
      start: allDay ? allDayDate(event.start) : instant(event.start),
      end: allDay ? allDayDate(event.end) : instant(event.end),
      allDay,
      recurring,
      organizer,
      organizerName: event.organizer?.emailAddress?.name ?? '',
      canCancel: !recurring && sameEmail(organizer, this.account.email),
      // A room that said no is not the meeting's room. On CalDAV the attendee disappears, here it stays on the list.
      room: roomResponse === 'declined' ? '' : room?.name || room?.email || '',
      participants,
      roomResponse,
    };
  }
  /** The event behind a reference, or null when this mailbox has no such event. */
  private async source(ref: string): Promise<GraphEvent | null> {
    const match = /^microsoft365:(id|uid):([A-Za-z0-9_-]+)$/.exec(ref);
    if (!match) throw new CalendarError('Ogiltig kalenderreferens.');
    const value = Buffer.from(match[2]!, 'base64url').toString();
    if (encode(value) !== match[2]) throw new CalendarError('Ogiltig kalenderreferens.');
    if (match[1] === 'id') {
      const reply = await this.send(`/me/events/${encodeURIComponent(value)}?${eventQuery}`, 'GET');
      if (reply.status === 404) return null;
      if (reply.status !== 200) throw new CalendarError('Mötet kunde inte hämtas.');
      return reply.json as GraphEvent;
    }
    const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${uidProperty}' and ep/value eq '${value.replaceAll("'", "''")}')`;
    const found = await this.collect<GraphEvent>(
      `/me/events?$filter=${encodeURIComponent(filter)}&${eventQuery}&$top=2`,
      1,
      'Mötet kunde inte hämtas.',
      'Mötet kunde inte hämtas entydigt.',
    );
    return found[0] ?? null;
  }
  private async read(ref: string) {
    const source = await this.source(ref);
    return source && !source.isCancelled ? { id: source.id!, event: this.occurrence(source) } : null;
  }
  async primaryCalendar() {
    const reply = await this.send('/me/calendar', 'GET');
    if (reply.status !== 200 || typeof reply.json.id !== 'string')
      throw new CalendarError('Kalenderkontot är inte tillgängligt.');
    return reply.json.id;
  }
  async eventRef(uid: string) {
    return uidRef(uid);
  }
  async list(start: string, end: string) {
    if (!validWindow(start, end)) throw new CalendarError('Välj en period på högst 32 dagar.');
    const window = `startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}`;
    const events = await this.collect<GraphEvent>(
      `/me/calendarView?${window}&${eventQuery}&$top=100`,
      100,
      'Mötena kunde inte hämtas.',
      'För många möten. Välj en kortare period.',
    );
    return events
      .filter(event => !event.isCancelled)
      .map(event => this.occurrence(event))
      .sort((a, b) => a.start.localeCompare(b.start));
  }
  async lookup(ref: string) {
    return (await this.read(ref))?.event ?? null;
  }
  async resources(): Promise<Resource[]> {
    const rooms = await this.collect<{
      displayName?: string;
      emailAddress?: string;
      capacity?: number;
      tags?: string[];
      audioDeviceName?: string;
      videoDeviceName?: string;
      displayDeviceName?: string;
    }>('/places/microsoft.graph.room?$top=100', 1000, 'Rummen kunde inte hämtas.', 'Rummen kunde inte hämtas.');
    return rooms.flatMap(room =>
      room.emailAddress
        ? [
            {
              ref: `microsoft365:room:${encode(room.emailAddress)}`,
              email: room.emailAddress,
              name: room.displayName ?? room.emailAddress,
              capacity: room.capacity ?? 0,
              equipment: [
                room.audioDeviceName,
                room.videoDeviceName,
                room.displayDeviceName,
                ...(room.tags ?? []),
              ].filter((value): value is string => Boolean(value)),
            },
          ]
        : [],
    );
  }
  async availability(start: string, end: string, targets: { ref: string; email: string }[]): Promise<Availability[]> {
    return (await this.freeBusy(start, end, targets)).map(({ ref, state, busy }) => ({
      ref,
      state: state === 'unknown' ? 'unknown' : busy.length ? 'busy' : 'free',
    }));
  }
  /** Busy periods per target over a window. A target Graph cannot answer for stays `unknown`, as does a lost reply. */
  async freeBusy(start: string, end: string, targets: { ref: string; email: string }[]): Promise<BusyPeriods[]> {
    if (!validWindow(start, end) || targets.length > 8) throw new CalendarError('Ogiltig tillgänglighetsperiod.');
    if (!targets.length) return [];
    const unknown = (ref: string): BusyPeriods => ({ ref, state: 'unknown', busy: [] });
    try {
      const reply = await this.send('/me/calendar/getSchedule', 'POST', {
        schedules: targets.map(target => target.email),
        startTime: utc(start),
        endTime: utc(end),
      });
      if (reply.status !== 200 || !Array.isArray(reply.json.value)) return targets.map(t => unknown(t.ref));
      const schedules = reply.json.value as {
        scheduleId?: string;
        error?: unknown;
        scheduleItems?: { status?: string; start?: GraphTime; end?: GraphTime }[];
      }[];
      return targets.map(target => {
        const schedule = schedules.find(item => sameEmail(item.scheduleId ?? '', target.email));
        if (!schedule?.scheduleItems || schedule.error) return unknown(target.ref);
        if (schedule.scheduleItems.some(item => item.status === 'unknown')) return unknown(target.ref);
        const from = new Date(start).toISOString(),
          to = new Date(end).toISOString();
        const busy = schedule.scheduleItems
          .filter(item => ['busy', 'oof', 'tentative'].includes(item.status ?? ''))
          .map(item => {
            const itemStart = instant(item.start),
              itemEnd = instant(item.end);
            return { start: itemStart < from ? from : itemStart, end: itemEnd > to ? to : itemEnd };
          });
        return { ref: target.ref, state: 'known', busy };
      });
    } catch {
      return targets.map(target => unknown(target.ref));
    }
  }
  async create(uid: string, input: MeetingInput) {
    const room = input.room ? (await this.resources()).find(resource => resource.ref === input.room) : undefined;
    if (input.room && !room) throw new CalendarError('Du får inte boka det valda rummet.');
    const ref = await this.eventRef(uid);
    if (!(await this.source(ref))) {
      const reply = await this.send('/me/events', 'POST', {
        subject: input.title,
        start: utc(input.start),
        end: utc(input.end),
        transactionId: uid,
        attendees: [
          ...input.participants.map(address => ({ type: 'required', emailAddress: { address } })),
          ...(room ? [{ type: 'resource', emailAddress: { address: room.email, name: room.name } }] : []),
        ],
        ...(room ? { location: { displayName: room.name, locationEmailAddress: room.email } } : {}),
        singleValueExtendedProperties: [{ id: uidProperty, value: uid }],
      });
      if (reply.status !== 201)
        throw new CalendarError('Bokningsresultatet är osäkert. Kontrollera mötet innan du försöker igen.');
    }
    const event = await this.lookup(ref);
    if (!event || event.uid !== uid || !sameEmail(event.organizer, this.account.email))
      throw new CalendarError('Bokningsresultatet är osäkert.');
    return event;
  }
  async reschedule(ref: string, revision: string, start: string, end: string) {
    const current = await this.read(ref);
    if (!current || current.event.revision !== revision)
      throw new CalendarError('Mötet har ändrats. Be om ett nytt förslag.');
    if (!current.event.canCancel || current.event.recurring || current.event.allDay)
      throw new CalendarError('Du kan bara flytta egna enstaka möten med klockslag.');
    const saved = await this.send(
      `/me/events/${encodeURIComponent(current.id)}`,
      'PATCH',
      { start: utc(start), end: utc(end) },
      { 'If-Match': revision },
    );
    if (saved.status === 409 || saved.status === 412)
      throw new CalendarError('Mötet har ändrats. Be om ett nytt förslag.');
    if (saved.status !== 200) throw new CalendarError('Ändringen kunde inte bekräftas. Kontrollera status.');
    const updated = await this.lookup(ref);
    if (!updated || Date.parse(updated.start) !== Date.parse(start) || Date.parse(updated.end) !== Date.parse(end))
      throw new CalendarError('Ändringens resultat är osäkert.');
    return updated;
  }
  async cancel(ref: string, revision: string) {
    const current = await this.read(ref);
    if (!current) return;
    if (!current.event.canCancel) throw new CalendarError('Bara organisatören får ställa in ett enstaka möte.');
    if (current.event.revision !== revision)
      throw new CalendarError('Mötet har ändrats. Uppdatera innan du ställer in det.');
    // Deleting on the organizer's calendar sends the cancellation to the attendees.
    const response = await this.send(`/me/events/${encodeURIComponent(current.id)}`, 'DELETE', undefined, {
      'If-Match': revision,
    });
    if (response.status === 409 || response.status === 412)
      throw new CalendarError('Mötet har ändrats. Uppdatera innan du ställer in det.');
    if (response.status !== 204 && response.status !== 404)
      throw new CalendarError('Resultatet av inställningen är osäkert.');
    if (await this.lookup(ref)) throw new CalendarError('Inställningen är inte bekräftad.');
  }
  async accept(ref: string, revision: string) {
    const current = await this.read(ref);
    if (!current || !invitedParticipant(current.event, this.account))
      throw new CalendarError('Du får bara svara på egna inbjudningar till enstaka möten.');
    if (current.event.revision !== revision)
      throw new CalendarError('Inbjudan har ändrats. Öppna mötet igen innan du svarar.');
    const saved = await this.send(
      `/me/events/${encodeURIComponent(current.id)}/accept`,
      'POST',
      { sendResponse: true },
      { 'If-Match': revision },
    );
    if (saved.status === 409 || saved.status === 412)
      throw new CalendarError('Inbjudan har ändrats. Öppna mötet igen innan du svarar.');
    if (saved.status !== 202)
      throw new CalendarError('Svaret kunde inte bekräftas. Kontrollera status innan du försöker igen.');
    // 202 only queues the answer, so a read-back may still show the old one; the copy returned shows what was sent.
    const accepted = await this.lookup(ref);
    if (!accepted) throw new CalendarError('Svaret kunde inte bekräftas.');
    const own = invitedParticipant(accepted, this.account);
    return {
      ...accepted,
      participants: accepted.participants.map(p => (p === own ? { ...p, response: 'accepted' as const } : p)),
    };
  }
}
