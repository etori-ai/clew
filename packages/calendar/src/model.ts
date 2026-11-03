export interface CalendarAccount { ref: string; email: string; name: string; }
/** The room's answer to a booking, separate from whether the command itself completed. */
export type RoomResponse = 'none' | 'pending' | 'accepted' | 'declined' | 'unknown';
/** A person's answer to an invitation. Adapters translate their protocol vocabulary into these values. */
export type ParticipantResponse = 'accepted' | 'declined' | 'tentative' | 'needs-action' | 'unknown';
export interface Participant { email: string; name: string; response: ParticipantResponse; resource: boolean; }
export interface EventOccurrence {
  id: string; ref: string; revision: string; uid: string; title: string; start: string; end: string; allDay: boolean; recurring: boolean;
  organizer: string; organizerName: string; canCancel: boolean; room: string; roomResponse: RoomResponse; participants: Participant[];
}
export interface Resource { ref: string; name: string; email: string; capacity: number; equipment: string[]; }
export interface Availability { ref: string; state: 'free' | 'busy' | 'unknown'; }
/** Busy periods per target from a scheduling free-busy request; `unknown` when the source could not answer. */
export interface BusyPeriods { ref: string; state: 'known' | 'unknown'; busy: { start: string; end: string }[]; }
export interface MeetingInput { title: string; start: string; end: string; participants: string[]; room?: string; }
export interface CalendarCapabilities { create: boolean; cancel: boolean; accept: boolean; recurringRead: boolean; exclusiveRooms: boolean; }

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
const sameEmail = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function invitedParticipant(event: EventOccurrence, account: CalendarAccount) {
  if (event.recurring || !event.organizer || sameEmail(event.organizer, account.email)) return undefined;
  const matches = event.participants.filter(person => !person.resource && sameEmail(person.email, account.email));
  return matches.length === 1 ? matches[0] : undefined;
}
/** Errors with this name are the only ones the BFF forwards to the browser verbatim. */
export class CalendarError extends Error {
  constructor(message: string) { super(message); this.name = 'CalendarError'; }
}
