import { inAudience, type AudiencedActor, type FollowerRef } from '@clew/connectors';
import type { FollowBinding, JobSource, JobStepDraft, StepDraft } from './contracts';
import type { LedgerStep } from './model';

/**
 * The pure part of jobs (D55): whether a binding is there for this actor and may run now, whether a follower's step is
 * its own, how a watch window becomes committed check times, and how the fan-out is reported. No I/O, no clock of its
 * own.
 */
export type BindingVerdict =
  | { status: 'ok' }
  | { status: 'disabled'; reason: 'switched-off' }
  | { status: 'degraded'; reason: 'kind-not-offered' | 'not-a-follower' | 'capability-unavailable' };
/** The connector a binding's follower belongs to: a capability's name begins with its connector's id. */
export const connectorOf = (binding: Pick<FollowBinding, 'capability'>) => binding.capability.split('.')[0]!;
/**
 * Whether a binding is there at all for this person: they are inside its audience and inside the audience of its
 * follower's connector (`inConnectorAudience`, D23), whatever state that connector is in. Any other binding is left out
 * of their proposal as if it were not bound, so a proposal never names a connector to someone outside its audience, nor
 * a binding the administrator made for others. Every binding that is there is named with its outcome (D55 item 10): a
 * connector switched off or no longer registered is degraded, and the proposal says it is partial.
 */
export const applies = (
  binding: FollowBinding,
  actor: AudiencedActor,
  inConnectorAudience: (connectorId: string) => boolean,
) => inAudience(binding.audience, actor) && inConnectorAudience(connectorOf(binding));
/**
 * D37's rule applied to a binding that is there for the person (`applies`): it must be switched on, the kind must still
 * be created, the follower must still exist, follow the kind and be callable by this person; a follower on a connector
 * switched off is not callable (`capability-unavailable`), one no longer registered does not exist (`not-a-follower`).
 */
export function classify(binding: FollowBinding, offered: boolean, follower: FollowerRef | undefined): BindingVerdict {
  if (!binding.enabled) return { status: 'disabled', reason: 'switched-off' };
  if (!offered) return { status: 'degraded', reason: 'kind-not-offered' };
  if (!follower || !follower.follows.includes(binding.kind)) return { status: 'degraded', reason: 'not-a-follower' };
  if (!follower.available) return { status: 'degraded', reason: 'capability-unavailable' };
  return { status: 'ok' };
}
/** A follower names its own connector's capabilities only; anything else is off contract. */
export function stepProblem(connectorId: string, draft: StepDraft): string | undefined {
  if (!draft.operation.startsWith(connectorId + '.'))
    return `step names ${draft.operation}, which is not a capability of ${connectorId}`;
  return undefined;
}
/** ISO 8601 duration with days, hours and minutes, in milliseconds; undefined when it is not one. */
export function durationMs(iso: string): number | undefined {
  const m = /^P(?!$)(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(iso);
  if (!m) return undefined;
  const ms = (Number(m[1] ?? 0) * 24 * 60 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) * 60_000;
  return ms > 0 ? ms : undefined;
}
/** Three absolute checks inside the window and the window's end: committed with the approval, so a late timer never extends a watch. */
export function watchSchedule(now: number, withinMs: number, checks = 3): { checks: string[]; expiresAt: string } {
  const end = now + withinMs;
  const times = Array.from({ length: checks }, (_, i) =>
    new Date(now + Math.round((withinMs * (i + 1)) / (checks + 1))).toISOString(),
  );
  return { checks: times, expiresAt: new Date(end).toISOString() };
}
/** The job's steps as the ledger takes them: an execute as approved, a watch with its schedule derived from `within` and bounded by the binding's. */
export function ledgerSteps(
  steps: JobStepDraft[],
  withinCeiling: Record<string, string | undefined>,
  now: number,
): LedgerStep[] {
  return steps.map(s => {
    if (s.draft.kind === 'execute')
      return { id: s.id, kind: 'execute', operation: s.draft.operation, payload: s.draft.payload };
    const own = durationMs(s.draft.within) ?? 0,
      ceiling = withinCeiling[s.binding] ? durationMs(withinCeiling[s.binding]!) : undefined;
    const within = ceiling ? Math.min(own, ceiling) : own;
    return {
      id: s.id,
      kind: 'watch',
      operation: s.draft.operation,
      input: s.draft.input,
      expect: s.draft.expect,
      title: s.draft.title,
      source: s.source,
      ...watchSchedule(now, within),
    };
  });
}
export const partial = (sources: JobSource[]) =>
  sources.some(s => s.status === 'timeout' || s.status === 'unavailable' || s.status === 'degraded');
