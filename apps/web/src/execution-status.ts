import type { ExecutionSummary } from '@clew/contracts';
/**
 * What a decision that the source has not confirmed says on the work item (D45, D47). `silent`: the item's system does
 * not answer now (D116, amended 2026-11-12), so a decision on its way says that it is queued and read back.
 */
export function executionStatus(execution: ExecutionSummary | null | undefined, silent = false): string | null {
  if (!execution) return null;
  if (silent && !execution.reason && !execution.compensates && ['pending', 'running'].includes(execution.state))
    return 'Ditt beslut är sparat. Det du skickar köas och läses tillbaka när systemet svarar.';
  if (execution.reason === 'needs-session') return 'Källan kräver en aktiv inloggning. Åtgärden väntar.';
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
