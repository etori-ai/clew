import { subjectKeys, type PanelViewSpec } from '@clew/contracts';
import type { PersonKeys } from '../threads/model';
import { userReads } from './people';

/**
 * Whose a source's key is (D116): the people module's user reads, read on every call. The stream resolves a row's user
 * name to the person's id as the row arrives, a decision resolves a started action's id to the user name now, and
 * dispatch checks that the name still belongs to the person.
 */
export const personKeys: PersonKeys = {
  holders: (readerId, userNames) => userReads.holders(readerId, userNames),
  userName: personId => userReads.userName(personId),
};
/**
 * A view as the reader gets it beside its output (D116): with `people`, the user names its records name people by, to
 * those people's ids in the reader's organisation, so a name links to `/people/<id>`. A name nobody holds is absent.
 */
export async function withPeople(reader: { id: string }, view: PanelViewSpec, output: unknown): Promise<PanelViewSpec> {
  const names = subjectKeys(view, output);
  const held = names.length ? await personKeys.holders(reader.id, names) : undefined;
  return held?.size ? { ...view, people: Object.fromEntries(held) } : view;
}
