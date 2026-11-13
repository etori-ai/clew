import { COMPETENCE_CONNECTOR } from '@clew/connectors';
import {
  COMPETENCE_ROW_STATUSES,
  daysUntil,
  stockholmDate,
  stockholmInstant,
  type CompetenceHoldingRow,
  type CompetenceStatus,
  type CompetenceType,
} from '@clew/contracts';
import {
  SOURCE_READ_ERRORS,
  type HoldingRecord,
  type PersonRef,
  type SourceHolding,
  type SourceReadError,
  type TypeRecord,
  type WorkflowStart,
} from './model';

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
    // A copied row whose source type is not mapped has no type and counts towards nothing (item 9).
    const type = holding.typeId === null ? undefined : types.get(holding.typeId);
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
/** One standing as a read lists it; a copied one with its source and when it was read. */
export function holdingRow(
  standing: Standing,
  person: Pick<PersonRef, 'id' | 'name' | 'userName'>,
  sourceNames: ReadonlyMap<string, string> = new Map(),
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
/** A copied row that waits for its type: it is listed, but counts towards nothing until the type is mapped. */
export const uncounted = (holding: HoldingRecord) =>
  holding.copy !== null && holding.typeId === null && counts(holding);
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
