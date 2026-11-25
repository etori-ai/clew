import type { AuthenticatedContext, Thread } from '@clew/contracts';
import {
  audiencedActorOf,
  BOARDING_CONNECTOR,
  COMPETENCE_CONNECTOR,
  Registry,
  type HoldingsReader,
  schemaCompiler,
} from '@clew/connectors';
import { capabilityRunner } from './run';
import { calendarConnector } from '../modules/calendar/connector';
import { calendar, events } from '../composition/calendar';
import { clock } from '../composition/ambient';
import { userCapabilities } from '../modules/people/capabilities';
import { staff, userReads } from '../composition/people';
import { reportCapabilities } from '../modules/entities/capabilities';
import { reportUsecases } from '../modules/entities/usecases';
import { searchConnector, type AnswerCards } from '../modules/search/connector';
import { searchUsecases } from '../modules/search/usecases';
import { ERRANDS_CAPABILITY, errandCapabilities } from '../modules/errands/capabilities';
import { errandUsecases } from '../modules/errands/usecases';
import { REQUESTS_CAPABILITY, requestCapabilities } from '../modules/requests/capabilities';
import { requestUsecases } from '../modules/requests/usecases';
import { newsCapabilities } from '../modules/news/capabilities';
import { workCapabilities } from '../modules/work/capabilities';
import { conversationCapabilities } from '../modules/conversations/capabilities';
import { toolCatalogueCapabilities } from '../modules/tool-catalogue/capabilities';
import { newsUsecases } from '../modules/news/usecases';
import { talksConnector } from '../modules/talks/capabilities';
import { talkSeamCapabilities } from '../modules/talk-seam/capabilities';
import { talkSeamUsecases } from '../modules/talk-seam/usecases';
import { talkDirectory, talkHolders, talkTakeovers, talks } from '../composition/talks';
import { competenceConnector } from '../modules/competence/capabilities';
import { competence } from '../composition/competence';
import { dialogueConnector } from '../modules/dialogue/capabilities';
import { dialogue } from '../composition/dialogue';
import { boardingConnector } from '../modules/boarding/capabilities';
import { boarding } from '../composition/boarding';
import { logger } from '../logging';
import { relations } from '../composition/relations';

/**
 * The registry the BFF runs with: the bundled connectors below plus every enabled connector row
 * (`remote.ts`, D21, D23). Every REST route, card action and tool definition is derived from here. Nothing in
 * `routes/`, `threads/` or `assistant/` knows a connector by name, and connectors reach each other only through
 * the registry (D20): in-process through the `clew.call` handle, remote through `POST /api/connectors/call`.
 * Who may be asked about (D117) is installed with it, so no call that names a person runs without the rule.
 */
export const registry = new Registry({
  onRefused: (id, topic, problem) =>
    logger.error({ scope: 'connectors', connector: id, topic, problem }, 'connector draft refused (D35)'),
  relations: relations.relate,
});
/** The composite search (D26) lists its sources from the registry at call time, so a connector enabled by an administrator is searched from the next question on. */
const search = searchUsecases({
  sources: (actor, options) => registry.searchSources(actor, options),
  clock,
  // A hit names a person by user name; the list links them by id (D122).
  people: userReads,
});
/** The card an answer becomes is the stream's use case; the composition root fills this slot once the stream is built over the registry. */
export const answerCards: AnswerCards = {};
// Clew's core only (D61): every other system, the development fixtures included, is a connector row (D21, D23).
// Users are core entities, not installed systems. Their read capabilities share dispatch only (D62). The reader's
// people as Personal lists them (`people.reports`, D141 rule 4) is the entities module's read, joined here under the
// same id, since the rule of who is on that list is that module's.
const people = userCapabilities(userReads);
const internal = [
  {
    ...people,
    capabilities: [...people.capabilities, ...reportCapabilities(reportUsecases({ directory: staff })).capabilities],
  },
];
/** The combined errand list (D35 item 4, D89) lists its case systems from the registry the same way. */
const errands = errandUsecases({ sources: (actor, options) => registry.errandSources(actor, options) });
/** The combined request list (D123), what a person ordered or reported, lists its service desks from the registry the same way. */
const requests = requestUsecases({ sources: (actor, options) => registry.requestSources(actor, options) });
/** The combined news list (D112, amended 2026-11-11) lists its news sources from the registry the same way. */
const news = newsUsecases({ sources: (actor, options) => registry.newsSources(actor, options) });
/**
 * The talks seam (D96 items 8 and 9): `clew.talks` and `clew.commitments` ask the one system that answers the talks
 * profile for the person, chosen from the registry at call time, so switching the built-in module off on Anslutna system
 * or enabling another system changes who answers from the next read on. Offered only while some system answers.
 */
