import {
  COMPETENCE_SEARCH_PAGE_MAX,
  COMPETENCE_SEARCH_PAGE_SIZES,
  COMPETENCE_SEARCH_SORTS,
  COMPETENCE_SEARCH_STATUSES,
  COMPETENCE_SEARCH_TYPES_MAX,
  COMPETENCE_SEARCH_WINDOWS,
  isCompetenceLevel,
  type CompetenceLevel,
  type CompetenceMatrixInput,
  type CompetenceSearchBody,
  type CompetenceSearchFileBody,
  type CompetenceSearchOrder,
  type CompetenceSearchSort,
  type CompetenceSearchStatus,
  type CompetenceSearchWindow,
} from '@clew/contracts';
import { viewPageHref } from './view-address';

/**
 * The place Kompetens in the rail (D120 item 8) and its pages, each an address of its own (D116): the reader's own
 * holdings at `/competence`, and the manager's matrix at `/competence/matrix` (D108 item 11). The matrix names its set
 * of columns in the address, `by` (`area:<the area>` or `position:<the position's id>`) and `part` (from 1, left out for
 * the first), so a reload, a link and Back show the same columns; `only=attention` narrows what it shows to the people
 * and the competences where something needs the manager, which the page does with what the read answered, so the read
 * is never asked again; the file is asked for narrowed the same way. Over the matrix, `requirement=new` is the dialog
 * that adds a requirement for one person, `register` and `competence` the registration of a certificate
 * (`register-address.ts`), `approve=<holding id>` the decision on a report's own registration (D108 item 7), and
 * `validate=<holding id>` the confirmation of a report's skill (D120 item 2). Over the reader's own page, `add=new` is
 * the dialog in which they register one of their own (with `competence=<type id>` from a row, the type it starts on),
 * and `skill=<holding id>` the one in which they change a skill of theirs. Every one of these dialogs is closed by
 * replacing its address, so Back never opens a write again (D83 rule 8); a choice of columns or the narrowing is a
 * step of its own, so Back undoes it. This file imports nothing of the page, so a unit test loads it on its own.
 */
export const COMPETENCE_PATH = '/competence';
export const MATRIX_PATH = '/competence/matrix';
const BY = 'by',
  PART = 'part';
export const REQUIREMENT_PARAM = 'requirement';
export const NEW = 'new';
export const ADD_PARAM = 'add';
/** The type the reader's own dialog starts on: the same name the matrix's registration uses (`register-address.ts`). */
const ADD_TYPE_PARAM = 'competence';
export const APPROVE_PARAM = 'approve';
export const VALIDATE_PARAM = 'validate';
export const SKILL_PARAM = 'skill';
/**
 * The read a manager's card of an approval opens (D108 item 7, `competence.approval`): it answers with rows, so the card
 * leads to its page (D116), and that page is the approval over the matrix (`approvalPageHref`).
 */
export const APPROVAL_READ = 'competence.approval';

const address = (pathname: string, query: URLSearchParams) => {
  const q = query.toString();
  return q ? `${pathname}?${q}` : pathname;
};
/** The set of columns the address names; a part that is no whole number from 1 to 99 is the first. */
export function matrixInputOf(search: URLSearchParams | string): CompetenceMatrixInput {
  const q = new URLSearchParams(search);
  const by = q.get(BY),
    part = q.get(PART);
  return {
    ...(by && by.length <= 200 ? { by } : {}),
    ...(part && /^[1-9]\d?$/.test(part) && part !== '1' ? { part: Number(part) } : {}),
  };
}
/** `?by=…&part=…` as the API and the file read it, the first part left out; empty for no set. */
export function matrixQuery(input: CompetenceMatrixInput): string {
  const q = new URLSearchParams();
  if (input.by) q.set(BY, input.by);
  if (input.by && input.part && input.part > 1) q.set(PART, String(input.part));
  const s = q.toString();
  return s ? `?${s}` : '';
}
/**
 * The matrix with this set of columns, everything else in the address kept: a move within the page keeps what is open
 * beside it (`card`, `open` and the rest of the panel's address).
 */
export function matrixHref(input: CompetenceMatrixInput, search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  q.delete(BY);
  q.delete(PART);
  if (input.by) q.set(BY, input.by);
  if (input.by && input.part && input.part > 1) q.set(PART, String(input.part));
  return address(MATRIX_PATH, q);
}
const ONLY = 'only',
  ATTENTION = 'attention';
