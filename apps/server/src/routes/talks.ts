import { Hono, type MiddlewareHandler } from 'hono';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  CommitmentAddBodySchema,
  TalkHeldBodySchema,
  type AuthenticatedContext,
  type CommitmentAddBody,
  type TalkHeldBody,
} from '@clew/contracts';
import { failure, InputError, privateHeaders, protectedRoute, type Env } from '../context';
import type { TalkUsecases } from '../modules/talks/usecases';

/**
 * The talks module's writes (D96 items 2 and 4): mark a talk held or undo it, add an action point, mark one done or
 * open again. Reads have no route here: Clew's pages read `clew.talks` and `clew.commitments` through the capability
 * route, whichever system answers. Each route parses, validates, calls one use case and maps its errors; the use cases
 * own who may do what. Every route first refuses unless Clew's own module answers the talks profile for this person,
 * so Clew never writes its own records while an administrator has switched it off or another system holds them.
 */
export interface TalkRouteDeps {
  talks: Pick<TalkUsecases, 'markHeld' | 'unmarkHeld' | 'addCommitment' | 'completeCommitment' | 'reopenCommitment'>;
  /** Whether the built-in module answers the talks profile for this person now (composition: `talksWritable`). */
  writable: (persona: AuthenticatedContext) => Promise<boolean>;
  /** The session guard; a test passes its own. */
  guard?: MiddlewareHandler<Env>;
}
export const NOT_WRITABLE = 'Utvecklingssamtalen hålls i ett annat system, så de kan inte ändras här.';
const ajv = addFormats(new Ajv({ allErrors: false }));
const validators = {
  held: ajv.compile<TalkHeldBody>(TalkHeldBodySchema),
  commitment: ajv.compile<CommitmentAddBody>(CommitmentAddBodySchema),
};
async function body<T>(request: Request, validate: (value: unknown) => value is T, max = 2000): Promise<T> {
  const text = await request.text();
  if (text.length > max) throw new InputError('För stor förfrågan.');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InputError('Ogiltig förfrågan.');
  }
  if (!validate(value)) throw new InputError('Ogiltig förfrågan.');
  return value;
}
/** A path id as the contracts take one: 1 to 80 characters. */
function param(value: string | undefined) {
  if (!value || value.length > 80) throw new InputError('Ogiltig förfrågan.');
  return value;
}

export function talkRoutes(deps: TalkRouteDeps) {
  const { talks } = deps;
  const routes = new Hono<Env>();
  routes.use('*', deps.guard ?? protectedRoute());
  routes.use('*', async (c, next) => {
    if (!(await deps.writable(c.get('session').context)))
      return c.json({ error: NOT_WRITABLE, code: 'denied' }, 403, privateHeaders);
    await next();
  });
  routes.post('/commitments/:id/done', async c => {
    await talks.completeCommitment(c.get('session').context, param(c.req.param('id')));
    return c.body(null, 204);
  });
  routes.delete('/commitments/:id/done', async c => {
    await talks.reopenCommitment(c.get('session').context, param(c.req.param('id')));
    return c.body(null, 204);
  });
  routes.post('/:personId/held', async c => {
    const personId = param(c.req.param('personId')),
      input = await body(c.req.raw, validators.held);
    return c.json(await talks.markHeld(c.get('session').context, personId, input));
  });
  routes.delete('/:personId/held', async c => {
    await talks.unmarkHeld(c.get('session').context, param(c.req.param('personId')));
    return c.body(null, 204);
  });
  routes.post('/:personId/commitments', async c => {
    const personId = param(c.req.param('personId')),
      input = await body(c.req.raw, validators.commitment);
    return c.json({ id: await talks.addCommitment(c.get('session').context, personId, input) }, 201);
  });
  routes.onError((error, c) => failure(c, error));
  return routes;
}
