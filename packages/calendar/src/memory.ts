import {
  CalendarError,
  type BusyPeriods,
  type CalendarAccount,
  type CalendarProvider,
  type EventOccurrence,
  type MeetingInput,
  type Resource,
} from './model';

/**
 * A calendar in memory: the `CalendarProvider` port (D11) for unit tests (D25). Events are plain records a test seeds
 * and reads back; free-busy answers come from `busy` per target ref, `'unknown'` when a target's calendar cannot
 * be read. `failCreate` makes `create` throw so the lost-reply path can be exercised.
 */
export interface MemoryCalendar extends CalendarProvider {
  events: EventOccurrence[];
  cancelled: string[];
  rooms: Resource[];
  options: { busy: Record<string, { start: string; end: string }[] | 'unknown'>; failCreate: boolean };
}
export function occurrence(
  partial: Partial<EventOccurrence> & Pick<EventOccurrence, 'uid' | 'title' | 'start' | 'end'>,
  account: CalendarAccount,
): EventOccurrence {
  return {
    id: partial.uid,
    ref: 'memory:' + partial.uid,
    revision: 'r1',
    allDay: false,
    recurring: false,
    organizer: account.email,
    organizerName: account.name,
    canCancel: true,
    room: '',
    roomResponse: 'none',
    participants: [],
    ...partial,
  };
}
const overlaps = (e: { start: string; end: string }, start: string, end: string) =>
  Date.parse(e.start) < Date.parse(end) && Date.parse(start) < Date.parse(e.end);
export function memoryCalendar(account: CalendarAccount, seed: EventOccurrence[] = []): MemoryCalendar {
  const calendar: MemoryCalendar = {
    events: [...seed],
    cancelled: [],
    rooms: [],
    options: { busy: {}, failCreate: false },
    capabilities: { create: true, cancel: true, accept: true, recurringRead: true, exclusiveRooms: false },
    account,
    async primaryCalendar() {
      return 'memory:' + account.ref;
    },
    async list(start, end) {
      return calendar.events.filter(e => overlaps(e, start, end)).sort((a, b) => a.start.localeCompare(b.start));
    },
    async lookup(ref) {
      return calendar.events.find(e => e.ref === ref) ?? null;
    },
    async resources() {
      return calendar.rooms;
    },
    // Busy when a seeded busy period overlaps the window; a target without an entry is free, 'unknown' stays unknown.
    async availability(start, end, targets) {
      return targets.map(t => {
        const busy = calendar.options.busy[t.ref];
        return {
          ref: t.ref,
          state:
            busy === 'unknown'
              ? ('unknown' as const)
              : (busy ?? []).some(b => overlaps(b, start, end))
                ? ('busy' as const)
                : ('free' as const),
        };
      });
    },
    async freeBusy(start, end, targets): Promise<BusyPeriods[]> {
      return targets.map(t => {
        const busy = calendar.options.busy[t.ref] ?? [];
        return busy === 'unknown'
          ? { ref: t.ref, state: 'unknown', busy: [] }
          : { ref: t.ref, state: 'known', busy: busy.filter(b => overlaps(b, start, end)) };
      });
    },
    async eventRef(uid) {
      return 'memory:' + uid;
    },
    async create(uid, input: MeetingInput) {
      if (calendar.options.failCreate) throw new Error('The calendar did not answer.');
      const room = input.room ? calendar.rooms.find(r => r.ref === input.room) : undefined;
      if (input.room && !room) throw new CalendarError('Du får inte boka det valda rummet.');
      const event = occurrence(
        {
          uid,
          title: input.title,
          start: input.start,
          end: input.end,
          room: room?.name ?? '',
          roomResponse: room ? 'pending' : 'none',
          participants: [
            ...input.participants.map(email => ({
              email,
              name: email,
              response: 'needs-action' as const,
              resource: false,
            })),
            ...(room
              ? [{ email: room.email, name: room.name, response: 'needs-action' as const, resource: true }]
              : []),
          ],
        },
        account,
      );
      calendar.events.push(event);
      return event;
    },
    // The same refusals as the CalDAV adapter, so a use case test sees the contract's edges: a stale revision, someone else's event.
    async reschedule(ref, revision, start, end) {
      const event = calendar.events.find(e => e.ref === ref);
      if (!event) throw new CalendarError('Mötet finns inte längre.');
      if (event.revision !== revision) throw new CalendarError('Mötet har ändrats. Be om ett nytt förslag.');
      if (!event.canCancel || event.recurring || event.allDay)
        throw new CalendarError('Du kan bara flytta egna enstaka möten med klockslag.');
      // A fresh record, as a real provider hands back: what a caller read before the write keeps its old values.
      const updated = { ...event, start, end, revision: event.revision + '+' };
      calendar.events = calendar.events.map(e => (e === event ? updated : e));
      return updated;
    },
    async cancel(ref, revision) {
      const event = calendar.events.find(e => e.ref === ref);
      if (!event) return;
      if (!event.canCancel) throw new CalendarError('Bara organisatören får ställa in ett enstaka möte.');
      if (event.revision !== revision) throw new CalendarError('Mötet har ändrats. Uppdatera innan du ställer in det.');
      calendar.events = calendar.events.filter(e => e.ref !== ref);
      calendar.cancelled.push(ref);
    },
  };
  return calendar;
}