/** Whether the address narrows the matrix to what needs the manager (`only=attention`). */
export const attentionOnly = (search: URLSearchParams | string) => new URLSearchParams(search).get(ONLY) === ATTENTION;
/** The matrix narrowed to what needs the manager, or not, everything else in the address kept. */
export function attentionHref(on: boolean, search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  q.delete(ONLY);
  if (on) q.set(ONLY, ATTENTION);
  return address(MATRIX_PATH, q);
}
/**
 * The matrix as shown, as a file to download: its set of columns, and narrowed to what needs the manager when the page
 * is (`only=attention`), which the server narrows with the same definition (`competenceMatrixNeeding`).
 */
export function matrixFileHref(input: CompetenceMatrixInput, attention = false): string {
  const q = new URLSearchParams(matrixQuery(input));
  if (attention) q.set(ONLY, ATTENTION);
  const s = q.toString();
  return '/api/competence/matrix.csv' + (s ? `?${s}` : '');
}
/** The matrix with the dialog that adds a requirement for one person over it, the set of columns kept. */
export function requirementHref(search: URLSearchParams | string): string {
  const q = new URLSearchParams(search);
  q.set(REQUIREMENT_PARAM, NEW);
  return address(MATRIX_PATH, q);
}
/** The matrix with that dialog closed. */
export function withoutRequirement(search: URLSearchParams | string): string {
  const q = new URLSearchParams(search);
  q.delete(REQUIREMENT_PARAM);
  return address(MATRIX_PATH, q);
}
/**
 * The reader's own page with the dialog that registers one of their own over it, the rest of the address kept; with a
 * type, the dialog starts on it (`competence`, the name the matrix's registration uses too): a row of the reader's own
 * list leads there, to renew what has run out or register what is missing.
 */
export function addHref(search: URLSearchParams | string = '', typeId?: string): string {
  const q = new URLSearchParams(search);
  q.set(ADD_PARAM, NEW);
  if (typeId) q.set(ADD_TYPE_PARAM, typeId);
  else q.delete(ADD_TYPE_PARAM);
  return address(COMPETENCE_PATH, q);
}
/** Whether the address opens that dialog. */
export const adding = (search: URLSearchParams | string) => new URLSearchParams(search).get(ADD_PARAM) === NEW;
/** The type the dialog starts on, while it is open; null for none. */
export const addingType = (search: URLSearchParams | string) =>
  adding(search) ? holdingIn(new URLSearchParams(search).get(ADD_TYPE_PARAM)) : null;
/** The reader's own page with that dialog closed. */
export function withoutAdd(search: URLSearchParams | string): string {
  const q = new URLSearchParams(search);
  q.delete(ADD_PARAM);
  q.delete(ADD_TYPE_PARAM);
  return address(COMPETENCE_PATH, q);
}
/** The registration whose decision the address opens over the matrix, or null for none. */
export function approveOf(search: URLSearchParams | string): string | null {
  const value = new URLSearchParams(search).get(APPROVE_PARAM);
  return value && value.length <= 80 ? value : null;
}
/** The matrix with the decision on this registration over it; the set of columns and the rest of the address kept. */
export function approveHref(holdingId: string, search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  q.set(APPROVE_PARAM, holdingId);
  return address(MATRIX_PATH, q);
}
/** The matrix with that decision closed. */
export function withoutApprove(search: URLSearchParams | string): string {
  const q = new URLSearchParams(search);
  q.delete(APPROVE_PARAM);
  return address(MATRIX_PATH, q);
}
/**
 * Where the page of the approval's read leads (`/tools/competence.approval?input=…`, D116): the decision over the
 * matrix, for the registration its input names; the matrix alone when it names none.
 */
export function approvalPageHref(search: URLSearchParams | string): string {
  let holding: unknown;
  try {
    holding = (JSON.parse(new URLSearchParams(search).get('input') ?? '{}') as { holding?: unknown }).holding;
  } catch {
    holding = undefined;
  }
  return typeof holding === 'string' && holding && holding.length <= 80 ? approveHref(holding) : MATRIX_PATH;
}
/** A holding's id as an address names one: 1 to 80 characters, else none. */
const holdingIn = (value: string | null) => (value && value.length <= 80 ? value : null);
/** The skill whose level the address opens for confirmation over the matrix (D120 item 2), or null for none. */
export const validateOf = (search: URLSearchParams | string) =>
  holdingIn(new URLSearchParams(search).get(VALIDATE_PARAM));
