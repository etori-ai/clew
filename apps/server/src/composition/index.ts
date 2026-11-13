import {
  acceptsEmptyInput,
  answerCards,
  bundledIds,
  holdingsReader,
  internalIds,
  offAtFirstBoot,
  registry,
  runCapability,
} from '../connectors/registry';
import {
  assertionFor,
  installationAssertionFor,
  registerConnector,
  secretPurpose,
  unregisterConnector,
} from '../connectors/remote';
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
import { personKey } from '../modules/entities/domain';
import { staff } from './people';
import { postgresJobQueue, postgresPeople } from '../scheduler/adapters/postgres';
import { createScheduler } from '../scheduler/usecases';
import { signInData } from './sign-ins';
import { postgresThreadStore } from '../threads/adapters/postgres';
import { cancelDurable, moveToRunningVersion } from '../dbos/start';
import { ledger } from './durable';
import { audiencedActorOf, COMPETENCE_CONNECTOR, DIALOGUE_CONNECTOR, inAudience } from '@clew/connectors';
import { organisationInAudiences, readAudienceFacts } from '@clew/db/auth';
import { reminderUsecases } from '../threads/usecases/reminders';
import { threadUsecases } from '../threads/usecases/cards';
import { clock, ids } from './ambient';
import { calendar, events, notifier, calendarAuthority, followups, planningRound } from './calendar';
import { talksRound } from '../modules/calendar/adapters/talks-round';
import { talks } from './talks';
import { holdingsPort } from './competence';
import { dialogue } from './dialogue';
import { TALKS_CAPABILITY } from '../modules/talk-seam/capabilities';
import type { AuthenticatedContext, DayView, TalksResult } from '@clew/contracts';
import { systemContext } from '../system-context';
import { cardDecisions } from '../threads/usecases/decisions';
import { startedCards } from '../threads/usecases/started';
import { askUsecases } from '../threads/usecases/asks';
import { createHash } from 'node:crypto';
import { executions } from './executions';
import { reviewDocuments } from './documents';
import { visibleThread } from '../threads/access';
import { refresh } from './refresh';
import { personKeys } from './person-keys';
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
  // A row names a person by user name; the card keeps their id (D122).
  people: personKeys,
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
    people: personKeys,
  }),
  // A card the person starts without the model (D8, D97): a propose's draft, or an execute behind its decision.
  ...startedCards({
    store,
    registry,
    run: runCapability,
    digest: value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32),
    clock,
    ids,
    people: personKeys,
  }),
};
const meetingFailed = logPort('asks', 'warn');
/**
 * What a write's dialog draws for a meeting ask (D112): the calendar module's reads of the person's own calendar, through
 * the registry as the person (D20), so its audience, switch and scope hold. A person without the calendar, or a calendar
 * that does not answer, gets no suggestions and no day; the dialog still offers "Annan tid".
 */
export const asks = askUsecases({
  registry,
  calendar: {
    free: async (persona, input) => {
      if (!registry.allowed(audiencedActorOf(persona), 'calendar.freeTimes')) return [];
      try {
        return (
          await runCapability<{ gaps: Array<{ start: string; end: string }> }>(persona, 'calendar.freeTimes', input)
        ).gaps;
      } catch (error) {
        meetingFailed('asks: free times could not be read', error);
        return [];
      }
    },
    day: async (persona, date) => {
      if (!registry.allowed(audiencedActorOf(persona), 'calendar.day')) return undefined;
      try {
        return await runCapability<DayView>(persona, 'calendar.day', { date });
      } catch (error) {
        meetingFailed('asks: the day could not be read', error);
        return undefined;
      }
    },
  },
});
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
 * authority on the owner's version (D96: the card stays with its owner), a dated activity's `dialogue-due` to the
 * follow-up dialogue on the same terms (D118), and the person's own reminder and snooze to the reminders, which do.
 */
export async function fireTimer(id: string, generation: number) {
  const timer = await store.readTimer(id);
  if (timer?.kind === 'obligation') return followups.fire(timer.threadId, generation);
  if (timer?.kind === 'due') return talks.commitmentDue(timer.threadId, generation);
  if (timer?.kind === 'dialogue-due') return dialogue.activityDue(timer.threadId, generation);
  return reminders.fire(id, generation);
}
/**
 * The round (`talksRound`, D96 items 1-3), read as the person through the registry. The built-in round asks the
 * calendar who is booked (`samtalBookings`), which takes the period as input and never reads the round, so the two do
 * not call each other.
 */
