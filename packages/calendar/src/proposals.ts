import { addDays, dayStart, localInstant, minutesOfDay, displayDate } from './dates';

export interface Interval {
  start: string;
  end: string;
}
/**
 * Whom a slot is for: an address and a name, and whatever else the caller keeps with them, such as the person's id,
 * which the planner hands back on the slot untouched.
 */
export interface Participant {
  email: string;
  name: string;
}
export interface Candidate<P extends Participant = Participant> {
  participant: P;
  busy: Interval[];
}
export interface PlanInput<P extends Participant = Participant> {
  /** Monday of the target week (YYYY-MM-DD). */
  week: string;
  /** Instants the manager is already busy, including proposals already drawn for other threads. */
  managerBusy: Interval[];
  candidates: Candidate<P>[];
  /** Earliest acceptable start, so a plan never proposes a slot in the past. */
  notBefore: string;
  durationMinutes?: number;
}
export interface PlannedSlot<P extends Participant = Participant> {
  participant: P;
  start: string;
  end: string;
}

const overlaps = (a: Interval, b: Interval) =>
  Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
export const collides = (slot: Interval, busy: Interval[]) => busy.some(b => overlaps(slot, b));

/**
 * Deterministic slot search for utvecklingssamtal: weekdays 09–16, whole or half hours, lunch kept free,
 * one conversation per day where possible, earliest first. No model involved; the server validates the
 * same collision rules again before anything is written.
 */
export function planWeek<P extends Participant>(input: PlanInput<P>): PlannedSlot<P>[] {
  const duration = input.durationMinutes ?? 60;
  const days = Array.from({ length: 5 }, (_, i) => addDays(input.week, i));
  const slots: Interval[] = [];
  for (const day of days)
    for (let minutes = 9 * 60; minutes + duration <= 16 * 60; minutes += 30) {
      if (minutes < 13 * 60 && minutes + duration > 12 * 60) continue; // lunch
      const hh = String(Math.floor(minutes / 60)).padStart(2, '0'),
        mm = String(minutes % 60).padStart(2, '0');
      try {
        const start = localInstant(`${day}T${hh}:${mm}`),
          end = new Date(Date.parse(start) + duration * 60000).toISOString();
        if (Date.parse(start) >= Date.parse(input.notBefore)) slots.push({ start, end });
      } catch {
        /* skip ambiguous local times */
      }
    }
  const taken: Interval[] = [...input.managerBusy];
  const usedDays = new Map<string, number>();
  const planned: PlannedSlot<P>[] = [];
  for (const candidate of input.candidates) {
    const free = slots.filter(slot => !collides(slot, taken) && !collides(slot, candidate.busy));
    // Prefer days with no conversation yet, then earliest.
    const pick = free.sort(
      (a, b) =>
        (usedDays.get(displayDate(a.start)) ?? 0) - (usedDays.get(displayDate(b.start)) ?? 0) ||
        a.start.localeCompare(b.start),
    )[0];
    if (!pick) continue;
    planned.push({ participant: candidate.participant, ...pick });
    taken.push(pick);
    usedDays.set(displayDate(pick.start), (usedDays.get(displayDate(pick.start)) ?? 0) + 1);
  }
  return planned.sort((a, b) => a.start.localeCompare(b.start));
}

