import type { AuthenticatedContext } from '@clew/contracts';
import type { ExecuteResult } from '@clew/connectors';
import {
  ExecutionError,
  type Execution,
  type ExecutionDeps,
  type ExecutionTx,
  type Job,
  type JobInput,
  type JobStep,
  type JobStepInput,
  type WatchObservation,
  type WatchState,
} from './model';
import {
  executionView,
  jobView,
  retainsAuthority,
  mayReplay,
  outcome,
  sameSafety,
  seen,
  undoInputOf,
  undoable,
  watchExpiredCard,
  watchIntentOf,
} from './domain';

const LEASE_MS = 120_000,
  APPROVAL_MS = 24 * 3600_000,
  MAX_STEPS = 10,
  MAX_CHECKS = 3;
const DECISION = /^[A-Za-z0-9:_.-]{1,200}$/,
  JOB_DECISION = /^[A-Za-z0-9:_.-]{1,150}$/,
  STEP_ID = /^[A-Za-z0-9_-]{1,40}$/;
type ApproveInput = {
  decisionId: string;
  operation: string;
  payload: unknown;
  compensates?: string;
  presentation?: Execution['presentation'];
};
export function executionUsecases({ store, source, watch, clock, ids, digest }: ExecutionDeps) {
  /** Everything an approval needs before its transaction: authority, the source's write safety and, for an undo, the compensation rule. No I/O on the store beyond reading the original. */
  async function prepare(persona: AuthenticatedContext, input: ApproveInput, at: string): Promise<Execution> {
    if (!DECISION.test(input.decisionId)) throw new ExecutionError('Ogiltigt beslut.');
    const access = await source.authorize(persona, input.operation, input.payload);
    if (input.compensates) {
      const original = await store.read(input.compensates);
      if (
        !original ||
        !retainsAuthority(persona, original) ||
        !undoable(original, persona.id, input.operation, access.connector, at)
      )
        throw new ExecutionError('Åtgärden kan inte ångras.');
      if (digest(input.payload) !== digest(undoInputOf(original!)))
        throw new ExecutionError('Ångra måste gälla exakt den bekräftade åtgärden.');
    }
    return {
      id: ids(),
      decisionId: input.decisionId,
      personId: persona.id,
      principal: persona.principal.id,
      unitId: persona.unitId,
      authorizationVersion: persona.authorizationVersion,
      connector: access.connector,
      operation: input.operation,
      payload: input.payload,
      digest: digest({
        operation: input.operation,
        payload: input.payload,
        compensates: input.compensates ?? null,
        threadId: input.presentation?.threadId ?? null,
        actionId: input.presentation?.actionId ?? null,
      }),
      safety: access.safety,
      ...(input.presentation ? { presentation: input.presentation } : {}),
      state: 'pending',
      reason: access.needsSession ? 'needs-session' : null,
      result: null,
      compensates: input.compensates ?? null,
      createdAt: at,
      updatedAt: at,
      expiresAt: new Date(Date.parse(at) + APPROVAL_MS).toISOString(),
      dispatchedAt: null,
      attempt: 0,
      leaseUntil: null,
    };
  }
  /** One approved intent into the ledger: the row, its audit and its outbox intent, or the existing row for the same decision. Composable, so a job commits its steps in one transaction. */
  async function commit(tx: ExecutionTx, persona: AuthenticatedContext, execution: Execution): Promise<Execution> {
    const saved = await tx.insert(execution);
    if (!retainsAuthority(persona, saved.execution)) throw new ExecutionError('Åtgärden finns inte.');
    if (saved.execution.digest !== execution.digest)
      throw new ExecutionError('Beslutet gäller redan ett annat innehåll.');
    if (saved.inserted) {
      await tx.audit({
        actor: persona.principal.id,
        action: 'execution.approved',
        subject: 'execution:' + execution.id,
        at: execution.createdAt,
        details: {
          connector: execution.connector,
          operation: execution.operation,
          digest: execution.digest,
          compensates: execution.compensates,
        },
      });
      await tx.enqueue({
        id: 'execution:' + execution.id,
        executionId: execution.id,
        attempt: 0,
        leaseUntil: null,
        nextAt: execution.createdAt,
        deliveredAt: null,
        lastError: null,
      });
    }
    return saved.execution;
  }
  async function approve(persona: AuthenticatedContext, input: ApproveInput) {
    await persona.authorize();
    const execution = await prepare(persona, input, clock().toISOString());
    const saved = await store.transaction(tx => commit(tx, persona, execution));
    const result = await read(persona, saved.id);
    if (!result) throw new ExecutionError('Åtgärden finns inte.');
    return result;
  }
  /**
   * One approval over several steps (D55). Every execute step is prepared and authorized on its own connector first, so a
   * refused step persists nothing; then the steps and the job row commit together. A repeated identical approval returns
   * the same job and the same executions; a changed step is refused. Steps are independent: no step reads another's result.
   */
  async function approveJob(persona: AuthenticatedContext, input: JobInput, authorizeApproval?: () => Promise<void>) {
    await persona.authorize();
    if (!JOB_DECISION.test(input.decisionId)) throw new ExecutionError('Ogiltigt beslut.');
    if (!input.steps.length || input.steps.length > MAX_STEPS)
      throw new ExecutionError('Ett jobb har mellan ett och tio steg.');
    const stepIds = new Set<string>();
    for (const step of input.steps) {
      if (!STEP_ID.test(step.id) || stepIds.has(step.id)) throw new ExecutionError('Ogiltigt steg.');
      stepIds.add(step.id);
    }
    const at = clock().toISOString();
    const prepared: Array<{ step: JobStepInput; connector: string; execution?: Execution }> = [];
    for (const step of input.steps) {
      if (step.kind === 'execute') {
        const execution = await prepare(
          persona,
          { decisionId: input.decisionId + ':' + step.id, operation: step.operation, payload: step.payload },
          at,
        );
        prepared.push({ step, connector: execution.connector, execution });
      } else {
        if (!watch) throw new ExecutionError('Bevakning är inte tillgänglig.');
        const ordered = step.checks.every((c, i) => i === 0 || c > step.checks[i - 1]!);
        if (
          !step.checks.length ||
          step.checks.length > MAX_CHECKS ||
          !ordered ||
          step.expiresAt <= step.checks[step.checks.length - 1]! ||
          step.expect.path.length > 10
        )
          throw new ExecutionError('Ogiltig bevakning.');
        if (!step.title.trim() || step.title.length > 120 || !step.source.trim() || step.source.length > 80)
          throw new ExecutionError('Ogiltig bevakning.');
        const access = await watch.authorize(persona, step.operation, step.input);
        prepared.push({ step, connector: access.connector });
      }
    }
    // Compare the approved duration/offsets, not the wall-clock time of a delivery retry.
    // Callers with explicitly absolute schedules keep their existing digest contract.
    const origin = input.scheduleOrigin === undefined ? undefined : Date.parse(input.scheduleOrigin);
    if (origin !== undefined && !Number.isFinite(origin)) throw new ExecutionError('Ogiltig bevakning.');
    const intent = input.steps.map(step => {
      if (step.kind !== 'watch' || origin === undefined) return step;
      const checks = step.checks.map(time => Date.parse(time) - origin);
      const expiresAt = Date.parse(step.expiresAt) - origin;
      if (
        checks.some(time => !Number.isSafeInteger(time) || time <= 0) ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= 0
      )
        throw new ExecutionError('Ogiltig bevakning.');
      return { ...step, checks, expiresAt };
    });
    const job: Omit<Job, 'steps'> = {
      id: ids(),
      decisionId: input.decisionId,
      personId: persona.id,
      principal: persona.principal.id,
      unitId: persona.unitId,
      authorizationVersion: persona.authorizationVersion,
      digest: digest({ steps: intent }),
      createdAt: at,
      updatedAt: at,
    };
    await authorizeApproval?.();
    await persona.authorize();
    const approved = await store.transaction(async tx => {
      const steps: JobStep[] = [];
      for (const p of prepared) {
        if (p.step.kind === 'execute') {
          const saved = await commit(tx, persona, p.execution!);
          steps.push({
            id: p.step.id,
            kind: 'execute',
            connector: p.connector,
            operation: p.step.operation,
            executionId: saved.id,
          });
        } else
          steps.push({
            id: p.step.id,
            kind: 'watch',
            connector: p.connector,
            operation: p.step.operation,
            input: p.step.input,
            expect: p.step.expect,
            checks: p.step.checks,
            expiresAt: p.step.expiresAt,
            title: p.step.title,
            source: p.step.source,
            state: 'waiting',
            reason: null,
            observations: [],
          });
      }
      const saved = await tx.insertJob({ ...job, steps });
      if (!retainsAuthority(persona, saved.job)) throw new ExecutionError('Jobbet finns inte.');
      if (saved.job.digest !== job.digest) throw new ExecutionError('Beslutet gäller redan ett annat innehåll.');
      if (saved.inserted) {
        // The watch's timer is intent in the same commit (D47): the outbox delivers the committed schedule to Temporal, which cannot invent or extend it.
        for (const s of steps) if (s.kind === 'watch') await tx.enqueueWatch(watchIntentOf(job, s, at));
        await tx.audit({
          actor: persona.principal.id,
          action: 'job.approved',
          subject: 'job:' + job.id,
          at,
          details: {
            decisionId: job.decisionId,
            steps: steps.map(s => ({
              id: s.id,
              kind: s.kind,
              connector: s.connector,
              operation: s.operation,
              ...(s.kind === 'execute' ? { executionId: s.executionId } : { checks: s.checks, expiresAt: s.expiresAt }),
            })),
          },
        });
      }
      return saved.job;
    });
    const result = await readJob(persona, approved.id);
    if (!result) throw new ExecutionError('Jobbet finns inte.');
    return result;
  }
  async function readJob(persona: AuthenticatedContext, id: string) {
    const job = await store.readJob(id);
    if (!job || !retainsAuthority(persona, job)) return undefined;
    await persona.authorize();
    const executions: Record<string, Execution | undefined> = {};
    for (const step of job.steps) {
      if (step.kind === 'execute') {
        const execution = await store.read(step.executionId);
        if (
          !execution ||
          !retainsAuthority(persona, execution) ||
          execution.connector !== step.connector ||
          execution.operation !== step.operation
        )
          return undefined;
        executions[step.executionId] = execution;
      }
    }
    // Do not release part of a composite snapshot when any participating source is no longer allowed.
    try {
      for (const step of job.steps) {
        const access =
          step.kind === 'execute'
            ? await source.authorize(persona, step.operation, executions[step.executionId]!.payload)
            : await watch?.authorize(persona, step.operation, step.input);
        if (access?.connector !== step.connector) return undefined;
      }
    } catch {
      return undefined;
    }
    await persona.authorize();
    return jobView(job, executions);
  }
  /**
   * "Ångra allt": one linked compensation per step whose confirmed effect can still be undone, approved in one decision and
   * dispatched and judged alone (D45). A step without an inverse, not yet done or past its window is reported, not forced.
   */
  async function undoJob(persona: AuthenticatedContext, jobId: string) {
    const job = await store.readJob(jobId);
    if (!job || !(await readJob(persona, jobId))) throw new ExecutionError('Jobbet finns inte.');
    const at = clock().toISOString();
    const compensations: Array<{ stepId: string; original: Execution; execution: Execution }> = [],
      skipped: Array<{ stepId: string; reason: string }> = [];
    for (const step of job.steps) {
      if (step.kind !== 'execute') continue;
      const original = await store.read(step.executionId);
      const operation = original?.result?.undoCapability;
      if (!original || !operation) {
        skipped.push({
          stepId: step.id,
          reason: ['succeeded', 'partial'].includes(original?.state ?? '') ? 'no-undo' : 'not-done',
        });
        continue;
      }
      if (!undoable(original, persona.id, operation, original.connector, at)) {
        skipped.push({
          stepId: step.id,
          reason: ['succeeded', 'partial'].includes(original.state) ? 'window-closed' : 'not-done',
        });
        continue;
      }
      compensations.push({
        stepId: step.id,
        original,
        execution: await prepare(
          persona,
          { decisionId: 'undo:' + original.id, operation, payload: undoInputOf(original), compensates: original.id },
          at,
        ),
      });
    }
    if (!compensations.length) throw new ExecutionError('Inget att ångra.');
    return store.transaction(async tx => {
      const saved: Array<{ stepId: string; executionId: string; compensationId: string }> = [];
      let fresh = false;
      for (const c of compensations) {
        const row = await commit(tx, persona, c.execution);
        fresh ||= row.id === c.execution.id;
        saved.push({ stepId: c.stepId, executionId: c.original.id, compensationId: row.id });
      }
      if (fresh)
        await tx.audit({
          actor: persona.principal.id,
          action: 'job.undo_approved',
          subject: 'job:' + job.id,
          at,
          details: { compensations: saved, skipped },
        });
      return { jobId: job.id, compensations: saved, skipped };
    });
  }
  /**
   * One check of a watch step (D55), the activity the `jobWatch` workflow calls with the check's index as its fence: nothing
   * is read before the check's time or twice for one check, the window's end wins over a late check (any index at or after
   * `expiresAt` settles `expired` and leaves the card), authority is current, and the read is the step's own connector's
   * read, never an execute. A source that does not answer leaves the watch waiting. Idempotent, so a retried activity adds nothing.
   */
  async function observe(jobId: string, stepId: string, check: number): Promise<WatchState> {
    const job = await store.readJob(jobId);
    const step = job?.steps.find(s => s.id === stepId);
    if (!job || !step || step.kind !== 'watch') throw new ExecutionError('Bevakningen finns inte.');
    if (step.state !== 'waiting') return step.state;
    const at = clock().toISOString();
    const settleWatch = (state: WatchState, reason: string | null, observation?: WatchObservation) =>
      store.transaction(async tx => {
        const current = await tx.lockJob(jobId);
        const s = current?.steps.find(x => x.id === stepId);
        if (!current || !s || s.kind !== 'watch') return 'blocked' as WatchState;
        const before: WatchState = s.state;
        if (before !== 'waiting' || (observation && s.observations.some(o => o.check === observation.check)))
          return before;
        const next: Extract<JobStep, { kind: 'watch' }> = {
          ...s,
          state,
          reason,
          observations: observation ? [...s.observations, observation] : s.observations,
        };
        await tx.updateJob({ ...current, steps: current.steps.map(x => (x.id === stepId ? next : x)), updatedAt: at });
        await tx.audit({
          actor: 'system:execution',
          action: 'job.watch_' + (observation ? 'observed' : state),
          subject: 'job:' + jobId,
          at,
          details: {
            stepId,
            state,
            ...(observation
              ? {
                  check: observation.check,
                  seen: observation.seen,
                  ...(observation.error ? { error: observation.error } : {}),
                }
              : {}),
          },
        });
        // The window ended unseen: the person gets a card (D55 item 5), admitted by the stream in this same commit (D47). Fenced by `before`, so one card per watch.
        if (state === 'expired') await tx.pushCard(watchExpiredCard(current, next, at));
        return state;
      });
    if (at >= step.expiresAt) return settleWatch('expired', 'expired');
    if (
      !watch ||
      !Number.isInteger(check) ||
      check < 0 ||
      check >= step.checks.length ||
      at < step.checks[check]! ||
      step.observations.some(o => o.check === check)
    )
      return 'waiting';
    let persona: AuthenticatedContext | undefined;
    try {
      persona = await source.current(job.personId);
      if (!persona || persona.unitId !== job.unitId || persona.authorizationVersion !== job.authorizationVersion)
        throw new Error('revoked');
      await persona.authorize();
      if ((await watch.authorize(persona, step.operation, step.input)).connector !== step.connector)
        throw new Error('moved');
    } catch {
      return settleWatch('blocked', 'authority-revoked');
    }
    let output: unknown;
    try {
      output = await watch.read(persona, step.operation, step.input);
    } catch {
      return settleWatch('waiting', null, { check, at, seen: false, error: 'source-unavailable' });
    }
    const matched = seen(output, step.expect, digest);
    return settleWatch(matched ? 'seen' : 'waiting', null, { check, at, seen: matched });
  }
  async function read(persona: AuthenticatedContext, id: string) {
    const e = await store.read(id);
    if (!e || !retainsAuthority(persona, e)) return undefined;
    await persona.authorize();
    if ((await source.authorize(persona, e.operation, e.payload)).connector !== e.connector) return undefined;
    await persona.authorize();
    return executionView(e);
  }
  async function settle(e: Execution, state: Execution['state'], reason: string | null, result?: ExecuteResult | null) {
    const at = clock().toISOString();
    return store.transaction(async tx => {
      const current = await tx.lock(e.id);
      // An expired worker may not overwrite a newer reconciliation's evidence.
      if (!current || current.attempt !== e.attempt || current.state !== 'running') return;
      const evidence = result ?? current.result;
      await tx.update({ ...current, state, reason, result: evidence, leaseUntil: null, updatedAt: at });
      await tx.audit({
        actor: 'system:execution',
        action: 'execution.' + state,
        subject: 'execution:' + e.id,
        at,
        details: { attempt: e.attempt, reason, outcomes: evidence?.rows.map(row => row.outcome) ?? [] },
      });
    });
  }
  /** One bounded activity. Recovery investigates dispatched state; it never blindly replays a write. */
  async function progress(id: string): Promise<'done' | 'busy' | 'reconcile'> {
    const at = clock().toISOString();
    const e = await store.transaction(async tx => {
      const row = await tx.lock(id);
      if (!row || row.reason === 'source-reset' || ['succeeded', 'partial', 'failed'].includes(row.state))
        return undefined;
      if (row.state === 'running' && row.leaseUntil && row.leaseUntil > at) return 'busy' as const;
      const next: Execution = {
        ...row,
        state: 'running',
        attempt: row.attempt + 1,
        leaseUntil: new Date(Date.parse(at) + LEASE_MS).toISOString(),
        updatedAt: at,
      };
      await tx.update(next);
      await tx.audit({
        actor: 'system:execution',
        action: 'execution.claimed',
        subject: 'execution:' + id,
        at,
        details: { attempt: next.attempt, recovery: !!row.dispatchedAt },
      });
      return next;
    });
    if (!e) return 'done';
    if (e === 'busy') return 'busy';
    let persona: AuthenticatedContext | undefined;
    try {
      persona = await source.current(e.personId);
      if (!persona || persona.unitId !== e.unitId || persona.authorizationVersion !== e.authorizationVersion)
        throw new Error('revoked');
      await persona.authorize();
      const access = await source.authorize(persona, e.operation, e.payload);
      if (access.needsSession) {
        await settle(e, e.dispatchedAt ? 'unknown' : 'pending', 'needs-session');
        return 'done';
      }
      if (!sameSafety(access.safety, e.safety)) {
        await settle(e, e.dispatchedAt ? 'unknown' : 'pending', 'source-contract-changed');
        return 'done';
      }
    } catch {
      await settle(e, e.dispatchedAt ? 'unknown' : 'pending', 'authority-revoked');
      return 'done';
    }
    if (e.dispatchedAt) {
      if (e.safety.strategy === 'manual') {
        await settle(e, 'unknown', 'manual-reconciliation');
        return 'done';
      }
      try {
        const found = await source.lookup(persona, e);
        if (found) {
          await settle(e, outcome(found), null, found);
          return 'done';
        }
      } catch {
        await settle(e, 'unknown', 'source-unavailable');
        return 'done';
      }
      if (!mayReplay(e, at)) {
        await settle(e, 'unknown', 'replay-not-safe');
        return 'done';
      }
    } else if (e.expiresAt <= at) {
      await settle(e, 'failed', 'approval-expired');
      return 'done';
    }
    // Persist dispatch BEFORE I/O. A crash from this point must be reconciled, even if no request reached the source.
    const dispatched = await store.transaction(async tx => {
      const current = await tx.lock(id);
      if (!current || current.attempt !== e.attempt || current.state !== 'running') return false;
      const time = clock().toISOString();
      await tx.update({ ...current, dispatchedAt: current.dispatchedAt ?? time });
      await tx.audit({
        actor: 'system:execution',
        action: 'execution.dispatched',
        subject: 'execution:' + id,
        at: time,
        details: { attempt: e.attempt },
      });
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
    if (!(await read(persona, id))) throw new ExecutionError('Åtgärden finns inte.');
    const at = clock().toISOString();
    await store.transaction(async tx => {
      const e = await tx.lock(id);
      if (!e || e.reason === 'source-reset' || !['pending', 'unknown'].includes(e.state)) return;
      await tx.enqueue({
        id: 'reconcile:' + id + ':' + e.attempt,
        executionId: id,
        attempt: 0,
        leaseUntil: null,
        nextAt: at,
        deliveredAt: null,
        lastError: null,
      });
      await tx.audit({
        actor: persona.principal.id,
        action: 'execution.reconciliation_requested',
        subject: 'execution:' + id,
        at,
      });
    });
    return read(persona, id);
  }
  return { approve, approveJob, undoJob, observe, readJob, read, progress, reconcile };
}
