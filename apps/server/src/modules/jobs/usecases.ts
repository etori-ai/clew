import { Value } from '@sinclair/typebox/value';
import type { AuthenticatedContext } from '@clew/contracts';
import type { Actor } from '@clew/connectors';
import { FollowResponseSchema } from '@clew/connectors/protocol';
import { JobError, type Fact, type FollowBinding, type FollowBindingInput, type JobProposal, type JobSource, type JobStepDraft } from './contracts';
import { classify, ledgerSteps, partial, stepProblem } from './domain';
import { DEFAULT_BUDGET, type JobCall, type JobDeps } from './model';

export const ADMIN_CAPABILITY = 'admin.connectors';
const TIMEOUT = Symbol('timeout');
/**
 * Jobs (D54). `assemble` is the composite that replaces per-flow code: for one fact it asks every follower an administrator
 * bound to the fact's kind, all at once under a budget, as the person, and merges the step drafts into one proposal that
 * names every bound system and its outcome. `approve` hands the proposal to the ledger as one decision. `bind` and `unbind`
 * are the administrator's composition layer: a binding is governance (D23), not a process.
 */
export function jobUsecases(deps: JobDeps) {
  const budget = { ...DEFAULT_BUDGET, ...deps.budget };
  const withinBudget = <T,>(work: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<typeof TIMEOUT>(resolve => { timer = setTimeout(() => resolve(TIMEOUT), ms); });
    return Promise.race([work, late]).finally(() => clearTimeout(timer));
  };
  const requireAdmin = (persona: AuthenticatedContext) => { if (!persona.capabilities.includes(ADMIN_CAPABILITY)) throw new JobError('Du saknar behörighet.'); };
  async function ask(binding: FollowBinding, connectorId: string, source: string, fact: Fact, call: JobCall): Promise<{ source: JobSource; steps: JobStepDraft[] }> {
    const base = { binding: binding.id, connector: connectorId, source, capability: binding.capability };
    try {
      const answer = await withinBudget(call(binding.capability, { fact }), budget.perSourceMs);
      if (answer === TIMEOUT) return { source: { ...base, status: 'timeout' }, steps: [] };
      if (!Value.Check(FollowResponseSchema, answer)) return { source: { ...base, status: 'unavailable', reason: 'off-contract' }, steps: [] };
      const problem = answer.steps.map(d => stepProblem(connectorId, d)).find(Boolean);
      if (problem) return { source: { ...base, status: 'unavailable', reason: problem }, steps: [] };
      return { source: { ...base, status: 'ok' }, steps: answer.steps.map((draft, i) => ({ id: connectorId + '-' + (i + 1), connector: connectorId, source, draft })) };
    } catch { return { source: { ...base, status: 'unavailable' }, steps: [] }; }
  }
  /** The job proposal for one fact, as the actor: nothing is written, every bound system is reported. */
  async function assemble(actor: Actor, fact: Fact, call: JobCall): Promise<JobProposal> {
    const bindings = await deps.bindings.list(fact.kind);
    const followers = deps.followers(actor, fact.kind), offered = deps.offered(fact.kind);
    const sources: JobSource[] = [], pending: Array<Promise<{ source: JobSource; steps: JobStepDraft[] }>> = [];
    for (const b of bindings) {
      const follower = followers.find(f => f.name === b.capability);
      const connectorId = follower?.connectorId ?? b.capability.split('.')[0]!, source = follower?.source ?? connectorId;
      const verdict = classify(b, actor, offered, follower);
      if (verdict.status !== 'ok') { sources.push({ binding: b.id, connector: connectorId, source, capability: b.capability, status: verdict.status, reason: verdict.reason }); continue; }
      pending.push(ask(b, connectorId, source, fact, call));
    }
    const settled = await withinBudget(Promise.all(pending), budget.totalMs);
    const outcomes = settled === TIMEOUT
      ? await Promise.all(pending.map(p => withinBudget(p, 0).then(o => o === TIMEOUT ? undefined : o)))
      : settled;
    const asked = bindings.filter(b => !sources.some(s => s.binding === b.id));
    const steps: JobStepDraft[] = [];
    outcomes.forEach((o, i) => {
      const b = asked[i]!;
      if (!o) { const follower = followers.find(f => f.name === b.capability)!; sources.push({ binding: b.id, connector: follower.connectorId, source: follower.source, capability: b.capability, status: 'timeout' }); return; }
      sources.push(o.source); steps.push(...o.steps);
    });
    return { fact, steps, sources, partial: partial(sources) };
  }
  /** One decision over the proposal's steps; the ledger makes each step its own execution or watch. */
  async function approve(persona: AuthenticatedContext, input: { decisionId: string; proposal: JobProposal }) {
    if (!input.proposal.steps.length) throw new JobError('Jobbet har inga steg.');
    const bindings = await deps.bindings.list(input.proposal.fact.kind);
    const ceiling = Object.fromEntries(bindings.map(b => [b.capability.split('.')[0]!, b.within]));
    return deps.ledger.approveJob(persona, { decisionId: input.decisionId, steps: ledgerSteps(input.proposal.steps, ceiling, deps.clock().getTime()) });
  }
  /** An administrator binds a follower to a fact kind, or changes the binding; one transaction with its audit row (D23). */
  async function bind(persona: AuthenticatedContext, input: FollowBindingInput & { id?: string; enabled?: boolean }) {
    requireAdmin(persona); await persona.authorize();
    const at = deps.clock().toISOString();
    const existing = input.id ? await deps.bindings.read(input.id) : undefined;
    if (input.id && !existing) throw new JobError('Kopplingen finns inte.');
    const binding: FollowBinding = { id: existing?.id ?? deps.ids(), kind: input.kind, capability: input.capability, audience: input.audience, ...(input.within ? { within: input.within } : {}), enabled: input.enabled ?? existing?.enabled ?? true, createdAt: existing?.createdAt ?? at, updatedAt: at };
    return deps.bindings.transaction(async tx => {
      await tx.upsert(binding);
      await tx.audit({ actor: persona.principal.id, action: existing ? 'job.binding_changed' : 'job.binding_added', subject: 'binding:' + binding.id, at, details: { kind: binding.kind, capability: binding.capability, audience: binding.audience, within: binding.within ?? null, enabled: binding.enabled } });
      return binding;
    });
  }
  async function unbind(persona: AuthenticatedContext, id: string) {
    requireAdmin(persona); await persona.authorize();
    const at = deps.clock().toISOString();
    const existing = await deps.bindings.read(id);
    if (!existing) throw new JobError('Kopplingen finns inte.');
    await deps.bindings.transaction(async tx => {
      await tx.remove(id);
      await tx.audit({ actor: persona.principal.id, action: 'job.binding_removed', subject: 'binding:' + id, at, details: { kind: existing.kind, capability: existing.capability } });
    });
  }
  const bindings = (kind?: string) => deps.bindings.list(kind);
  return { assemble, approve, bind, unbind, bindings };
}
export type JobUsecases = ReturnType<typeof jobUsecases>;
