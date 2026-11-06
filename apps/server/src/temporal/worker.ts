import { fileURLToPath } from 'node:url';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';
import { TASK_QUEUE, temporalAddress, temporalNamespace } from './client';

const RETRY_MS = 30_000;
let worker: Worker | undefined;

/**
 * The Temporal worker runs inside the BFF process in v1: one task queue, the workflows in `workflows.ts`, the
 * activities with database access. If Temporal is unreachable the server still serves the page (D8) and the
 * worker retries; reminders report themselves unavailable until it connects.
 */
export async function startWorker() {
  try {
    const connection = await NativeConnection.connect({ address: temporalAddress() });
    worker = await Worker.create({
      connection,
      namespace: temporalNamespace(),
      taskQueue: TASK_QUEUE,
      activities,
      workflowsPath: fileURLToPath(new URL('./workflows.ts', import.meta.url)),
    });
    console.log(`Temporal worker on ${temporalAddress()} (namespace ${temporalNamespace()}, queue ${TASK_QUEUE})`);
    worker.run().catch(error => {
      console.error('temporal worker stopped', error instanceof Error ? error.message : error);
      worker = undefined;
      setTimeout(() => void startWorker(), RETRY_MS);
    });
  } catch (error) {
    console.error(
      `temporal worker unavailable at ${temporalAddress()}, retrying in ${RETRY_MS / 1000} s:`,
      error instanceof Error ? error.message : error,
    );
    setTimeout(() => void startWorker(), RETRY_MS);
  }
}
export function stopWorker() {
  worker?.shutdown();
  worker = undefined;
}
