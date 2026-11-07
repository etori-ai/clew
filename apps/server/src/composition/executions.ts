import { createHash, randomUUID } from 'node:crypto';
import { actorOf, type ExecuteResult } from '@clew/connectors';
import { Value } from '@sinclair/typebox/value';
import { ExecuteResultSchema } from '@clew/connectors/protocol';
import { registry } from '../connectors/registry';
import { systemContext } from '../system-context';
import { sealSecret, openSecret } from '../auth-crypto';
import { postgresExecutionStore } from '../modules/executions/adapters/postgres';
import { retainsAuthority } from '../modules/executions/domain';
import { executionUsecases } from '../modules/executions/usecases';
import { ExecutionError, type ExecutionSource, type WatchSource } from '../modules/executions/model';
import { executionDispatcher, watchDispatcher } from '../modules/executions/dispatch';
import { startExecutionWorkflow, startWatchWorkflow } from '../temporal/executions';
import { clock } from './ambient';
import { projectExecution } from './execution-projection';
import { watchCardSink } from './watch-card';
import { calendarApproval, calendarSource } from './calendar';
import { calendarOperations, type CalendarCommand } from '../modules/calendar/usecases/decisions';

/** Object key order is not approved business content. Arrays preserve the approved order. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
// An expired watch's card is filed under its system's label and first area (D55 item 5); the registry is read at settlement, as `pushDraft` reads it for a scan's card.
const place = (connector: string) => {
  const c = registry.connector(connector);
  return { source: c?.source ?? connector, area: c?.areas[0]?.id ?? connector };
};
export const executionStore = postgresExecutionStore(
  { seal: sealSecret, open: openSecret },
  { project: projectExecution, pushCard: watchCardSink(place) },
);
const source: ExecutionSource = {
  async authorize(persona, operation, input) {
    if (calendarOperations.includes(operation as (typeof calendarOperations)[number])) {
      await registry.refreshGovernance();
      if (!registry.visible(persona, 'calendar')) throw new ExecutionError('Kalendern är inte tillgänglig.');
      return calendarSource.authorize(persona, operation, input);
    }
    const found = await registry.validate(actorOf(persona), operation, input);
    if (found.capability.kind !== 'execute') throw new ExecutionError('Förmågan är ingen åtgärd.');
    const safety = found.capability.execution ?? { strategy: 'manual' as const };
    if (safety.strategy !== 'manual') {
      const lookup = registry.allowed(actorOf(persona), safety.lookup);
      if (!lookup || lookup.connector.id !== found.connector.id || lookup.capability.kind !== 'read')
        throw new ExecutionError('Källans återläsning är inte tillgänglig.');
    }
    return { connector: found.connector.id, safety, needsSession: !!found.connector.delegation };
  },
  current: id => systemContext(id, 'system:execution'),
  async execute(persona, e) {
    if (e.connector === 'calendar' && calendarOperations.includes(e.operation as (typeof calendarOperations)[number]))
      return calendarSource.execute(persona, e);
    const result = await registry.run<ExecuteResult>(actorOf(persona), e.operation, e.payload, { operationId: e.id });
    if (!Value.Check(ExecuteResultSchema, result)) throw new Error('Invalid execution result');
    return result;
  },
  async lookup(persona, e) {
    if (e.connector === 'calendar' && calendarOperations.includes(e.operation as (typeof calendarOperations)[number]))
      return calendarSource.lookup(persona, e);
    if (e.safety.strategy === 'manual') throw new Error('No safe lookup');
    const found = registry.allowed(actorOf(persona), e.safety.lookup);
    if (!found || found.connector.id !== e.connector || found.capability.kind !== 'read')
      throw new Error('Lookup revoked');
    const response = await registry.run<{ found: boolean; result?: ExecuteResult }>(actorOf(persona), e.safety.lookup, {
      operationId: e.id,
    });
    if (response.found === false) return undefined;
    if (response.found !== true || !Value.Check(ExecuteResultSchema, response.result))
      throw new Error('Unverified lookup result');
    return response.result;
  },
};
/** A watch step's read (D55): a `read` the person may call, run as the person; never an execute. */
const watch: WatchSource = {
  async authorize(persona, operation, input) {
    const found = await registry.validate(actorOf(persona), operation, input);
    if (found.capability.kind !== 'read') throw new ExecutionError('En bevakning måste vara en läsning.');
    return { connector: found.connector.id };
  },
  read: (persona, operation, input) => registry.run(actorOf(persona), operation, input),
};
export const executions = executionUsecases({
  store: executionStore,
  source,
  watch,
  clock,
  ids: randomUUID,
  digest: input =>
    createHash('sha256')
      .update(JSON.stringify(canonical(input)))
      .digest('hex'),
});
calendarApproval.approve = executions.approve;
calendarApproval.previous = async (p, id) => {
  const e = await executionStore.readDecision(p.id, id);
  if (!e) return undefined;
  if (!retainsAuthority(p, e)) throw new ExecutionError('Åtgärden finns inte.');
  await p.authorize();
  await source.authorize(p, e.operation, e.payload);
  return { operation: e.operation, payload: e.payload as CalendarCommand };
};
export const dispatchExecutions = executionDispatcher({ store: executionStore, start: startExecutionWorkflow, clock });
/** A job's watch steps (D55) reach their `jobWatch` workflows through the same kind of outbox, on the same tick. */
export const dispatchWatches = watchDispatcher({ store: executionStore, start: startWatchWorkflow, clock });
export function startExecutionDispatch() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await dispatchExecutions();
      await dispatchWatches();
    } catch {
      console.error('execution outbox unavailable');
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 2000);
  timer.unref();
  return () => clearInterval(timer);
}
