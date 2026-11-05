import { createHash, randomUUID } from 'node:crypto';
import { actorOf, type ExecuteResult } from '@clew/connectors';
import { Value } from '@sinclair/typebox/value';
import { ExecuteResultSchema } from '@clew/connectors/protocol';
import { registry } from '../connectors/registry';
import { systemContext } from '../system-context';
import { sealSecret, openSecret } from '../auth-crypto';
import { postgresExecutionStore } from '../modules/executions/adapters/postgres';
import { executionUsecases } from '../modules/executions/usecases';
import { ExecutionError, type ExecutionSource } from '../modules/executions/model';
import { executionDispatcher } from '../modules/executions/dispatch';
import { startExecutionWorkflow } from '../temporal/executions';
import { clock } from './ambient';
import { projectExecution } from './execution-projection';

/** Object key order is not approved business content. Arrays preserve the approved order. */
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
export const executionStore = postgresExecutionStore({ seal: sealSecret, open: openSecret }, projectExecution);
const source: ExecutionSource = {
  async authorize(persona, operation, input) {
    const found = await registry.validate(actorOf(persona), operation, input);
    if (found.capability.kind !== 'execute') throw new ExecutionError('Förmågan är ingen åtgärd.');
    const safety = found.capability.execution ?? { strategy: 'manual' as const };
    if (safety.strategy !== 'manual') {
      const lookup = registry.allowed(actorOf(persona), safety.lookup);
      if (!lookup || lookup.connector.id !== found.connector.id || lookup.capability.kind !== 'read') throw new ExecutionError('Källans återläsning är inte tillgänglig.');
    }
    return { connector: found.connector.id, safety, needsSession: !!found.connector.delegation };
  },
  current: id => systemContext(id, 'system:execution'),
  async execute(persona, e) {
    const result = await registry.run<ExecuteResult>(actorOf(persona), e.operation, e.payload, { operationId: e.id });
    if (!Value.Check(ExecuteResultSchema, result)) throw new Error('Invalid execution result');
    return result;
  },
  async lookup(persona, e) {
    if (e.safety.strategy === 'manual') throw new Error('No safe lookup');
    const found = registry.allowed(actorOf(persona), e.safety.lookup);
    if (!found || found.connector.id !== e.connector || found.capability.kind !== 'read') throw new Error('Lookup revoked');
    const response = await registry.run<{ found: boolean; result?: ExecuteResult }>(actorOf(persona), e.safety.lookup, { operationId: e.id });
    if (response.found === false) return undefined;
    if (response.found !== true || !Value.Check(ExecuteResultSchema, response.result)) throw new Error('Unverified lookup result');
    return response.result;
  },
};
export const executions = executionUsecases({ store: executionStore, source, clock, ids: randomUUID, digest: input => createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex') });
export const dispatchExecutions = executionDispatcher({ store: executionStore, start: startExecutionWorkflow, clock });
export function startExecutionDispatch() {
  let busy = false;
  const tick = async () => { if (busy) return; busy = true; try { await dispatchExecutions(); } catch { console.error('execution outbox unavailable'); } finally { busy = false; } };
  void tick(); const timer = setInterval(() => void tick(), 2000); timer.unref();
  return () => clearInterval(timer);
}
