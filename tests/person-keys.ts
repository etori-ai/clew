import type { MemoryProvisionState } from '../apps/server/src/modules/people/adapters/memory';
import type { PersonKeys } from '../apps/server/src/threads/model';

/**
 * Whose a source's key is (D116), over the memory directory of the unit tests: what `composition/person-keys.ts` reads
 * from the people table. A user name names whoever of the reader's organisation holds it now, active or not, compared
 * without regard to case; a reader the directory does not hold is answered nothing. `exists` is the erasure's check.
 */
export function memoryPersonKeys(
  state: Pick<MemoryProvisionState, 'users'>,
): PersonKeys & { exists(personId: string): Promise<boolean> } {
  return {
    async holders(readerId, userNames) {
      const held = new Map<string, string>();
      const reader = state.users.get(readerId);
      if (!reader) return held;
      for (const name of userNames)
        for (const user of state.users.values())
          if (
            user.organisationId === reader.organisationId &&
            user.userName !== null &&
            user.userName.toLowerCase() === name.toLowerCase()
          )
            held.set(name, user.id);
      return held;
    },
    userName: async personId => state.users.get(personId)?.userName ?? null,
    exists: async personId => state.users.has(personId),
  };
}