planningRound.read = talksRound({
  answers: persona => !!registry.allowed(audiencedActorOf(persona), TALKS_CAPABILITY),
  read: persona => runCapability<TalksResult>(persona, TALKS_CAPABILITY, {}),
  failed: logPort('talks', 'error'),
});
/**
 * Clew writes its own talk records only while the built-in module answers the talks profile for this person (D96 item
 * 9): not when an administrator has switched it off, nor for someone outside its audience. The rows are read first, as
 * every API request does, so a change made on another instance counts at once.
 */
export async function talksWritable(persona: AuthenticatedContext) {
  await refreshConnectors();
  return registry.talkSource(audiencedActorOf(persona))?.builtIn === true;
}
/**
 * Clew writes competence records only while the built-in module is switched on and visible to this person (D108 item
 * 13). The rows are read first, as every API request does, so a change made on another instance counts at once.
 */
export async function competenceWritable(persona: AuthenticatedContext) {
  await refreshConnectors();
  return registry.visible(audiencedActorOf(persona), COMPETENCE_CONNECTOR);
}
/**
 * Clew writes the follow-up dialogue only while its built-in module is switched on and visible to this person (D118).
 * The rows are read first, as every API request does, so a change made on another instance counts at once.
 */
export async function dialogueWritable(persona: AuthenticatedContext) {
  await refreshConnectors();
  return registry.visible(audiencedActorOf(persona), DIALOGUE_CONNECTOR);
}
/**
 * The copy of what sources hold (D108 item 9) reads only while the module is switched on for the installation, the
 * administrator's choice on Anslutna system, read fresh as above. Filled here because the registry is built over the
 * competence module (`composition/competence.ts`).
 */
holdingsPort.switchedOn = async () => {
  await refreshConnectors();
  return registry.governance(COMPETENCE_CONNECTOR).state === 'enabled';
};
// The installation's own read of the holdings profile (D119): the enabled connectors that answer `<id>.holdings`, and
// one page of one of them, read with no person behind the call.
holdingsPort.holdingsSources = () => holdingsReader.holdingsSources();
holdingsPort.readHoldings = (connectorId, cursor, options) => holdingsReader.readHoldings(connectorId, cursor, options);
/**
 * Who a source's rows may be kept for (D23): the installation's read has no person behind it, so the audiences are
 * applied to the people its rows are about. A row is kept only for an active person with access who is inside both the
 * source connector's audience and the competence module's own, by the registry's own rule (`inAudience`) over what the
 * audience is decided on; and the sources page shows a source only to an organisation that has such a person.
 */
const copyAudiences = (connectorId: string) => [
  registry.governance(connectorId).audience,
  registry.governance(COMPETENCE_CONNECTOR).audience,
];
holdingsPort.admitted = async (connectorId, personIds) => {
  const audiences = copyAudiences(connectorId);
  const facts = await readAudienceFacts(personIds);
  return new Set(
    facts
      .filter(f => {
        const actor = { id: f.personId, name: '', unitId: f.unitId, unitLabel: '', role: f.role, groups: f.groups };
        return audiences.every(audience => inAudience(audience, actor));
      })
      .map(f => f.personId),
  );
};
holdingsPort.reaches = (connectorId, organisationId) =>
  organisationInAudiences(organisationId, copyAudiences(connectorId));
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
  // The people the asker manages (D115): Personal's list, read on every turn; only people who can be asked about (D97).
  people: async persona =>
    (await staff.reach(persona)).managed.flatMap(unit =>
      // By Clew's key, the person's id (D122), as the cards about them name them; only someone who can be asked about.
      unit.people.flatMap(p => (personKey(p) ? [{ key: p.id, name: p.name, unit: unit.unitLabel }] : [])),
    ),
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
        // The reads the manifest declares for the installation (D119) are read as Clew reads them; the administrator's
        // report counts what came back and shows none of it (D23).
        assertInstallation: installationAssertionFor(id),
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
  jobs: postgresJobQueue({ durable: ledger, move: moveToRunningVersion }),
  people: postgresPeople(),
  threads,
  calendar,
  // The nightly clean-up of sign-in machinery (D123).
  signIns: signInData,
  clock,
  log: logPort('scheduler', 'error'),
});
