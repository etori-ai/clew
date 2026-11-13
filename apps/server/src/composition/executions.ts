import { createHash, randomUUID } from 'node:crypto';
import { audiencedActorOf, type ExecuteResult } from '@clew/connectors';
import { Value } from 'typebox/value';
import { ExecuteResultSchema } from '@clew/connectors/protocol';
import { registry } from '../connectors/registry';
import { systemContext } from '../system-context';
import { sealSecret, openSecret } from '../auth-crypto';
import { postgresExecutionStore } from '../modules/executions/adapters/postgres';
import { retainsAuthority } from '../modules/executions/domain';
import { executionUsecases } from '../modules/executions/usecases';
import {
  ExecutionError,
  type ExecutionSessions,
  type ExecutionSource,
  type WatchSource,
} from '../modules/executions/model';
import { standingSession } from '../auth';
import { clock } from './ambient';
import { ledger } from './durable';
import { reviewDocuments } from './documents';
import { projectExecution } from './execution-projection';
import { watchCardSink } from './watch-card';
import { calendarApproval, calendarSource } from './calendar';
import { personKeys } from './person-keys';
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
// Every approval starts its workflow inside the ledger's transaction (D86); there is no outbox loop behind it.
export const executionStore = postgresExecutionStore({ seal: sealSecret, open: openSecret }, ledger, {
  project: projectExecution(ledger),
  pushCard: watchCardSink(place, ledger),
});
const source: ExecutionSource = {
  async authorize(persona, operation, input) {
    if (calendarOperations.includes(operation as (typeof calendarOperations)[number])) {
      await registry.refreshGovernance();
      if (!registry.visible(persona, 'calendar')) throw new ExecutionError('Kalendern är inte tillgänglig.');
      return calendarSource.authorize(persona, operation, input);
    }
    const found = await registry.validate(audiencedActorOf(persona), operation, input);
    if (found.capability.kind !== 'execute') throw new ExecutionError('Förmågan är ingen åtgärd.');
    const safety = found.capability.execution ?? { strategy: 'manual' as const };
    if (safety.strategy !== 'manual') {
      const lookup = registry.allowed(audiencedActorOf(persona), safety.lookup);
      if (!lookup || lookup.connector.id !== found.connector.id || lookup.capability.kind !== 'read')
        throw new ExecutionError('Källans återläsning är inte tillgänglig.');
    }
    return { connector: found.connector.id, safety, needsSession: !!found.connector.delegation };
  },
  current: id => systemContext(id, 'system:execution'),
  // The persona carries a delegate only when the ledger found the person's own live session behind this execution (D26).
  async execute(persona, e) {
    if (e.connector === 'calendar' && calendarOperations.includes(e.operation as (typeof calendarOperations)[number]))
      return calendarSource.execute(persona, e);
    const result = await registry.run<ExecuteResult>(audiencedActorOf(persona), e.operation, e.payload, {
      operationId: e.id,
      authorize: () => persona.authorize(),
      delegate: persona.delegate,
    });
    if (!Value.Check(ExecuteResultSchema, result)) throw new Error('Invalid execution result');
    return result;
  },
  async lookup(persona, e) {
    if (e.connector === 'calendar' && calendarOperations.includes(e.operation as (typeof calendarOperations)[number]))
      return calendarSource.lookup(persona, e);
    if (e.safety.strategy === 'manual') throw new Error('No safe lookup');
    const found = registry.allowed(audiencedActorOf(persona), e.safety.lookup);
    if (!found || found.connector.id !== e.connector || found.capability.kind !== 'read')
      throw new Error('Lookup revoked');
    const response = await registry.run<{ found: boolean; result?: ExecuteResult }>(
      audiencedActorOf(persona),
      e.safety.lookup,
      { operationId: e.id },
      { authorize: () => persona.authorize(), delegate: persona.delegate },
    );
    if (response.found === false) return undefined;
    if (response.found !== true || !Value.Check(ExecuteResultSchema, response.result))
      throw new Error('Unverified lookup result');
    return response.result;
  },
};
/**
 * The person's own live session behind a write on a connector that acts as them (D26): `find` is the auth module's
 * reading of a kept binding; `ready` asks the session's delegate for the token of the connector's declared audience once,
 * before dispatch is recorded, so the call that follows takes it from the session's short cache.
 */
const sessions: ExecutionSessions = {
  find: standingSession,
  async ready(persona, e) {
    const audience = registry.connector(e.connector)?.delegation?.audience;
    return !!audience && !!persona.delegate && !!(await persona.delegate(audience));
  },
};
/** A watch step's read (D55): a `read` the person may call, run as the person; never an execute. */
const watch: WatchSource = {
  async authorize(persona, operation, input) {
    const found = await registry.validate(audiencedActorOf(persona), operation, input);
    if (found.capability.kind !== 'read') throw new ExecutionError('En bevakning måste vara en läsning.');
    return { connector: found.connector.id };
  },
  read: (persona, operation, input) =>
    registry.run(audiencedActorOf(persona), operation, input, { authorize: () => persona.authorize() }),
};
export const executions = executionUsecases({
  review: reviewDocuments.validate,
  store: executionStore,
  source,
  sessions,
  watch,
  clock,
  ids: randomUUID,
  digest: input =>
    createHash('sha256')
      .update(JSON.stringify(canonical(input)))
      .digest('hex'),
  // A started action is sent only while its user name still names its person (D119).
  people: personKeys,
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
