import type { ExecuteResult } from '@clew/connectors';
import type { Execution, ExecutionState, Job, WatchExpect, WriteSafety } from './model';

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
/** The one rule for compensation (D45): the person's own confirmed effect, its declared inverse on the same connector, inside the window. */
export function undoable(original: Execution | undefined, personId: string, operation: string, connector: string, at: string): boolean {
  return !!original && original.personId === personId && original.connector === connector && ['succeeded', 'partial'].includes(original.state) &&
    original.result?.undoCapability === operation &&
    Date.parse(at) <= Date.parse(original.dispatchedAt ?? original.createdAt) + (original.result.undoMinutes ?? 10) * 60_000;
}
/** What the source said the undo must carry, or the confirmed refs when it said nothing. */
export function undoInputOf(original: Execution): unknown {
  return original.result?.undoInput ?? { refs: (original.result?.rows ?? []).filter(r => r.outcome === 'done').map(r => r.ref).sort() };
}
/** No approved payload, identity attributes or signed authority in the browser result. */
export function executionView(e: Execution) {
  return { id: e.id, decisionId: e.decisionId, connector: e.connector, operation: e.operation, state: e.state, reason: e.reason, result: e.result, compensates: e.compensates, createdAt: e.createdAt, updatedAt: e.updatedAt };
}
/** The value a watch compares, found by a plain key path; undefined when the path leaves the output. */
export function valueAt(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
/** A watch is seen when the value at the path equals what the follower expected, compared as approved content. */
export const seen = (output: unknown, expect: WatchExpect, digest: (input: unknown) => string) => digest(valueAt(output, expect.path) ?? null) === digest(expect.equals ?? null);
/** A job as the browser sees it: each step's own state, never a payload, a watch input or signed authority. */
export function jobView(job: Job, executions: Record<string, Execution | undefined>) {
  return {
    id: job.id, decisionId: job.decisionId, createdAt: job.createdAt, updatedAt: job.updatedAt,
    steps: job.steps.map(s => s.kind === 'execute'
      ? { id: s.id, kind: s.kind, connector: s.connector, operation: s.operation, executionId: s.executionId, state: executions[s.executionId]?.state ?? 'pending', reason: executions[s.executionId]?.reason ?? null, result: executions[s.executionId]?.result ?? null }
      : { id: s.id, kind: s.kind, connector: s.connector, operation: s.operation, state: s.state, reason: s.reason, checks: s.checks, expiresAt: s.expiresAt, observations: s.observations.length }),
  };
}
