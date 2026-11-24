import type { StaffOverview, ThreadItem } from '@clew/contracts';
import type { UnitMember } from './model';

/** Pure helpers of the calendar module (D20): no I/O, no clock, no runtime library. */

/** A planning card's row of a drawn time (D12): the proposal by its id. */
export const proposalRow = (proposalId: string) => 'proposal:' + proposalId;
/** A planning card's row of someone the planner could not place (D30): the person by Clew's id (N3). */
export const unplacedRow = (personId: string) => 'unplaced:' + personId;
/**
 * A card's rows without the ones that name a person (D123): the row of each of their proposals and their row without
 * one. Found by the ref alone, which holds the proposal's or the person's id, never by the label, which holds the name.
 */
export function withoutInvitee(
  items: readonly ThreadItem[],
  proposalIds: ReadonlySet<string>,
  personId: string,
): ThreadItem[] {
  const refs = new Set([...proposalIds].map(proposalRow));
  refs.add(unplacedRow(personId));
  return items.filter(i => !refs.has(i.ref));
}

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

/** Slices of at most `size`, in order: a provider's free-busy answers at most `FREE_BUSY_TARGETS` targets per request. */
export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
