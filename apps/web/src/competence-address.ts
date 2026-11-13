import { COMPETENCE_SEARCH_PAGE_MAX, COMPETENCE_SEARCH_PAGE_SIZES, type CompetenceMatrixInput } from '@clew/contracts';
import { viewPageHref } from './view-address';

/**
 * The place Kompetens in the rail (D120 item 8) and its pages, each an address of its own (D116): the reader's own
 * holdings at `/competence`, and the manager's matrix at `/competence/matrix` (D108 item 11). The matrix names its set
 * of columns in the address, `by` (`area:<the area>` or `position:<the position's id>`) and `part` (from 1, left out for
 * the first), so a reload, a link and Back show the same columns. Over the matrix, `requirement=new` is the dialog that
 * adds a requirement for one person, `register` and `competence` the registration of a certificate
 * (`register-address.ts`), `approve=<holding id>` the decision on a report's own registration (D108 item 7), and
 * `validate=<holding id>` the confirmation of a report's skill (D120 item 2). Over the reader's own page, `add=new` is
 * the dialog in which they register one of their own, and `skill=<holding id>` the one in which they change a skill
 * of theirs. This file imports nothing of the page, so a unit test loads it on its own.
 */
export const COMPETENCE_PATH = '/competence';
export const MATRIX_PATH = '/competence/matrix';
const BY = 'by',
  PART = 'part';
export const REQUIREMENT_PARAM = 'requirement';
export const NEW = 'new';
export const ADD_PARAM = 'add';
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
/** The matrix as shown, as a file to download. */
export const matrixFileHref = (input: CompetenceMatrixInput) => '/api/competence/matrix.csv' + matrixQuery(input);
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
/** The reader's own page with the dialog that registers one of their own over it, the rest of the address kept. */
export function addHref(search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  q.set(ADD_PARAM, NEW);
  return address(COMPETENCE_PATH, q);
}
/** Whether the address opens that dialog. */
export const adding = (search: URLSearchParams | string) => new URLSearchParams(search).get(ADD_PARAM) === NEW;
/** The reader's own page with that dialog closed. */
export function withoutAdd(search: URLSearchParams | string): string {
  const q = new URLSearchParams(search);
  q.delete(ADD_PARAM);
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
 * Kompetenssökning (D121 item 4) at `/competence/search`: who in the organisation holds a type. What is searched for (the
 * type, a least level, a unit) is never in the address, as Användare keeps a searched name out of it (D100 item 5): the
 * type would tell a log line what the reader looked for. The page and its size are (`page`, `size`), so Back undoes a
 * step through the result; the search itself is kept in memory for the session (`competence-search-session.ts`).
 */
export const SEARCH_PATH = '/competence/search';
const PAGE = 'page',
  SIZE = 'size';
/** The page of the result and its size the address names: a page from 1, a size of 25, 50 or 100; anything else is the first. */
export function searchPageOf(search: URLSearchParams | string): {
  page: number;
  pageSize: (typeof COMPETENCE_SEARCH_PAGE_SIZES)[number];
} {
  const q = new URLSearchParams(search);
  const page = Number(q.get(PAGE)),
    size = Number(q.get(SIZE));
  return {
    page: Number.isInteger(page) && page > 1 && page <= COMPETENCE_SEARCH_PAGE_MAX ? page : 1,
    pageSize: COMPETENCE_SEARCH_PAGE_SIZES.find(n => n === size) ?? COMPETENCE_SEARCH_PAGE_SIZES[0],
  };
}
/**
 * The search page at another page or size, everything else in the address kept: the first page and the first size are
 * left out, and a new size starts again from the first page.
 */
export function searchHref(change: { page?: number; size?: number }, search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  if (change.size !== undefined) {
    q.delete(PAGE);
    if (change.size === COMPETENCE_SEARCH_PAGE_SIZES[0]) q.delete(SIZE);
    else q.set(SIZE, String(change.size));
  }
  if (change.page !== undefined) {
    if (change.page > 1) q.set(PAGE, String(change.page));
    else q.delete(PAGE);
  }
  return address(SEARCH_PATH, q);
}
/** The search page from its first page, its size kept: a new search starts there. */
export function firstSearchPage(search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  q.delete(PAGE);
  return address(SEARCH_PATH, q);
}
/**
 * One person's holdings opened from a hit (D121 item 4): the page of the read `competence.holdings` (D116) for that
 * person, by user name, with the search as the way back. No name: the page names the person from the directory, as
 * their own page does, so a name never rides in the address (the review of 2026-11-13).
 */
export const holdingsPageHref = (key: string, from: string) =>
  viewPageHref({ capability: 'competence.holdings', input: { person: key } }, from);
