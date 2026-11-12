import { COMPETENCE_CONNECTOR } from '@clew/connectors';
import {
  COMPETENCE_MATRIX_COLUMNS,
  COMPETENCE_ROW_STATUSES,
  daysUntil,
  stockholmDate,
  stockholmInstant,
  type CompetenceHoldingRow,
  type CompetenceMatrixCell,
  type CompetenceMatrixGroup,
  type CompetenceMatrixOutput,
  type CompetenceMatrixReason,
  type CompetenceMatrixStatus,
  type CompetenceStatus,
  type CompetenceType,
} from '@clew/contracts';
import {
  SOURCE_READ_ERRORS,
  type HoldingRecord,
  type PersonRef,
  type Placed,
  type PositionRecord,
  type RequirementRecord,
  type ShareTargetRecord,
  type SourceHolding,
  type SourceReadError,
  type TypeRecord,
  type UnitRecord,
  type WorkflowStart,
} from './model';

/**
 * The rules of the competence domain (D108) as pure functions: when a holding ends, where it stands on a day, which of
 * several holdings of one type decides, what is required of a person and what they lack (item 6), how a unit's branch is
 * covered, what a type's name may be, and the refs, keys and rows the reads carry. No I/O, no clock: the use case hands
 * in every day.
 */

/** A holding that ends within this many days is expiring (D108 item 4). */
export const EXPIRING_DAYS = 90;
export const TYPE_NAME_MAX = 120;
export const TYPE_AREA_MAX = 80;

/** What another system knows a person by: the provisioned user name, or Clew's id when there is none. */
export const personKey = (person: Pick<PersonRef, 'id' | 'userName'>) => person.userName ?? person.id;
/** `holding:competence:<holding id>`. */
export const holdingRef = (holdingId: string) => `holding:${COMPETENCE_CONNECTOR}:${holdingId}`;
/**
 * The read a manager's card of an approval opens (D108 item 7): the registration that waits, which leads to its decision
 * on the matrix.
 */
export const APPROVAL_READ = `${COMPETENCE_CONNECTOR}.approval`;
/** A required type a person lacks is no holding: `holding:competence:missing:<person id>:<type id>`, stable while it lacks. */
export const missingRef = (personId: string, typeId: string) =>
  `holding:${COMPETENCE_CONNECTOR}:missing:${personId}:${typeId}`;

/** The calendar day of an instant in Swedish time, `YYYY-MM-DD`. */
export const swedishDay = (at: Date) => stockholmDate(at.toISOString());
/** A real calendar day written `YYYY-MM-DD` (not 2026-02-30). */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
const dayAndMonth = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long', timeZone: 'UTC' });
/** A calendar day as a person reads it in a sentence: `2026-11-28` is "28 november". */
export const swedishDayAndMonth = (day: string) => dayAndMonth.format(new Date(day + 'T12:00:00Z'));

/** One line of text, trimmed, every run of white space one space; undefined when blank or longer than `max` characters. */
function line(text: string, max: number): string | undefined {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length >= 1 && [...value].length <= max ? value : undefined;
}
export const normaliseName = (name: string) => line(name, TYPE_NAME_MAX);
export const normaliseArea = (area: string) => line(area, TYPE_AREA_MAX);

/**
 * The same day of the month `months` later; a day the later month does not have is its last (31 January and one month
 * is 28 or 29 February).
 */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}
/**
 * The last day a holding is valid (D108 item 3): the issuer's date where the holding has one, else the employer's rule
 * counted from the issue date, else null (it does not end). `validityMonths` is the type's now, so a change of the rule
 * moves every holding counted from it.
 */
export function endOf(
  holding: Pick<HoldingRecord, 'issuedOn' | 'expiresOn'>,
  type: Pick<TypeRecord, 'validityMonths'>,
): string | null {
  if (holding.expiresOn) return holding.expiresOn;
  return type.validityMonths ? addMonths(holding.issuedOn, type.validityMonths) : null;
}
/** Where a holding stands: every status but `missing`, which is where a person stands without one. */
export type HeldStatus = Exclude<CompetenceStatus, 'missing'>;
/** Where a holding that ends on `end` stands on `today` (D108 item 4). The last day is still valid. */
export function statusOn(end: string | null, today: string): HeldStatus {
  if (end === null) return 'valid';
  const days = daysUntil(end, today);
  return days < 0 ? 'expired' : days <= EXPIRING_DAYS ? 'expiring' : 'valid';
}
/** A holding counts when it is `valid` as stored: not pending, rejected or revoked. */
export const counts = (holding: Pick<HoldingRecord, 'state'>) => holding.state === 'valid';
/** A person's own registration that waits for their manager's decision (D108 item 7): it counts towards nothing. */
export const awaiting = (holding: Pick<HoldingRecord, 'state' | 'evidence'>) =>
  holding.evidence === 'self' && holding.state === 'pending';

/** A holding with its type's end date and status worked out for one day. */
export interface HeldStanding {
  personId: string;
  holding: HoldingRecord;
  type: TypeRecord;
  end: string | null;
  status: HeldStatus;
}
/** A type required of a person (D108 item 6) that they hold nothing of that counts: no holding, no end. */
export interface MissingStanding {
  personId: string;
  holding: null;
  type: TypeRecord;
  end: null;
  status: 'missing';
}
/** Where a person stands on one type on one day: by the holding that decides, or missing where one is required. */
export type Standing = HeldStanding | MissingStanding;
/**
 * For each person and type, the one holding that decides (D108 item 9): of the ones that count, the one that ends last,
 * one that never ends before any that does, the most recently issued on a tie. Holdings of an unknown type are left out.
 * With `required` (each person's required types, `requiredOf`), a required type the person has no deciding holding of is
 * a `missing` standing (item 6); a required type that is archived or unknown is required of nobody, since nobody can be
 * registered for it. An expired holding stays `expired`: the person had it.
 */