/** The matrix with the confirmation of this skill's level over it; the set of columns and the rest of the address kept. */
export function validateHref(holdingId: string, search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  q.set(VALIDATE_PARAM, holdingId);
  return address(MATRIX_PATH, q);
}
/** The matrix with that confirmation closed. */
export function withoutValidate(search: URLSearchParams | string): string {
  const q = new URLSearchParams(search);
  q.delete(VALIDATE_PARAM);
  return address(MATRIX_PATH, q);
}
/** The reader's own skill the address opens to change (D120 item 2), or null for none. */
export const skillOf = (search: URLSearchParams | string) => holdingIn(new URLSearchParams(search).get(SKILL_PARAM));
/** The reader's own page with the dialog that changes this skill of theirs over it, the rest of the address kept. */
export function skillHref(holdingId: string, search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  q.delete(ADD_PARAM);
  q.delete(ADD_TYPE_PARAM);
  q.set(SKILL_PARAM, holdingId);
  return address(COMPETENCE_PATH, q);
}
/** The reader's own page with that dialog closed. */
export function withoutSkill(search: URLSearchParams | string): string {
  const q = new URLSearchParams(search);
  q.delete(SKILL_PARAM);
  return address(COMPETENCE_PATH, q);
}

/**
 * Kompetenssökning (D121 item 4) at `/competence/search`: who in the organisation holds every one of the chosen types.
 * The whole search is in the address, by ids and codes only, never a name (D43: English names and values):
 * `?type=<id>[,<id>…]&unit=<id>&level=<1-3>&status=<valid,expiring,expired>&until=<30|90|180>&sort=<…>&order=desc&page=<n>&size=<n>`,
 * so a reload, a link and Back show the same search, and every change is one step in the history. A reload or a link
 * therefore reads the search again, and that read is logged as any other (D121 item 5). The request itself still
 * carries it in a body. The first page, the first size, the order by name and an ascending order are left out.
 */
export const SEARCH_PATH = '/competence/search';
const TYPE = 'type',
  UNIT = 'unit',
  LEVEL = 'level',
  STATUS = 'status',
  UNTIL = 'until',
  SORT = 'sort',
  ORDER = 'order',
  PAGE = 'page',
  SIZE = 'size';
const SEARCH_PARAMS = [TYPE, UNIT, LEVEL, STATUS, UNTIL, SORT, ORDER, PAGE, SIZE];
/** An id as the server takes one in a body: 1 to 80 characters, none of them a control character. */
const isSearchId = (value: string) => value.length >= 1 && value.length <= 80 && !/[\u0000-\u001F\u007F]/.test(value);
type PageSize = (typeof COMPETENCE_SEARCH_PAGE_SIZES)[number];
/** The search an address names. */
export interface SearchAddress {
  /** The chosen types, in the order chosen; empty before one is chosen. */
  typeIds: string[];
  unitId: string | null;
  minLevel: CompetenceLevel | null;
  /** The statuses asked for, in the contract's order; empty for every status. */
  status: CompetenceSearchStatus[];
  until: CompetenceSearchWindow | null;
  sort: CompetenceSearchSort;
  order: CompetenceSearchOrder;
  page: number;
  pageSize: PageSize;
  /**
   * What the address names that no search can mean, so nothing is asked: an id that is no id (`type`, `unit`), or more
   * types than one search takes (`types`). A code the lists do not hold (a status, a window, an order) is left out
   * instead, as Användare leaves one out (D100 item 2): it names nobody and nothing.
   */
  unreadable: 'type' | 'types' | 'unit' | null;
}
/** The search the address names; anything it cannot mean as a code is the default. */
export function searchOf(search: URLSearchParams | string): SearchAddress {
  const q = new URLSearchParams(search);
  const typed = (q.get(TYPE) ?? '').split(',').filter(Boolean),
    unit = q.get(UNIT),
    level = Number(q.get(LEVEL)),
    asked = (q.get(STATUS) ?? '').split(','),
    until = Number(q.get(UNTIL)),
    sort = q.get(SORT),
    page = Number(q.get(PAGE)),
    size = Number(q.get(SIZE));
  const typeIds = [...new Set(typed)];
  return {
    typeIds: typeIds.length <= COMPETENCE_SEARCH_TYPES_MAX && typeIds.every(isSearchId) ? typeIds : [],
    unitId: unit && isSearchId(unit) ? unit : null,
    minLevel: isCompetenceLevel(level) ? level : null,
    status: COMPETENCE_SEARCH_STATUSES.filter(s => asked.includes(s)),
    until: COMPETENCE_SEARCH_WINDOWS.find(n => n === until) ?? null,
    sort: COMPETENCE_SEARCH_SORTS.find(s => s === sort) ?? 'name',
    order: q.get(ORDER) === 'desc' ? 'desc' : 'asc',
    page: Number.isInteger(page) && page > 1 && page <= COMPETENCE_SEARCH_PAGE_MAX ? page : 1,
    pageSize: COMPETENCE_SEARCH_PAGE_SIZES.find(n => n === size) ?? COMPETENCE_SEARCH_PAGE_SIZES[0],
    unreadable: !typeIds.every(isSearchId)
      ? 'type'
      : typeIds.length > COMPETENCE_SEARCH_TYPES_MAX
        ? 'types'
        : unit && !isSearchId(unit)
          ? 'unit'
          : null,
  };
}
/** A change to the search; what it leaves out stays as it is. */
export type SearchChange = Partial<Omit<SearchAddress, 'unreadable'>>;
/**
 * The search page with a change, everything else in the address kept (the panel's address too). Anything but a step to
 * another page starts again from the first page; the defaults are left out, the parts are written in one order, and the
 * lists with plain commas, so one search has one address.
 */
