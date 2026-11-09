import type { Receipt, Thread } from '@clew/contracts';

/** A partial or uncertain answer is not a completed flow. Skipped rows were never submitted. */
export const receiptComplete = (receipt: Receipt | null | undefined): boolean =>
  !!receipt &&
  receipt.rows.some(row => row.outcome === 'done') &&
  receipt.rows.every(row => row.outcome === 'done' || row.outcome === 'skipped');

/** Match the durable execution boundary; an unresolved original cannot be compensated. */
export const canUndoReceipt = (thread: Thread, now = Date.now()): boolean =>
  !!thread.receipt?.undoCapability &&
  !!thread.receipt.undoUntil &&
  Date.parse(thread.receipt.undoUntil) > now &&
  (!thread.execution || (!thread.execution.compensates && ['succeeded', 'partial'].includes(thread.execution.state))) &&
  thread.receipt.rows.some(row => row.outcome === 'done') &&
  !thread.receipt.rows.some(row => row.outcome === 'unknown');
