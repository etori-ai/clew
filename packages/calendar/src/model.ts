export interface CalendarAccount {
  ref: string;
  email: string;
  name: string;
}
/** The room's answer to a booking, separate from whether the command itself completed. */
export type RoomResponse = 'none' | 'pending' | 'accepted' | 'declined' | 'unknown';
/** A person's answer to an invitation. Adapters translate their protocol vocabulary into these values. */
export type ParticipantResponse = 'accepted' | 'declined' | 'tentative' | 'needs-action' | 'unknown';
export interface Participant {
  email: string;
  name: string;
  response: ParticipantResponse;
  resource: boolean;
}
export interface EventOccurrence {
  id: string;
  ref: string;
  revision: string;
  uid: string;
  /**
   * The id every copy of the meeting carries, in the organiser's calendar and in each guest's: iCalendar's UID,
   * Microsoft Graph's `iCalUId`. The same as `uid` where Clew's uid is the calendar's own (CalDAV, memory); on Microsoft
   * 365 Clew's uid lives on the organiser's copy alone, so a guest's copy is known by this one (WA-L5).
   */
  icalUid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  recurring: boolean;
  organizer: string;
  organizerName: string;
  canCancel: boolean;
  room: string;
  roomResponse: RoomResponse;
  participants: Participant[];
}
export interface Resource {
  ref: string;
  name: string;
  email: string;
  capacity: number;
  equipment: string[];
}
export interface Availability {
  ref: string;
  state: 'free' | 'busy' | 'unknown';
}
/** Busy periods per target from a scheduling free-busy request; `unknown` when the source could not answer. */
export interface BusyPeriods {
  ref: string;
  state: 'known' | 'unknown';
  busy: { start: string; end: string }[];
}
export interface MeetingInput {
  title: string;
  start: string;
  end: string;
  participants: string[];
  room?: string;
}
export interface CalendarCapabilities {
  create: boolean;
  cancel: boolean;
  accept: boolean;
  recurringRead: boolean;
  exclusiveRooms: boolean;
}

/** The tool interface. In-process behind this interface in v1; the same surface is what an MCP server would expose later. */
export interface CalendarProvider {
  capabilities: CalendarCapabilities;
  account: CalendarAccount;
  primaryCalendar(): Promise<string>;
  list(start: string, end: string): Promise<EventOccurrence[]>;
  lookup(ref: string): Promise<EventOccurrence | null>;
  resources(): Promise<Resource[]>;
  availability(start: string, end: string, targets: { ref: string; email: string }[]): Promise<Availability[]>;
  freeBusy(start: string, end: string, targets: { ref: string; email: string }[]): Promise<BusyPeriods[]>;
  eventRef(uid: string): Promise<string>;
  create(uid: string, input: MeetingInput): Promise<EventOccurrence>;
  reschedule(ref: string, revision: string, start: string, end: string): Promise<EventOccurrence>;
  cancel(ref: string, revision: string): Promise<void>;
}
/**
 * How many calendars one free-busy request may ask about, on every adapter: a booking's eight participants and its room
 * fit with room to spare, and a planner asks for a larger team in requests of this size.
 */
export const FREE_BUSY_TARGETS = 20;
export const sameEmail = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/**
 * Whether the account organises the event: it names the account as its organiser, or it names none and has no guests,
 * which is how a calendar client stores an appointment in the owner's own calendar. A meeting with guests and no
 * organiser is nobody's to move or cancel: removing it would take it from the owner's calendar alone, and the guests
 * would keep it.
 */
export const organisedBy = (event: Pick<EventOccurrence, 'organizer' | 'participants'>, account: CalendarAccount) =>
  event.organizer
    ? sameEmail(event.organizer, account.email)
    : event.participants.every(person => sameEmail(person.email, account.email));
/** The account's own place on an invitation it can answer: a single meeting someone else organises. */
export function invitedParticipant(event: EventOccurrence, account: CalendarAccount) {
  if (event.recurring || !event.organizer || organisedBy(event, account)) return undefined;
  const matches = event.participants.filter(person => !person.resource && sameEmail(person.email, account.email));
  return matches.length === 1 ? matches[0] : undefined;
}
/** Errors with this name are the only ones the BFF forwards to the browser verbatim. */
export class CalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarError';
  }
}
/**
 * An event the calendar holds that Clew cannot read as it is written (a zone the file does not describe, a file that is
 * no calendar): asking again gives the same answer until someone changes the event in the calendar, so a caller says
 * this message rather than "try again later". Forwarded to the browser as any `CalendarError` is.
 */
export class UnreadableEventError extends CalendarError {}
