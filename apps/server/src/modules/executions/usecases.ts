import type { AuthenticatedContext } from '@clew/contracts';
import type { ExecuteResult } from '@clew/connectors';
import { ExecutionError, type Execution, type ExecutionDeps } from './model';
import { executionView, mayReplay, outcome, sameSafety } from './domain';

const LEASE_MS = 120_000, APPROVAL_MS = 24 * 3600_000;
export function executionUsecases({ store, source, clock, ids, digest }: ExecutionDeps) {
  async function approve(persona: AuthenticatedContext, input: { decisionId: string; operation: string; payload: unknown; compensates?: string; presentation?: Execution['presentation'] }) {
    await persona.authorize();
    if (!/^[A-Za-z0-9:_.-]{1,200}$/.test(input.decisionId)) throw new ExecutionError('Ogiltigt beslut.');
    const access = await source.authorize(persona, input.operation, input.payload);
    if (input.compensates) {
      const original = await store.read(input.compensates);
      if (!original || original.personId !== persona.id || original.connector !== access.connector || !['succeeded', 'partial'].includes(original.state) || original.result?.undoCapability !== input.operation || clock().getTime() > Date.parse(original.updatedAt) + (original.result.undoMinutes ?? 10) * 60_000)
        throw new ExecutionError('Åtgärden kan inte ångras.');
    }
    const at = clock().toISOString();
    const execution: Execution = { id: ids(), decisionId: input.decisionId, personId: persona.id, principal: persona.principal.id, unitId: persona.unitId, authorizationVersion: persona.authorizationVersion,
      connector: access.connector, operation: input.operation, payload: input.payload, digest: digest({ operation: input.operation, payload: input.payload, compensates: input.compensates ?? null, threadId: input.presentation?.threadId ?? null, actionId: input.presentation?.actionId ?? null }), safety: access.safety, ...(input.presentation ? { presentation: input.presentation } : {}),
      state: 'pending', reason: access.needsSession ? 'needs-session' : null, result: null, compensates: input.compensates ?? null,
      createdAt: at, updatedAt: at, expiresAt: new Date(Date.parse(at) + APPROVAL_MS).toISOString(), dispatchedAt: null, attempt: 0, leaseUntil: null };
    return store.transaction(async tx => {
      const saved = await tx.insert(execution);
      if (saved.execution.digest !== execution.digest) throw new ExecutionError('Beslutet gäller redan ett annat innehåll.');
      if (saved.inserted) {
        await tx.audit({ actor: persona.principal.id, action: 'execution.approved', subject: 'execution:' + execution.id, at, details: { connector: execution.connector, operation: execution.operation, digest: execution.digest, compensates: execution.compensates } });
        await tx.enqueue({ id: 'execution:' + execution.id, executionId: execution.id, attempt: 0, leaseUntil: null, nextAt: at, deliveredAt: null, lastError: null });
      }
      return executionView(saved.execution);
    });
  }
  async function read(persona: AuthenticatedContext, id: string) {
    const e = await store.read(id);
    if (!e || e.personId !== persona.id) return undefined;
    await persona.authorize();
    await source.authorize(persona, e.operation, e.payload);
    return executionView(e);
  }
  async function settle(e: Execution, state: Execution['state'], reason: string | null, result: ExecuteResult | null = null) {
    const at = clock().toISOString();
    return store.transaction(async tx => {
      const current = await tx.lock(e.id);
      // An expired worker may not overwrite a newer reconciliation's evidence.
      if (!current || current.attempt !== e.attempt || current.state !== 'running') return;
      await tx.update({ ...current, state, reason, result, leaseUntil: null, updatedAt: at });
      await tx.audit({ actor: 'system:execution', action: 'execution.' + state, subject: 'execution:' + e.id, at, details: { attempt: e.attempt, reason, outcomes: result?.rows.map(row => row.outcome) ?? [] } });
    });
  }
  /** One bounded activity. Recovery investigates dispatched state; it never blindly replays a write. */
  async function progress(id: string): Promise<'done' | 'busy' | 'reconcile'> {
    const at = clock().toISOString();
    const e = await store.transaction(async tx => {
      const row = await tx.lock(id);
      if (!row || ['succeeded', 'partial', 'failed'].includes(row.state)) return undefined;
      if (row.state === 'running' && row.leaseUntil && row.leaseUntil > at) return 'busy' as const;
      const next: Execution = { ...row, state: 'running', attempt: row.attempt + 1, leaseUntil: new Date(Date.parse(at) + LEASE_MS).toISOString(), updatedAt: at };
      await tx.update(next);
      await tx.audit({ actor: 'system:execution', action: 'execution.claimed', subject: 'execution:' + id, at, details: { attempt: next.attempt, recovery: !!row.dispatchedAt } });
      return next;
    });
    if (!e) return 'done';
    if (e === 'busy') return 'busy';
    let persona: AuthenticatedContext | undefined;
    try {
      persona = await source.current(e.personId);
      if (!persona || persona.unitId !== e.unitId || persona.authorizationVersion !== e.authorizationVersion) throw new Error('revoked');
      await persona.authorize();
      const access = await source.authorize(persona, e.operation, e.payload);
      if (access.needsSession) { await settle(e, e.dispatchedAt ? 'unknown' : 'pending', 'needs-session'); return 'done'; }
      if (!sameSafety(access.safety, e.safety)) { await settle(e, e.dispatchedAt ? 'unknown' : 'pending', 'source-contract-changed'); return 'done'; }
    } catch { await settle(e, e.dispatchedAt ? 'unknown' : 'pending', 'authority-revoked'); return 'done'; }
    if (e.dispatchedAt) {
      if (e.safety.strategy === 'manual') { await settle(e, 'unknown', 'manual-reconciliation'); return 'done'; }
      try {
        const found = await source.lookup(persona, e);
        if (found) { await settle(e, outcome(found), null, found); return 'done'; }
      } catch { await settle(e, 'unknown', 'source-unavailable'); return 'done'; }
      if (!mayReplay(e, at)) { await settle(e, 'unknown', 'replay-not-safe'); return 'done'; }
    } else if (e.expiresAt <= at) { await settle(e, 'failed', 'approval-expired'); return 'done'; }
    // Persist dispatch BEFORE I/O. A crash from this point must be reconciled, even if no request reached the source.
    const dispatched = await store.transaction(async tx => {
      const current = await tx.lock(id);
      if (!current || current.attempt !== e.attempt || current.state !== 'running') return false;
      const time = clock().toISOString();
      await tx.update({ ...current, dispatchedAt: current.dispatchedAt ?? time });
      await tx.audit({ actor: 'system:execution', action: 'execution.dispatched', subject: 'execution:' + id, at: time, details: { attempt: e.attempt } });
      return true;
    });
    if (!dispatched) return 'done';
    try {
      const result = await source.execute(persona, e);
      await settle(e, outcome(result), null, result);
      return 'done';
    } catch {
      await settle(e, 'unknown', 'source-outcome-unknown');
      return e.dispatchedAt ? 'done' : 'reconcile';
    }
  }
  /** A human asks to check the original operation again; this never allocates another source key. */
  async function reconcile(persona: AuthenticatedContext, id: string) {
    if (!await read(persona, id)) throw new ExecutionError('Åtgärden finns inte.');
    const at = clock().toISOString();
    await store.transaction(async tx => {
      const e = await tx.lock(id);
      if (!e || !['pending', 'unknown'].includes(e.state)) return;
      await tx.enqueue({ id: 'reconcile:' + id + ':' + e.attempt, executionId: id, attempt: 0, leaseUntil: null, nextAt: at, deliveredAt: null, lastError: null });
      await tx.audit({ actor: persona.principal.id, action: 'execution.reconciliation_requested', subject: 'execution:' + id, at });
    });
    return read(persona, id);
  }
  return { approve, read, progress, reconcile };
}
