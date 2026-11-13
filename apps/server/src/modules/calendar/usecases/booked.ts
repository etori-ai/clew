import { displayDate } from '@clew/calendar/dates';
import type { People, ProposalStore, Team } from '../model';

/**
 * One talk a round (D96 talks items 1 and 2, Q12 of the 2026-11-12 review). A person with two managers has one talk a
 * round, whichever of them books it: a booking one current manager made through Clew counts as booked for every one of
 * them, without its time, since a manager may not read another manager's calendar. The planner, the nightly count, the
 * open card, the confirmation and the dispatch of the approved invitation all ask the same rule here, so that no planner
 * proposes, and no confirmation sends, a second talk.
 */

/** The statuses in which a proposal books its invitee: sent, final, or accepted by them. */
export const BOOKED: readonly string[] = ['confirmed', 'final', 'accepted'];
/** The days a round covers, `YYYY-MM-DD`, both included. */
export interface Period {
  opensOn: string;
  dueOn: string;
}
/** Whether an instant falls on a day of the period, in Swedish time. */
export const within = (start: string, period: Period) => {
  const day = displayDate(start);
  return day >= period.opensOn && day <= period.dueOn;
};
/**
 * Who among these people (person ids) another of their current managers booked through Clew inside the period: a
 * proposal in a booked status that someone other than the reader owns, starting on a day of the period, whose owner has
 * the person in their team now. A booking whose manager has left the person, or is gone from the directory, books
 * nothing for anyone else.
 */
export type BookedElsewhere = (readerId: string, personIds: readonly string[], period: Period) => Promise<Set<string>>;
export function bookedElsewhere(deps: { store: ProposalStore; team: Team; people: People }): BookedElsewhere {
  return async (readerId, personIds, period) => {
    if (!personIds.length) return new Set();
    const theirs = (await deps.store.bookedProposals(personIds)).filter(
      p => p.personId !== readerId && BOOKED.includes(p.status) && within(p.start, period),
    );
    const owners = new Map<string, Set<string>>();
    for (const id of new Set(theirs.map(p => p.personId))) {
      const manager = await deps.people.personaFor(id);
      if (manager) owners.set(id, new Set((await deps.team(manager)).map(m => m.personId)));
    }
    return new Set(
      theirs.filter(p => owners.get(p.personId)?.has(p.participant.personId)).map(p => p.participant.personId),
    );
  };
}
/**
 * An approved invitation another manager has on its way to a person, as the approval of a second one finds it under its
 * lock (`composition/execution-projection.ts`): the drawn time it invites to, and where the execution sending it stands.
 */
export interface InvitationOnItsWay {
  start: string;
  state: string;
  reason: string | null;
  /** The end of the approval's lifetime (D45), 24 hours after it was approved. */
  expiresAt: string;
}
/**
 * A pending invitation can be reconciled even when its last attempt was blocked. In particular, a temporary team
 * read failure and withdrawn authority both record `authority-revoked`. Keep the invitee reserved for that approval
 * while it is pending, running or unknown, inside its 24 hours (D45) and the round. A source reset fences every retry.
 */
export const mayStillBeSent = (invitation: InvitationOnItsWay, at: string, period?: Period) =>
  Date.parse(at) < Date.parse(invitation.expiresAt) &&
  invitation.reason !== 'source-reset' &&
  (invitation.state === 'pending' || invitation.state === 'running' || invitation.state === 'unknown') &&
  (!period || within(invitation.start, period));
/** Why a drawn time left an open card (D30's judgement calls): a row's reason, never the other manager or the time. */
export const BOOKED_ELSEWHERE = 'bokad av en annan chef';
export const ALREADY_HELD = 'har redan haft sitt samtal';
/** A row's reason for someone of the team the card has no time for: a talk settled elsewhere is gone, or they are new. */
export const NEEDS_TIME = 'behöver en tid';
/**
 * A row's reason for someone of the team the count leaves out because of the manager's own calendar: a talk with them
 * is in it (booked by hand, or an invitation of the manager's own that was sent).
 */
export const OWN_CALENDAR = 'har ett samtal i din kalender';
const names = (list: readonly string[]) =>
  list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} och ${list.at(-1)}`;
/** What a manager reads when the round cannot be read now, so that it cannot be told whether someone has a talk. */
export const uncertainSentence = (people: readonly string[]) =>
  `Det gick inte att se om ${names(people)} redan har ett utvecklingssamtal bokat. Försök igen om en stund.`;
/** What a manager reads when someone they would invite is booked by another of their managers: who, never when. */
export const bookedSentence = (people: readonly string[]) =>
  `${names(people)} har redan ett utvecklingssamtal bokat med en annan chef.`;
/** What a manager reads when another of the person's managers has an approved invitation to them on its way. */
export const invitingSentence = (people: readonly string[]) =>
  `${names(people)} bjuds redan in till ett utvecklingssamtal av en annan chef.`;
/** What a manager reads when the round already records someone's talk as held. */
export const heldSentence = (people: readonly string[]) =>
  `${names(people)} har redan haft sitt utvecklingssamtal i den här omgången.`;
