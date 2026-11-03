import ICAL from 'ical.js';
import { XMLParser } from 'fast-xml-parser';
import { CalendarError, invitedParticipant, type CalendarProvider, type EventOccurrence, type MeetingInput, type Resource, type Participant, type ParticipantResponse, type Availability, type BusyPeriods } from './model';
import { stamp, validWindow } from './dates';

const xml = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, htmlEntities: true });
type Node = Record<string, unknown>;
const object = (value: unknown): Node => value && typeof value === 'object' && !Array.isArray(value) ? value as Node : {};
const array = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
function parse(body: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw new CalendarError('Ogiltigt svar från kalendern.');
  return object(xml.parse(body));
}
function responses(body: string) {
  return array(object(parse(body).multistatus).response).map(raw => {
    const item = object(raw), props: Node = {};
    for (const rawStat of array(item.propstat)) {
      const stat = object(rawStat);
      if (text(stat.status).includes(' 200 ')) Object.assign(props, object(stat.prop));
    }
    return { href: text(item.href), props };
  });
}
const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const reference = (path: string) => `nextcloud:${Buffer.from(path).toString('base64url')}`;
const mailto = (value: unknown) => String(value ?? '').replace(/^mailto:/i, '');
/** iCalendar PARTSTAT (RFC 5545 §3.2.12) to the provider-neutral response vocabulary. */
function participantResponse(partstat: unknown): ParticipantResponse {
  switch (String(partstat ?? 'NEEDS-ACTION').toUpperCase()) {
    case 'ACCEPTED': return 'accepted';
    case 'DECLINED': return 'declined';
    case 'TENTATIVE': return 'tentative';
    case 'NEEDS-ACTION': return 'needs-action';
    default: return 'unknown';
  }
}