const talkSeam = talkSeamUsecases({
  source: actor => registry.talkSource(actor),
  directory: talkDirectory,
  holders: talkHolders,
  takeovers: talkTakeovers,
});
/**
 * Clew's own connector is assembled here, the only file that names connectors: the composite search owns the id and the
 * question area, the errand list adds its read and its area, the request list its read and its area, the news list its
 * read, Att göra, Alla samtal and Alla verktyg one read each, the talks seam its two reads. The modules never import
 * each other (D20).
 */
const core = searchConnector(search, answerCards);
/**
 * A person's own threads, for the reads over them: their work items (`clew.work`) and their conversations
 * (`clew.conversations`). The stream owns the threads and is built over this registry, so the composition root fills
 * this slot with the stream's own read boundary, as it fills `answerCards`.
 */
export const personThreads: { list?: (actor: Parameters<Registry['visible']>[0], now: string) => Promise<Thread[]> } =
  {};
const threadsOf = async (actor: Parameters<Registry['visible']>[0], now: string) =>
  (await personThreads.list?.(actor, now)) ?? [];
const workPart = workCapabilities({ list: threadsOf, clock, forModel: id => registry.forModel(id) });
const conversationPart = conversationCapabilities({ list: threadsOf, clock });
/**
 * Clew's own lists that Alla verktyg shows whether or not an administrator placed them in the menu (D126 rule 8), as
 * the page's `toolsOf` adds them: each one the person may call.
 */
const OWN_LISTS = [ERRANDS_CAPABILITY, REQUESTS_CAPABILITY];
const toolPart = toolCatalogueCapabilities({
  menu: actor => registry.menu(actor),
  own: actor => OWN_LISTS.flatMap(name => registry.allowed(actor, name) ?? []),
});
const errandPart = errandCapabilities(errands, actor => registry.errandSources(actor).length > 0);
const requestPart = requestCapabilities(requests, actor => registry.requestSources(actor).length > 0);
const newsPart = newsCapabilities(news, actor => registry.newsSources(actor).length > 0);
const talkPart = talkSeamCapabilities(talkSeam, actor => !!registry.talkSource(actor));
const clewConnector = {
  ...core,
  areas: [...core.areas, ...errandPart.areas, ...requestPart.areas],
  capabilities: [
    ...core.capabilities,
    ...errandPart.capabilities,
    ...requestPart.capabilities,
    ...newsPart.capabilities,
    ...workPart.capabilities,
    ...conversationPart.capabilities,
    ...toolPart.capabilities,
    ...talkPart.capabilities,
  ],
};
// The built-in talks module (D96 item 9) is bundled, not internal: it gets an administrable row, enabled by default,
// and an administrator can switch it off so that another system answers the profile.
// The competence module (D108 item 13) is bundled too, and is the one bundled connector an installation switches on
// itself: its row is created disabled (`offAtFirstBoot`), so nothing of the domain shows until an administrator enables it.
// The follow-up dialogue (D118) is bundled and enabled by default, as talks is: an administrator can switch it off.
// Introduction and leaving (D124) start switched off the same way.
const bundled = [
  calendarConnector(calendar, events),
  clewConnector,
  talksConnector(talks),
  competenceConnector(competence),
  dialogueConnector(dialogue),
  boardingConnector(boarding),
];
for (const m of [...internal, ...bundled]) registry.register({ ...m, uses: ['*'] });
export const internalIds = internal.map(m => m.id);
/** The connectors that live in this process: they get a `connector` row at boot so an administrator can govern them too (D23). */
export const bundledIds = bundled.map(m => m.id);
/** The bundled connectors whose row is created disabled: an administrator switches them on (D108 item 13, D124). */
export const offAtFirstBoot: readonly string[] = [COMPETENCE_CONNECTOR, BOARDING_CONNECTOR];
export { audiencedActorOf };
/**
 * The holdings port (D108 item 9, D119) over the live registry: the sources that answer the holdings profile for the
 * installation, and one page of one of them read as the installation. For composition to hand the competence register's
 * scheduled copy; no route, card, tool or connector is given it.
 */
export const holdingsReader: HoldingsReader = {
  holdingsSources: () => registry.holdingsSources(),
  readHoldings: (connectorId, cursor, options) => registry.readHoldings(connectorId, cursor, options),
};

/**
 * Whether a capability's input schema accepts `{}`: the conformance check calls only the reads that do (the same rule as
 * `scripts/connector-check.ts`). A compiler of the call's own, as the loader's (CB-6): one kept for the module held every
 * schema it compiled, and every `$id`, so a second check of a manifest that gives a schema an `$id` was refused.
 */
export const acceptsEmptyInput = (schema: object) => {
  try {
    return !!schemaCompiler()(schema)({});
  } catch {
    return true;
  }
};
/**
 * Run a capability through the live registry with input validation (`capabilityRunner`): the path for REST, cards and
 * tools. `direct` is the person's own session asking for a read itself (`POST /api/cap`), `caller` the assistant's
 * runner and `forModel` the model's own tool call (`CapabilityRunOptions`).
 */
export const runCapability = capabilityRunner(registry);
