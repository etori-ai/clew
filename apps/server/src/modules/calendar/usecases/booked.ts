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
    const owners = new Map(
      await Promise.all(
        [...new Set(theirs.map(p => p.personId))].map(async id => {
          const owner = await deps.people.personaFor(id);
          return [id, new Set(owner ? (await deps.team(owner)).map(m => m.personId) : [])] as const;
        }),
      ),
    );
    return new Set(
      theirs.filter(p => owners.get(p.personId)?.has(p.participant.personId)).map(p => p.participant.personId),
    );
  };
}
/**
 * Who among these people (person ids) another of their current managers has booked through Clew in the open round,
 * asked right before an approved invitation is sent; empty without an open round.
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
/** Why a drawn time left an open card (D30's judgement calls): a row's reason, never the other manager or the time. */
export const BOOKED_ELSEWHERE = 'bokad av en annan chef';
export const ALREADY_HELD = 'har redan haft sitt samtal';
const names = (list: readonly string[]) =>
  list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} och ${list.at(-1)}`;
/** What a manager reads when someone they would invite is booked by another of their managers: who, never when. */
export const bookedSentence = (people: readonly string[]) =>
  `${names(people)} har redan ett utvecklingssamtal bokat med en annan chef.`;
/** What a manager reads when another of the person's managers has an approved invitation to them on its way. */
export const invitingSentence = (people: readonly string[]) =>
  `${names(people)} bjuds redan in till ett utvecklingssamtal av en annan chef.`;
/** What a manager reads when the round already records someone's talk as held. */
export const heldSentence = (people: readonly string[]) =>
  `${names(people)} har redan haft sitt utvecklingssamtal i den här omgången.`;
