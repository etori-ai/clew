import type { ExecutionSummary } from '@clew/contracts';
export function executionStatus(execution: ExecutionSummary | null | undefined): string | null {
  if (!execution) return null;
  if (execution.reason === 'needs-session') return 'Källan kräver en aktiv inloggning. Åtgärden väntar.';
  if (execution.reason === 'authority-revoked') return 'Behörigheten har ändrats. Åtgärden väntar på kontroll.';
  if (execution.reason === 'source-contract-changed') return 'Källans villkor har ändrats. Åtgärden väntar på kontroll.';
  if (execution.state === 'unknown') return execution.compensates ? 'Det är ännu oklart om åtgärden har ångrats. Det ursprungliga kvittot finns kvar.' : 'Källans besked saknas. Utfallet behöver kontrolleras innan något mer görs.';
  if (execution.state === 'pending') return execution.compensates ? 'Din begäran att ångra är sparad och väntar på källan.' : 'Ditt beslut är sparat och väntar på källan.';
  if (execution.state === 'running') return 'Väntar på källans bekräftelse.';
  return null;
}