export function deciding(
  holdings: readonly HoldingRecord[],
  types: ReadonlyMap<string, TypeRecord>,
  today: string,
  required?: ReadonlyMap<string, readonly string[]>,
): Standing[] {
  const best = new Map<string, HeldStanding>();
  const later = (a: HeldStanding, b: HeldStanding) => {
    if (a.end !== b.end) return a.end === null || (b.end !== null && a.end > b.end);
    return (
      a.holding.issuedOn > b.holding.issuedOn ||
      (a.holding.issuedOn === b.holding.issuedOn && a.holding.id < b.holding.id)
    );
  };
  const keyOf = (personId: string, typeId: string) => personId + '\n' + typeId;
  for (const holding of holdings) {
    // A copied row whose source type is not mapped has no type and counts towards nothing (item 9).
    const type = holding.typeId === null ? undefined : types.get(holding.typeId);
    if (!type || !counts(holding)) continue;
    const end = endOf(holding, type);
    const standing: HeldStanding = {
      personId: holding.personId,
      holding,
      type,
      end,
      status: statusOn(end, today),
    };
    const key = keyOf(holding.personId, type.id);
    const current = best.get(key);
    if (!current || later(standing, current)) best.set(key, standing);
  }
  const missing: MissingStanding[] = [];
  for (const [personId, typeIds] of required ?? [])
    for (const typeId of new Set(typeIds)) {
      const type = types.get(typeId);
      if (!type || type.archivedAt !== null || best.has(keyOf(personId, typeId))) continue;
      missing.push({ personId, holding: null, type, end: null, status: 'missing' });
    }
  return [...best.values(), ...missing];
}
/** Whether a standing needs a person: it has expired, is missing or expires within `EXPIRING_DAYS`. */
export const needsAttention = (standing: Pick<Standing, 'status'>) => standing.status !== 'valid';
/** Whether a standing meets what is required: a holding that counts and has not run out (expiring still meets it). */
export const meets = (standing: Pick<Standing, 'status'>) =>
  standing.status === 'valid' || standing.status === 'expiring';
/**
 * The requirements that apply to one person (D108 item 6): those set on a position they hold (by its code), on a unit
 * they are assigned to, and on them alone. A requirement whose position or unit no longer exists applies to nobody,
 * since nobody holds the one or is placed on the other, until it comes back under the same key.
 */
export function requirementsOn(person: Placed, requirements: readonly RequirementRecord[]): RequirementRecord[] {
  const positions = new Set(person.positionCodes),
    units = new Set(person.unitIds);
  return requirements.filter(
    r =>
      (r.positionCode !== null && positions.has(r.positionCode)) ||
      (r.unitId !== null && units.has(r.unitId)) ||
      r.personId === person.personId,
  );
}
/**
 * The last time any of a person's holdings of a type was revoked, by a manager or by its source withdrawing it; null
 * when none was. A card's identity carries it, so a cause that comes back after a revocation is new work.
 */
export function lastRevoked(holdings: readonly HoldingRecord[], personId: string, typeId: string): string | null {
  let last: string | null = null;
  for (const h of holdings)
    if (h.personId === personId && h.typeId === typeId && h.revokedAt && (!last || h.revokedAt > last))
      last = h.revokedAt;
  return last;
}
/** A card's work as the refresh keys it (D47): the draft's topic, and its one occurrence's key, period and revision. */
export interface CardIdentity {
  topic: string;
  key: string;
  period: string;
  revision: string;
}
/**
 * What a person's own card is (D108 item 12, D47), keyed on the person and the competence type, never a holding's row,
 * so a row copied again under a new id (item 9) is the same card, its dismissal kept. The period says which cause it
 * is: the refresh never reopens a resolved occurrence whose identity comes back, so a cause that returns must be a new
 * period. A holding that has run out or soon will is `due:<type>`, its period the status, the end date and the last
 * revocation of the type: one that runs out after its "går ut snart" card was handled, a new end date (a renewal, or an
 * administrator's change of the type's validity) and a renewal revoked so that the older holding decides again are each
 * a new card. A missing type is `missing:<type>`, its period the requirements that ask for it and the last revocation:
 * a requirement removed and set again (a new id), or a holding revoked, is a new card. The one known limit: a requirement
 * that stops applying to the person and applies again unchanged, such as a position or a unit that disappears and comes
 * back under the same code or id, brings back the same identity, so that card does not open again.
 */
export function ownCard(
  standing: Standing,
  cause: { requirementIds: readonly string[]; lastRevoked: string | null },
): CardIdentity {
  const revoked = cause.lastRevoked ?? 'none';
  if (standing.holding === null) {
    const topic = `${COMPETENCE_CONNECTOR}:missing:${standing.type.id}`;
    return {
      topic,
      key: topic,
      period: `${[...cause.requirementIds].sort().join(',')}|${revoked}`,
      revision: 'missing',
    };
  }
  const topic = `${COMPETENCE_CONNECTOR}:due:${standing.type.id}`;
  return { topic, key: topic, period: `${standing.status}|${standing.end}|${revoked}`, revision: standing.status };
}
/**
 * The manager's one card (D108 item 12): one occurrence on its topic, its revision the counts it shows (what is to act
 * on, expired and missing together, and what soon runs out), so it names nobody and does not grow with the reports. A
 * refresh reopens a handled card whenever the revision differs, and a scan that keeps nothing cannot tell counts that
 * rise from counts that fall: either brings the card back, counts that stand do not.
 */