export function searchHref(change: SearchChange, search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  const next = { ...searchOf(q), ...change, ...('page' in change ? {} : { page: 1 }) };
  for (const name of SEARCH_PARAMS) q.delete(name);
  if (next.typeIds.length) q.set(TYPE, next.typeIds.join(','));
  if (next.unitId) q.set(UNIT, next.unitId);
  if (next.minLevel) q.set(LEVEL, String(next.minLevel));
  const status = COMPETENCE_SEARCH_STATUSES.filter(s => next.status.includes(s));
  if (status.length) q.set(STATUS, status.join(','));
  if (next.until) q.set(UNTIL, String(next.until));
  if (next.sort !== 'name') q.set(SORT, next.sort);
  if (next.order === 'desc') q.set(ORDER, 'desc');
  if (next.page > 1) q.set(PAGE, String(next.page));
  if (next.pageSize !== COMPETENCE_SEARCH_PAGE_SIZES[0]) q.set(SIZE, String(next.pageSize));
  return address(SEARCH_PATH, q).replace(/%2C/gi, ',');
}
/** The address as `searchHref` writes it, nothing changed: two addresses of one search are equal in this form. */
export const sameSearch = (search: URLSearchParams | string) => searchHref({ page: searchOf(search).page }, search);
/** The search page with nothing searched for, the order and the page size kept: where "Rensa sökningen" leads. */
export function noSearchHref(search: URLSearchParams | string = ''): string {
  const { sort, order, pageSize } = searchOf(search);
  const q = new URLSearchParams(search);
  for (const name of SEARCH_PARAMS) q.delete(name);
  return searchHref({ sort, order, pageSize }, q);
}
/** The body the address asks the server with, or null when it names no search that can be asked. */
export function searchBodyOf(a: SearchAddress): CompetenceSearchBody | null {
  if (a.unreadable || a.typeIds.length === 0) return null;
  return {
    typeIds: a.typeIds,
    ...(a.minLevel ? { minLevel: a.minLevel } : {}),
    ...(a.unitId ? { unitId: a.unitId } : {}),
    ...(a.status.length ? { status: a.status } : {}),
    ...(a.until ? { until: a.until } : {}),
    ...(a.sort !== 'name' ? { sort: a.sort } : {}),
    ...(a.order !== 'asc' ? { order: a.order } : {}),
    page: a.page,
    pageSize: a.pageSize,
  };
}
/** The body of the file of the search on screen: the same search, every page of it. */
export function searchFileBodyOf(body: CompetenceSearchBody): CompetenceSearchFileBody {
  const { page: _page, pageSize: _size, ...file } = body;
  return file;
}
/**
 * One person's holdings opened from a hit (D121 item 4): the page of the read `competence.holdings` (D116) for that
 * person, by user name, with the search as the way back. No name: the page names the person from the directory, as
 * their own page does, so a name never rides in the address (the review of 2026-11-13).
 */
export const holdingsPageHref = (key: string, from: string) =>
  viewPageHref({ capability: 'competence.holdings', input: { person: key } }, from);
