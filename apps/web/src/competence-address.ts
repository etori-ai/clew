import type { CompetenceMatrixInput } from '@clew/contracts';

/**
 * The place Kompetens in the rail (D120 item 8) and its pages, each an address of its own (D116): the reader's own
 * holdings at `/competence`, and the manager's matrix at `/competence/matrix` (D108 item 11). The matrix names its set
 * of columns in the address, `by` (`area:<the area>` or `position:<the position's id>`) and `part` (from 1, left out for
 * the first), so a reload, a link and Back show the same columns. Over the matrix, `requirement=new` is the dialog that
 * adds a requirement for one person, `register` and `competence` the registration of a certificate
 * (`register-address.ts`), and `approve=<holding id>` the decision on a report's own registration (D108 item 7). Over
 * the reader's own page, `add=new` is the dialog in which they register one of their own. This file imports nothing of
 * the page, so a unit test loads it on its own.
 */
export const COMPETENCE_PATH = '/competence';
export const MATRIX_PATH = '/competence/matrix';
const BY = 'by',
  PART = 'part';
export const REQUIREMENT_PARAM = 'requirement';
export const NEW = 'new';
export const ADD_PARAM = 'add';
export const APPROVE_PARAM = 'approve';
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
