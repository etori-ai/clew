import { COMPETENCE_CONNECTOR } from '@clew/connectors';
import {
  COMPETENCE_STATUSES,
  daysUntil,
  stockholmDate,
  type CompetenceHoldingRow,
  type CompetenceStatus,
  type CompetenceType,
} from '@clew/contracts';
import type { HoldingRecord, PersonRef, TypeRecord } from './model';

/**
 * The rules of the competence domain (D108) as pure functions: when a holding ends, where it stands on a day, which of
 * several holdings of one type decides, what a type's name may be, and the refs, keys and rows the reads carry. No I/O,
 * no clock: the use case hands in every day.
 */

/** A holding that ends within this many days is expiring (D108 item 4). */
export const EXPIRING_DAYS = 90;
export const TYPE_NAME_MAX = 120;
export const TYPE_AREA_MAX = 80;

/** What another system knows a person by: the provisioned user name, or Clew's id when there is none. */
export const personKey = (person: Pick<PersonRef, 'id' | 'userName'>) => person.userName ?? person.id;
/** `holding:competence:<holding id>`. */
export const holdingRef = (holdingId: string) => `holding:${COMPETENCE_CONNECTOR}:${holdingId}`;

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
/** Where a holding that ends on `end` stands on `today` (D108 item 4). The last day is still valid. */
export function statusOn(end: string | null, today: string): CompetenceStatus {
  if (end === null) return 'valid';
  const days = daysUntil(end, today);
  return days < 0 ? 'expired' : days <= EXPIRING_DAYS ? 'expiring' : 'valid';
}
/** A holding counts when it is `valid` as stored: not pending, rejected or revoked. */
export const counts = (holding: Pick<HoldingRecord, 'state'>) => holding.state === 'valid';

/** A holding with its type's end date and status worked out for one day. */
export interface Standing {
  holding: HoldingRecord;
  type: TypeRecord;
  end: string | null;
  status: CompetenceStatus;
}
/**
 * For each person and type, the one holding that decides (D108 item 9): of the ones that count, the one that ends last,
 * one that never ends before any that does, the most recently issued on a tie. Holdings of an unknown type are left out.
 */
export function deciding(
  holdings: readonly HoldingRecord[],
  types: ReadonlyMap<string, TypeRecord>,
  today: string,
): Standing[] {
  const best = new Map<string, Standing>();
  const later = (a: Standing, b: Standing) => {
    if (a.end !== b.end) return a.end === null || (b.end !== null && a.end > b.end);
    return (
      a.holding.issuedOn > b.holding.issuedOn ||
      (a.holding.issuedOn === b.holding.issuedOn && a.holding.id < b.holding.id)
    );
  };
  for (const holding of holdings) {
    const type = types.get(holding.typeId);
    if (!type || !counts(holding)) continue;
    const end = endOf(holding, type);
    const standing: Standing = { holding, type, end, status: statusOn(end, today) };
    const key = holding.personId + '\n' + holding.typeId;
    const current = best.get(key);
    if (!current || later(standing, current)) best.set(key, standing);
  }
  return [...best.values()];
}
/** Whether a standing needs a person: it has expired or expires within `EXPIRING_DAYS`. */
export const needsAttention = (standing: Pick<Standing, 'status'>) => standing.status !== 'valid';

const sv = (a: string, b: string) => a.localeCompare(b, 'sv');
/** Rows in the order a list is drawn: by status (`COMPETENCE_STATUSES`), the soonest end first, then person and type. */
export function orderHoldingRows<
  T extends Pick<CompetenceHoldingRow, 'status' | 'expiresOn' | 'name' | 'competence' | 'ref'>,
>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      COMPETENCE_STATUSES.indexOf(a.status) - COMPETENCE_STATUSES.indexOf(b.status) ||
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

/** One standing as a read lists it. */
export function holdingRow(
  standing: Standing,
  person: Pick<PersonRef, 'id' | 'name' | 'userName'>,
): CompetenceHoldingRow {
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
  };
}
/** What a person's standings add up to: how many have run out, how many soon will, and how many count at all. */
export interface PersonSummary {
  expired: number;
  expiring: number;
  holdings: number;
}
export function summarise(standings: readonly Pick<Standing, 'status'>[]): PersonSummary {
  const count = (status: CompetenceStatus) => standings.filter(s => s.status === status).length;
  return { expired: count('expired'), expiring: count('expiring'), holdings: standings.length };
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
