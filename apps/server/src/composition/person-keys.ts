import type { PersonKeys } from '../threads/model';
import { userReads } from './people';

/**
 * Whose a source's key is (D119): the people module's user reads, read on every call. The stream resolves a row's user
 * name to the person's id as the row arrives, a panel view and a card's read do the same for the records they name
 * (`viewWithPeople`), a decision resolves a started action's id to the user name now, and dispatch checks that the name
 * still belongs to the person.
 */
export const personKeys: PersonKeys = {
  holders: (readerId, userNames) => userReads.holders(readerId, userNames),
  userName: personId => userReads.userName(personId),
};
