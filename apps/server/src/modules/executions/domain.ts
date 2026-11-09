import type { AuthenticatedContext } from '@clew/contracts';
import type { ExecuteResult } from '@clew/connectors';
import type {
  Execution,
  ExecutionState,
  Job,
  JobStep,
  WatchCard,
  WatchExpect,
  WatchIntent,
  WorkflowStart,
  WriteSafety,
} from './model';

/** Stored source evidence is readable only under the authority that produced it (D75). */
export function retainsAuthority(
  persona: Pick<AuthenticatedContext, 'id' | 'unitId' | 'authorizationVersion'>,
  snapshot: Pick<Execution, 'personId' | 'unitId' | 'authorizationVersion'>,
) {
  return (
    !!snapshot.authorizationVersion &&
    snapshot.personId === persona.id &&
    snapshot.unitId === persona.unitId &&
    snapshot.authorizationVersion === persona.authorizationVersion
  );
}

export function sameSafety(a: WriteSafety, b: WriteSafety) {
  return (
    a.strategy === b.strategy &&
    (a.strategy === 'manual' || (b.strategy !== 'manual' && a.lookup === b.lookup)) &&
    (a.strategy !== 'deduplicated' || (b.strategy === 'deduplicated' && a.retentionSeconds === b.retentionSeconds))
  );
}

