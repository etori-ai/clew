import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { AuthenticatedContext } from '@clew/contracts';
import { postgresState } from '@clew/db/state';
import { actorOf, CapabilityError, Registry } from '@clew/connectors';
import { hrConnector } from '@clew/connectors/mock/hr';
import { financeConnector } from '@clew/connectors/mock/finance';
import { incidentsConnector } from '@clew/connectors/mock/incidents';
import { kommunikationConnector } from '@clew/connectors/mock/kommunikation';
import { InputError } from '../context';
import { calendarConnector } from '../modules/calendar/connector';
import { calendar, events } from '../composition/calendar';
import { clock } from '../composition/ambient';
import { peopleConnector } from '../modules/people/connector';
import { searchConnector, type AnswerCards } from '../modules/search/connector';
import { searchUsecases } from '../modules/search/usecases';

/**
 * The registry the BFF runs with: the bundled connectors below plus every enabled connector row
 * (`remote.ts`, D21, D23). Every REST route, card action and tool definition is derived from here. Nothing in
 * `routes/`, `threads/` or `assistant/` knows a connector by name, and connectors reach each other only through
 * the registry (D20): in-process through the `clew.call` handle, remote through `POST /api/connectors/call`.
 */
export const registry = new Registry({ onRefused: (id, topic, problem) => console.error(`connector ${id}: draft ${topic} refused (D35): ${problem}`) });
/** The composite search (D26) lists its sources from the registry at call time, so a connector enabled by an administrator is searched from the next question on. */
const search = searchUsecases({ sources: actor => registry.searchSources(actor), clock });
/** The card an answer becomes is the stream's use case; the composition root fills this slot once the stream is built over the registry. */
export const answerCards: AnswerCards = {};
const bundled = [hrConnector(postgresState), financeConnector(postgresState), incidentsConnector(postgresState), kommunikationConnector(postgresState), calendarConnector(calendar, events), peopleConnector(), searchConnector(search, answerCards)];
for (const m of bundled) registry.register({ ...m, uses: ['*'] });
/** The connectors that live in this process: they get a `connector` row at boot so an administrator can govern them too (D23). */
export const bundledIds = bundled.map(m => m.id);
export { actorOf };

const ajv = addFormats(new Ajv({ allErrors: false, strict: false }));
/** Whether a capability's input schema accepts `{}`: the conformance check calls only the reads that do (the same rule as `scripts/connector-check.ts`). */
export const acceptsEmptyInput = (schema: object) => { try { return !!ajv.compile(schema)({}); } catch { return true; } };
/** Run a capability through the registry with input validation. The single path for REST, cards, tools and connector callbacks. */
export async function runCapability<O = unknown>(persona: AuthenticatedContext, name: string, input: unknown): Promise<O> {
  const found = registry.find(name);
  if (!found) throw new InputError('Okänd förmåga.');
  await persona.authorize();
  try {
    const result = await registry.run<O>(actorOf(persona), name, input ?? {}, persona.delegate ? { delegate: persona.delegate } : {});
    await persona.authorize();
    return result;
  }
  catch (error) { if (error instanceof CapabilityError) throw new InputError(error.message); throw error; }
}
/** A connector's call into another connector (D20, D21): reads and proposals only, scope re-checked for the same actor, never execute. */
export async function callFromConnector<O = unknown>(persona: AuthenticatedContext, name: string, input: unknown): Promise<O> {
  const found = registry.find(name);
  if (!found) throw new InputError('Okänd förmåga.');
  if (found.capability.kind === 'execute') throw new InputError('En anslutning kan inte utföra åtgärder i en annan anslutning.');
  return runCapability<O>(persona, name, input);
}
