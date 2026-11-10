import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { isEntityKind, type EntityKind } from '@clew/contracts';
import { failure, InputError, privateHeaders, protectedRoute, type Env } from '../context';
import type { EntityUsecases } from '../modules/entities/usecases';

/**
 * Entities (D97): a person or a unit and what the sources about it say, for the web. Four reads, each parsing the
 * address, calling one use case and answering what it returns. A kind Clew does not have, a key outside the rule and a
 * source the reader may not use (or that nobody placed, for the list) all answer the same 404 as an unknown address, so
 * the answer never tells which. A person who manages nobody gets a list without groups, not a refusal: the web decides
 * what to draw.
 */
export interface EntityRouteDeps {
  entities: Pick<EntityUsecases, 'list' | 'rows' | 'detail' | 'section'>;
  /** The session guard; a test passes its own. */
  guard?: MiddlewareHandler<Env>;
}
/** A capability's name: `<connector id>.<verb>`, as the registry knows it. */
const CAPABILITY = /^[a-z][a-z0-9-]{0,39}\.[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const notFound = (c: Context) => c.json({ error: 'Okänd adress.' }, 404, privateHeaders);
function capabilityOf(value: string | undefined) {
  if (!value || !CAPABILITY.test(value)) throw new InputError('Ogiltig förfrågan.');
  return value;
}

export function entityRoutes(deps: EntityRouteDeps) {
  const { entities } = deps;
  const routes = new Hono<Env>();
  routes.use('*', deps.guard ?? protectedRoute());
  /** The kind in the address, or undefined for one Clew does not have. */
  const kindOf = (c: Context<Env>): EntityKind | undefined => {
    const kind = c.req.param('kind');
    return kind && isEntityKind(kind) ? kind : undefined;
  };
  const answer = <T>(c: Context<Env>, value: T | undefined) => (value === undefined ? notFound(c) : c.json(value));
  routes.get('/:kind', async c => {
    const kind = kindOf(c);
    return kind ? c.json(await entities.list(c.get('session').context, kind)) : notFound(c);
  });
  routes.get('/:kind/rows', async c => {
    const kind = kindOf(c);
    if (!kind) return notFound(c);
    const capability = c.req.query('capability');
    // A person may have the user name "rows": asked for without a source, this address opens that person.
    if (capability === undefined) return answer(c, await entities.detail(c.get('session').context, kind, 'rows'));
    return answer(c, await entities.rows(c.get('session').context, kind, capabilityOf(capability)));
  });
  routes.get('/:kind/:key', async c => {
    const kind = kindOf(c);
    if (!kind) return notFound(c);
    return answer(c, await entities.detail(c.get('session').context, kind, c.req.param('key')));
  });
  routes.get('/:kind/:key/section', async c => {
    const kind = kindOf(c);
    if (!kind) return notFound(c);
    const capability = capabilityOf(c.req.query('capability'));
    return answer(c, await entities.section(c.get('session').context, kind, c.req.param('key'), capability));
  });
  routes.onError((error, c) => failure(c, error));
  return routes;
}
