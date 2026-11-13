import { foldSourceKey, SUBJECT_CHANGED, type AuthenticatedContext } from '@clew/contracts';
import { RelationsUnavailableError, type ExecuteResult } from '@clew/connectors';
import {
  ExecutionError,
  SourceUnavailableError,
  type AuthorizeOptions,
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
  executionStart,
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
  watchStart,
} from './domain';
/** An authorization for reading what was already decided, not for a new effect (D117). */
const READING: AuthorizeOptions = { reading: true };
/**
 * Authority that could not be established now, rather than authority refused (D117): the source port says so, or the
 * registry could not read the directory to resolve whom the input names. Retried as unavailable, never revoked.
 */
const unavailable = (error: unknown) =>
  error instanceof SourceUnavailableError || error instanceof RelationsUnavailableError;

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
  /**
   * The person's answers to the capability's asks (D112), already merged into `payload`: the approved intent holds them
   * there, and the approval's audit row names them, in the same transaction.
   */
  asked?: Record<string, string>;
  /** The person a started action is about (D122): `payload[param]` is the user name they held when it was decided. */
  subject?: { param: string; personId: string };
};
/** Which of the person's kept sessions stood behind a call to a connector that acts as them (D26); what the audit records instead of a binding. */
type Backing = 'approving' | 'checking';
export function executionUsecases({
  store,
  source,
  sessions,
  watch,
  clock,
  ids,
  digest,
  review,
  people,
}: ExecutionDeps) {
  /** Everything an approval needs before its transaction: authority, the source's write safety and, for an undo, the compensation rule. No I/O on the store beyond reading the original. */
  async function prepare(persona: AuthenticatedContext, input: ApproveInput, at: string): Promise<Execution> {
    if (!DECISION.test(input.decisionId)) throw new ExecutionError('Ogiltigt beslut.');
    const access = await source.authorize(persona, input.operation, input.payload);
    // Existing decisions retain their approved versions even after source change or evidence expiry.
    // Commit still compares the complete intent and its original authority before returning a replay.
    if (review && !(await store.readDecision(persona.id, input.decisionId)))
      await review(persona, input.operation, input.payload);
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
    // A connector that acts as the person (D26): the signed-in session that approves is the one that may stand behind the
    // dispatch. Without one (or without a port to find it again) the write waits for a session, as it always did.
    const approvingSession = access.needsSession && sessions && persona.delegate ? persona.sessionBinding : null;
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
        // The person the payload's user name was decided for is part of what was approved (D122).
        ...(input.subject ? { subject: input.subject } : {}),
      }),
      safety: access.safety,
      ...(input.presentation ? { presentation: input.presentation } : {}),
      state: 'pending',
      reason: access.needsSession && !approvingSession ? 'needs-session' : null,
      result: null,
      compensates: input.compensates ?? null,
      createdAt: at,
      updatedAt: at,
      expiresAt: new Date(Date.parse(at) + APPROVAL_MS).toISOString(),
      dispatchedAt: null,
      attempt: 0,
      leaseUntil: null,
      approvingSession,
      checkingSession: null,
      subject: input.subject ?? null,
    };
  }
  /**
   * One approved intent into the ledger: the row, its audit and its workflow start (D86), or the existing row for the same
   * decision. Composable, so a job commits its steps in one transaction. `asked` is what the person answered (D112): it is
   * in the payload, and the audit row names it.
   */
  async function commit(
    tx: ExecutionTx,
    persona: AuthenticatedContext,
    execution: Execution,
    asked?: Record<string, string>,
  ): Promise<Execution> {
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
          ...(execution.approvingSession ? { session: 'approving' } : {}),
          ...(asked && Object.keys(asked).length ? { asked } : {}),
        },
      });
      await tx.enqueue(executionStart('execution:' + execution.id, execution.id));
    }
    return saved.execution;
  }
  async function approve(persona: AuthenticatedContext, input: ApproveInput) {
    await persona.authorize();
    // The answers are part of the approved input, never beside it (D112).
    const payload = (input.payload ?? {}) as Record<string, unknown>;
    if (input.asked && Object.entries(input.asked).some(([key, value]) => payload[key] !== value))
      throw new ExecutionError('Svaren och beslutet gäller olika innehåll.');
    const execution = await prepare(persona, input, clock().toISOString());
    const saved = await store.transaction(tx => commit(tx, persona, execution, input.asked));
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
        // The watch's timer is intent in the same commit (D47) and so is its workflow (D86): the engine gets the committed schedule and cannot invent or extend it.
        for (const s of steps)
          if (s.kind === 'watch') {
            const intent = watchIntentOf(job, s, at);
            await tx.enqueueWatch(intent);
            await tx.enqueue(watchStart(intent));
          }
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
        // Reading what was decided (D117): whom a step names is resolved when it is dispatched, not when it is shown.
        const access =
          step.kind === 'execute'
            ? await source.authorize(persona, step.operation, executions[step.executionId]!.payload, READING)
            : await watch?.authorize(persona, step.operation, step.input, READING);
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
    } catch (error) {
      // A directory that cannot say now whom the read names is a check that did not happen, not lost authority (D117).
      if (unavailable(error))
        return settleWatch('waiting', null, { check, at, seen: false, error: 'source-unavailable' });
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
  /** The execution and its source's current answer, while the persona may read it (D75, D77). */
  async function readable(persona: AuthenticatedContext, id: string) {
    const e = await store.read(id);
    if (!e || !retainsAuthority(persona, e)) return undefined;
    await persona.authorize();
    const access = await source.authorize(persona, e.operation, e.payload, READING);
    if (access.connector !== e.connector) return undefined;
    await persona.authorize();
    return { e, access };
  }
  async function read(persona: AuthenticatedContext, id: string) {
    const found = await readable(persona, id);
    return found && executionView(found.e);
  }
  async function settle(
    e: Execution,
    state: Execution['state'],
    reason: string | null,
    result?: ExecuteResult | null,
    backing?: Backing,
  ) {
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
        details: {
          attempt: e.attempt,
          reason,
          outcomes: evidence?.rows.map(row => row.outcome) ?? [],
          ...(backing ? { session: backing } : {}),
        },
      });
    });
  }
  /**
   * The person's own live session behind work on a connector that acts as them (D26): the session that approved it for a
   * dispatch or a replay, and, for the read-back of a write already dispatched, also the session in which they last asked
   * to check it. A session that has ended, was revoked, is someone else's or yields no token stands behind nothing; there
   * is no fallback to a service credential, a stored token or any other session. Throws when the identity provider
   * cannot exchange a token now.
   */
  async function standing(e: Execution, persona: AuthenticatedContext) {
    const kept: Array<[string | null, Backing]> = [
      [e.approvingSession, 'approving'],
      [e.dispatchedAt ? e.checkingSession : null, 'checking'],
    ];
    for (const [binding, backing] of kept) {
      if (!binding || !sessions) continue;
      const session = await sessions.find(binding);
      if (!session || session.personId !== e.personId) continue;
      const delegated: AuthenticatedContext = { ...persona, delegate: session.delegate };
      if (await sessions.ready(delegated, e)) return { persona: delegated, backing };
    }
    return undefined;
  }
  /** Whether the user name in a started action's payload still names the person it was decided for (D122). */
  async function stillNamed(e: Execution): Promise<boolean> {
    if (!e.subject || !people) return false;
    const sent = (e.payload as Record<string, unknown> | null)?.[e.subject.param];
    const now = await people.userName(e.subject.personId);
    return typeof sent === 'string' && now !== null && foldSourceKey('person', sent) === foldSourceKey('person', now);
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
    let persona: AuthenticatedContext | undefined,
      needsSession = false,
      resolution: unknown;
    try {
      persona = await source.current(e.personId);
      if (!persona || persona.unitId !== e.unitId || persona.authorizationVersion !== e.authorizationVersion)
        throw new Error('revoked');
      await persona.authorize();
      const access = await source.authorize(persona, e.operation, e.payload);
      needsSession = access.needsSession;
      // Whom the payload names is resolved here, before the dispatch is recorded, and the send uses this (D117): a
      // directory that cannot be read is found now, while nothing has been sent, and never after.
      resolution = access.resolution;
      if (!sameSafety(access.safety, e.safety)) {
        await settle(e, e.dispatchedAt ? 'unknown' : 'pending', 'source-contract-changed');
        return 'done';
      }
    } catch (error) {
      // Only an answer that the person may no longer do this revokes it. A directory that cannot be read now (D117) is
      // the same as a source that cannot be reached: nothing has been sent, and it says so.
      await settle(
        e,
        e.dispatchedAt ? 'unknown' : 'pending',
        unavailable(error) ? 'source-unavailable' : 'authority-revoked',
      );
      return 'done';
    }
    // An approval that was never sent lives 24 hours (D45), whether or not a session could stand behind it meanwhile.
    if (!e.dispatchedAt && e.expiresAt <= at) {
      await settle(e, 'failed', 'approval-expired');
      return 'done';
    }
    // A connector that acts as the person gets the person's own token or nothing (D26). The current grant was checked
    // above; the session adds the token and never more authority than the grant.
    let backing: Backing | undefined;
    if (needsSession) {
      let stood: Awaited<ReturnType<typeof standing>>;
      try {
        stood = await standing(e, persona);
      } catch {
        // A live session, but no token to be had now: nothing has been sent.
        await settle(e, e.dispatchedAt ? 'unknown' : 'pending', 'source-unavailable');
        return 'done';
      }
      if (!stood) {
        await settle(e, e.dispatchedAt ? 'unknown' : 'pending', 'needs-session');
        return 'done';
      }
      persona = stood.persona;
      backing = stood.backing;
    }
    if (e.dispatchedAt) {
      if (e.safety.strategy === 'manual') {
        await settle(e, 'unknown', 'manual-reconciliation', undefined, backing);
        return 'done';
      }
      try {
        const found = await source.lookup(persona, e);
        if (found) {
          await settle(e, outcome(found), null, found, backing);
          return 'done';
        }
      } catch {
        await settle(e, 'unknown', 'source-unavailable', undefined, backing);
        return 'done';
      }
      if (!mayReplay(e, at)) {
        await settle(e, 'unknown', 'replay-not-safe', undefined, backing);
        return 'done';
      }
      // A replay is a write: the session that only asked to check it stands behind the read-back, never behind a write.
      if (backing === 'checking') {
        await settle(e, 'unknown', 'needs-session', undefined, backing);
        return 'done';
      }
    }
    // A started action names a person by the user name they held when it was decided (D122). Sent only while that name
    // is still theirs: after a rename it would reach nobody, after a reuse someone else, so the person decides again.
    if (e.subject && !(await stillNamed(e))) {
      await settle(e, e.dispatchedAt ? 'unknown' : 'failed', SUBJECT_CHANGED, undefined, backing);
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
        details: { attempt: e.attempt, ...(backing ? { session: backing } : {}) },
      });
      return true;
    });
    if (!dispatched) return 'done';
    try {
      const result = await source.execute(persona, e, resolution);
      await settle(e, outcome(result), null, result, backing);
      return 'done';
    } catch {
      await settle(e, 'unknown', 'source-outcome-unknown', undefined, backing);
      return e.dispatchedAt ? 'done' : 'reconcile';
    }
  }
  /**
   * A human asks to check the original operation again; this never allocates another source key. On a connector that
   * acts as the person, the session that asks is kept for the read-back of a write already dispatched (D26): it may
   * stand behind the lookup when the approving session has ended, never behind a dispatch or a replay.
   */
  async function reconcile(persona: AuthenticatedContext, id: string) {
    const found = await readable(persona, id);
    if (!found) throw new ExecutionError('Åtgärden finns inte.');
    const asking = found.access.needsSession && sessions && persona.delegate ? persona.sessionBinding : null;
    const at = clock().toISOString();
    await store.transaction(async tx => {
      const e = await tx.lock(id);
      if (!e || e.reason === 'source-reset' || !['pending', 'unknown'].includes(e.state)) return;
      const checking = asking && e.dispatchedAt && asking !== e.approvingSession ? asking : null;
      if (checking && checking !== e.checkingSession) await tx.keepCheckingSession(id, checking);
      await tx.enqueue(executionStart('reconcile:' + id + ':' + e.attempt, id));
      await tx.audit({
        actor: persona.principal.id,
        action: 'execution.reconciliation_requested',
        subject: 'execution:' + id,
        at,
        ...(checking ? { details: { session: 'checking' } } : {}),
      });
    });
    return read(persona, id);
  }
  return { approve, approveJob, undoJob, observe, readJob, read, progress, reconcile };
}
