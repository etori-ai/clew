import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { Value } from 'typebox/value';
import {
  AskValuesSchema,
  EntityNamesInputSchema,
  isEntityKind,
  type AskValues,
  type EntityActionInput,
  type EntityKind,
  type EntityNames,
} from '@clew/contracts';
import { failure, InputError, privateHeaders, protectedRoute, type Env } from '../context';
import type { EntityUsecases } from '../modules/entities/usecases';
import type { EntityActions } from '../modules/entities/actions';
import { textOfAtMost } from '../bounded-body';

/**
 * Entities (D97): a person or a unit and what the sources about it say, for the web. Four reads, each parsing the
 * address, calling one use case and answering what it returns, and the names of a list's subjects. A kind Clew does not have, a key outside the rule and a
 * source the reader may not use (or that nobody placed, for the list) all answer the same 404 as an unknown address, so
 * the answer never tells which. A person who manages nobody gets a list without groups, not a refusal: the web decides
 * what to draw. Two writes: an action from the entity's menu becomes a card (D8), and an execute sent from its dialog
 * becomes its card and its decision at once (D126 item 7); the same 404 answers an action the entity does not offer the
 * reader. Its effect (D112) is a read of what the action would write, with the same 404.
 */
export interface EntityRouteDeps {
  entities: Pick<EntityUsecases, 'list' | 'rows' | 'detail' | 'section' | 'names'>;
  /** Starting an action about an entity, deciding an execute, and what it would write; without it the routes only read. */
  actions?: Pick<EntityActions, 'start' | 'effect'> & Partial<Pick<EntityActions, 'decide'>>;
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
/** The body of a start, a decision or an effect: `{ capability }`, with the person's answers to its asks in `values` (D112), and nothing else. */
async function actionInput(request: Request): Promise<EntityActionInput> {
  const text = await textOfAtMost(request, 32_000);
  let value: unknown;
  try {
    value = text !== undefined ? JSON.parse(text) : undefined;
  } catch {
    value = undefined;
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(k => k !== 'capability' && k !== 'values')
  )
    throw new InputError('Ogiltig förfrågan.');
  const { capability, values } = value as { capability: unknown; values?: unknown };
  if (values !== undefined && !Value.Check(AskValuesSchema, values)) throw new InputError('Ogiltig förfrågan.');
  return {
    capability: capabilityOf(typeof capability === 'string' ? capability : undefined),
    ...(values !== undefined ? { values: values as AskValues } : {}),
  };
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
    // A person's key is their id (D122), which may be "rows": asked for without a source, this address opens that person.
    if (capability === undefined) return answer(c, await entities.detail(c.get('session').context, kind, 'rows'));
    return answer(c, await entities.rows(c.get('session').context, kind, capabilityOf(capability)));
  });
  routes.get('/:kind/:key', async c => {
    const kind = kindOf(c);
    if (!kind) return notFound(c);
    return answer(c, await entities.detail(c.get('session').context, kind, c.req.param('key')));
  });
  /**
   * The names of the people and units a list's rows are about, at most `ENTITY_NAMES_MAX` per request, the keys in the
   * body. A read, posted so that no key stands in an address; one the reader may not open is absent from the answer.
   */
  routes.post('/names', async c => {
    const text = await textOfAtMost(c.req.raw, 64_000);
    let value: unknown;
    try {
      value = text !== undefined ? JSON.parse(text) : undefined;
    } catch {
      value = undefined;
    }
    if (!Value.Check(EntityNamesInputSchema, value)) throw new InputError('Ogiltig förfrågan.');
    return c.json({ names: await entities.names(c.get('session').context, value.subjects) } satisfies EntityNames);
  });
  routes.get('/:kind/:key/section', async c => {
    const kind = kindOf(c);
    if (!kind) return notFound(c);
    const capability = capabilityOf(c.req.query('capability'));
    return answer(c, await entities.section(c.get('session').context, kind, c.req.param('key'), capability));
  });
  const { actions } = deps;
  if (actions) {
    routes.post('/:kind/:key/actions', async c => {
      const kind = kindOf(c);
      if (!kind) return notFound(c);
      const { capability, values } = await actionInput(c.req.raw);
      return answer(c, await actions.start(c.get('session').context, kind, c.req.param('key'), capability, values));
    });
    /**
     * An execute sent from the action dialog's last button (D126 item 7): its card and its human decision with the
     * person's answers, in that order; nothing of it exists before this request.
     */
    if (actions.decide) {
      const decide = actions.decide;
      routes.post('/:kind/:key/decide', async c => {
        const kind = kindOf(c);
        if (!kind) return notFound(c);
        const { capability, values } = await actionInput(c.req.raw);
        return answer(c, await decide(c.get('session').context, kind, c.req.param('key'), capability, values));
      });
    }
    /** "Det här händer" before the card exists (D112): what the action would write; a read, nothing is written. */
    routes.post('/:kind/:key/effect', async c => {
      const kind = kindOf(c);
      if (!kind) return notFound(c);
      const { capability, values } = await actionInput(c.req.raw);
      return answer(c, await actions.effect(c.get('session').context, kind, c.req.param('key'), capability, values));
    });
  }
  routes.onError((error, c) => failure(c, error));
  return routes;
}
