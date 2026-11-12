import type { AuthenticatedContext, ThreadItem } from '@clew/contracts';
import { keyedItems, personNames } from '../domain';
import type { PersonKeys } from '../model';

/**
 * Drafts as Clew keeps them (D116): a source names a person by its own key, the user name (D96 talks item 8), and every
 * row that does names the person by Clew's key, their id, from one read for all the drafts. A row whose name nobody of
 * the reader's organisation holds now names nobody. Without `people` no row names a person.
 */
export async function keyedDrafts<T extends { items?: ThreadItem[] }>(
  people: PersonKeys | undefined,
  persona: Pick<AuthenticatedContext, 'id'>,
  drafts: readonly T[],
): Promise<T[]> {
  const names = [...new Set(drafts.flatMap(d => personNames(d.items ?? [])))];
  if (!names.length) return [...drafts];
  const held = people ? await people.holders(persona.id, names) : new Map<string, string>();
  return drafts.map(d => (d.items && personNames(d.items).length ? { ...d, items: keyedItems(d.items, held) } : d));
}
