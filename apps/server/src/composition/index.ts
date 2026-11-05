import { answerCards, bundledIds, registry, runCapability } from '../connectors/registry';
import { assertionFor, registerConnector, secretPurpose, unregisterConnector } from '../connectors/remote';
import { postgresConnectorStore, postgresUnits } from '../connectors/adapters/postgres';
import { connectorUsecases } from '../connectors/usecases/admin';
import type { LiveRegistration, Secrets } from '../connectors/model';
import type { ReconcileDeps as ConnectorReconcileDeps } from '../connectors/reconcile';
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
import { postgresMockResetStore } from '../modules/mocks/adapters/postgres';
import { mockUsecases } from '../modules/mocks/usecases';
import { postgresJobQueue, postgresPeople } from '../scheduler/adapters/postgres';
import { createScheduler } from '../scheduler/usecases';
import { postgresThreadStore } from '../threads/adapters/postgres';
import { temporalTimers } from '../threads/adapters/temporal';
import { reminderUsecases } from '../threads/usecases/reminders';
import { threadUsecases } from '../threads/usecases/cards';
import { clock, ids } from './ambient';
import { calendar, events, notifier } from './calendar';

/**
 * The composition root (D25): the one place that pairs use cases with their live adapters. Routes, the scheduler and
 * the assistant import the built use cases from here; nothing below this folder chooses an adapter, reads the clock
 * or draws an id on its own. The tests build the same use cases over the memory adapters. The calendar is wired in
 * `calendar.ts`, before the registry, because the registry's calendar connector is built over it.
 */
const store = postgresThreadStore();
export { calendar, events };
const timers = temporalTimers();
export const threads = threadUsecases({ store, registry, run: runCapability, timers, clock, ids, calendar: { ensureProposalThread: calendar.ensureProposalThread, replan: calendar.replan, dismiss: calendar.dismiss,
  todayEvents: persona => calendar.readToday(persona).then(v => v.events.filter(e => !e.allDay).map(e => ({ title: e.title, end: e.end }))).catch(() => []) } });
export const reminders = reminderUsecases({ store, timers, clock });
// A cited answer becomes a card (D26) through the search connector's propose; the stream owns the card, so the slot is filled here.
answerCards.create = (actorId, input) => threads.cardFromAnswer({ id: actorId }, input);
// The obligation's follow-up cards (D30) land in the invitee's stream like any pushed card.
notifier.push = (personId, draft) => threads.pushDraft({ id: personId }, { ...draft, connector: 'calendar' }, 'assistant:obligation');
export const mocks = mockUsecases({ store: postgresMockResetStore(), registry, clock, enabled: process.env.CLEW_POC === 'true' });
/**
 * The models behind the box (D24): providers and models in Postgres, keys sealed with the master key under
 * `provider:key:<id>`, the OpenAI-compatible wire, and which endpoints answer kept in this process (it is in-process by
 * nature, so the memory adapter is the live one). No environment variable names a model.
 */
const modelSealer: KeySealer = { seal: (value, id) => sealSecret(value, 'provider:key:' + id), open: (sealed, id) => openSecret(sealed, 'provider:key:' + id) };
const modelHealth = memoryModelHealth();
export const models = modelUsecases({ store: postgresModelStore(), sealer: modelSealer, wire: openAICompatibleWire(), health: modelHealth, clock });
export const assistant = assistantUsecases({ store, registry, run: runCapability, calendar, models: { resolve: models.resolve, health: modelHealth }, clock, ids, log: console.error });
/** The models' health probe (D8), started by main.ts beside the server: once at boot, then every minute. */
export const startAssistantProbe = (intervalMs = 60_000) => {
  const tick = () => void models.probe().catch(error => console.error('models: probe failed:', error instanceof Error ? error.message : error));
  tick();
  setInterval(tick, intervalMs).unref?.();
};
/** Connector administration (D23): sealing with the master key, the live registry's remote side, and the conformance check with a real signer. */
const connectorSecrets: Secrets = { seal: (value, id) => sealSecret(value, secretPurpose(id)), open: (sealed, id) => openSecret(sealed, secretPurpose(id)) };
const connectorLive: LiveRegistration = { register: (source, manifest) => registerConnector(registry, source, manifest), unregister: id => unregisterConnector(registry, id) };
const sign = (secret: string, audience: string) => (actor: { id: string }) => new SignJWT({ actor }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer('clew').setAudience(audience).setSubject(actor.id).setIssuedAt().setExpirationTime('2m').sign(new TextEncoder().encode(secret));
const connectorStore = postgresConnectorStore();
export const connectorAdmin = connectorUsecases({ store: connectorStore, registry, secrets: connectorSecrets, live: connectorLive, units: postgresUnits(), clock,
  transport: { fetchManifest: (url, id) => fetchManifest(url, id), check: ({ url, id, secret }) => checkConnector({ url, id, assert: assertionFor(id, secret), assertForeign: sign('wrong-secret-wrong-secret-' + id, id) }) } });
export const connectorReconcile: ConnectorReconcileDeps = { registry, store: connectorStore, secrets: connectorSecrets, live: connectorLive, bundled: bundledIds, clock, log: console.log };
export const scheduler = createScheduler({ jobs: postgresJobQueue(), people: postgresPeople(), threads, calendar, clock, log: console.error });
