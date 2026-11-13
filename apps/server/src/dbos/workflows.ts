/**
 * Workflow code on DBOS Transact (D85). A workflow keeps time and order; everything with an effect is a step that
 * calls a use case from the composition root. The steps are reached through `Activities`, bound by `activities.ts`
 * at startup and by the runtime tests with their own doubles, so this file imports nothing of Clew's.
 *
 * A workflow function must be deterministic between checkpoints: the clock is `DBOS.now()`, waits are `DBOS.sleep`,
 * and a changed workflow body is a new application version (see `runtime.ts`).
 *
 * The five workflows the ledger starts from inside its transactions (D86: `scheduledJob`, `durableReminder`,
 * `approvedExecution`, `jobWatch`, and the competence copy `competenceCopy`) are registered with portable
 * serialization: `dbos.enqueue_workflow` writes their input as plain JSON, and their names are the contract between the
 * store adapters and this file.
 */
import { DBOS } from '@dbos-inc/dbos-sdk';

export type WatchOutcome = 'seen' | 'expired' | 'blocked' | 'waiting';
export interface ObligationStep {
  action: 'wait' | 'remind' | 'return';
  why: string;
  due: string[];
  next: string;
}
/** A source the competence copy reads (D108 item 9): its connector id and its name as a person reads it. */
export interface CopySourceRef {
  connectorId: string;
  source: string;
}
/** The use cases the workflows call between waits. */
export interface Activities {
  fireTimer(id: string, generation: number): Promise<unknown>;
  progressExecution(id: string): Promise<'done' | 'busy' | 'reconcile'>;
  observeWatch(jobId: string, stepId: string, check: number): Promise<WatchOutcome>;
  runScheduledJob(id: string): Promise<'done' | 'busy'>;
  checkObligation(threadId: string): Promise<ObligationStep>;
  remindInvitees(threadId: string, due: string[]): Promise<unknown>;
  returnObligation(threadId: string, why: 'answered' | 'deadline'): Promise<unknown>;
  scheduleCompetenceCopy(): Promise<unknown>;
  competenceSources(only: string | null): Promise<CopySourceRef[]>;
  copyHoldings(run: string, source: CopySourceRef, signal?: AbortSignal): Promise<string>;
  reconcileApprovals(): Promise<unknown>;
}
let bound: Partial<Activities> = {};
/** Composition binds the live use cases; a runtime test binds what it measures. Later bindings replace earlier ones by name. */
export function bindActivities(activities: Partial<Activities>) {
  bound = { ...bound, ...activities };
}
function activity<K extends keyof Activities>(name: K): Activities[K] {
  return ((...args: unknown[]) => {
    const fn = bound[name] as ((...a: unknown[]) => Promise<unknown>) | undefined;
    if (!fn) throw new Error(`Durable activity ${name} is not bound`);
    return fn(...args);
  }) as Activities[K];
}
/**
 * One checkpointed call of a use case. Retries are the step's; a step that still fails ends the workflow in ERROR, where
 * it stays until an operator starts it again from that step once the cause is fixed (`scripts/workflows-move.ts`):
 * `resumeWorkflow` changes nothing for a workflow that has ended. An attempt that runs past `timeoutMS` is given up and
 * retried, but the engine does not stop it: it goes on beside the retry. A step with no timeout (`null`) runs for as
 * long as its use case does, so a step that reads a whole source has none and relies on the source's own per-call
 * timeout.
 */
const step = <T>(name: keyof Activities, run: () => Promise<T>, maxAttempts = 5, timeoutMS: number | null = 60_000) =>
  DBOS.runStep(run, {
    name,
    retriesAllowed: maxAttempts > 1,
    maxAttempts,
    intervalSeconds: 1,
    backoffRate: 2,
    ...(timeoutMS === null ? {} : { timeoutMS }),
  });
/** Absolute time: a delayed start never restarts the requested duration (D47). */
async function sleepUntil(at: string) {
  const wait = Date.parse(at) - (await DBOS.now());
  if (wait > 0) await DBOS.sleep(wait);
}

/**
 * A scheduled job (D15, D47): wait for its run time, then run it once the ledger lets go of it. Its step has no timeout:
 * the run keeps its claim on the job for as long as it lasts (`scheduledJobRunner`), and an attempt given up at a
 * timeout would go on beside its retry, which would run the job a second time once the claim's lease had passed.
 */
export const scheduledJob = DBOS.registerWorkflow(
  async (input: { id: string; dueAt: string }): Promise<void> => {
    await sleepUntil(input.dueAt);
    while ((await step('runScheduledJob', () => activity('runScheduledJob')(input.id), 10, null)) === 'busy')
      await DBOS.sleep(30_000);
  },
  { name: 'scheduledJob', serialization: 'portable' },
);

/** A reminder or snooze timer (D17, D47): wait until the absolute due time, then let the ledger decide by generation. Cancel ends the wait. */
export const durableReminder = DBOS.registerWorkflow(
  async (input: { id: string; generation: number; dueAt: string }): Promise<void> => {
    await sleepUntil(input.dueAt);
    await step('fireTimer', () => activity('fireTimer')(input.id, input.generation), 10);
  },
  { name: 'durableReminder', serialization: 'portable' },
);

