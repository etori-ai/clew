import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { AuthenticatedContext } from '@clew/contracts';
import { postgresState } from '@clew/db/state';
import { actorOf, CapabilityError, Registry } from '@clew/connectors';
import { heromaConnector } from '@clew/connectors/mock/heroma';
import { raindanceConnector } from '@clew/connectors/mock/raindance';
import { treservaConnector } from '@clew/connectors/mock/treserva';
import { kommunikationConnector } from '@clew/connectors/mock/kommunikation';
import { InputError } from '../context';
import { calendarConnector } from '../modules/calendar/connector';
import { calendar } from '../composition/calendar';
import { peopleConnector } from '../modules/people/connector';

/**
 * The registry the BFF runs with: the bundled connectors below plus every enabled connector row
 * (`remote.ts`, D21, D23). Every REST route, card action and tool definition is derived from here. Nothing in
 * `routes/`, `threads/` or `assistant/` knows a connector by name, and connectors reach each other only through
 * the registry (D20): in-process through the `clew.call` handle, remote through `POST /api/connectors/call`.
 */
export const registry = new Registry();
for (const m of [heromaConnector(postgresState), raindanceConnector(postgresState), treservaConnector(postgresState), kommunikationConnector(postgresState), calendarConnector(calendar), peopleConnector()]) registry.register(m);
export { actorOf };

const ajv = addFormats(new Ajv({ allErrors: false, strict: false }));
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
function validateInput(name: string, schemaObject: object, input: unknown) {
  let v = validators.get(name); if (!v) { v = ajv.compile(schemaObject); validators.set(name, v); }
  if (!v(input)) throw new InputError('Ogiltig förfrågan till ' + name + '.');
}
/** Run a capability through the registry with input validation. The single path for REST, cards, tools and connector callbacks. */
export async function runCapability<O = unknown>(persona: AuthenticatedContext, name: string, input: unknown): Promise<O> {
  const found = registry.find(name);
  if (!found) throw new InputError('Okänd förmåga.');
  validateInput(name, found.capability.input as object, input ?? {});
  if (found.capability.kind === 'execute') await persona.authorize();
  try { return await registry.run<O>(actorOf(persona), name, input ?? {}); }
  catch (error) { if (error instanceof CapabilityError) throw new InputError(error.message); throw error; }
}
/** A connector's call into another connector (D20, D21): reads and proposals only, scope re-checked for the same actor, never execute. */
export async function callFromConnector<O = unknown>(persona: AuthenticatedContext, name: string, input: unknown): Promise<O> {
  const found = registry.find(name);
  if (!found) throw new InputError('Okänd förmåga.');
  if (found.capability.kind === 'execute') throw new InputError('En anslutning kan inte utföra åtgärder i en annan anslutning.');
  return runCapability<O>(persona, name, input);
}
