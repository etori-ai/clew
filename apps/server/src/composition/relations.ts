import { relationUsecases } from '../modules/entities/relations';
import { systemContext } from '../system-context';
import { staff, userReads } from './people';

/**
 * Who may be asked about (D97 item 8, D117), paired with its live adapters (D25): the entities module's rule over the
 * people directory, with the person behind each call read from their current grant, so a call made under a grant that
 * has since changed is judged by the new one. The registry is built with it, and the connector check asks it for `--as`.
 */
export const relations = relationUsecases({
  directory: staff,
  reader: actor => systemContext(actor.id, 'system:relations'),
  holders: (readerId, userNames) => userReads.holders(readerId, userNames),
});