export function outcome(result: ExecuteResult): ExecutionState {
  if (
    !result ||
    !Array.isArray(result.rows) ||
    !result.rows.length ||
    result.rows.some(row => !['done', 'failed', 'unknown', 'skipped'].includes(row.outcome))
  )
    return 'unknown';
  if (result.rows.some(row => row.outcome === 'unknown')) return 'unknown';
  if (result.rows.every(row => row.outcome === 'done')) return 'succeeded';
  return result.rows.some(row => row.outcome === 'done') ? 'partial' : 'failed';
}
/** A local lease never makes an arbitrary remote write safe to replay. */
export function mayReplay(execution: Execution, at: string) {
  return (
    execution.safety.strategy === 'deduplicated' &&
    !!execution.dispatchedAt &&
    Date.parse(at) < Date.parse(execution.expiresAt) &&
    Date.parse(at) < Date.parse(execution.dispatchedAt) + execution.safety.retentionSeconds * 1000
  );
}
/** The one rule for compensation (D45): the person's own confirmed effect, its declared inverse on the same connector, inside the window. */
export function undoable(
  original: Execution | undefined,
  personId: string,
  operation: string,
  connector: string,
  at: string,
): boolean {
  return (
    !!original &&
    original.reason !== 'source-reset' &&
    original.personId === personId &&
    original.connector === connector &&
    ['succeeded', 'partial'].includes(original.state) &&
    original.result?.undoCapability === operation &&
    Date.parse(at) <=
      Date.parse(original.dispatchedAt ?? original.createdAt) + (original.result.undoMinutes ?? 10) * 60_000
  );
}
/** What the source said the undo must carry, or the confirmed refs when it said nothing. */
export function undoInputOf(original: Execution): unknown {
  return (
    original.result?.undoInput ?? {
      refs: (original.result?.rows ?? [])
        .filter(r => r.outcome === 'done')
        .map(r => r.ref)
        .sort(),
    }
  );
}
/** No approved payload, identity attributes or signed authority in the browser result. */
export function executionView(e: Execution) {
  return {
    id: e.id,
    decisionId: e.decisionId,
    connector: e.connector,
    operation: e.operation,
    state: e.state,
    reason: e.reason,
    result: e.result,
    compensates: e.compensates,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
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
export const seen = (output: unknown, expect: WatchExpect, digest: (input: unknown) => string) =>
  digest(valueAt(output, expect.path) ?? null) === digest(expect.equals ?? null);
/** A job as the browser sees it: each step's own state, never a payload, a watch input or signed authority. */
export function jobView(job: Job, executions: Record<string, Execution | undefined>) {
  return {
    id: job.id,
    decisionId: job.decisionId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    steps: job.steps.map(s =>
      s.kind === 'execute'
        ? {
            id: s.id,
            kind: s.kind,
            connector: s.connector,
            operation: s.operation,
            executionId: s.executionId,
            state: executions[s.executionId]?.state ?? 'pending',
            reason: executions[s.executionId]?.reason ?? null,
            result: executions[s.executionId]?.result ?? null,
          }
        : {
            id: s.id,
            kind: s.kind,
            connector: s.connector,
            operation: s.operation,
            title: s.title,
            source: s.source,
            state: s.state,
            reason: s.reason,
            checks: s.checks,
            expiresAt: s.expiresAt,
            observations: s.observations.length,
          },
    ),
  };
}
const stockholmTime = (at: string) =>
  new Date(at).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', timeStyle: 'short' });
/** One watch intent per watch step, committed with the approval (D47): the step's own absolute times, generation 1, due for delivery at once. */
export const watchIntentOf = (
  job: Pick<Job, 'id' | 'personId'>,
  step: Extract<JobStep, { kind: 'watch' }>,
  at: string,
): WatchIntent => ({
  id: `watch:${job.id}:${step.id}`,
  jobId: job.id,
  stepId: step.id,
  personId: job.personId,
  generation: 1,
  checks: step.checks,
  expiresAt: step.expiresAt,
  attempt: 0,
  leaseUntil: null,
  nextAt: at,
  deliveredAt: at,
  lastError: null,
});
/** The `approvedExecution` workflow behind an approval or a requested reconciliation (D45, D86): the stable id is the intent's, the input the execution id. */
export const executionStart = (workflowId: string, executionId: string): WorkflowStart => ({
  workflow: 'approvedExecution',
  id: workflowId,
  input: executionId,
});
export const watchWorkflowId = (intent: Pick<WatchIntent, 'id' | 'generation'>) => `${intent.id}:${intent.generation}`;
/** The `jobWatch` workflow of a watch step (D55, D47, D86): the committed absolute checks and the window's end, never recomputed. */
export const watchStart = (intent: WatchIntent): WorkflowStart => ({
  workflow: 'jobWatch',
  id: watchWorkflowId(intent),
  input: {
    jobId: intent.jobId,
    stepId: intent.stepId,
    generation: intent.generation,
    checks: intent.checks,
    expiresAt: intent.expiresAt,
  },
});
/**
 * The card a watch leaves when its window ends unseen (D55 item 5, canvas J: "Lönesystemet har inte läst sjukanmälan").
 * The words name the system and the step as the person approved them and say how many reads found nothing; the card is
 * Clew's, not the system's (D35), so it carries no action: the person looks in the system or asks about the job.
 */
export function watchExpiredCard(
  job: Pick<Job, 'id' | 'personId' | 'authorizationVersion'>,
  step: Extract<JobStep, { kind: 'watch' }>,
  at: string,
): WatchCard {
  const reads = step.observations.filter(o => !o.error).length,
    failed = step.observations.length - reads;
  const looked =
    reads === 0
      ? 'Ingen kontroll kunde läsa systemet'
      : `${reads === 1 ? 'En kontroll' : reads + ' kontroller'} fram till ${stockholmTime(step.expiresAt)} visade inget`;
  return {
    id: `watch:${job.id}:${step.id}`,
    sourceAuthorization: job.authorizationVersion,
    personId: job.personId,
    jobId: job.id,
    stepId: step.id,
    connector: step.connector,
    topic: `watch-expired:${job.id}:${step.id}`,
    title: `${step.source} har inte visat det som bevakades`,
    summary: `${step.title}: ${looked}${failed ? ` och ${failed === 1 ? 'en kontroll' : failed + ' kontroller'} nådde inte systemet` : ''}. Titta i ${step.source} eller fråga om jobbet.`,
    reason: `Bevakningen gick ut ${stockholmTime(at)} utan att det förväntade syntes`,
    at,
  };
}
