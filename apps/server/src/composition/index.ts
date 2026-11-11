import {
  acceptsEmptyInput,
  answerCards,
  bundledIds,
  internalIds,
  offAtFirstBoot,
  registry,
  runCapability,
} from '../connectors/registry';
import { assertionFor, registerConnector, secretPurpose, unregisterConnector } from '../connectors/remote';
import { postgresConnectorStore, postgresUnits, postgresGroups } from '../connectors/adapters/postgres';
import { connectorUsecases } from '../connectors/usecases/admin';
import type { LiveRegistration, Secrets } from '../connectors/model';
import type { ReconcileDeps as ConnectorReconcileDeps } from '../connectors/reconcile';
import { applyAllRows } from '../connectors/reconcile';
import { openSecret, sealSecret } from '../auth-crypto';
import { fetchManifest } from '@clew/connectors/remote';
import { checkConnector } from '@clew/connectors/check';
import { SignJWT } from 'jose';
import { openAICompatibleWire } from '../assistant/adapters/openai-compatible';
import { postgresModelStore } from '../assistant/adapters/postgres';
import { memoryModelHealth } from '../assistant/adapters/memory';
import { modelUsecases } from '../assistant/usecases/models';
import type { KeySealer } from '../assistant/ports';
import { assistantUsecases } from '../assistant';
import { postgresJobQueue, postgresPeople } from '../scheduler/adapters/postgres';
import { createScheduler } from '../scheduler/usecases';
import { postgresThreadStore } from '../threads/adapters/postgres';
import { cancelDurable } from '../dbos/start';
import { ledger } from './durable';
import { actorOf, COMPETENCE_CONNECTOR } from '@clew/connectors';
import { reminderUsecases } from '../threads/usecases/reminders';
import { threadUsecases } from '../threads/usecases/cards';
import { clock, ids } from './ambient';
import { calendar, events, notifier, calendarAuthority, followups, planningRound } from './calendar';
import { talks } from './talks';
import { TALKS_CAPABILITY } from '../modules/talk-seam/capabilities';
import type { AuthenticatedContext, TalksResult } from '@clew/contracts';
import { systemContext } from '../system-context';
import { cardDecisions } from '../threads/usecases/decisions';
import { startedCards } from '../threads/usecases/started';
import { createHash } from 'node:crypto';
import { executions } from './executions';
import { reviewDocuments } from './documents';
import { visibleThread } from '../threads/access';
import { refresh } from './refresh';
import { postgresAttention } from '../threads/adapters/attention-postgres';
import { logPort } from '../logging';
import { currentTraceId, telemetry } from '../telemetry';
export { refresh } from './refresh';

/**
 * The composition root (D25): the one place that pairs use cases with their live adapters. Routes, the scheduler and
 * the assistant import the built use cases from here; nothing below this folder chooses an adapter, reads the clock
 * or draws an id on its own. The tests build the same use cases over the memory adapters. The calendar is wired in
 * `calendar.ts`, before the registry, because the registry's calendar connector is built over it.
 */
