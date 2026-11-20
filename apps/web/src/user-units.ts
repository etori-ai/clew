import type { SessionUser, Thread } from '@clew/contracts';

/**
 * A person with several assignments (D135): the units they hold, named as the session names them. Every function here
 * says nothing for a person with one, so their pages are as they were.
 */
type Held = Pick<SessionUser, 'unitId' | 'unitLabel' | 'assignments'>;

/** Every assignment of a person who holds more than one, the primary one first; none for a person with one. */
export function heldUnits(user: Held) {
  const all = user.assignments;
  if (!all || all.length < 2) return undefined;
  const primary = all.find(a => a.unitId === user.unitId);
  return primary ? [primary, ...all.filter(a => a !== primary)] : [...all];
}

/**
 * The person's units in one line, where the header and Hem name their unit: the one unit, both of two ("Ekonomi och
 * HR"), or the primary one and how many more ("Ekonomi och 2 enheter till").
 */
export function unitsLine(user: Held): string {
  const held = heldUnits(user);
  if (!held) return user.unitLabel;
  if (held.length === 2) return `${held[0]!.unitLabel} och ${held[1]!.unitLabel}`;
  return `${held[0]!.unitLabel} och ${held.length - 1} enheter till`;
}

const inWords = new Intl.ListFormat('sv', { type: 'conjunction' });
/** Every unit of the person, the primary one first, as a list in words ("Ekonomi, Arkivet och HR"), for the settings. */
export function unitsList(user: Held): string {
  return inWords.format((heldUnits(user) ?? [{ unitLabel: user.unitLabel }]).map(a => a.unitLabel).filter(Boolean));
}
/**
 * The unit a work item is about, by the name the reader's session holds for it: only when the item names exactly one
 * unit, the unit is one of the reader's, and the reader holds more than one. Never the source's own text.
 */
export function workUnit(user: Held, thread: Pick<Thread, 'subjects'>): string | undefined {
  const held = heldUnits(user);
  if (!held) return undefined;
  const units = (thread.subjects ?? []).filter(s => s.entity === 'unit');
  if (units.length !== 1) return undefined;
  return held.find(a => a.unitId === units[0]!.key)?.unitLabel;
}
