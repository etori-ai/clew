import { RELEASED_BY_PERSON, SUBJECT_CHANGED, type ExecutionSummary } from '@clew/contracts';
import type { StatusKind } from '@clew/ui/status-words';

/**
 * What a decision that the source has not confirmed says on the work item (D45, D47), as one sentence. `silent`: the
 * item's system does not answer now (D116, amended 2026-11-12), so a decision on its way says that it is queued and read
 * back. The work item itself says it as a notice now (`status-of.ts`, D126 item 13); this sentence stays for the places
 * that say it in a line: a conversation's draft, a calendar proposal's card, Hem's callout and the announcement.
 */
export function executionStatus(execution: ExecutionSummary | null | undefined, silent = false): string | null {
  if (!execution) return null;
  // A started action whose user name moved to someone else, or away, before it was sent (D122).
  if (execution.reason === SUBJECT_CHANGED)
    return execution.state === 'unknown'
      ? 'Personen har inte längre det användarnamn som beslutet gällde, så åtgärden skickas inte igen. Utfallet behöver kontrolleras i källsystemet.'
      : 'Personen har inte längre det användarnamn som beslutet gällde. Inget skickades. Fatta beslutet igen.';
  // A decision in doubt the person let go, having seen in the source that it did not go through (DE-M2).
  if (execution.reason === RELEASED_BY_PERSON)
    return 'Beslutet är markerat som inte genomfört. Fatta det igen om det behövs.';
  if (silent && !execution.reason && !execution.compensates && ['pending', 'running'].includes(execution.state))
    return 'Ditt beslut är sparat. Det du skickar köas och läses tillbaka när systemet svarar.';
  if (execution.reason === 'needs-session') return 'Källan kräver en aktiv inloggning. Åtgärden väntar.';
  if (execution.reason === 'needs-link') return 'Källan behöver ditt konto. Åtgärden väntar.';
  if (execution.reason === 'authority-revoked') return 'Behörigheten har ändrats. Åtgärden väntar på kontroll.';
  if (execution.reason === 'source-contract-changed')
    return 'Källans villkor har ändrats. Åtgärden väntar på kontroll.';
  if (execution.state === 'unknown')
    return execution.compensates
      ? 'Det är ännu oklart om åtgärden har ångrats. Det ursprungliga kvittot finns kvar.'
      : 'Källans besked saknas. Utfallet behöver kontrolleras innan något mer görs.';
  if (execution.state === 'pending')
    return execution.compensates
      ? 'Din begäran att ångra är sparad och väntar på källan.'
      : 'Ditt beslut är sparat och väntar på källan.';
  if (execution.state === 'running') return 'Väntar på källans bekräftelse.';
  if (execution.state === 'partial') return 'En del av åtgärden är klar. De återstående raderna behöver din bedömning.';
  if (execution.state === 'failed')
    return 'Åtgärden kunde inte genomföras. Kontrollera beskedet innan du fattar ett nytt beslut.';
  return null;
}

/** A decision in doubt the person may let go (DE-M2); not an undo, whose original receipt stands whatever became of it. */
export const releasable = (execution: ExecutionSummary | null | undefined) =>
  execution?.state === 'unknown' && !execution.compensates;
/**
 * The question asked before a person lets go of a decision in doubt (DE-M2), in an action's `confirm` shape
 * (`confirmParts`): a decision made again after one that did go through does the same thing twice, so that is said
 * before, not after.
 */
export const releaseQuestion = (source: string) => ({
  label: 'Markera som inte genomfört',
  confirm: `Markera beslutet som inte genomfört? Gör det bara om du har sett i ${source} att det inte gick igenom. Clew slutar då vänta på besked, och du kan fatta beslutet igen. Gick det ändå igenom gör ett nytt beslut samma sak en gång till.`,
});

/** The reasons a decision waits before it can be sent: a sign-in, an authority or the source's terms (D45, D47). */
export const WAITING_REASONS: readonly string[] = [
  'needs-session',
  'needs-link',
  'authority-revoked',
  'source-contract-changed',
];

/**
 * Where a decision the source has not confirmed stands, as one state of the vocabulary (D126 item 13), in the order
 * `executionStatus` says it (D45, D47, D122): a started action whose user name moved first, then what holds the
 * decision back, then how far it got. Null for no decision and for one the source confirmed, whose receipt says how it
 * went.
 */
export function executionKind(execution: ExecutionSummary | null | undefined): StatusKind | null {
  if (!execution) return null;
  if (execution.reason === SUBJECT_CHANGED) return execution.state === 'unknown' ? 'unconfirmed' : 'failed';
  if (execution.reason && WAITING_REASONS.includes(execution.reason)) return 'blocked';
  switch (execution.state) {
    case 'unknown':
      return 'unconfirmed';
    case 'pending':
    case 'running':
      return 'sending';
    case 'partial':
      return 'partial';
    case 'failed':
      return 'failed';
    default:
      return null;
  }
}