export function teamCard(counts: { toActOn: number; expiring: number }): CardIdentity {
  const topic = `${COMPETENCE_CONNECTOR}:attention`;
  return { topic, key: topic, period: 'once', revision: `${counts.toActOn}|${counts.expiring}` };
}
/**
 * The types required of one person (D108 item 6), each once: those set on a position they hold, on a unit they are
 * assigned to, and on them alone. A person with two positions is under both sets.
 */
export function requiredOf(person: Placed, requirements: readonly RequirementRecord[]): string[] {
  return [...new Set(requirementsOn(person, requirements).map(r => r.typeId))];
}
/**
 * A unit with every unit below it in the tree (D99 item 5), the unit first. A unit the tree does not name is itself
 * alone, and each unit is taken once, so a stored chain that were ever a cycle ends. The people module's rule, worked out
 * here again since a module never imports another.
 */
export function branchOf(tree: readonly Pick<UnitRecord, 'id' | 'parentId'>[], unitId: string): string[] {
  const below = new Map<string, string[]>();
  for (const u of tree) if (u.parentId !== null) below.set(u.parentId, [...(below.get(u.parentId) ?? []), u.id]);
  const branch = new Set([unitId]);
  for (const id of branch) for (const next of below.get(id) ?? []) branch.add(next);
  return [...branch];
}
/**
 * The least number of people a figure may count beyond those the reader already knows (D108 item 8, D118: a figure names
 * nobody). A manager knows where their own reports stand, and they are all the coverage of required types counts; the
 * rest of a branch enters only a share target, and only when it holds at least this many people. The same bound keeps
 * an organisation's share target from being shown over fewer.
 */
export const COVERAGE_MIN_GROUP = 5;
/**
 * Whether a figure over `people` may be shown to a reader who knows `known` of them (D108 item 8): yes when the rest are
 * none (the figure says nothing the reader does not know) or at least `COVERAGE_MIN_GROUP`.
 */
export function showable(people: readonly string[], known: (personId: string) => boolean): boolean {
  const others = people.filter(id => !known(id)).length;
  return others === 0 || others >= COVERAGE_MIN_GROUP;
}
/** One required type over the reader's own reports: how many it is required of, and how many of them meet it. */
export interface RequirementCoverage {
  type: TypeRecord;
  under: number;
  meeting: number;
}
/**
 * One share target over what it was set on, the unit's whole branch: how many people hold its position, how many of
 * them meet its type, the share they are (whole percent, rounded down, so a share shown at the target meets it) and
 * whether it reaches the least share. With nobody to count, no share and no verdict. `withheld`: the people the reader
 * does not know are too few to count (`showable`), so no figure is given.
 */
export interface TargetCoverage {
  target: ShareTargetRecord;
  type: TypeRecord;
  holders: number;
  meeting: number;
  share: number | null;
  met: boolean | null;
  withheld: boolean;
}
/** A unit's branch against what is required (D108 items 6 and 8, D99 item 5): counts only, never a person. */
export interface UnitCoverage {
  /** The reader's own reports with at least one requirement, and of them the ones who meet every one. */
  under: number;
  meetingAll: number;
  requirements: RequirementCoverage[];
  targets: TargetCoverage[];
}
/** The share of `holders` who meet a type, rounded down, and whether it reaches a least share; none of nobody. */
const shareOf = (meeting: number, holders: number, minShare: number) => ({
  share: holders ? Math.floor((meeting * 100) / holders) : null,
  met: holders ? meeting * 100 >= minShare * holders : null,
});
/**
 * How a branch is covered (D108 items 6 and 8), for its manager. Coverage per required type, and the summary of who
 * meets everything, count the reader's own reports alone (`reports`, whom they already see one by one), however many
 * others the branch holds: so no row of it can be set against another to single anyone out. The rest of the branch
 * enters only the share targets set on the unit, each measured once over the whole branch (`people`: its active people,
 * the reader included where they hold the position), and given only when the people in its denominator whom the reader
 * does not know (neither a report nor the reader) are none or at least `COVERAGE_MIN_GROUP`. Set against a requirement
 * row of the same type, a target row then gives away at most a figure over that many. Two targets of the same type whose
 * denominators overlap could be set against each other: where the part of one that is not in the other holds one to four
 * people the reader does not know, both are withheld.
 *
 * Each person comes with every unit and position of theirs (a requirement on a unit outside the branch still applies to
 * a person in it); `standings` are the holdings that decide for them (`deciding`). A requirement or a target whose type
 * is archived or unknown counts towards nothing, and so does one whose position or unit is gone.
 */