/** An approved execution (D45): retries re-enter the persisted ledger; a dispatched operation is always investigated before any replay. */
export const approvedExecution = DBOS.registerWorkflow(
  async (id: string): Promise<void> => {
    for (;;) {
      const state = await step('progressExecution', () => activity('progressExecution')(id));
      if (state === 'done') return;
      await DBOS.sleep(state === 'busy' ? 30_000 : 2_000);
    }
  },
  { name: 'approvedExecution', serialization: 'portable' },
);

/**
 * A job's watch step (D55 item 5, D47): wait until each committed absolute check, ask the ledger to observe it, stop
 * when the step has settled; at the window's end ask once more, which is what settles `expired` and leaves the card. The
 * policy (authority, read, expectation, expiry) lives in `observe`; the workflow only keeps time and never computes a
 * schedule of its own. A check reached late is observed late, never repeated, and the window is never extended.
 */
export const jobWatch = DBOS.registerWorkflow(
  async (input: {
    jobId: string;
    stepId: string;
    generation: number;
    checks: string[];
    expiresAt: string;
  }): Promise<WatchOutcome> => {
    for (let check = 0; check < input.checks.length; check++) {
      await sleepUntil(input.checks[check]!);
      const state = await step('observeWatch', () => activity('observeWatch')(input.jobId, input.stepId, check));
      if (state !== 'waiting') return state;
    }
    await sleepUntil(input.expiresAt);
    for (;;) {
      // The ledger's own clock decides that the window has ended; a worker a few seconds behind asks again shortly.
      const state = await step('observeWatch', () =>
        activity('observeWatch')(input.jobId, input.stepId, input.checks.length),
      );
      if (state !== 'waiting') return state;
      await DBOS.sleep(10_000);
    }
  },
  { name: 'jobWatch', serialization: 'portable' },
);

/**
 * The competence module's copy of what sources hold (D108 item 9): wait until the run's time, list the sources that
 * answer the holdings profile (none while the module is off), then read each in a step of its own. A daily run first
 * asks for the next day's; if that step fails after its retries the read goes on, and the server's hourly guard asks
 * for the next day's run again (`startCompetenceCopy`), so the chain does not end with one failure. A source that does
 * not answer is recorded by the use case and read again at the next run, never retried here: the step's own retries
 * cover the database, and a source whose step still fails is left for the next run while the others are read. Two runs
 * never read one source at once, because the use case holds a lease on it; the engine's recovery of a run after a
 * restart re-enters the same step, and the same run may take its own lease again. A daily run also reconciles the cards
 * of the registrations that wait for approval (D108 item 7) with who can decide each now, before it reads: whether there
 * are sources or not, and a failure of either never keeps the other from running. Started from inside a transaction
 * (D86) by the store, so it is registered with portable serialization and its name is the contract with the store.
 */
export const competenceCopy = DBOS.registerWorkflow(
  async (input: { run: string; dueAt: string; connectorId?: string; daily?: true }): Promise<void> => {
    await sleepUntil(input.dueAt);
    if (input.daily) {
      try {
        await step('scheduleCompetenceCopy', () => activity('scheduleCompetenceCopy')(), 3);
      } catch {
        // Recorded as the step's error; the hourly guard asks for the next day's run again.
      }
      // No step timeout, as for a read: each registration is a transaction of its own, and a second attempt beside a
      // slow first would only find less to do.
      try {
        await step('reconcileApprovals', () => activity('reconcileApprovals')(), 3, null);
      } catch {
        // Recorded as the step's error; the next day's run reconciles again, and the copy goes on.
      }
    }
    const sources = await step('competenceSources', () => activity('competenceSources')(input.connectorId ?? null));
    // No step timeout: a timed-out attempt would run on beside the next. Each page has the read's own deadline, and
    // cancelling the workflow aborts the page under way through the step's signal, so a read always ends.
    for (const source of sources)
      try {
        await step(
          'copyHoldings',
          () => activity('copyHoldings')(input.run, source, DBOS.stepStatus?.cancelSignal),
          3,
          null,
        );
      } catch {
        // One source's failure is that source's: its lease lapses, the next run reads it, and the others are read now.
      }
  },
  { name: 'competenceCopy', serialization: 'portable' },
);

/**
 * The follow-ups of an obligation (D30): look at the replies at every office hour, remind whoever is overdue, and
 * return the thread to the manager on the Friday review or when every reply is in. The policy lives in the use cases;
 * the workflow only keeps time. Undo cancels the workflow, which ends the wait.
 */
export const obligation = DBOS.registerWorkflow(
  async (input: { threadId: string; personId: string }): Promise<'answered' | 'deadline'> => {
    for (;;) {
      const next = await step('checkObligation', () => activity('checkObligation')(input.threadId));
      if (next.action === 'return') {
        const why = next.why === 'deadline' ? 'deadline' : 'answered';
        await step('returnObligation', () => activity('returnObligation')(input.threadId, why));
        return why;
      }
      if (next.action === 'remind')
        await step('remindInvitees', () => activity('remindInvitees')(input.threadId, next.due));
      await DBOS.sleep(Math.max(60_000, Date.parse(next.next) - (await DBOS.now())));
    }
  },
  { name: 'obligation' },
);
