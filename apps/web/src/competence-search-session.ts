import type { CompetenceKind, CompetenceLevel } from '@clew/contracts';

/**
 * The search a registrar is making on Kompetenssökning (D121 item 4), kept while the session lasts so that a person
 * opened from a hit and Back find the search where it was. In memory only, never in browser storage (D33): the address
 * holds the page alone, since the type searched for is no address's business (D100 item 5), and a reload forgets the
 * search as Användare forgets a typed name. Cleared when the session ends.
 */
export interface SearchDraft {
  /** The type chosen, as the type field shows it. */
  type: { id: string; label: string; area: string; kind: CompetenceKind } | null;
  /** On a skill: the least level asked for. */
  minLevel: CompetenceLevel | null;
  /** A unit of the organisation, with everything below it. */
  unitId: string | null;
}
export const NO_SEARCH: SearchDraft = { type: null, minLevel: null, unitId: null };
let kept: SearchDraft = NO_SEARCH;
/** The search as it was left in this session. */
export const keptSearch = (): SearchDraft => kept;
/** Keep the search as it stands now. */
export const keepSearch = (draft: SearchDraft) => {
  kept = draft;
};
/** Forget it: the session ended. */
export const clearSearch = () => {
  kept = NO_SEARCH;
};