/** Why a candidate got no slot (D30), for the judgement calls on the card: nothing free for them, or nothing free for both. */
export function unplacedReasons<P extends Participant>(
  input: PlanInput<P>,
  planned: PlannedSlot<P>[],
): Array<{ participant: P; reason: string }> {
  const duration = input.durationMinutes ?? 60;
  const days = Array.from({ length: 5 }, (_, i) => addDays(input.week, i));
  const dayFree = (busy: Interval[]) =>
    days.filter(day => {
      for (let minutes = 9 * 60; minutes + duration <= 16 * 60; minutes += 30) {
        if (minutes < 13 * 60 && minutes + duration > 12 * 60) continue;
        try {
          const start = localInstant(
            `${day}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
          );
          const end = new Date(Date.parse(start) + duration * 60000).toISOString();
          if (Date.parse(start) >= Date.parse(input.notBefore) && !collides({ start, end }, busy)) return true;
        } catch {
          /* skipped local time */
        }
      }
      return false;
    });
  const placed = new Set(planned.map(p => p.participant.email));
  return input.candidates
    .filter(c => !placed.has(c.participant.email))
    .map(c => {
      const own = dayFree(c.busy),
        yours = dayFree(input.managerBusy);
      const reason = !own.length
        ? 'upptagen hela veckan'
        : !yours.length
          ? 'dina lediga timmar räckte inte'
          : `ledig bara ${own.map(d => displayDate(d).slice(5)).join(', ')}, när du är upptagen`;
      return { participant: c.participant, reason };
    });
}
/** Busy minutes of the office day (08–17) on one Stockholm day, merged, as a share of the day (D30): the load bar in the day heading. */
export function dayLoad(day: string, intervals: Interval[]): { busyMinutes: number; share: number } {
  const open = dayStart(day),
    start = Date.parse(open) + 8 * 3600000,
    end = Date.parse(open) + 17 * 3600000;
  const clipped = intervals
    .map(e => ({ start: Math.max(Date.parse(e.start), start), end: Math.min(Date.parse(e.end), end) }))
    .filter(e => e.end > e.start)
    .sort((a, b) => a.start - b.start);
  let busy = 0,
    cursor = start;
  for (const e of clipped) {
    if (e.end > cursor) {
      busy += e.end - Math.max(e.start, cursor);
      cursor = e.end;
    }
  }
  const busyMinutes = Math.round(busy / 60000);
  return { busyMinutes, share: Math.min(1, busyMinutes / 540) };
}

/** Free gaps of at least `minMinutes` between 08 and 17 on one Stockholm day. */
export function freeGaps(day: string, events: Interval[], minMinutes = 30) {
  const open = dayStart(day),
    start = Date.parse(open) + 8 * 3600000,
    end = Date.parse(open) + 17 * 3600000;
  const busy = events
    .map(e => ({ start: Math.max(Date.parse(e.start), start), end: Math.min(Date.parse(e.end), end) }))
    .filter(e => e.end > e.start)
    .sort((a, b) => a.start - b.start);
  const gaps: Interval[] = [];
  let cursor = start;
  for (const b of busy) {
    if (b.start - cursor >= minMinutes * 60000)
      gaps.push({ start: new Date(cursor).toISOString(), end: new Date(b.start).toISOString() });
    cursor = Math.max(cursor, b.end);
  }
  if (end - cursor >= minMinutes * 60000)
    gaps.push({ start: new Date(cursor).toISOString(), end: new Date(end).toISOString() });
  return gaps;
}
/** The input of `freeSlots`: a window of Stockholm days and what is already in the person's own calendar. */
export interface FreeSlotInput {
  /** First day of the window (YYYY-MM-DD). */
  from: string;
  /** The day after the window (YYYY-MM-DD), exclusive. */
  until: string;
  /** The person's own busy instants. */
  busy: Interval[];
  /** Earliest acceptable start: a suggestion is never in the past. */
  notBefore: string;
  durationMinutes: number;
  /** How many times to suggest; three by default. */
  count?: number;
}
/**
 * Free times for one meeting in one person's own calendar (D112 item 10), deterministic and without a model: weekdays
 * 09–16 on whole or half hours, lunch kept free, as the planner searches (D30). At most one a day while there are days
 * left, earliest first, then the next free time of each day in turn, so the person is offered a spread before a cluster.
 */
export function freeSlots(input: FreeSlotInput): Interval[] {
  const count = input.count ?? 3;
  const duration = input.durationMinutes;
  const perDay: Interval[][] = [];
  for (let day = input.from; day < input.until; day = addDays(day, 1)) {
    if (new Date(day + 'T12:00:00Z').getUTCDay() % 6 === 0) continue; // Saturday and Sunday
    const free: Interval[] = [];
    for (let minutes = 9 * 60; minutes + duration <= 16 * 60; minutes += 30) {
      if (minutes < 13 * 60 && minutes + duration > 12 * 60) continue; // lunch
      try {
        const at = Date.parse(
          localInstant(
            `${day}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
          ),
        );
        const start = new Date(at).toISOString();
        const slot = { start, end: new Date(at + duration * 60000).toISOString() };
        if (Date.parse(start) >= Date.parse(input.notBefore) && !collides(slot, input.busy)) free.push(slot);
      } catch {
        /* skipped local time */
      }
    }
    if (free.length) perDay.push(free);
  }
  const slots: Interval[] = [];
  for (let round = 0; slots.length < count && perDay.some(d => d.length > round); round++)
    for (const day of perDay) if (slots.length < count && day[round]) slots.push(day[round]!);
  return slots.sort((a, b) => a.start.localeCompare(b.start));
}
export const withinOfficeHours = (slot: Interval) => {
  const s = minutesOfDay(slot.start),
    e = minutesOfDay(slot.end);
  return s >= 8 * 60 && e <= 17 * 60 && e > s && displayDate(slot.start) === displayDate(slot.end);
};
