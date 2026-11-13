import type { AuthenticatedContext } from '@clew/contracts';
import { displayDate } from '@clew/calendar/dates';
import type { People, ProposalStore, RoundReader, Team } from '../model';

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
 * Whom each of these managers (person ids) has in their team now, by person id, read through the identity each has
 * now: a manager gone from the directory has nobody. A booking, or an invitation on its way, of a manager who has left
 * the person counts for nobody else (M1).
 */
export type TeamsOf = (managerIds: readonly string[]) => Promise<ReadonlyMap<string, ReadonlySet<string>>>;
export function teamsOf(deps: { team: Team; people: People }): TeamsOf {
  return async managerIds =>
    new Map(
      await Promise.all(
        [...new Set(managerIds)].map(async id => {
          const manager = await deps.people.personaFor(id);
          return [id, new Set(manager ? (await deps.team(manager)).map(m => m.personId) : [])] as const;
        }),
      ),
    );
}
/**
 * Who among these people (person ids) another of their current managers booked through Clew inside the period: a
 * proposal in a booked status that someone other than the reader owns, starting on a day of the period, whose owner has
 * the person in their team now. A booking whose manager has left the person, or is gone from the directory, books
 * nothing for anyone else.
 */
export type BookedElsewhere = (readerId: string, personIds: readonly string[], period: Period) => Promise<Set<string>>;
export function bookedElsewhere(deps: { store: ProposalStore; team: Team; people: People }): BookedElsewhere {
  const teams = teamsOf(deps);
  return async (readerId, personIds, period) => {
    if (!personIds.length) return new Set();
    const theirs = (await deps.store.bookedProposals(personIds)).filter(
      p => p.personId !== readerId && BOOKED.includes(p.status) && within(p.start, period),
    );
    const owners = await teams(theirs.map(p => p.personId));
    return new Set(
      theirs.filter(p => owners.get(p.personId)?.has(p.participant.personId)).map(p => p.participant.personId),
    );
  };
}
/**
 * Who among these people (person ids) another of their current managers has booked through Clew in the open round,
 * asked right before an approved invitation is sent; empty without an open round. Rejects when the round cannot be
 * read, so that the invitation is not sent while it cannot be told.
 */
export type BookedInRound = (
  persona: AuthenticatedContext,
  personIds: readonly string[],
) => Promise<ReadonlySet<string>>;
export function bookedInRound(deps: {
  store: ProposalStore;
  team: Team;
  people: People;
  round: RoundReader;
}): BookedInRound {
  const elsewhere = bookedElsewhere(deps);
  return async (persona, personIds) => {
    const open = await deps.round(persona);
    return open ? elsewhere(persona.id, personIds, open) : new Set();
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
 * Whether an invitation on its way may still be sent, and so holds its invitee against a second one (M1, Q12): it is
 * being sent; it waits to be sent with nothing to stop it, which a pending execution settled with a reason does not; or
 * it was sent and its result is unknown. Each only inside the approval's 24 hours (D45), and inside the period of the
 * round the asking confirmation is in. A refused or expired approval holds nobody, and neither does one still unknown
 * after its 24 hours: a talk it did send counts as booked once a check reads it back.
 */
export const mayStillBeSent = (invitation: InvitationOnItsWay, at: string, period?: Period) =>
  Date.parse(at) < Date.parse(invitation.expiresAt) &&
  (invitation.state === 'running' ||
    invitation.state === 'unknown' ||
    (invitation.state === 'pending' && invitation.reason === null)) &&
  (!period || within(invitation.start, period));
/** Why a drawn time left an open card (D30's judgement calls): a row's reason, never the other manager or the time. */
export const BOOKED_ELSEWHERE = 'bokad av en annan chef';
export const ALREADY_HELD = 'har redan haft sitt samtal';
/** A row's reason for someone of the team the card has no time for: a talk settled elsewhere is gone, or they are new. */
export const NEEDS_TIME = 'behöver en tid';
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