export function coverageOf(input: {
  people: readonly Placed[];
  reader: string;
  reports: ReadonlySet<string>;
  requirements: readonly RequirementRecord[];
  targets: readonly ShareTargetRecord[];
  types: ReadonlyMap<string, TypeRecord>;
  standings: readonly Standing[];
}): UnitCoverage {
  const live = (typeId: string) => {
    const type = input.types.get(typeId);
    return type && type.archivedAt === null ? type : undefined;
  };
  const known = (personId: string) => input.reports.has(personId) || personId === input.reader;
  const met = new Set(input.standings.filter(meets).map(s => s.personId + '\n' + s.type.id));
  const meetsType = (personId: string, typeId: string) => met.has(personId + '\n' + typeId);
  const own = input.people.filter(p => input.reports.has(p.personId));
  const required = new Map(
    own.map(p => [
      p.personId,
      [...new Set(requirementsOn(p, input.requirements).map(r => r.typeId))].filter(id => live(id)),
    ]),
  );
  const requiredOfPerson = (p: Placed) => required.get(p.personId) ?? [];
  const requirements: RequirementCoverage[] = [];
  for (const typeId of new Set([...required.values()].flat())) {
    const under = own.filter(p => requiredOfPerson(p).includes(typeId));
    requirements.push({
      type: live(typeId)!,
      under: under.length,
      meeting: under.filter(p => meetsType(p.personId, typeId)).length,
    });
  }
  const anything = own.filter(p => requiredOfPerson(p).length);
  const measured = input.targets.flatMap(target => {
    const type = live(target.typeId);
    if (!type) return [];
    const holders = input.people.filter(p => p.positionCodes.includes(target.positionCode)).map(p => p.personId);
    return [{ target, type, holders, withheld: !showable(holders, known) }];
  });
  // Two targets of one type over overlapping denominators: the part of either outside the other must be safe to count.
  for (const a of measured)
    for (const b of measured) {
      if (a === b || a.target.typeId !== b.target.typeId) continue;
      const inB = new Set(b.holders);
      if (!a.holders.some(id => inB.has(id))) continue;
      if (
        !showable(
          a.holders.filter(id => !inB.has(id)),
          known,
        )
      )
        a.withheld = b.withheld = true;
    }
  const targets = measured.map(({ target, type, holders, withheld }): TargetCoverage => {
    if (withheld) return { target, type, holders: 0, meeting: 0, share: null, met: null, withheld };
    const meeting = holders.filter(id => meetsType(id, target.typeId)).length;
    return {
      target,
      type,
      holders: holders.length,
      meeting,
      ...shareOf(meeting, holders.length, target.minShare),
      withheld,
    };
  });
  const byName = (a: { type: TypeRecord }, b: { type: TypeRecord }) =>
    sv(a.type.area, b.type.area) || sv(a.type.name, b.type.name) || a.type.id.localeCompare(b.type.id);
  return {
    under: anything.length,
    meetingAll: anything.filter(p => requiredOfPerson(p).every(id => meetsType(p.personId, id))).length,
    requirements: requirements.sort(byName),
    targets: targets.sort((a, b) => byName(a, b) || a.target.id.localeCompare(b.target.id)),
  };
}
/**
 * A share target across the whole organisation (D108 item 6), measured over it once, as the administrator reads it on
 * the requirements page: the share of `holders` (the organisation's active people in the position) who meet its type, a
 * figure that names nobody (D118), shown only over at least `COVERAGE_MIN_GROUP` people.
 */
export function organisationOutcome(
  target: Pick<ShareTargetRecord, 'minShare'>,
  holders: readonly string[],
  meetsType: (personId: string) => boolean,
): { holders: number; meeting: number; share: number; met: boolean } | { tooFew: true } {
  if (holders.length < COVERAGE_MIN_GROUP) return { tooFew: true };
  const meeting = holders.filter(meetsType).length;
  const { share, met } = shareOf(meeting, holders.length, target.minShare);
  return { holders: holders.length, meeting, share: share!, met: met! };
}

const sv = (a: string, b: string) => a.localeCompare(b, 'sv');
/**
 * Rows in the order a list is drawn: by status (`COMPETENCE_ROW_STATUSES`, what counts towards nothing last), the
 * soonest end first, then person and type.
 */
export function orderHoldingRows<
  T extends Pick<CompetenceHoldingRow, 'status' | 'expiresOn' | 'name' | 'competence' | 'ref'>,
>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      COMPETENCE_ROW_STATUSES.indexOf(a.status) - COMPETENCE_ROW_STATUSES.indexOf(b.status) ||
      (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999') ||
      sv(a.name, b.name) ||
      sv(a.competence, b.competence) ||
      a.ref.localeCompare(b.ref),
  );
}
/** The catalogue in the order it is listed: by area, then name, in Swedish order. */
export function orderTypes<T extends Pick<TypeRecord, 'area' | 'name' | 'id'>>(types: T[]): T[] {
  return [...types].sort((a, b) => sv(a.area, b.area) || sv(a.name, b.name) || a.id.localeCompare(b.id));
}

/** A copied row's source as a read names it (D108 item 9): the system's name and when the row was last read. */
function copiedFrom(holding: HoldingRecord, sourceNames: ReadonlyMap<string, string>) {
  if (!holding.copy) return {};
  const source = sourceNames.get(holding.copy.connectorId) ?? holding.copy.connectorId;
  return { source: [...source].slice(0, 120).join(''), readAt: holding.copy.readAt };
}
/**
 * One standing as a read lists it; a copied one with its source and when it was read; a missing one with its type and
 * no dates, since there is no holding.
 */
export function holdingRow(
  standing: Standing,
  person: Pick<PersonRef, 'id' | 'name' | 'userName'>,
  sourceNames: ReadonlyMap<string, string> = new Map(),
): CompetenceHoldingRow {
  if (standing.holding === null)
    return {
      ref: missingRef(person.id, standing.type.id),
      userName: personKey(person),
      name: person.name,
      competence: standing.type.name,
      area: standing.type.area,
      kind: standing.type.kind,
      status: 'missing',
    };
  return {
    ref: holdingRef(standing.holding.id),
    userName: personKey(person),
    name: person.name,
    competence: standing.type.name,
    area: standing.type.area,
    kind: standing.type.kind,
    issuedOn: standing.holding.issuedOn,
    ...(standing.end ? { expiresOn: standing.end } : {}),
    status: standing.status,
    evidence: standing.holding.evidence,
    ...copiedFrom(standing.holding, sourceNames),
  };
}
/**
 * A copied holding whose source type is not mapped (D108 item 9), as a read lists it: under the source's own label,
 * with the issuer's end date if the source gave one, marked as counting towards nothing.
 */
