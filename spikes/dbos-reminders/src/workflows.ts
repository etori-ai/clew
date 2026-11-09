/**
 * Clew's `durableReminder` (apps/server/src/temporal/workflows.ts) on DBOS. Same contract as D17/D47: an absolute
 * due time, a generation that fences delayed starts and replacements, cancel until it fires, never two deliveries.
 *
 * Two variants are registered so the cancel semantics can be compared:
 *  - `durableReminder`: waits with `DBOS.recv('cancel')` until the due time. Cancel is a message, which the app can
 *    send with `dbos.send_message` inside the same transaction that marks the intent cancelled (Temporal: a signal).
 *  - `sleepReminder`: waits with `DBOS.sleep` and relies on `DBOS.cancelWorkflow` from outside, which the docs say
 *    preempts the workflow "at the beginning of its next step".
 * Both end in the same fenced step, which is where the generation decides.
 */
import { DBOS } from '@dbos-inc/dbos-sdk';
import { pool } from './db.js';

export type ReminderInput = { id: string; generation: number; dueAt: string };
export type Outcome = 'fired' | 'stale' | 'cancelled' | 'duplicate';

/** The fenced delivery: one row per attempt so duplicates are visible, one `fired_at` per intent so they are harmless. */
export const fireTimer = DBOS.registerStep(
  async (id: string, generation: number): Promise<Outcome> => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const fired = await client.query(
        `update timer_intent set fired_at = now(), fired_by = $3
           where id = $1 and generation = $2 and state = 'active' and fired_at is null`,
        [id, generation, DBOS.executorID],
      );
      let outcome: Outcome = 'fired';
      if (fired.rowCount === 0) {
        const row = await client.query<{ generation: number; state: string; fired_at: string | null }>(
          'select generation, state, fired_at from timer_intent where id = $1',
          [id],
        );
        const current = row.rows[0];
        outcome =
          !current || current.generation !== generation
            ? 'stale'
            : current.state === 'cancelled'
              ? 'cancelled'
              : 'duplicate';
      }
      await client.query('insert into timer_attempt (id, generation, executor, outcome) values ($1, $2, $3, $4)', [
        id,
        generation,
        DBOS.executorID,
        outcome,
      ]);
      await client.query('commit');
      return outcome;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  },
  { name: 'fireTimer', retriesAllowed: true, maxAttempts: 5 },
);

export const durableReminder = DBOS.registerWorkflow(
  async (input: ReminderInput): Promise<Outcome> => {
    const cancel = await DBOS.recv<string>('cancel', { deadlineEpochMS: Date.parse(input.dueAt) });
    if (cancel !== null) return 'cancelled';
    return fireTimer(input.id, input.generation);
  },
  { name: 'durableReminder', serialization: 'portable' },
);

export const sleepReminder = DBOS.registerWorkflow(
  async (input: ReminderInput): Promise<Outcome> => {
    const wait = Date.parse(input.dueAt) - (await DBOS.now());
    if (wait > 0) await DBOS.sleep(wait);
    return fireTimer(input.id, input.generation);
  },
  { name: 'sleepReminder', serialization: 'portable' },
);

/** Registering one more workflow changes the application's source hash, which is how the version experiment "deploys new code". */
if (process.env.EXTRA_WORKFLOW) {
  DBOS.registerWorkflow(async (): Promise<void> => {}, { name: 'extraWorkflowForVersionHash' });
}

export const workflowId = (id: string, generation: number) => `${id}:v2:${generation}`;
