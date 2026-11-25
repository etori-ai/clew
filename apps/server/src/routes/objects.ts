import { Hono, type MiddlewareHandler } from 'hono';
import Ajv from 'ajv';
import { Type, type Static } from 'typebox';
import type { AuthenticatedContext, ClewObject } from '@clew/contracts';
import { failure, InputError, type Env } from '../context';
import { textOfAtMost } from '../bounded-body';

/** `@`'s search: the words typed and the refs in view, each bounded by the route. */
const ObjectsInput = Type.Object(
  { q: Type.String(), near: Type.Array(Type.String()) },
  { additionalProperties: false },
);
type ObjectsQuery = Static<typeof ObjectsInput>;
const valid = new Ajv({ allErrors: false }).compile(ObjectsInput);
/** How long what is typed after `@` may be, and how many refs of what is in view, each of at most 200 characters. */
const LONGEST = 80,
  NEAR = 40;
const REF = /^[a-z]+:[A-Za-z0-9:_.@-]+$/;

export interface ObjectsRouteDeps {
  /** What `@` can point at for the person, in the context they look at (`listObjects`): the use case owns the scope. */
  list(persona: AuthenticatedContext, q: string, near: string[]): Promise<ClewObject[]>;
  /** The session guard of a test; inside the API its own guard stands in front. */
  guard?: MiddlewareHandler<Env>;
}
/**
 * What `@` can point at, in the box's context (`POST /api/objects`): `q` is what the person typed after `@`, `near` the
 * refs they are looking at. Both travel in the body, never in the address: what is typed after `@` is a person's name as
 * often as not, and an address lands in every access log on the way (the web review of 2026-11-23, M4). A read: it
 * writes nothing, and it runs as the session's person, never anyone the body names. Mounted under `/api/objects`
 * behind the API's session guard, which asks a POST for the session's origin and CSRF token.
 */
export function objectsRoutes(deps: ObjectsRouteDeps) {
  const routes = new Hono<Env>();
  if (deps.guard) routes.use('*', deps.guard);
  routes.post('/', async c => {
    const text = await textOfAtMost(c.req.raw, 16_000);
    if (text === undefined) throw new InputError('För stor förfrågan.');
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new InputError('Ogiltig förfrågan.');
    }
    if (!valid(value)) throw new InputError('Ogiltig förfrågan.');
    const { q, near } = value as ObjectsQuery;
    if (q.length > LONGEST) throw new InputError('För lång sökning.');
    if (near.length > NEAR || near.some(r => r.length > 200 || !REF.test(r)))
      throw new InputError('Ogiltigt sammanhang.');
    return c.json({ objects: await deps.list(c.get('session').context, q, near) });
  });
  routes.onError((error, c) => failure(c, error));
  return routes;
}