export function uncountedRow(
  holding: HoldingRecord,
  person: Pick<PersonRef, 'id' | 'name' | 'userName'>,
  sourceNames: ReadonlyMap<string, string>,
): CompetenceHoldingRow {
  return {
    ref: holdingRef(holding.id),
    userName: personKey(person),
    name: person.name,
    competence: holding.copy?.sourceLabel ?? '',
    issuedOn: holding.issuedOn,
    ...(holding.expiresOn ? { expiresOn: holding.expiresOn } : {}),
    status: 'uncounted',
    evidence: holding.evidence,
    ...copiedFrom(holding, sourceNames),
  };
}
/**
 * A person's own registration that waits for a decision, or was rejected (D108 item 7), as a read lists it: its type,
 * its dates (the end worked out as for any holding) and `awaiting-approval` or `rejected`. Neither counts towards
 * anything; a rejected one is listed to the person alone, which the read decides.
 */
export function ownRow(
  holding: HoldingRecord,
  type: TypeRecord,
  person: Pick<PersonRef, 'id' | 'name' | 'userName'>,
): CompetenceHoldingRow {
  const end = endOf(holding, type);
  return {
    ref: holdingRef(holding.id),
    userName: personKey(person),
    name: person.name,
    competence: type.name,
    area: type.area,
    kind: type.kind,
    issuedOn: holding.issuedOn,
    ...(end ? { expiresOn: end } : {}),
    status: holding.state === 'pending' ? 'awaiting-approval' : 'rejected',
    evidence: holding.evidence,
  };
}
/** A copied row that waits for its type: it is listed, but counts towards nothing until the type is mapped. */
export const uncounted = (holding: HoldingRecord) =>
  holding.copy !== null && holding.typeId === null && counts(holding);
/**
 * What a person's standings add up to: how many have run out, how many required types they lack, how many soon run
 * out, and how many holdings count at all (a missing type is no holding).
 */
export interface PersonSummary {
  expired: number;
  missing: number;
  expiring: number;
  holdings: number;
}
export function summarise(standings: readonly Pick<Standing, 'status'>[]): PersonSummary {
  const count = (status: CompetenceStatus) => standings.filter(s => s.status === status).length;
  return {
    expired: count('expired'),
    missing: count('missing'),
    expiring: count('expiring'),
    holdings: standings.length - count('missing'),
  };
}
/**
 * The one status that stands for a person (D108 items 4 and 6), in the precedence of `COMPETENCE_STATUSES`: expired,
 * then missing, then expiring, then valid; `none` when they hold nothing and lack nothing.
 */
export function personStatus(summary: PersonSummary): CompetenceStatus | 'none' {
  if (summary.expired) return 'expired';
  if (summary.missing) return 'missing';
  if (summary.expiring) return 'expiring';
  return summary.holdings ? 'valid' : 'none';
}
/** One type as the catalogue lists it. */
export function typeRow(type: TypeRecord): CompetenceType {
  return {
    id: type.id,
    name: type.name,
    area: type.area,
    kind: type.kind,
    ...(type.validityMonths ? { validityMonths: type.validityMonths } : {}),
    archived: type.archivedAt !== null,
  };
}

// The manager's matrix (D108 item 11).

/** A report as the matrix names them: Clew's id, their name, and the user name another system knows them by. */
export interface MatrixPerson {
  id: string;
  name: string;
  userName: string | null;
}
/** One set of columns the matrix offers, with the types it holds in the order they are drawn. */
interface MatrixSet extends CompetenceMatrixGroup {
  typeIds: string[];
}
/** `items` in consecutive runs of at most `size`. */
const runs = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
/** The order the reasons of a cell are listed in: positions, then units, then the person's own, each by name. */
const REASON_ORDER = ['position', 'unit', 'person'] as const;
/**
 * The manager's matrix (D108 item 11): each report (`people`, every one of them, by name) against the types required
 * of at least one of them, at most `COMPETENCE_MATRIX_COLUMNS` columns at a time. A required type that is archived or
 * unknown is required of nobody, so it is no column. Where more types are required than fit, the reader chooses a set:
 * the required types of one area, or those a requirement on one position asks for, of every position a report holds; a
 * set larger than ten is shown in parts of ten. `by` and `part` name the set (an unknown one, or none, is the first, the
 * first area). Each cell says where the person stands (the holding that decides, as `deciding` works it out, or
 * `missing` where the type is required of them and nothing counts, or `none` where it is neither held nor required),
 * what requires it of them, and whether the reader may revoke the holding: one registered in Clew may be, one copied
 * from a source never (D108 item 9). Where the person's own registration of the type waits for a decision (item 7), the
 * cell names it (`pending`) beside the status it has without it.
 */
