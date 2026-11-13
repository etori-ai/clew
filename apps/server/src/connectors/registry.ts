import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { AuthenticatedContext } from '@clew/contracts';
import {
  actorOf,
  CapabilityError,
  COMPETENCE_CONNECTOR,
  Registry,
  type HoldingsReader,
  type RunCaller,
} from '@clew/connectors';
import { InputError } from '../context';
import { calendarConnector } from '../modules/calendar/connector';
import { calendar, events } from '../composition/calendar';
import { clock } from '../composition/ambient';
import { userCapabilities } from '../modules/people/capabilities';
import { userReads } from '../composition/people';
import { searchConnector, type AnswerCards } from '../modules/search/connector';
import { searchUsecases } from '../modules/search/usecases';
import { errandCapabilities } from '../modules/errands/capabilities';
import { errandUsecases } from '../modules/errands/usecases';
import { requestCapabilities } from '../modules/requests/capabilities';
import { requestUsecases } from '../modules/requests/usecases';
import { newsCapabilities } from '../modules/news/capabilities';
import { newsUsecases } from '../modules/news/usecases';
import { talksConnector } from '../modules/talks/capabilities';
import { talkSeamCapabilities } from '../modules/talk-seam/capabilities';
import { talkSeamUsecases } from '../modules/talk-seam/usecases';
import { talkDirectory, talks } from '../composition/talks';
import { competenceConnector } from '../modules/competence/capabilities';
import { competence } from '../composition/competence';
import { dialogueConnector } from '../modules/dialogue/capabilities';
import { dialogue } from '../composition/dialogue';
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
const search = searchUsecases({ sources: actor => registry.searchSources(actor), clock });
/** The card an answer becomes is the stream's use case; the composition root fills this slot once the stream is built over the registry. */
export const answerCards: AnswerCards = {};
// Clew's core only (D61): every other system, the development fixtures included, is a connector row (D21, D23).
// Users are core entities, not installed systems. Their read capabilities share dispatch only (D62).
const internal = [userCapabilities(userReads)];
/** The combined errand list (D35 item 4, D89) lists its case systems from the registry the same way. */
const errands = errandUsecases({ sources: actor => registry.errandSources(actor) });
/** The combined request list (D123), what a person ordered or reported, lists its service desks from the registry the same way. */
const requests = requestUsecases({ sources: actor => registry.requestSources(actor) });
/** The combined news list (D112, amended 2026-11-11) lists its news sources from the registry the same way. */
const news = newsUsecases({ sources: actor => registry.newsSources(actor) });
/**
 * The talks seam (D96 items 8 and 9): `clew.talks` and `clew.commitments` ask the one system that answers the talks
 * profile for the person, chosen from the registry at call time, so switching the built-in module off on Anslutna system
 * or enabling another system changes who answers from the next read on. Offered only while some system answers.
 */
const talkSeam = talkSeamUsecases({ source: actor => registry.talkSource(actor), directory: talkDirectory });
/**
 * Clew's own connector is assembled here, the only file that names connectors: the composite search owns the id and the
 * question area, the errand list adds its read and its area, the request list its read and its area, the news list its
 * read, the talks seam its two reads. The modules never import each other (D20).
 */
const core = searchConnector(search, answerCards);
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
    ...talkPart.capabilities,
  ],
};
// The built-in talks module (D96 item 9) is bundled, not internal: it gets an administrable row, enabled by default,
// and an administrator can switch it off so that another system answers the profile.
// The competence module (D108 item 13) is bundled too, and is the one bundled connector an installation switches on
// itself: its row is created disabled (`offAtFirstBoot`), so nothing of the domain shows until an administrator enables it.
// The follow-up dialogue (D118) is bundled and enabled by default, as talks is: an administrator can switch it off.
const bundled = [
  calendarConnector(calendar, events),
  clewConnector,
  talksConnector(talks),
  competenceConnector(competence),
  dialogueConnector(dialogue),
];
for (const m of [...internal, ...bundled]) registry.register({ ...m, uses: ['*'] });
export const internalIds = internal.map(m => m.id);
/** The connectors that live in this process: they get a `connector` row at boot so an administrator can govern them too (D23). */
export const bundledIds = bundled.map(m => m.id);
/** The bundled connectors whose row is created disabled: an administrator switches them on (D108 item 13). */
export const offAtFirstBoot: readonly string[] = [COMPETENCE_CONNECTOR];
export { actorOf };
/**
 * The holdings port (D108 item 9, D119) over the live registry: the sources that answer the holdings profile for the
 * installation, and one page of one of them read as the installation. For composition to hand the competence register's
 * scheduled copy; no route, card, tool or connector is given it.
 */
export const holdingsReader: HoldingsReader = {
  holdingsSources: () => registry.holdingsSources(),
  readHoldings: (connectorId, cursor, options) => registry.readHoldings(connectorId, cursor, options),
};

const ajv = addFormats(new Ajv({ allErrors: false, strict: false }));
/** Whether a capability's input schema accepts `{}`: the conformance check calls only the reads that do (the same rule as `scripts/connector-check.ts`). */
export const acceptsEmptyInput = (schema: object) => {
  try {
    return !!ajv.compile(schema)({});
  } catch {
    return true;
  }
};
/**
 * Run a capability through the registry with input validation. The single path for REST, cards, tools and connector
 * callbacks. `direct` is for the one caller that is the person's own session asking for a read itself (`GET /api/cap`):
 * only there is a relation the person holds by grant resolved (D121, `RunContext.direct`). `caller` is for the
 * assistant's runner, which reads in a conversation turn for the person (D122 item 6, `RunContext.caller`).
 */
export async function runCapability<O = unknown>(
  persona: AuthenticatedContext,
  name: string,
  input: unknown,
  options: { direct?: boolean; caller?: RunCaller } = {},
): Promise<O> {
  const found = registry.find(name);
  if (!found) throw new InputError('Okänd förmåga.');
  await persona.authorize();
  try {
    const result = await registry.run<O>(actorOf(persona), name, input ?? {}, {
      ...(persona.delegate ? { delegate: persona.delegate } : {}),
      ...(options.direct ? { direct: true } : {}),
      ...(options.caller ? { caller: options.caller } : {}),
    });
    await persona.authorize();
    return result;
  } catch (error) {
    if (error instanceof CapabilityError) throw new InputError(error.message);
    throw error;
  }
}
/** A connector's call into another connector (D20, D21): reads and proposals only, scope re-checked for the same actor, never execute. */
export async function callFromConnector<O = unknown>(
  persona: AuthenticatedContext,
  name: string,
  input: unknown,
): Promise<O> {
  const found = registry.find(name);
  if (!found) throw new InputError('Okänd förmåga.');
  if (found.capability.kind === 'execute')
    throw new InputError('En anslutning kan inte utföra åtgärder i en annan anslutning.');
  return runCapability<O>(persona, name, input);
}
