import {
  acceptsEmptyInput,
  answerCards,
  bundledIds,
  internalIds,
  registry,
  runCapability,
} from '../connectors/registry';
import { assertionFor, registerConnector, secretPurpose, unregisterConnector } from '../connectors/remote';
import { postgresConnectorStore, postgresUnits } from '../connectors/adapters/postgres';
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
import { postgresTimerDelivery } from '../threads/adapters/timer-postgres';
import { timerDispatcher } from '../threads/usecases/timer-dispatch';
import { deliverTimer } from '../temporal/timers';
import { actorOf } from '@clew/connectors';
import { reminderUsecases } from '../threads/usecases/reminders';
import { threadUsecases } from '../threads/usecases/cards';
import { clock, ids } from './ambient';
import { calendar, events, notifier, calendarAuthority, followups } from './calendar';
import { systemContext } from '../system-context';
import { cardDecisions } from '../threads/usecases/decisions';
import { executions } from './executions';
import { reviewDocuments } from './documents';
import { visibleThread } from '../threads/access';
import type { ReminderInput } from '../threads/model';
import { refresh } from './refresh';
import { postgresAttention } from '../threads/adapters/attention-postgres';
export { refresh } from './refresh';

/**
 * The composition root (D25): the one place that pairs use cases with their live adapters. Routes, the scheduler and
 * the assistant import the built use cases from here; nothing below this folder chooses an adapter, reads the clock
 * or draws an id on its own. The tests build the same use cases over the memory adapters. The calendar is wired in
 * `calendar.ts`, before the registry, because the registry's calendar connector is built over it.
 */
const store = postgresThreadStore();
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
const dispatchTimers = timerDispatcher({ store: postgresTimerDelivery(), deliver: deliverTimer, clock });
calendarAuthority.current = async id => {
  await refreshConnectors();
  const p = await systemContext(id, 'system:obligation');
  return p && registry.visible(p, 'calendar') ? p : undefined;
};
export async function fireTimer(id: string, generation: number) {
  const timer = await store.readTimer(id);
  if (timer?.kind === 'obligation') return followups.fire(timer.threadId, generation);
  return reminders.fire(id, generation);
}
export async function fireLegacyReminder(input: ReminderInput) {
  const persona = await systemContext(input.personId, 'system:reminder');
  await refreshConnectors();
  const t = persona && (await store.readThread(persona.id, input.threadId));
  if (!persona || !t || !visibleThread(registry, persona, t)) return 'skipped';
  return reminders.surface(input);
}
export function startTimerDispatch() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await dispatchTimers();
    } catch {
      console.error('timer outbox unavailable');
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 2000);
  timer.unref();
  return () => clearInterval(timer);
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
  wire: openAICompatibleWire(),
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
  log: console.error,
});
/** The models' health probe (D8), started by main.ts beside the server: once at boot, then every minute. */
export const startAssistantProbe = (intervalMs = 60_000) => {
  const tick = () =>
    void models
      .probe()
      .catch(error => console.error('models: probe failed:', error instanceof Error ? error.message : error));
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
  clock,
  log: console.log,
};
// Refresh from the authoritative rows, including across server instances, before releasing protected data.
export const refreshConnectors = () => applyAllRows(connectorReconcile);
registry.setRefresh(refreshConnectors);
export const scheduler = createScheduler({
  jobs: postgresJobQueue(),
  people: postgresPeople(),
  threads,
  calendar,
  clock,
  log: console.error,
});
