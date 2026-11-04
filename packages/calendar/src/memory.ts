import type { BusyPeriods, CalendarAccount, CalendarProvider, EventOccurrence, MeetingInput } from './model';

/**
 * A calendar in memory: the `CalendarProvider` port (D11) for unit tests (D25). Events are plain records a test seeds
 * and reads back; free-busy answers come from `busy` per target ref, `'unknown'` when a target's calendar cannot
 * be read. `failCreate` makes `create` throw so the lost-reply path can be exercised.
 */
export interface MemoryCalendar extends CalendarProvider {
  events: EventOccurrence[];
  cancelled: string[];
  options: { busy: Record<string, { start: string; end: string }[] | 'unknown'>; failCreate: boolean };
}
export function occurrence(partial: Partial<EventOccurrence> & Pick<EventOccurrence, 'uid' | 'title' | 'start' | 'end'>, account: CalendarAccount): EventOccurrence {
  return { id: partial.uid, ref: 'memory:' + partial.uid, revision: 'r1', allDay: false, recurring: false, organizer: account.email, organizerName: account.name, canCancel: true, room: '', roomResponse: 'none', participants: [], ...partial };
}
const overlaps = (e: { start: string; end: string }, start: string, end: string) => Date.parse(e.start) < Date.parse(end) && Date.parse(start) < Date.parse(e.end);
export function memoryCalendar(account: CalendarAccount, seed: EventOccurrence[] = []): MemoryCalendar {
  const calendar: MemoryCalendar = {
    events: [...seed], cancelled: [], options: { busy: {}, failCreate: false },
    capabilities: { create: true, cancel: true, accept: true, recurringRead: true, exclusiveRooms: false },
    account,
    async primaryCalendar() { return 'memory:' + account.ref; },
    async list(start, end) { return calendar.events.filter(e => overlaps(e, start, end)).sort((a, b) => a.start.localeCompare(b.start)); },
    async lookup(ref) { return calendar.events.find(e => e.ref === ref) ?? null; },
    async resources() { return []; },
    async availability(_start, _end, targets) { return targets.map(t => ({ ref: t.ref, state: calendar.options.busy[t.ref] === 'unknown' ? 'unknown' as const : 'free' as const })); },
    async freeBusy(start, end, targets): Promise<BusyPeriods[]> {
      return targets.map(t => { const busy = calendar.options.busy[t.ref] ?? []; return busy === 'unknown' ? { ref: t.ref, state: 'unknown', busy: [] } : { ref: t.ref, state: 'known', busy: busy.filter(b => overlaps(b, start, end)) }; });
    },
    async eventRef(uid) { return 'memory:' + uid; },
    async create(uid, input: MeetingInput) {
      if (calendar.options.failCreate) throw new Error('The calendar did not answer.');
      const event = occurrence({ uid, title: input.title, start: input.start, end: input.end, participants: input.participants.map(email => ({ email, name: email, response: 'needs-action', resource: false })) }, account);
      calendar.events.push(event);
      return event;
    },
    async reschedule(ref, _revision, start, end) {
      const event = calendar.events.find(e => e.ref === ref);
      if (!event) throw new Error('No such event.');
      Object.assign(event, { start, end, revision: event.revision + '+' });
      return event;
    },
    async cancel(ref) { calendar.events = calendar.events.filter(e => e.ref !== ref); calendar.cancelled.push(ref); },
  };
  return calendar;
}
