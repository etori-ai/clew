import { SUBJECT_CHANGED, type ExecutionSummary } from '@clew/contracts';
export function executionStatus(execution: ExecutionSummary | null | undefined): string | null {
  if (!execution) return null;
  // A started action whose user name moved to someone else, or away, before it was sent (D116).
  if (execution.reason === SUBJECT_CHANGED)
    return execution.state === 'unknown'
      ? 'Personen har inte längre det användarnamn som beslutet gällde, så åtgärden skickas inte igen. Utfallet behöver kontrolleras i källsystemet.'
      : 'Personen har inte längre det användarnamn som beslutet gällde. Inget skickades. Fatta beslutet igen.';
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
