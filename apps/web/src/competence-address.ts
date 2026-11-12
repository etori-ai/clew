import type { CompetenceMatrixInput } from '@clew/contracts';

/**
 * The place Kompetens in the rail (D120 item 8) and its pages, each an address of its own (D116): the reader's own
 * holdings at `/competence`, and the manager's matrix at `/competence/matrix` (D108 item 11). The matrix names its set
 * of columns in the address, `by` (`area:<the area>` or `position:<the position's id>`) and `part` (from 1, left out for
 * the first), so a reload, a link and Back show the same columns. Over the matrix, `requirement=new` is the dialog that
 * adds a requirement for one person, and `register` and `competence` the registration of a certificate
 * (`register-address.ts`). This file imports nothing of the page, so a unit test loads it on its own.
 */
export const COMPETENCE_PATH = '/competence';
export const MATRIX_PATH = '/competence/matrix';
const BY = 'by',
  PART = 'part';
export const REQUIREMENT_PARAM = 'requirement';
export const NEW = 'new';

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
/** The matrix with this set of columns; a dialog that was open over it is not carried along. */
export const matrixHref = (input: CompetenceMatrixInput) => MATRIX_PATH + matrixQuery(input);
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
