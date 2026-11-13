import type { MemoryProvisionState } from '../apps/server/src/modules/people/adapters/memory';
import type { PersonKeys } from '../apps/server/src/threads/model';

/** A user name as Clew compares it: without regard to case, in its composed form (NFC), as a stored one is. */
const folded = (name: string) => name.normalize('NFC').toLowerCase();
/**
 * Whose a source's key is (D119), over the memory directory of the unit tests: what `composition/person-keys.ts` reads
 * from the people table. A user name names whoever of the reader's organisation holds it now, active or not, compared
 * without regard to case and in its composed form; two holders of spellings that compare alike leave it naming nobody,
 * and a reader the directory does not hold is answered nothing. `enabled` is the erasure's check: undefined for an id
 * the directory does not hold, false for a deactivated person.
 */
export function memoryPersonKeys(
  state: Pick<MemoryProvisionState, 'users'>,
): PersonKeys & { enabled(personId: string): Promise<boolean | undefined> } {
  return {
    async holders(readerId, userNames) {
      const held = new Map<string, string>();
      const reader = state.users.get(readerId);
      if (!reader) return held;
      for (const name of userNames) {
        const ids = [...state.users.values()]
          .filter(
            user =>
              user.organisationId === reader.organisationId &&
              user.userName !== null &&
              folded(user.userName) === folded(name),
          )
          .map(user => user.id);
        if (ids.length === 1) held.set(name, ids[0]!);
      }
      return held;
    },
    userName: async personId => state.users.get(personId)?.userName ?? null,
    enabled: async personId => state.users.get(personId)?.enabled,
  };
}
