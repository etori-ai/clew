import type { ExecuteResult } from '@clew/connectors';
import type { Execution, ExecutionState, WriteSafety } from './model';

export function sameSafety(a: WriteSafety, b: WriteSafety) {
  return a.strategy === b.strategy && (a.strategy === 'manual' || b.strategy !== 'manual' && a.lookup === b.lookup) &&
    (a.strategy !== 'deduplicated' || b.strategy === 'deduplicated' && a.retentionSeconds === b.retentionSeconds);
}

export function outcome(result: ExecuteResult): ExecutionState {
  if (!result || !Array.isArray(result.rows) || !result.rows.length || result.rows.some(row => !['done', 'failed', 'unknown', 'skipped'].includes(row.outcome))) return 'unknown';
  if (result.rows.some(row => row.outcome === 'unknown')) return 'unknown';
  if (result.rows.every(row => row.outcome === 'done')) return 'succeeded';
  return result.rows.some(row => row.outcome === 'done') ? 'partial' : 'failed';
}
/** A local lease never makes an arbitrary remote write safe to replay. */
export function mayReplay(execution: Execution, at: string) {
  return execution.safety.strategy === 'deduplicated' && !!execution.dispatchedAt &&
    Date.parse(at) < Date.parse(execution.expiresAt) &&
    Date.parse(at) < Date.parse(execution.dispatchedAt) + execution.safety.retentionSeconds * 1000;
}
/** No approved payload, identity attributes or signed authority in the browser result. */
export function executionView(e: Execution) {
  return { id: e.id, decisionId: e.decisionId, connector: e.connector, operation: e.operation, state: e.state, reason: e.reason, result: e.result, compensates: e.compensates, createdAt: e.createdAt, updatedAt: e.updatedAt };
}
