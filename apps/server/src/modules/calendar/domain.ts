import type { StaffOverview } from '@clew/contracts';
import type { UnitMember } from './model';

/** Pure helpers of the calendar module (D20): no I/O, no clock, no runtime library. */

/**
 * The manager's team from the Personal overview (D94, D96 item 3): everyone on the units the manager manages except the
 * manager, a person on two units once, deactivated people and people without an address left out. The ref is the
 * address as a `mailto:` URI, which is what free-busy results are matched on.
 */
export function teamFromStaff(overview: StaffOverview, managerId: string): UnitMember[] {
  const seen = new Set<string>(),
    team: UnitMember[] = [];
  for (const unit of overview.units)
    for (const person of unit.people) {
      if (person.id === managerId || !person.enabled || !person.email || seen.has(person.id)) continue;
      seen.add(person.id);
      team.push({ personId: person.id, ref: 'mailto:' + person.email, email: person.email, name: person.name });
    }
  return team;
}

const MONTHS = [
  'januari',
  'februari',
  'mars',
  'april',
  'maj',
  'juni',
  'juli',
  'augusti',
  'september',
  'oktober',
  'november',
  'december',
];
/** A `YYYY-MM-DD` date as a person reads it in a sentence: "28 november". */
export function dueLabel(date: string) {
  const [, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]}`;
}

/** Slices of at most `size`, in order; a provider's free-busy answers at most eight targets per request. */
export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