export function matrixOf(input: {
  people: readonly MatrixPerson[];
  placed: readonly Placed[];
  requirements: readonly RequirementRecord[];
  types: ReadonlyMap<string, TypeRecord>;
  holdings: readonly HoldingRecord[];
  positions: readonly PositionRecord[];
  units: readonly UnitRecord[];
  today: string;
  by?: string | undefined;
  part?: number | undefined;
}): CompetenceMatrixOutput {
  const live = (typeId: string) => {
    const type = input.types.get(typeId);
    return type && type.archivedAt === null ? type : undefined;
  };
  const placed = new Map(input.placed.map(p => [p.personId, p]));
  const placeOf = (personId: string): Placed => placed.get(personId) ?? { personId, unitIds: [], positionCodes: [] };
  /** The requirements on a type that is not archived, that apply to each person. */
  const applying = new Map(
    input.people.map(p => [p.id, requirementsOn(placeOf(p.id), input.requirements).filter(r => live(r.typeId))]),
  );
  const required = new Map([...applying].map(([id, rs]) => [id, [...new Set(rs.map(r => r.typeId))]]));
  const all = orderTypes([...new Set([...required.values()].flat())].map(id => live(id)!));
  const positionLabel = new Map(input.positions.map(p => [p.code, p.label])),
    unitLabel = new Map(input.units.map(u => [u.id, u.label]));

  const sets: MatrixSet[] = [];
  let shown = all,
    chosen: MatrixSet | undefined;
  if (all.length > COMPETENCE_MATRIX_COLUMNS) {
    const split = (by: string, kind: MatrixSet['kind'], label: string, types: readonly TypeRecord[]) =>
      runs(types, COMPETENCE_MATRIX_COLUMNS).map((run, i, parts): MatrixSet => ({
        by,
        part: i + 1,
        parts: parts.length,
        kind,
        label,
        types: run.length,
        typeIds: run.map(t => t.id),
      }));
    // `all` is in the catalogue's order, by area first, so its areas come in Swedish order.
    for (const area of new Set(all.map(t => t.area)))
      sets.push(
        ...split(
          'area:' + area,
          'area',
          area,
          all.filter(t => t.area === area),
        ),
      );
    const held = [...new Set(input.people.flatMap(p => placeOf(p.id).positionCodes))]
      .filter(code => positionLabel.has(code))
      .sort((a, b) => sv(positionLabel.get(a)!, positionLabel.get(b)!) || a.localeCompare(b));
    for (const code of held) {
      const asked = new Set(input.requirements.filter(r => r.positionCode === code).map(r => r.typeId));
      const types = all.filter(t => asked.has(t.id));
      if (types.length) sets.push(...split('position:' + code, 'position', positionLabel.get(code)!, types));
    }
    chosen =
      sets.find(s => s.by === input.by && s.part === (input.part ?? 1)) ??
      sets.find(s => s.by === input.by) ??
      sets[0]!;
    const ids = new Set(chosen.typeIds);
    shown = all.filter(t => ids.has(t.id));
  }

  const standings = deciding(input.holdings, input.types, input.today, required);
  const at = new Map(standings.map(s => [s.personId + '\n' + s.type.id, s]));
  // A person's own registration waiting for a decision (D108 item 7) counts towards nothing: the cell's status is what
  // it is without it, and the cell says it waits.
  const waits = new Map(
    input.holdings.filter(h => awaiting(h) && h.typeId !== null).map(h => [h.personId + '\n' + h.typeId, h.id]),
  );
  const reason = (r: RequirementRecord): CompetenceMatrixReason =>
    r.positionCode !== null
      ? { on: 'position', label: positionLabel.get(r.positionCode) ?? r.positionCode }
      : r.unitId !== null
        ? { on: 'unit', label: unitLabel.get(r.unitId) ?? r.unitId }
        : { on: 'person', requirementId: r.id };
  const cell = (personId: string, typeId: string): CompetenceMatrixCell => {
    const through = applying
      .get(personId)!
      .filter(r => r.typeId === typeId)
      .map(reason)
      .sort(
        (a, b) =>
          REASON_ORDER.indexOf(a.on) - REASON_ORDER.indexOf(b.on) ||
          sv(a.label ?? '', b.label ?? '') ||
          (a.requirementId ?? '').localeCompare(b.requirementId ?? ''),
      );
    const standing = at.get(personId + '\n' + typeId);
    const required = through.length > 0;
    const pendingId = waits.get(personId + '\n' + typeId);
    const pending = pendingId ? { pending: pendingId } : {};
    if (!standing) return { typeId, status: 'none', required, through, revocable: false, ...pending };
    if (standing.holding === null)
      return { typeId, status: 'missing', required, through, revocable: false, ...pending };
    return {
      typeId,
      status: standing.status,
      ...(standing.end ? { expiresOn: standing.end } : {}),
      required,
      through,
      holdingId: standing.holding.id,
      evidence: standing.holding.evidence,
      revocable: standing.holding.evidence !== 'system',
      ...pending,
    };
  };
  const rows = [...input.people]
    .sort((a, b) => sv(a.name, b.name) || a.id.localeCompare(b.id))
    .map(p => ({ personId: p.id, key: personKey(p), name: p.name, cells: shown.map(t => cell(p.id, t.id)) }));
  return {
    ...(chosen ? { by: chosen.by, part: chosen.part } : {}),
    groups: sets.map(({ typeIds: _typeIds, ...group }) => group),
    columns: shown.map(t => ({ typeId: t.id, name: t.name, area: t.area, kind: t.kind })),
    rows,
    required: all.length,
  };
}

/** A cell of the matrix's file in words a person reads, the dates as `YYYY-MM-DD` so a spreadsheet can sort them. */
const CSV_WORDS: Record<CompetenceMatrixStatus, string> = {
  expired: 'Utgånget',
  missing: 'Saknas',
  expiring: 'Går ut snart',
  valid: 'Giltigt',
  none: 'Krävs inte',
};
export function matrixCellText(cell: Pick<CompetenceMatrixCell, 'status' | 'expiresOn' | 'required'>): string {
  const word =
    cell.status === 'valid' && cell.expiresOn
      ? `Giltigt till ${cell.expiresOn}`
      : cell.expiresOn && (cell.status === 'expired' || cell.status === 'expiring')
        ? `${CSV_WORDS[cell.status]} ${cell.expiresOn}`
        : CSV_WORDS[cell.status];
  return !cell.required && cell.status !== 'none' ? `${word} (krävs inte)` : word;
}
/**
 * One field of the file: a value a spreadsheet would read as a formula (`=`, `+`, `-`, `@`, a tab or a return first)
 * is kept as text with a quote before it, and one with a separator, a quote or a line break is quoted.
 */
