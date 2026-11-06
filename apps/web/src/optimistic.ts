import type { Thread } from '@clew/contracts';

/**
 * What a card looks like the moment the person has acted on it (D64), before the server has answered. Only actions
 * whose outcome the person chose themselves are predicted here: the server adds the message, the audit row and the
 * timer, and its answer replaces the prediction. An execute action is never predicted: its outcome is the source's.
 */

/** Avfärda: the card is handled as of now. */
export const dismissed = (thread: Thread, at: string): Thread => ({ ...thread, state: 'dismissed', handledAt: at });
/** Inte nu: the card sits in the pile until the chosen time (D29). */
export const snoozed = (thread: Thread, until: string): Thread => ({ ...thread, snoozedUntil: until });
/** Ta upp nu and Ångra: back in the stream, open, with no landing time; a dismissed card no longer waits on anyone. */
export const reopened = (thread: Thread): Thread => ({
  ...thread,
  state: 'open',
  handledAt: null,
  snoozedUntil: null,
  ...(thread.state === 'dismissed' ? { waitingOn: null } : {}),
});
/**
 * At rest: nothing the person asked for still waits on the source's reply or the scheduler's acknowledgement. A decision
 * the source has not confirmed (D45) and a timer Temporal has not yet taken (D47) are committed intent on its way; an
 * execution that is unknown, partial or failed needs the person, so it counts as rest and is shown at once.
 */
export const atRest = (thread: Pick<Thread, 'execution' | 'timers'>): boolean =>
  !(thread.execution && (thread.execution.state === 'pending' || thread.execution.state === 'running')) &&
  !thread.timers?.some(timer => timer.state === 'queued');
