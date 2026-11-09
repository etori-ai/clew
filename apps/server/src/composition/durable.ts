import type { DurableQueue } from '@clew/db/durable';
import { DEFAULT_APPLICATION, ledgerQueue } from '../dbos/runtime';

/**
 * The one place that names the engine's application and queue for the stores (D86): every Postgres adapter that
 * starts a workflow inside a transaction gets this object, and `main.ts` launches the engine under the same name, so
 * what the ledger enqueues is what the runner dequeues. A test passes its own engine's name instead.
 */
export const ledger: DurableQueue = { application: DEFAULT_APPLICATION, queue: ledgerQueue(DEFAULT_APPLICATION) };
