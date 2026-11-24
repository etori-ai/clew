import { withoutInvitee } from '../domain';
import type { ProposalTx } from '../model';

/** The audit row of a planning card an erasure took a person's rows off (D123): about `thread:<id>`, ids only. */
export const INVITEE_ERASED = 'proposals.invitee_erased';
/** What the calendar cleared of one erased person, counts only, as the people module's `person.erased` row holds them. */
export interface InviteeErased {
  /** Invitations to the person cleared of the name and the address they were drawn with. */
  invitations: number;
  /** Rows that named the person on their managers' planning cards, taken off the cards. */
  planningRows: number;
  /** Times drawn for the person and never sent, withdrawn (`superseded`): they could no longer be sent. */
  drafts: number;
}
/**
 * The calendar's part of an erasure of one person (D123, DE-M6 of the review of 2026-11-23): what the calendar wrote
 * about them on other people's cards. The people module's erasure port tells it, in the transaction that writes the
 * `person.erased` row (bound in `composition/people.ts`; the calendar never imports the people module, nor it the
 * calendar), so it commits or rolls back with the rest of the erasure.
 *
 * Every card that names the person by structure (`inviteeCards`: a proposal that invites them, or their row without
 * one) is locked in id order, and on each the rows that name them leave the card (`withoutInvitee`, by the ref, never by
 * the label that holds the name). A time drawn for them and never sent is withdrawn: its address is gone, so it could
 * never be sent, and as a live draft it would stand nameless in the manager's calendar, in the Förslag menu and in the
 * card's own selection. An invitation that was sent keeps its status, the manager's history and the round's count. A
 * card that changed gets the erasure's time as its version, so a write prepared from what it held before (the scan's
 * settling, a move, a confirmation of the version shown) is refused rather than writing the rows back, and one
 * `proposals.invitee_erased` row by the erasure's actor, with the person's id, the number of rows and the ids of the
 * withdrawn times. Last, every invitation to the person is cleared of the name and the address it was drawn with; the
 * rows stay and name the person by their id.
 *
 * What stays is text the calendar wrote in free sentences, a card's messages and summary ("Flytta …", "… kan inte …"),
 * and a confirmation's receipt and approved payload (D45): the runbook's "What stays" says how an operator finds them.
 */
export function inviteeErasure(
  tx: Pick<
    ProposalTx,
    'inviteeCards' | 'lockThread' | 'updateProposals' | 'updateThread' | 'writeAudit' | 'clearInvitee'
  >,
) {
  return {
    async invitee({ actor, personId, at }: { actor: string; personId: string; at: string }): Promise<InviteeErased> {
      let planningRows = 0,
        drafts = 0;
      for (const card of await tx.inviteeCards(personId)) {
        const locked = await tx.lockThread(card.personId, card.id);
        if (!locked) continue;
        const theirs = locked.proposals.filter(p => p.participant.personId === personId);
        const unsent = theirs.filter(p => p.status === 'proposed').map(p => p.id);
        const items = withoutInvitee(locked.thread.items, new Set(theirs.map(p => p.id)), personId);
        const rows = locked.thread.items.length - items.length;
        if (!rows && !unsent.length) continue;
        if (unsent.length) await tx.updateProposals(unsent, { status: 'superseded' });
        await tx.updateThread(card.id, { ...(rows ? { items } : {}), updatedAt: at });
        await tx.writeAudit({
          actor,
          action: INVITEE_ERASED,
          subject: 'thread:' + card.id,
          at,
          details: { person: personId, rows, drafts: unsent },
        });
        planningRows += rows;
        drafts += unsent.length;
      }
      return { invitations: await tx.clearInvitee(personId), planningRows, drafts };
    },
  };
}
export type InviteeErasure = ReturnType<typeof inviteeErasure>;