// The store starts every timer's workflow inside its own transaction and cancels an ended wait after the commit (D86).
const store = postgresThreadStore({ durable: ledger, cancel: cancelDurable });
export { calendar, events };
const threadCore = threadUsecases({
  store,
  registry,
  run: runCapability,
  clock,
  ids,
  calendar: {
    ensureProposalThread: calendar.ensureProposalThread,
    replan: calendar.replan,
    dismiss: calendar.dismiss,
    todayEvents: persona =>
      calendar
        .readToday(persona)
        .then(v => v.events.filter(e => !e.allDay).map(e => ({ title: e.title, end: e.end })))
        .catch(() => []),
  },
});
const attentionStore = postgresAttention();
export const threads = {
  ...threadCore,
  ensureThreads: refresh.request,
  attentionFor: async (p: Parameters<typeof threadCore.attentionFor>[0]) => ({
    ...(await threadCore.attentionFor(p)),
    ...(await attentionStore.day(p.id, clock().toISOString())),
  }),
  ...cardDecisions({
    read: threadCore.threadFor,
    registry,
    run: runCapability,
    approve: executions.approve,
    clock,
    documentPreview: reviewDocuments.preview,
  }),
  // A card the person starts without the model (D8, D97): a propose's draft, or an execute behind its decision.
  ...startedCards({
    store,
    registry,
    run: runCapability,
    digest: value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32),
    clock,
    ids,
  }),
};
export const attention = {
  pending: async (p: Parameters<typeof threadCore.threadFor>[0]) => {
    const visible = (await threads.listThreadsFor(p))
      .filter(t => t.state === 'open' && !t.waitingOn && !t.snoozedUntil)
      .map(t => t.id);
    return (await attentionStore.pending(p.id, clock().toISOString())).filter(d => visible.includes(d.threadId));
  },
  claim: async (p: Parameters<typeof threadCore.threadFor>[0], id: string) => {
    await p.authorize();
    const visible = (await threads.listThreadsFor(p))
      .filter(t => t.state === 'open' && !t.waitingOn && !t.snoozedUntil)
      .map(t => t.id);
    return attentionStore.claim(p.id, id, visible, clock().toISOString());
  },
  release: (batch: string) => attentionStore.release(batch, clock().toISOString()),
};
export const reminders = reminderUsecases({
  store,
  clock,
  authorized: async timer => {
    const persona = await systemContext(timer.personId, 'system:reminder');
    if (!persona || persona.unitId !== timer.unitId || persona.authorizationVersion !== timer.authorizationVersion)
      return false;
    await refreshConnectors();
    const thread = await store.readThread(persona.id, timer.threadId);
    return !!thread && visibleThread(registry, persona, thread);
  },
});
calendarAuthority.current = async id => {
  await refreshConnectors();
  const p = await systemContext(id, 'system:obligation');
  return p && registry.visible(p, 'calendar') ? p : undefined;
};
/**
 * A fired timer goes to the module that owns its kind (D47, D85): the obligation to the calendar's follow-ups (D30), an
 * action point's `due` to the talks module, which brings the card back while the action point is open and checks no
 * authority on the owner's version (D96: the card stays with its owner), and the person's own reminder and snooze to
 * the reminders, which do.
 */
export async function fireTimer(id: string, generation: number) {
  const timer = await store.readTimer(id);
  if (timer?.kind === 'obligation') return followups.fire(timer.threadId, generation);
  if (timer?.kind === 'due') return talks.commitmentDue(timer.threadId, generation);
  return reminders.fire(id, generation);
}
const roundFailed = logPort('talks', 'error');
/**
 * The round the planner works towards (D96 items 1-3) is the one `clew.talks` answers for the person, from whichever
 * system answers the talks profile, read as the person through the registry: its dates, and the people whose talk the
 * source records as held. No round, no system that answers for this person, or a read that fails: no round, and the
 * planner plans nothing rather than fail the stream. The built-in round asks the calendar who is booked
 * (`samtalBookings`), which takes the period as input and never reads the round, so the two do not call each other.
 */
planningRound.read = async persona => {
  if (!registry.allowed(actorOf(persona), TALKS_CAPABILITY)) return null;
  try {
    const result = await runCapability<TalksResult>(persona, TALKS_CAPABILITY, {});
    if (!result.round) return null;
    const { label, opensOn, dueOn } = result.round;
    return { label, opensOn, dueOn, held: result.rows.filter(r => r.state === 'held').map(r => r.personId) };
  } catch (error) {
    roundFailed('talks: the planning round could not be read', error);
    return null;
  }
};
/**
 * Clew writes its own talk records only while the built-in module answers the talks profile for this person (D96 item
 * 9): not when an administrator has switched it off, nor for someone outside its audience. The rows are read first, as
 * every API request does, so a change made on another instance counts at once.
 */
export async function talksWritable(persona: AuthenticatedContext) {
  await refreshConnectors();
  return registry.talkSource(actorOf(persona))?.builtIn === true;
}
/**
 * Clew writes competence records only while the built-in module is switched on and visible to this person (D107 item
 * 13). The rows are read first, as every API request does, so a change made on another instance counts at once.
 */