function csvField(value: string): string {
  const text = /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
  return /[";\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
/**
 * The matrix as shown, as a file (D108 item 11): a heading row of "Namn", "Användarnamn" and the columns' names, then
 * one row per person with their name, their user name (Clew's id for someone provisioned without one), so two reports
 * who share a name can be told apart, and each cell in words. Separated by semicolons with a byte order mark and CRLF
 * line ends, which a spreadsheet set up for Swedish opens as columns with å, ä and ö intact.
 */
export function matrixCsv(matrix: Pick<CompetenceMatrixOutput, 'columns' | 'rows'>): string {
  const lines = [
    ['Namn', 'Användarnamn', ...matrix.columns.map(c => c.name)],
    ...matrix.rows.map(r => [r.name, r.key, ...r.cells.map(matrixCellText)]),
  ];
  return '\ufeff' + lines.map(line => line.map(csvField).join(';')).join('\r\n') + '\r\n';
}

// The copy of what sources hold (D108 item 9).

/** A read holds its source under a lease renewed after every page, so a run that died lets go within this time. */
export const LEASE_MS = 15 * 60_000;
/** At most this many pages in one read: a source whose cursor never ends fails the read instead of holding it. */
export const PAGES_MAX = 10_000;
/**
 * At most this many holdings in one read of one source (D108 item 9). The read holds, until its one transaction, the
 * row id of every holding the source answered and the usable holdings of the people Clew matched; the transaction
 * reads every row copied from the source and writes the new and the changed, then moves the time of the rest. Two
 * hundred thousand (ten thousand people with twenty holdings each) keeps that to tens of megabytes in the server and
 * a transaction of some seconds; a source that holds more stops the read there, keeps what was read and is said in the
 * log, rather than outgrowing the process.
 */
export const COPY_HOLDINGS_MAX = 200_000;
/** A page whose source does not answer is asked again after these pauses, then the read stops until the next run. */
export const UNAVAILABLE_PAUSES_MS = [5_000, 30_000] as const;
/** The longest id and type id the copy keeps from a source: the profile's own bounds. */
export const SOURCE_ID_MAX = 200;
/** The longest key the copy matches, the profile's bound: a user name in Clew is at most as long. */
export const SOURCE_KEY_MAX = 512;
/**
 * The error kind a page's failure carries (`SourceReadError`), read from its `code` as the installation's read throws
 * it (D119); undefined for anything else, which the copy treats as `unknown`.
 */
export function sourceReadError(error: unknown): SourceReadError | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return SOURCE_READ_ERRORS.find(c => c === code);
}
/** The daily read starts at this time in Sweden, before the nightly scan at 06:00 makes the day's cards. */
export const DAILY_COPY_AT = '04:00';
/** The workflow that copies (`dbos/workflows.ts`): its name is the contract between the store's start and the engine. */
export const COPY_WORKFLOW = 'competenceCopy';
/** What the copy's workflow takes: the run that claims each source, when to start, and one source or every one. */
export interface CopyInput {
  run: string;
  dueAt: string;
  connectorId?: string;
  /** The daily run: it schedules the next day's before it reads. */
  daily?: true;
}

/** The day after `day`, `YYYY-MM-DD`. */
const nextDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};
/** The next daily read after `now`: 04:00 in Sweden today if that is still ahead, else tomorrow. */
export function nextDailyCopy(now: Date): { day: string; at: string } {
  const today = swedishDay(now);
  const at = stockholmInstant(today, DAILY_COPY_AT);
  if (Date.parse(at) > now.getTime()) return { day: today, at };
  const day = nextDay(today);
  return { day, at: stockholmInstant(day, DAILY_COPY_AT) };
}
/** The daily read's start: one workflow per day by its id, so every instance and every boot may ask for it. */
export function dailyCopyStart(day: string, at: string): WorkflowStart {
  const input: CopyInput = { run: 'daily:' + day, dueAt: at, daily: true };
  return { workflow: COPY_WORKFLOW, id: 'competence-copy:' + day, input };
}
/** A run asked for by hand, starting at once: an administrator's "Läs in nu" for one source, an operator's for one or all. */
export function readNowStart(run: string, connectorId: string | undefined, at: string): WorkflowStart {
  const input: CopyInput = { run, dueAt: at, ...(connectorId ? { connectorId } : {}) };
  return { workflow: COPY_WORKFLOW, id: 'competence-read:' + run, input };
}
/** The instant a lease taken or renewed at `at` runs out. */
export const leaseUntil = (at: Date) => new Date(at.getTime() + LEASE_MS).toISOString();

/** A holding of a source as the copy keeps it: its ids, its one-line label and its dates. */
export interface UsableHolding {
  id: string;
  type: string;
  label: string;
  issuedOn: string;
  expiresOn: string | null;
}
/**
 * Text Postgres refuses or that names nothing: a control character (C0, DEL, C1; NUL among them, which a `text` column
 * refuses outright) or one half of a surrogate pair without the other. The profile bounds only the length of a source's
 * strings, so the copy checks them itself: one such string must cost one holding, never the whole read.
 */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const UNSAFE_ALL = new RegExp(UNSAFE.source, 'g');
