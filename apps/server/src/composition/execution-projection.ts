import type { Transaction } from '@clew/db';
import type { DurableQueue } from '@clew/db/durable';
import type { Execution } from '../modules/executions/model';
import type { InvitationsTx } from '../modules/calendar/model';
import { projectOntoCard } from '../threads/usecases/projection';
import { postgresProjectionTx } from '../threads/adapters/projection-postgres';
import type { ProjectionStage } from '../threads/projection-model';
import { talkInvitationsOn } from './talk-invitations';

/**
 * The ledger's projection onto the stream (D45), bound to the live adapter: `projectOntoCard`
 * (`threads/usecases/projection.ts`) over the Postgres port on the ledger's own transaction. The execution, the card and
 * their audit rows commit through this one physical transaction; never source I/O here, and no read through another
 * connection. The obligation timer and the receipt jobs start their workflows in the same transaction (D86), in the
 * engine's application and queue named by `durable`; the composition root binds it, a Postgres test binds its own. An
 * invitation that the calendar read back, or that was undone or replaced, reaches the talk whose booking it carries here
 * too (D132 item 3): `invitations` builds the talks module's port on this transaction.
 */
export const projectExecution =
  (durable: DurableQueue, invitations: (tx: Transaction) => InvitationsTx = talkInvitationsOn) =>
  (tx: Transaction, e: Execution, stage: ProjectionStage) =>
    projectOntoCard(postgresProjectionTx(tx, durable, invitations), e, stage);
