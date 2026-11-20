import type { Transaction } from '@clew/db';
import type { InvitationsTx } from '../modules/calendar/model';
import { talkRecordsTx } from '../modules/talks/adapters/postgres';
import { talkInvitations } from '../modules/talks/usecases';
import { ids } from './ambient';

/**
 * The calendar module's invitations port bound to the talks module (D132 item 3), on the transaction that changes the
 * invitation: the proposal store's own, and the execution ledger's projection. Neither module imports the other, so the
 * pairing is made here. The talk's booking and the invitation that carries it share one physical database transaction,
 * so they commit or roll back as one.
 */
export const talkInvitationsOn = (tx: Transaction): InvitationsTx => talkInvitations(talkRecordsTx(tx), { ids });