/** Whether a source's string can be kept or matched as it is: no control character, no lone surrogate. */
export const safeText = (value: string) => !UNSAFE.test(value);
const shortText = (value: unknown, max: number) =>
  typeof value === 'string' && value.length >= 1 && value.length <= max && safeText(value) ? value : undefined;
/**
 * A source's holding as the copy can hold it, or undefined when it cannot: an id and a type id of at most 200
 * characters with no control character or lone surrogate (they identify the row, so they are refused, never changed),
 * a label (one line, with what Postgres cannot hold taken out, cut to the length of a type's name), a real day of issue
 * that has come, and an end on or after it. What the source calls its kind is not kept: the catalogue type says what
 * it is once mapped.
 */
export function usableHolding(holding: SourceHolding, today: string): UsableHolding | undefined {
  const id = shortText(holding?.id, SOURCE_ID_MAX),
    type = shortText(holding?.type, SOURCE_ID_MAX);
  const label =
    typeof holding?.label === 'string' ? holding.label.replace(UNSAFE_ALL, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!id || !type || !label) return undefined;
  const issuedOn = holding.issuedOn,
    expiresOn = holding.expiresOn ?? null;
  if (typeof issuedOn !== 'string' || !isCalendarDay(issuedOn) || issuedOn > today) return undefined;
  if (expiresOn !== null && (typeof expiresOn !== 'string' || !isCalendarDay(expiresOn) || expiresOn < issuedOn))
    return undefined;
  return { id, type, label: [...label].slice(0, TYPE_NAME_MAX).join(''), issuedOn, expiresOn };
}

/** One usable holding of the read, with the active person its key matched. */
export interface ReadHolding {
  personId: string;
  organisationId: string;
  holding: UsableHolding;
}
/** What one read changes in the copy: the rows to write (new, changed or revoked) and the ones read unchanged. */
export interface CopyPlan {
  /** The rows to put: new, changed and revoked. */
  write: HoldingRecord[];
  /** The source row ids read as they are already copied: only their time of reading moves. */
  touch: string[];
  /** What was read, new or changed, and what was read as it is: each with its person's organisation, for the counts. */
  stored: ReadHolding[];
  unchanged: ReadHolding[];
  /** The rows the source no longer has, revoked. */
  revoked: HoldingRecord[];
  /** Each organisation's source types among what was read that have no mapping. */
  unmapped: Map<string, Set<string>>;
}
const sameCopy = (a: HoldingRecord, b: HoldingRecord) =>
  a.personId === b.personId &&
  a.typeId === b.typeId &&
  a.issuedOn === b.issuedOn &&
  a.expiresOn === b.expiresOn &&
  a.state === b.state &&
  a.copy?.sourceType === b.copy?.sourceType &&
  a.copy?.sourceLabel === b.copy?.sourceLabel;
/**
 * What a read of one source changes in Clew's copy (D108 item 9). A row is matched to the copy by the source's row id,
 * so the same read twice changes nothing but the time it was read. Its catalogue type comes from the mapping of the
 * person's organisation, else it stays empty and counts towards nothing. A row the source no longer answers is revoked
 * only when `revokeAbsent` (a complete read of a source that reports withdrawals); `seen` holds every row id the source
 * answered, for people Clew matched or not, so a holding of someone deactivated is never taken for a withdrawn one. A
 * row withdrawn before and answered again is valid again.
 */
export function planCopy(input: {
  connectorId: string;
  existing: readonly HoldingRecord[];
  read: readonly ReadHolding[];
  seen: ReadonlySet<string>;
  mapping: (organisationId: string, sourceType: string) => string | null;
  revokeAbsent: boolean;
  at: string;
  newId: () => string;
}): CopyPlan {
  const before = new Map(input.existing.flatMap(h => (h.copy ? [[h.copy.sourceId, h] as const] : [])));
  const latest = new Map<string, ReadHolding>();
  for (const r of input.read) latest.set(r.holding.id, r);
  const write: HoldingRecord[] = [],
    touch: string[] = [],
    stored: ReadHolding[] = [],
    unchanged: ReadHolding[] = [],
    revoked: HoldingRecord[] = [],
    unmapped = new Map<string, Set<string>>();
  for (const read of latest.values()) {
    const { personId, organisationId, holding } = read;
    const typeId = input.mapping(organisationId, holding.type);
    if (!typeId) unmapped.set(organisationId, (unmapped.get(organisationId) ?? new Set()).add(holding.type));
    const old = before.get(holding.id);
    const next: HoldingRecord = {
      id: old?.id ?? input.newId(),
      personId,
      typeId,
      issuedOn: holding.issuedOn,
      expiresOn: holding.expiresOn,
      evidence: 'system',
      state: 'valid',
      registeredBy: null,
      createdAt: old?.createdAt ?? input.at,
      revokedAt: null,
      revokedBy: null,
      copy: {
        connectorId: input.connectorId,
        sourceId: holding.id,
        sourceType: holding.type,
        sourceLabel: holding.label,
        readAt: input.at,
      },
      decidedBy: null,
      decidedAt: null,
      threadId: null,
    };
    if (old && sameCopy(old, next)) {
      touch.push(holding.id);
      unchanged.push(read);
    } else {
      write.push(next);
      stored.push(read);
    }
  }
  if (input.revokeAbsent)
    for (const h of input.existing)
      if (h.copy && h.state === 'valid' && !input.seen.has(h.copy.sourceId)) {
        const gone: HoldingRecord = { ...h, state: 'revoked', revokedAt: input.at, revokedBy: null };
        write.push(gone);
        revoked.push(gone);
      }
  return { write, touch, stored, unchanged, revoked, unmapped };
}
