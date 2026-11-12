import { subjectKeys, type AuthenticatedContext, type PanelViewSpec, type ThreadItem } from '@clew/contracts';
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
/**
 * A declared view as the reader gets it beside its output (D116): with `people`, from the user name each record that
 * names a person holds (`subject` on a person, D97 item 6) to that person's id in the reader's organisation, from one read,
 * so the record links to `/people/<id>`. A name nobody there holds is absent, and its record links nowhere. Without a
 * person to resolve, or without `people`, the view is as the registry gave it.
 */
export async function viewWithPeople(
  people: Pick<PersonKeys, 'holders'> | undefined,
  persona: Pick<AuthenticatedContext, 'id'>,
  view: PanelViewSpec,
  output: unknown,
): Promise<PanelViewSpec> {
  const names = subjectKeys(view, output);
  const held = names.length && people ? await people.holders(persona.id, names) : undefined;
  return held?.size ? { ...view, people: Object.fromEntries(held) } : view;
}