export async function competenceWritable(persona: AuthenticatedContext) {
  await refreshConnectors();
  return registry.visible(actorOf(persona), COMPETENCE_CONNECTOR);
}
// A cited answer becomes a card (D26) through the search connector's propose; the stream owns the card, so the slot is filled here.
answerCards.create = async (actorId, input) => {
  const persona = await systemContext(actorId, 'system:answer-card');
  if (!persona) throw new Error('Person no longer authorized.');
  return threads.cardFromAnswer(persona, input);
};
// The obligation's follow-up cards (D30) land in the invitee's stream like any pushed card.
notifier.push = (personId, draft) =>
  threads.pushDraft({ id: personId }, { ...draft, connector: 'calendar' }, 'assistant:obligation');
/**
 * The models behind the box (D24): providers and models in Postgres, keys sealed with the master key under
 * `provider:key:<id>`, the OpenAI-compatible wire, and which endpoints answer kept in this process (it is in-process by
 * nature, so the memory adapter is the live one). No environment variable names a model.
 */
const modelSealer: KeySealer = {
  seal: (value, id) => sealSecret(value, 'provider:key:' + id),
  open: (sealed, id) => openSecret(sealed, 'provider:key:' + id),
};
const modelHealth = memoryModelHealth();
export const models = modelUsecases({
  store: postgresModelStore(),
  sealer: modelSealer,
  wire: openAICompatibleWire(fetch, { recordModelContent: telemetry.recordModelContent }),
  health: modelHealth,
  clock,
});
export const assistant = assistantUsecases({
  store,
  registry,
  run: runCapability,
  calendar,
  models: { resolve: models.resolve, health: modelHealth },
  clock,
  ids,
  log: logPort('assistant', 'error'),
  trace: currentTraceId,
});
/** The models' health probe (D8), started by main.ts beside the server: once at boot, then every minute. */
export const startAssistantProbe = (intervalMs = 60_000) => {
  const probeFailed = logPort('models', 'error');
  const tick = () => void models.probe().catch(error => probeFailed('models: probe failed', error));
  tick();
  setInterval(tick, intervalMs).unref?.();
};
/** Connector administration (D23): sealing with the master key, the live registry's remote side, and the conformance check with a real signer. */
const connectorSecrets: Secrets = {
  seal: (value, id) => sealSecret(value, secretPurpose(id)),
  open: (sealed, id) => openSecret(sealed, secretPurpose(id)),
};
const connectorLive: LiveRegistration = {
  register: (source, manifest) => registerConnector(registry, source, manifest),
  unregister: id => unregisterConnector(registry, id),
};
const sign = (secret: string, audience: string) => (actor: { id: string }) =>
  new SignJWT({ actor })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('clew')
    .setAudience(audience)
    .setSubject(actor.id)
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(new TextEncoder().encode(secret));
const connectorStore = postgresConnectorStore();
export const connectorAdmin = connectorUsecases({
  internal: internalIds,
  store: connectorStore,
  registry,
  secrets: connectorSecrets,
  live: connectorLive,
  units: postgresUnits(),
  groups: postgresGroups(),
  clock,
  transport: {
    fetchManifest: (url, id) => fetchManifest(url, id),
    check: async ({ url, id, secret }) => {
      const manifest = await fetchManifest(url, id);
      return checkConnector({
        url,
        id,
        key: secret,
        assert: assertionFor(id, manifest.uses),
        assertForeign: sign('wrong-secret-wrong-secret-' + id, id),
        acceptsEmptyInput,
      });
    },
  },
});
export const connectorReconcile: ConnectorReconcileDeps = {
  registry,
  store: connectorStore,
  secrets: connectorSecrets,
  live: connectorLive,
  bundled: bundledIds,
  internal: internalIds,
  offAtFirstBoot,
  clock,
  log: logPort('connectors'),
};
// Refresh from the authoritative rows, including across server instances, before releasing protected data.
export const refreshConnectors = () => applyAllRows(connectorReconcile);
registry.setRefresh(refreshConnectors);
export const scheduler = createScheduler({
  jobs: postgresJobQueue(ledger),
  people: postgresPeople(),
  threads,
  calendar,
  clock,
  log: logPort('scheduler', 'error'),
});
