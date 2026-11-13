import { Hono, type MiddlewareHandler } from 'hono';
import { audiencedActorOf, type Registry } from '@clew/connectors';
import type { AuthenticatedContext } from '@clew/contracts';
import { failure, InputError, type Env } from '../context';
import type { PersonKeys } from '../threads/model';
import { viewWithPeople } from '../threads/usecases/keys';

/**
 * Standing actions and panel views: one capability run directly, as the person. GET answers a read, its input as JSON in
 * `input`, with how to draw it when the capability declares a view (D38), and with the people its records name by user
 * name, to their ids (D116), so a record links to `/people/<id>`. POST runs anything but an execute, which only the human
 * decision endpoint reaches. Mounted under `/api/cap` inside the API, behind its session guard and its refresh of the
 * connectors; a test passes its own guard.
 */
export interface CapabilityRouteDeps {
  registry: Pick<Registry, 'find' | 'viewFor'>;
  /** Run a capability as the person, with input validation and scope: `runCapability` in the server. */
  run(persona: AuthenticatedContext, name: string, input: unknown): Promise<unknown>;
  /** Whose a source's key is (D116): a record that names a person by user name links to them by id. Absent: nobody. */
  people?: Pick<PersonKeys, 'holders'>;
  /** The session guard of a test; inside the API its own guard stands in front. */
  guard?: MiddlewareHandler<Env>;
}
export function capabilityRoutes(deps: CapabilityRouteDeps) {
  const { registry, run, people } = deps;
  const routes = new Hono<Env>();
  if (deps.guard) routes.use('*', deps.guard);
  routes.get('/:name', async c => {
    const name = c.req.param('name');
    const found = registry.find(name);
    if (!found || found.capability.kind !== 'read') return c.json({ error: 'Okänd förmåga.' }, 404);
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
    const persona = c.get('session').context;
    const output = await run(persona, name, input);
    const view = registry.viewFor(audiencedActorOf(persona), name);
    // A record that names a person links to them by id (D116).
    return c.json({
      output,
      source: found.connector.source,
      ...(view ? { view: await viewWithPeople(people, persona, view, output) } : {}),
    });
  });
  routes.post('/:name', async c => {
    const name = c.req.param('name');
    const found = registry.find(name);
    if (!found || found.capability.kind === 'execute') return c.json({ error: 'Okänd förmåga.' }, 404);
    const text = await c.req.raw.text();
    if (text.length > 8000) throw new InputError('För stor förfrågan.');
    let input: unknown = {};
    try {
      input = text ? JSON.parse(text) : {};
    } catch {
      throw new InputError('Ogiltig förfrågan.');
    }
    return c.json({ output: await run(c.get('session').context, name, input) });
  });
  routes.onError((error, c) => failure(c, error));
  return routes;
}
