import { Hono, type MiddlewareHandler } from 'hono';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  CompetenceHoldingBodySchema,
  CompetenceMappingBodySchema,
  CompetenceTypeBodySchema,
  CompetenceTypePatchSchema,
  type AuthenticatedContext,
  type CompetenceHoldingBody,
  type CompetenceMappingBody,
  type CompetenceTypeBody,
  type CompetenceTypePatch,
} from '@clew/contracts';
import { failure, InputError, privateHeaders, protectedRoute, type Env } from '../context';
import type { CompetenceUsecases } from '../modules/competence/usecases';

/**
 * The competence module's own routes (D108): the catalogue an administrator keeps, the sources whose holdings are
 * copied in and their mappings to the catalogue (item 9), and a manager's registration of a certificate. A person's
 * holdings and what needs attention have no route here: Clew reads `competence.holdings` and `competence.attention`
 * through the capability route. Each route parses, validates, calls one use case and maps its errors; the use cases
 * own who may do what. Every route first refuses unless the built-in module is switched on and visible to the person,
 * so nothing of the domain is read or written while an administrator has it off.
 */
export interface CompetenceRouteDeps {
  competence: Pick<
    CompetenceUsecases,
    | 'types'
    | 'addType'
    | 'updateType'
    | 'archiveType'
    | 'validityImpact'
    | 'registerHolding'
    | 'revokeHolding'
    | 'sources'
    | 'mapSourceType'
    | 'readNow'
  >;
  /** Whether the built-in module is on for this person now (composition: `competenceWritable`). */
  writable: (persona: AuthenticatedContext) => Promise<boolean>;
  /** The session guard; a test passes its own. */
  guard?: MiddlewareHandler<Env>;
}
export const NOT_ENABLED = 'Kompetens är inte påslaget i den här installationen.';
const ajv = addFormats(new Ajv({ allErrors: false }));
const validators = {
  type: ajv.compile<CompetenceTypeBody>(CompetenceTypeBodySchema),
  patch: ajv.compile<CompetenceTypePatch>(CompetenceTypePatchSchema),
  holding: ajv.compile<CompetenceHoldingBody>(CompetenceHoldingBodySchema),
  mapping: ajv.compile<CompetenceMappingBody>(CompetenceMappingBodySchema),
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
/** A connector's id in the path, as the connector table holds one. */
function connector(value: string | undefined) {
  if (!value || value.length > 80 || !/^[a-z][a-z0-9-]*$/.test(value)) throw new InputError('Ogiltig förfrågan.');
  return value;
}
/** `?months=`: a whole number of months from 1 to 600, or `none` for no rule. */
function months(value: string | undefined): number | null {
  if (value === 'none') return null;
  const n = Number(value);
  if (!value || !/^\d{1,3}$/.test(value) || n < 1 || n > 600) throw new InputError('Ogiltig förfrågan.');
  return n;
}

export function competenceRoutes(deps: CompetenceRouteDeps) {
  const { competence } = deps;
  const routes = new Hono<Env>();
  routes.use('*', deps.guard ?? protectedRoute());
  routes.use('*', async (c, next) => {
    if (!(await deps.writable(c.get('session').context)))
      return c.json({ error: NOT_ENABLED, code: 'denied' }, 403, privateHeaders);
    await next();
  });
  routes.get('/types', async c => c.json(await competence.types(c.get('session').context), 200, privateHeaders));
  routes.post('/types', async c => {
    const input = await body(c.req.raw, validators.type);
    return c.json({ id: await competence.addType(c.get('session').context, input) }, 201);
  });
  routes.get('/types/:id/validity', async c =>
    c.json(
      await competence.validityImpact(
        c.get('session').context,
        param(c.req.param('id')),
        months(c.req.query('months')),
      ),
      200,
      privateHeaders,
    ),
  );
  routes.patch('/types/:id', async c => {
    const id = param(c.req.param('id')),
      input = await body(c.req.raw, validators.patch);
    await competence.updateType(c.get('session').context, id, input);
    return c.body(null, 204);
  });
  routes.post('/types/:id/archive', async c => {
    await competence.archiveType(c.get('session').context, param(c.req.param('id')));
    return c.body(null, 204);
  });
  routes.post('/people/:personId/holdings', async c => {
    const personId = param(c.req.param('personId')),
      input = await body(c.req.raw, validators.holding);
    return c.json({ id: await competence.registerHolding(c.get('session').context, personId, input) }, 201);
  });
  routes.delete('/holdings/:id', async c => {
    await competence.revokeHolding(c.get('session').context, param(c.req.param('id')));
    return c.body(null, 204);
  });
  // The sources whose holdings are copied in (D108 item 9): what each holds and its mappings, and a read started now.
  routes.get('/sources', async c => c.json(await competence.sources(c.get('session').context), 200, privateHeaders));
  routes.put('/sources/:connectorId/mapping', async c => {
    const connectorId = connector(c.req.param('connectorId')),
      input = await body(c.req.raw, validators.mapping);
    return c.json(await competence.mapSourceType(c.get('session').context, connectorId, input), 200);
  });
  routes.post('/sources/:connectorId/read', async c => {
    await competence.readNow(c.get('session').context, connector(c.req.param('connectorId')));
    return c.body(null, 202);
  });
  routes.onError((error, c) => failure(c, error));
  return routes;
}
