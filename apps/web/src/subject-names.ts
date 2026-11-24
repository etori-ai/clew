import { keepPreviousData, useQueries } from '@tanstack/react-query';
import { ENTITY_NAMES_MAX, type Subject } from '@clew/contracts';
import { entityNamesQuery } from './queries';

const subjectId = (s: Subject) => `${s.entity}:${s.key}`;

/**
 * The reads that name these subjects: each distinct subject once, in a stable order so the same set is the same read
 * whatever order a list draws it in, at most `ENTITY_NAMES_MAX` to a read.
 */
export function namesReads(subjects: readonly Subject[]): Subject[][] {
  const distinct = [...new Map(subjects.map(s => [subjectId(s), s])).entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, s]) => s);
  const reads: Subject[][] = [];
  for (let at = 0; at < distinct.length; at += ENTITY_NAMES_MAX) reads.push(distinct.slice(at, at + ENTITY_NAMES_MAX));
  return reads;
}

/**
 * The names of whom a list's rows are about, read from Clew's own directory by the key Clew holds (D62, D122): never the
 * label of the row that names them, which says what the row is ("Medarbetare", "Ansökan"), and never a match on a title
 * (D132). The list's subjects are asked together (`namesReads`), not one read per subject. A name seldom changes, so an
 * answer is kept five minutes, and while a changed list is asked the last answer stays drawn. A subject the reader may
 * not open, one that is gone, and one whose read has not answered name nobody (null); `pending` while any read has not.
 */
export function useSubjectNames(subjects: readonly Subject[]): {
  nameOf: (subject: Subject) => string | null;
  pending: boolean;
} {
  const answers = useQueries({
    queries: namesReads(subjects).map(read => ({ ...entityNamesQuery(read), placeholderData: keepPreviousData })),
  });
  const names = new Map(answers.flatMap(a => a.data?.names ?? []).map(n => [subjectId(n), n.name]));
  return {
    nameOf: subject => names.get(subjectId(subject)) ?? null,
    pending: answers.some(a => a.isPending || a.isPlaceholderData),
  };
}