export class NextcloudProvider implements CalendarProvider {
  capabilities = { create: true, cancel: true, accept: true, recurringRead: true, exclusiveRooms: false };
  account;
  private discovery?: Promise<{ calendar: string; outbox: string }>;
  constructor(private user: string, private password: string, private base = 'http://calendar') {
    this.account = { ref: `nextcloud:account:${user}`, email: `${user}@clew.test`, name: user };
  }
  private async request(path: string, method: string, body?: string, headers: Record<string, string> = {}) {
    const url = new URL(path, this.base);
    if (url.origin !== new URL(this.base).origin || !url.pathname.startsWith('/remote.php/dav/') || url.search || url.hash) throw new CalendarError('Ogiltig kalenderreferens.');
    const response = await fetch(url, { method, body, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Basic ${btoa(`${this.user}:${this.password}`)}`, 'Content-Type': 'application/xml; charset=utf-8', ...headers } });
    const reader = response.body?.getReader(); let raw = '', count = 0; const decoder = new TextDecoder();
    if (reader) while (true) {
      const part = await reader.read(); if (part.done) break;
      count += part.value.byteLength;
      if (count > 512000) { await reader.cancel(); throw new CalendarError('För många kalenderuppgifter. Välj en kortare period.'); }
      raw += decoder.decode(part.value, { stream: true });
    }
    return { status: response.status, body: raw + decoder.decode(), etag: response.headers.get('etag') ?? '' };
  }
  private async discover() {
    return this.discovery ??= (async () => {
      const principal = `/remote.php/dav/principals/users/${encodeURIComponent(this.user)}/`;
      const response = await this.request(principal, 'PROPFIND', '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/><c:schedule-outbox-URL/></d:prop></d:propfind>', { Depth: '0' });
      if (response.status !== 207) throw new CalendarError('Kalenderkontot är inte tillgängligt.');
      const props = responses(response.body)[0]?.props ?? {};
      const home = text(object(props['calendar-home-set']).href), outbox = text(object(props['schedule-outbox-URL']).href);
      if (!home || !outbox) throw new CalendarError('Kalenderkontot saknar schemaläggning.');
      const listing = await this.request(home, 'PROPFIND', '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>', { Depth: '1' });
      const primary = responses(listing.body).filter(item => item.href === home + 'personal/' && Object.hasOwn(object(item.props.resourcetype), 'calendar'));
      if (primary.length !== 1) throw new CalendarError('Primär kalender saknas eller är tvetydig.');
      return { calendar: primary[0]!.href, outbox };
    })().catch(error => { this.discovery = undefined; throw error; });
  }
  async primaryCalendar() { return (await this.discover()).calendar; }
  async eventRef(uid: string) { return reference((await this.primaryCalendar()) + encodeURIComponent(uid) + '.ics'); }
  private async path(ref: string) {
    if (!ref.startsWith('nextcloud:')) throw new CalendarError('Ogiltig kalenderreferens.');
    const path = Buffer.from(ref.slice(10), 'base64url').toString();
    const primary = await this.primaryCalendar();
    const tail = path.slice(primary.length);
    if (reference(path) !== ref || !path.startsWith(primary) || !/^[A-Za-z0-9%_.-]+\.ics$/.test(tail) || decodeURIComponent(tail).includes('/') || tail.includes('..')) throw new CalendarError('Du får inte läsa någon annans kalender.');
    return path;
  }
  private events(body: string, path: string, revision: string): EventOccurrence[] {
    const calendar = new ICAL.Component(ICAL.parse(body));
    if (calendar.name !== 'vcalendar') throw new CalendarError('Kalenderkällan svarade med ogiltiga mötesuppgifter.');
    for (const zone of calendar.getAllSubcomponents('vtimezone')) {
      const tzid = String(zone.getFirstPropertyValue('tzid'));
      ICAL.TimezoneService.register(new ICAL.Timezone({ component: zone, tzid }), tzid);
    }
    const ref = reference(path);
    return calendar.getAllSubcomponents('vevent').filter(component => component.getFirstPropertyValue('status') !== 'CANCELLED').map(component => {
      const event = new ICAL.Event(component), start = event.startDate, end = event.endDate;
      const participants: Participant[] = component.getAllProperties('attendee').map(attendee => ({
        email: mailto(attendee.getFirstValue()), name: String(attendee.getParameter('cn') ?? ''),
        resource: attendee.getParameter('cutype') === 'ROOM', response: participantResponse(attendee.getParameter('partstat')),
      }));
      const room = participants.find(p => p.resource);
      const organizerProperty = component.getFirstProperty('organizer');
      const organizer = mailto(organizerProperty?.getFirstValue()), organizerName = String(organizerProperty?.getParameter('cn') ?? '');
      const recurring = component.hasProperty('rrule') || component.hasProperty('recurrence-id');
      const pending = room && room.response !== 'accepted' && room.response !== 'declined';
      return { id: `${ref}:${component.getFirstPropertyValue('recurrence-id') ?? ''}`, ref, revision, uid: event.uid,
        title: event.summary || 'Möte', start: start.isDate ? start.toString() : start.toJSDate().toISOString(),
        end: end.isDate ? end.toString() : end.toJSDate().toISOString(), allDay: start.isDate, recurring,
        organizer, organizerName, canCancel: !recurring && organizer.toLowerCase() === this.account.email.toLowerCase(),
        room: room?.name || room?.email || '', participants,
        roomResponse: room?.response === 'accepted' ? 'accepted' : room?.response === 'declined' ? 'declined' : pending ? 'pending' : 'none',
      };
    });
  }
  async list(start: string, end: string) {
    if (!validWindow(start, end)) throw new CalendarError('Välj en period på högst 32 dagar.');
    const path = await this.primaryCalendar();
    const body = `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data><c:expand start="${stamp(start)}" end="${stamp(end)}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${stamp(start)}" end="${stamp(end)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const response = await this.request(path, 'REPORT', body, { Depth: '1' });
    if (response.status !== 207) throw new CalendarError('Mötena kunde inte hämtas.');
    const events = responses(response.body).flatMap(item => this.events(text(item.props['calendar-data']), item.href, text(item.props.getetag)));
    if (events.length > 100) throw new CalendarError('För många möten. Välj en kortare period.');
    return events.sort((a, b) => a.start.localeCompare(b.start));
  }
  async lookup(ref: string) {
    const path = await this.path(ref), response = await this.request(path, 'GET');
    if (response.status === 404) return null;
    if (response.status !== 200) throw new CalendarError('Mötet kunde inte hämtas.');
    return this.events(response.body, path, response.etag)[0] ?? null;
  }
  async resources(): Promise<Resource[]> {
    const response = await this.request('/remote.php/dav/principals/calendar-rooms/', 'PROPFIND', '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:n="http://nextcloud.com/ns"><d:prop><d:displayname/><c:calendar-user-address-set/><n:room-seating-capacity/><n:room-features/></d:prop></d:propfind>', { Depth: '1' });
    if (response.status !== 207) throw new CalendarError('Rummen kunde inte hämtas.');
    return responses(response.body).flatMap(({ href, props }) => {
      const email = array(object(props['calendar-user-address-set']).href).map(text).find(value => value.startsWith('mailto:'))?.slice(7);
      return email ? [{ ref: reference(href), email, name: text(props.displayname), capacity: Number(props['room-seating-capacity']) || 0,
        equipment: text(props['room-features']).split(',').filter(Boolean) }] : [];
    });
  }
  async availability(start: string, end: string, targets: { ref: string; email: string }[]): Promise<Availability[]> {
    if (!validWindow(start, end) || targets.length > 8) throw new CalendarError('Ogiltig tillgänglighetsperiod.');
    if (!targets.length) return [];
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Clew//SV', 'METHOD:REQUEST', 'BEGIN:VFREEBUSY', `UID:${crypto.randomUUID()}`,
      `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `ORGANIZER:mailto:${this.account.email}`,
      ...targets.map(target => `ATTENDEE:mailto:${target.email}`), 'END:VFREEBUSY', 'END:VCALENDAR', ''];
    try {
      const response = await this.request((await this.discover()).outbox, 'POST', lines.join('\r\n'), { 'Content-Type': 'text/calendar; charset=utf-8' });
      const replies = array(object(parse(response.body)['schedule-response']).response).map(object);
      return targets.map(target => {
        const reply = replies.find(item => text(object(item.recipient).href).toLowerCase() === `mailto:${target.email.toLowerCase()}`);
        if (!reply || !text(reply['request-status']).startsWith('2.') || !reply['calendar-data']) return { ref: target.ref, state: 'unknown' };
        const freebusy = new ICAL.Component(ICAL.parse(text(reply['calendar-data']))).getFirstSubcomponent('vfreebusy');
        if (!freebusy) return { ref: target.ref, state: 'unknown' };
        return { ref: target.ref, state: freebusy.getAllProperties('freebusy').some(p => p.getParameter('fbtype') !== 'FREE') ? 'busy' : 'free' };
      });
    } catch { return targets.map(target => ({ ref: target.ref, state: 'unknown' })); }
  }
  /** Busy periods per target over a window. One scheduling request; a lost reply leaves that target `unknown`. */
  async freeBusy(start: string, end: string, targets: { ref: string; email: string }[]): Promise<BusyPeriods[]> {
    if (!validWindow(start, end) || targets.length > 8) throw new CalendarError('Ogiltig tillgänglighetsperiod.');
    if (!targets.length) return [];
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Clew//SV', 'METHOD:REQUEST', 'BEGIN:VFREEBUSY', `UID:${crypto.randomUUID()}`,
      `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `ORGANIZER:mailto:${this.account.email}`,
      ...targets.map(target => `ATTENDEE:mailto:${target.email}`), 'END:VFREEBUSY', 'END:VCALENDAR', ''];
    try {
      const response = await this.request((await this.discover()).outbox, 'POST', lines.join('\r\n'), { 'Content-Type': 'text/calendar; charset=utf-8' });
      const replies = array(object(parse(response.body)['schedule-response']).response).map(object);
      return targets.map(target => {
        const reply = replies.find(item => text(object(item.recipient).href).toLowerCase() === `mailto:${target.email.toLowerCase()}`);
        if (!reply || !text(reply['request-status']).startsWith('2.') || !reply['calendar-data']) return { ref: target.ref, state: 'unknown', busy: [] };
        const freebusy = new ICAL.Component(ICAL.parse(text(reply['calendar-data']))).getFirstSubcomponent('vfreebusy');
        if (!freebusy) return { ref: target.ref, state: 'unknown', busy: [] };
        const busy = freebusy.getAllProperties('freebusy').filter(p => p.getParameter('fbtype') !== 'FREE').flatMap(p => p.getValues().map(value => {
          const period = value as ICAL.Period;
          const from = period.start.toJSDate(), to = period.end ? period.end.toJSDate() : new Date(from.getTime() + period.duration!.toSeconds() * 1000);
          return { start: from.toISOString(), end: to.toISOString() };
        }));
        return { ref: target.ref, state: 'known', busy };
      });
    } catch { return targets.map(target => ({ ref: target.ref, state: 'unknown', busy: [] })); }
  }
  async create(uid: string, input: MeetingInput) {
    const room = input.room ? (await this.resources()).find(resource => resource.ref === input.room) : undefined;
    if (input.room && !room) throw new CalendarError('Du får inte boka det valda rummet.');
    const calendar = new ICAL.Component(['vcalendar', [], []]);
    calendar.updatePropertyWithValue('version', '2.0'); calendar.updatePropertyWithValue('prodid', '-//Clew//SV');
    const component = new ICAL.Component('vevent'); calendar.addSubcomponent(component);
    component.updatePropertyWithValue('uid', uid); component.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));
    component.updatePropertyWithValue('dtstart', ICAL.Time.fromJSDate(new Date(input.start), true));
    component.updatePropertyWithValue('dtend', ICAL.Time.fromJSDate(new Date(input.end), true));
    component.updatePropertyWithValue('summary', input.title); component.updatePropertyWithValue('organizer', `mailto:${this.account.email}`);
    for (const guest of [...input.participants.map(email => ({ email, room: false })), ...(room ? [{ email: room.email, room: true }] : [])]) {
      const attendee = new ICAL.Property('attendee'); attendee.setValue(`mailto:${guest.email}`);
      attendee.setParameter('partstat', 'NEEDS-ACTION'); attendee.setParameter('rsvp', 'TRUE'); attendee.setParameter('cutype', guest.room ? 'ROOM' : 'INDIVIDUAL');
      component.addProperty(attendee);
    }
    const ref = await this.eventRef(uid);
    const response = await this.request(await this.path(ref), 'PUT', calendar.toString(), { 'If-None-Match': '*', 'Content-Type': 'text/calendar; charset=utf-8' });
    if (response.status !== 201 && response.status !== 412) throw new CalendarError('Bokningsresultatet är osäkert. Kontrollera mötet innan du försöker igen.');
    const event = await this.lookup(ref);
    if (!event || event.uid !== uid || event.organizer !== this.account.email) throw new CalendarError('Bokningsresultatet är osäkert.');
    // RoomVox removes a declined resource attendee from the organizer copy.
    if (room && !event.participants.some(p => p.email === room.email)) event.roomResponse = 'declined';
    return event;
  }
  async reschedule(ref: string, revision: string, start: string, end: string) {
    const path = await this.path(ref), response = await this.request(path, 'GET');
    if (response.status !== 200 || response.etag !== revision) throw new CalendarError('Mötet har ändrats. Be om ett nytt förslag.');
    const event = this.events(response.body, path, response.etag)[0];
    if (!event?.canCancel || event.recurring || event.allDay) throw new CalendarError('Du kan bara flytta egna enstaka möten med klockslag.');
    const calendar = new ICAL.Component(ICAL.parse(response.body));
    const components = calendar.getAllSubcomponents('vevent');
    if (components.length !== 1) throw new CalendarError('Återkommande möten stöds inte.');
    const component = components[0]!;
    component.updatePropertyWithValue('dtstart', ICAL.Time.fromJSDate(new Date(start), true));
    component.updatePropertyWithValue('dtend', ICAL.Time.fromJSDate(new Date(end), true));
    component.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));
    component.updatePropertyWithValue('sequence', Number(component.getFirstPropertyValue('sequence') ?? 0) + 1);
    // Preserve participants, resources, UID, title and all other source properties.
    const saved = await this.request(path, 'PUT', calendar.toString(), { 'If-Match': revision, 'Content-Type': 'text/calendar; charset=utf-8' });
    if (![200, 204].includes(saved.status)) throw new CalendarError('Ändringen kunde inte bekräftas. Kontrollera status.');
    const updated = await this.lookup(ref);
    if (!updated || Date.parse(updated.start) !== Date.parse(start) || Date.parse(updated.end) !== Date.parse(end)) throw new CalendarError('Ändringens resultat är osäkert.');
    return updated;
  }
  async cancel(ref: string, revision: string) {
    const event = await this.lookup(ref);
    if (!event) return;
    if (!event.canCancel) throw new CalendarError('Bara organisatören får ställa in ett enstaka möte.');
    if (event.revision !== revision) throw new CalendarError('Mötet har ändrats. Uppdatera innan du ställer in det.');
    const response = await this.request(await this.path(ref), 'DELETE', undefined, { 'If-Match': revision });
    if (response.status === 412) throw new CalendarError('Mötet har ändrats. Uppdatera innan du ställer in det.');
    if (response.status !== 204 && response.status !== 404) throw new CalendarError('Resultatet av inställningen är osäkert.');
    if (await this.lookup(ref)) throw new CalendarError('Inställningen är inte bekräftad.');
  }
  async accept(ref: string, revision: string) {
    const path = await this.path(ref), response = await this.request(path, 'GET');
    if (response.status !== 200) throw new CalendarError('Inbjudan kunde inte hämtas.');
    const event = this.events(response.body, path, response.etag)[0];
    if (!event || !invitedParticipant(event, this.account)) throw new CalendarError('Du får bara svara på egna inbjudningar till enstaka möten.');
    if (response.etag !== revision) throw new CalendarError('Inbjudan har ändrats. Öppna mötet igen innan du svarar.');
    const calendar = new ICAL.Component(ICAL.parse(response.body));
    const components = calendar.getAllSubcomponents('vevent');
    if (components.length !== 1) throw new CalendarError('Svar på återkommande möten stöds inte ännu.');
    const component = components[0]!;
    const participant = component.getAllProperties('attendee').find(attendee => String(attendee.getFirstValue()).toLowerCase() === `mailto:${this.account.email.toLowerCase()}`)!;
    // CalDAV implicit scheduling sends the reply; preserve every other attendee and organizer field.
    participant.setParameter('partstat', 'ACCEPTED'); participant.setParameter('rsvp', 'FALSE');
    const saved = await this.request(path, 'PUT', calendar.toString(), { 'If-Match': revision, 'Content-Type': 'text/calendar; charset=utf-8' });
    if (saved.status === 412) throw new CalendarError('Inbjudan har ändrats. Öppna mötet igen innan du svarar.');
    if (![200, 204].includes(saved.status)) throw new CalendarError('Svaret kunde inte bekräftas. Kontrollera status innan du försöker igen.');
    const accepted = await this.lookup(ref);
    if (!accepted || invitedParticipant(accepted, this.account)?.response !== 'accepted') throw new CalendarError('Svaret kunde inte bekräftas.');
    return accepted;
  }
}
