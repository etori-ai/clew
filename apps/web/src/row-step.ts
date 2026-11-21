import type { Thread, ThreadAction } from '@clew/contracts';
import { opensDialog } from './action-path';
import { begun, nextStep, reviewRows, type ReviewDraft } from './review-session';

/**
 * What the button at the end of a work item's row on Hem says and does (D142): it names the person's next press and
 * leads to where that press is made, and the item's name is the way to its page whenever the button is not.
 *
 * - `review`: the decision is reviewed one row at a time (D70 item 2), on the item's own page: "Granska N", "Fortsätt
 *   granska" at the first row not yet judged once it is begun, and "Granska N avvisade" where the source refused rows
 *   of a decision already sent.
 * - `press`: one press with nothing to read first (D70 item 1): an execute that neither asks nor says beforehand what
 *   it writes (`opensDialog`), and takes no chosen rows. It runs from the row.
 * - `open`: everything else. The next step is on the item's page (several ways forward, something to read, nothing to
 *   decide, a state to read).
 *
 * `plain` is the item's state as the one vocabulary has it (`statusOf`): the person's, with nothing happened and
 * nothing in the way, and something to decide.
 */
export type RowStep =
  { kind: 'open' } | { kind: 'review'; label: string; step?: number } | { kind: 'press'; action: ThreadAction };

export function rowStep(thread: Thread, plain: boolean, draft: ReviewDraft): RowStep {
  const primary = thread.actions.find(a => a.role === 'primary');
  if (primary?.kind === 'execute' && primary.review === 'each') {
    const refused = thread.receipt?.rows.filter(r => r.outcome === 'failed').length ?? 0;
    if (refused && ['failed', 'partial'].includes(thread.execution?.state ?? ''))
      return { kind: 'review', label: `Granska ${refused} ${refused === 1 ? 'avvisad' : 'avvisade'}` };
    if (!plain) return { kind: 'open' };
    const rows = reviewRows(thread);
    return begun(draft)
      ? { kind: 'review', label: 'Fortsätt granska', step: nextStep(draft, rows) }
      : { kind: 'review', label: `Granska ${rows.length}` };
  }
  if (plain && primary?.kind === 'execute' && !opensDialog(primary) && !primary.usesItems)
    return { kind: 'press', action: primary };
  return { kind: 'open' };
}
