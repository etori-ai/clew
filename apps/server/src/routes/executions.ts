import { Hono, type MiddlewareHandler } from 'hono';
import Ajv from 'ajv';
import { Type, type Static } from 'typebox';
import type { Registry } from '@clew/connectors';
import { failure, InputError, type Env } from '../context';
import { textOfAtMost } from '../bounded-body';
import type { executionUsecases } from '../modules/executions/usecases';

/**
 * The human decision endpoint (D45, D47): `POST /api/executions` approves one execute capability as the person, `GET
 * /api/executions/:id` reads the decision back, and `POST /api/executions/:id/reconcile` asks its source again. Mounted
 * under `/api/executions` inside the API, behind its session guard; a test passes its own guard.
 *
 * It takes no compensation (DE-L5). An effect is undone from its own item, whose receipt the undo replaces; an undo
 * approved here would reach no item, which would keep its receipt and its Ångra, and that Ångra would then be refused as
 * other content. A body that names `compensates` is refused before anything is approved.
 */
export interface ExecutionRouteDeps {
  registry: Pick<Registry, 'allowed'>;
  executions: Pick<ReturnType<typeof executionUsecases>, 'approve' | 'read' | 'reconcile'>;
  /** The session guard of a test; inside the API its own guard stands in front. */
  guard?: MiddlewareHandler<Env>;
}
const ApprovalInput = Type.Object(
  {
    decisionId: Type.String({ minLength: 1, maxLength: 200 }),
    operation: Type.String({ minLength: 1, maxLength: 80 }),
    payload: Type.Unknown(),
    compensates: Type.Optional(Type.String({ maxLength: 100 })),
  },
  { additionalProperties: false },
);
const validate = new Ajv({ allErrors: false }).compile<Static<typeof ApprovalInput>>(ApprovalInput);
export function executionRoutes({ registry, executions, guard }: ExecutionRouteDeps) {
  const routes = new Hono<Env>();
  if (guard) routes.use('*', guard);
  routes.post('/', async c => {
    const text = await textOfAtMost(c.req.raw, 64_000);
    if (text === undefined) throw new InputError('För stor förfrågan.');
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      throw new InputError('Ogiltig förfrågan.');
    }
    if (!validate(input)) throw new InputError('Ogiltig förfrågan.');
    const persona = c.get('session').context;
    if (registry.allowed(persona, input.operation)?.capability.kind !== 'execute')
      throw new InputError('Okänd förmåga.');
    if (input.compensates) throw new InputError('Ett beslut ångras från sitt ärende.');
    return c.json(await executions.approve(persona, input), 202);
  });
  routes.get('/:id', async c => {
    const execution = await executions.read(c.get('session').context, c.req.param('id'));
    return execution ? c.json(execution) : c.json({ error: 'Åtgärden finns inte.' }, 404);
  });
  routes.post('/:id/reconcile', async c =>
    c.json(await executions.reconcile(c.get('session').context, c.req.param('id')), 202),
  );
  routes.onError((error, c) => failure(c, error));
  return routes;
}
