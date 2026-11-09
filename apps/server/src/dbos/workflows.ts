/**
 * Workflow code on DBOS Transact (D85). A workflow keeps time and order; everything with an effect is a step that
 * calls a use case from the composition root. The steps are reached through `Activities`, bound by `activities.ts`
 * at startup and by the runtime tests with their own doubles, so this file imports nothing of Clew's.
 *
 * A workflow function must be deterministic between checkpoints: the clock is `DBOS.now()`, waits are `DBOS.sleep`,
 * and a changed workflow body is a new application version (see `runtime.ts`).
 *
 * The four workflows the ledger starts from inside its transactions (D86: `scheduledJob`, `durableReminder`,
 * `approvedExecution`, `jobWatch`) are registered with portable serialization: `dbos.enqueue_workflow` writes their
 * input as plain JSON, and their names are the contract between the store adapters and this file.
 */
import { DBOS } from '@dbos-inc/dbos-sdk';

export type WatchOutcome = 'seen' | 'expired' | 'blocked' | 'waiting';
export interface ObligationStep {
  action: 'wait' | 'remind' | 'return';
  why: string;
  due: string[];
  next: string;
}
/** The use cases the workflows call between waits. */
export interface Activities {
  fireTimer(id: string, generation: number): Promise<unknown>;
  progressExecution(id: string): Promise<'done' | 'busy' | 'reconcile'>;
  observeWatch(jobId: string, stepId: string, check: number): Promise<WatchOutcome>;
  runScheduledJob(id: string): Promise<'done' | 'busy'>;
  observeMcp(id: string): Promise<number | null>;
  checkObligation(threadId: string): Promise<ObligationStep>;
  remindInvitees(threadId: string, due: string[]): Promise<unknown>;
  returnObligation(threadId: string, why: 'answered' | 'deadline'): Promise<unknown>;
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
/** One checkpointed call of a use case. Retries are the step's (Temporal's activity retry); a step that still fails ends the workflow in ERROR, where an operator resumes it. */
const step = <T>(name: keyof Activities, run: () => Promise<T>, maxAttempts = 5) =>
  DBOS.runStep(run, {
    name,
    retriesAllowed: maxAttempts > 1,
    maxAttempts,
    intervalSeconds: 1,
    backoffRate: 2,
    timeoutMS: 60_000,
  });
/** Absolute time: a delayed start never restarts the requested duration (D47). */
async function sleepUntil(at: string) {
  const wait = Date.parse(at) - (await DBOS.now());
  if (wait > 0) await DBOS.sleep(wait);
}

/** A scheduled job (D15, D47): wait for its run time, then run it once the ledger lets go of it. */
export const scheduledJob = DBOS.registerWorkflow(
  async (input: { id: string; dueAt: string }): Promise<void> => {
    await sleepUntil(input.dueAt);
    while ((await step('runScheduledJob', () => activity('runScheduledJob')(input.id), 10)) === 'busy')
      await DBOS.sleep(30_000);
  },
  { name: 'scheduledJob', serialization: 'portable' },
);

/**
 * A registered MCP read watch (D81): read, sleep the interval the use case asks for, up to a hundred times. The
 * reconciler in composition starts the next round when none is running, which bounds one workflow's step history.
 */
export const mcpWatch = DBOS.registerWorkflow(
  async (id: string): Promise<'ended' | 'rotated'> => {
    for (let check = 0; check < 100; check++) {
      let interval: number | null = 60;
      try {
        interval = await step('observeMcp', () => activity('observeMcp')(id), 3);
      } catch {
        /* A failed read is never a delivery. Try later. */
      }
      if (interval === null) return 'ended';
      await DBOS.sleep(interval * 1000);
    }
    return 'rotated';
  },
  { name: 'mcpWatch' },
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
