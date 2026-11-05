import { and, eq } from 'drizzle-orm';
import { schema, type Transaction } from '@clew/db';
import { receipt } from '@clew/connectors';
import { ExecutionError, type Execution } from '../modules/executions/model';

/** The execution, visible card and audit commit through this same physical transaction. Never source I/O here. */
export async function projectExecution(tx: Transaction, e: Execution, stage: 'approval' | 'update') {
  if (!e.presentation) return;
  const [thread] = await tx.select().from(schema.threads).where(and(eq(schema.threads.id, e.presentation.threadId), eq(schema.threads.personId, e.personId))).for('update');
  if (!thread) throw new ExecutionError('Tråden finns inte.');
  const previous = thread.execution;
  if (stage === 'approval') {
    if (thread.updatedAt.toISOString() !== e.presentation.version || thread.connector !== e.connector) throw new ExecutionError('Kortet har ändrats. Läs tillbaka det innan du bekräftar.');
    if (previous && ['pending', 'running', 'unknown'].includes(previous.state)) throw new ExecutionError('Ett tidigare beslut väntar redan på besked.');
    if (e.compensates ? previous?.id !== e.compensates : thread.state !== 'open') throw new ExecutionError('Tråden är redan hanterad.');
  } else if (previous?.id !== e.id) return;
  const execution = { id: e.id, decisionId: e.decisionId, operation: e.operation, state: e.state, reason: e.reason, compensates: e.compensates };
  const confirmed = e.state === 'succeeded';
  const terminal = ['succeeded', 'partial', 'failed'].includes(e.state);
  const result = e.result;
  await tx.update(schema.threads).set({ execution, updatedAt: new Date(e.updatedAt),
    ...(stage === 'approval' && !e.compensates ? { waitingOn: 'Väntar på källans besked' } : {}),
    ...(!e.compensates && result && e.state !== 'running' ? { receipt: receipt(result, new Date(thread.receipt?.at ?? e.updatedAt)) } : {}),
    ...(!e.compensates && terminal ? { state: 'handled' as const, handledAt: new Date(e.updatedAt), waitingOn: null } : {}),
    ...(e.compensates && confirmed ? { state: 'open' as const, handledAt: null, waitingOn: null, receipt: null } : {}),
  }).where(eq(schema.threads.id, thread.id));
  if (stage === 'approval' || terminal || e.state === 'unknown') {
    await tx.insert(schema.audit).values({ actor: stage === 'approval' ? e.principal : 'system:execution', action: stage === 'approval' ? 'thread.decision_approved' : 'thread.execution_' + e.state, subject: 'thread:' + thread.id, createdAt: new Date(e.updatedAt), details: { executionId: e.id, operation: e.operation, compensates: e.compensates } });
  }
}
