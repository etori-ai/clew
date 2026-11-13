import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { audiencedActorOf, UNKNOWN, type Registry } from '@clew/connectors';
import type { AuthenticatedContext } from '@clew/contracts';
import { failure, InputError, privateHeaders, type Env } from '../context';
import type { PersonKeys } from '../threads/model';
import { viewWithPeople } from '../threads/usecases/keys';

/**
 * Standing actions and panel views: one capability run directly, as the person. GET answers a read, its input as JSON in
 * `input`, with how to draw it when the capability declares a view (D38), and with the people its records name by user
 * name, to their ids (D119), so a record links to `/people/<id>`. POST runs anything but an execute, which only the human
 * decision endpoint reaches. Mounted under `/api/cap` inside the API, behind its session guard and its refresh of the
 * connectors; a test passes its own guard.
 *
 * A capability the person may not know of, its connector switched off or leaving them out of its audience, or the
 * capability switched off, answers exactly as a name nobody registered does (D23): the one 404, settled before the input
 * is read, and again for any "Okänd förmåga." raised while it runs. A capability of a connector the person can see that
 * its scope leaves out is the registry's own refusal, a 400: the person may know that it exists, as `GET
 * /api/connectors` lists it.
 */
export interface CapabilityRouteDeps {
  registry: Pick<Registry, 'findFor' | 'viewFor'>;
  /** Run a capability as the person, with input validation and scope: `runCapability` in the server. */
  run(persona: AuthenticatedContext, name: string, input: unknown): Promise<unknown>;
  /** Whose a source's key is (D119): a record that names a person by user name links to them by id. Absent: nobody. */
  people?: Pick<PersonKeys, 'holders'>;
  /**
   * The person a read runs as: with the units they follow up below their own (`withFollowedUnits`, D117), so a view
   * opened for such a unit can be answered. Whether they may know of the capability is still asked as the session's
   * person. Absent: the session's person.
   */
  follow?(persona: AuthenticatedContext): Promise<AuthenticatedContext>;
  /** The session guard of a test; inside the API its own guard stands in front. */
  guard?: MiddlewareHandler<Env>;
}
/** The answer for a capability the person does not know, whether nobody registered it or it is hidden from them. */
const unknown = (c: Context) => c.json({ error: UNKNOWN }, 404, privateHeaders);
export function capabilityRoutes(deps: CapabilityRouteDeps) {
  const { registry, run, people } = deps;
  const routes = new Hono<Env>();
  if (deps.guard) routes.use('*', deps.guard);
  routes.get('/:name', async c => {
    const name = c.req.param('name');
    const persona = c.get('session').context;
    const found = registry.findFor(audiencedActorOf(persona), name);
    if (!found || found.capability.kind !== 'read') return unknown(c);
    let input: unknown = {};
    const raw = c.req.query('input');
    if (raw) {
      try {
        input = JSON.parse(raw);
      } catch {
        throw new InputError('Ogiltig förfrågan.');
      }
    }
    // The output and, when the capability declares one, how to draw it (D38): the browser never guesses a declared view.
    // As the person with the units they follow up (D117), so a view opened for a unit below them can be answered.
    const reader = deps.follow ? await deps.follow(persona) : persona;
    const output = await run(reader, name, input);
    const view = registry.viewFor(audiencedActorOf(reader), name);
    // A record that names a person links to them by id (D119).
    return c.json({
      output,
      source: found.connector.source,
      ...(view ? { view: await viewWithPeople(people, reader, view, output) } : {}),
    });
  });
  routes.post('/:name', async c => {
    const name = c.req.param('name');
    const persona = c.get('session').context;
    const found = registry.findFor(audiencedActorOf(persona), name);
    if (!found || found.capability.kind === 'execute') return unknown(c);
    const text = await c.req.raw.text();
    if (text.length > 8000) throw new InputError('För stor förfrågan.');
    let input: unknown = {};
    try {
      input = text ? JSON.parse(text) : {};
    } catch {
      throw new InputError('Ogiltig förfrågan.');
    }
    return c.json({ output: await run(persona, name, input) });
  });
  // "Okänd förmåga." raised while the capability runs gets the same answer as an unknown name: its connector switched
  // off between the check and the call, a nested call to a capability hidden from the person, or the source's own.
  routes.onError((error, c) =>
    error instanceof InputError && error.message === UNKNOWN ? unknown(c) : failure(c, error),
  );
  return routes;
}
