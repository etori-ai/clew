import { Hono, type Context, type MiddlewareHandler } from 'hono';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  BOARDING_CONDITIONS,
  BOARDING_EVENTS,
  BOARDING_IMPORT_ROWS_MAX,
  BOARDING_ITEM_KINDS,
  BOARDING_LAYER_NAME_MAX,
  BOARDING_OFFSET_MAX,
  BOARDING_OWNER_ROLES,
  BOARDING_TIED_TO_MAX,
  BOARDING_TITLE_MAX,
  BOARDING_VALUE_MAX,
  BoardingImportBodySchema,
  BoardingItemAddBodySchema,
  BoardingStartBodySchema,
  type AuthenticatedContext,
  type BoardingImportBody,
  type BoardingItemAddBody,
  type BoardingStartBody,
} from '@clew/contracts';
import { failure, ForbiddenError, InputError, privateHeaders, protectedRoute, type Env } from '../context';
import type { BoardingUsecases } from '../modules/boarding/usecases';

/**
 * The boarding module's own routes (D124): a manager's plans and a person's plans, the preview and the start of a plan,
 * an item added, ticked off or opened again, a plan closed, the suggestions, and the layers an administrator imports.
 * The reads a declared view is enough for (`boarding.person`, `boarding.plan`) are capabilities too; the plan's page
 * reads here, since a person ticks items on it. Each route parses, validates, calls one use case and maps its errors;
 * the use cases own who may do what. Every route first refuses unless the built-in module is switched on and visible to
 * the person, so nothing of the domain is read or written while an administrator has it off.
 */
export interface BoardingRouteDeps {
  boarding: Pick<
    BoardingUsecases,
    | 'plans'
    | 'suggestions'
    | 'personPlans'
    | 'plan'
    | 'preview'
    | 'startPlan'
    | 'addItem'
    | 'closePlan'
    | 'setDone'
    | 'setNotDone'
    | 'layers'
    | 'importLayers'
  >;
  /** Whether the built-in module is on for this person now (composition: `boardingWritable`). */
  writable: (persona: AuthenticatedContext) => Promise<boolean>;
  /** The session guard; a test passes its own. */
  guard?: MiddlewareHandler<Env>;
}
export const NOT_ENABLED = 'Introduktion och avslut är inte påslaget i den här installationen.';
const ajv = addFormats(new Ajv({ allErrors: false }));
const validators = {
  start: ajv.compile<BoardingStartBody>(BoardingStartBodySchema),
  item: ajv.compile<BoardingItemAddBody>(BoardingItemAddBodySchema),
  import: ajv.compile<BoardingImportBody>(BoardingImportBodySchema),
};
const longest = (values: readonly string[]) => values.reduce((a, b) => (b.length > a.length ? b : a), '');
/**
 * The longest row an import may carry, as JSON: every field at its longest, each text field's characters counted twice
 * (a quote or a backslash is escaped, a character outside the first plane is two code units), and the comma after it.
 */
const IMPORT_ROW_MAX =
  JSON.stringify({
    row: BOARDING_IMPORT_ROWS_MAX + 1,
    layer: '',
    event: longest(BOARDING_EVENTS),
    condition: longest(BOARDING_CONDITIONS),
    value: '',
    title: '',
    kind: longest(BOARDING_ITEM_KINDS),
    owner: longest(BOARDING_OWNER_ROLES),
    offsetDays: -BOARDING_OFFSET_MAX,
    tiedTo: '',
  }).length +
  1 +
  2 * (BOARDING_LAYER_NAME_MAX + BOARDING_VALUE_MAX + BOARDING_TITLE_MAX + BOARDING_TIED_TO_MAX);
/**
 * The longest import request: a whole file (`BOARDING_IMPORT_ROWS_MAX` rows, sent at once) at the longest each row may
 * be, with a tenth more for white space a client may add, so every file the page accepts is a body the route reads. It
 * is computed from the limits, so the two cannot drift apart. The contract and the row rule bound every field again.
 */
export const IMPORT_BODY_MAX = Math.ceil((BOARDING_IMPORT_ROWS_MAX * IMPORT_ROW_MAX + 64) * 1.1);
/** A character of a body is at most three bytes in UTF-8. */
const BYTES_PER_CHARACTER = 3;
const TOO_LARGE = 'För stor förfrågan.';
/** The body's text, never more of it than `bound` bytes: a declared length above it is refused before anything is read. */
async function boundedText(request: Request, bound: number): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d{1,15}$/.test(declared) || Number(declared) > bound)) throw new InputError(TOO_LARGE);
  if (!request.body) return '';
  const reader = request.body.getReader();
  const pieces: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > bound) {
      await reader.cancel().catch(() => undefined);
      throw new InputError(TOO_LARGE);
    }
    pieces.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const piece of pieces) {
    bytes.set(piece, at);
    at += piece.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
/** A JSON body of at most `max` characters, checked against its contract. */
async function body<T>(request: Request, validate: (value: unknown) => value is T, max = 2000): Promise<T> {
  const text = await boundedText(request, max * BYTES_PER_CHARACTER);
  if (text.length > max) throw new InputError(TOO_LARGE);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InputError('Ogiltig förfrågan.');
  }
  if (!validate(value)) throw new InputError('Ogiltig förfrågan.');
  return value;
}
/** The layers' routes are the administrator's alone: anyone else is refused before a body is read. The use case checks again. */
const adminOnly: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.get('session').context.capabilities.includes('admin.boarding')) throw new ForbiddenError();
  await next();
};
/** A path id as the contracts take one: 1 to 80 characters. */
function param(value: string | undefined) {
  if (!value || value.length > 80) throw new InputError('Ogiltig förfrågan.');
  return value;
}

export function boardingRoutes(deps: BoardingRouteDeps) {
  const { boarding } = deps;
  const routes = new Hono<Env>();
  routes.use('*', deps.guard ?? protectedRoute());
  routes.use('*', async (c, next) => {
    if (!(await deps.writable(c.get('session').context)))
      return c.json({ error: NOT_ENABLED, code: 'denied' }, 403, privateHeaders);
    await next();
  });
  const persona = (c: Context<Env>) => c.get('session').context;
  routes.get('/plans', async c => c.json(await boarding.plans(persona(c)), 200, privateHeaders));
  routes.get('/suggestions', async c => c.json({ rows: await boarding.suggestions(persona(c)) }, 200, privateHeaders));
  routes.get('/people/:personId', async c =>
    c.json(await boarding.personPlans(persona(c), param(c.req.param('personId'))), 200, privateHeaders),
  );
  routes.get('/plans/:id', async c =>
    c.json(await boarding.plan(persona(c), param(c.req.param('id'))), 200, privateHeaders),
  );
  routes.post('/preview', async c =>
    c.json(await boarding.preview(persona(c), await body(c.req.raw, validators.start)), 200, privateHeaders),
  );
  routes.post('/plans', async c =>
    c.json(await boarding.startPlan(persona(c), await body(c.req.raw, validators.start)), 201, privateHeaders),
  );
  routes.post('/plans/:id/items', async c => {
    const id = param(c.req.param('id')),
      input = await body(c.req.raw, validators.item);
    return c.json(await boarding.addItem(persona(c), id, input), 201, privateHeaders);
  });
  routes.post('/plans/:id/close', async c => {
    await boarding.closePlan(persona(c), param(c.req.param('id')));
    return c.body(null, 204);
  });
  routes.post('/items/:id/done', async c => {
    await boarding.setDone(persona(c), param(c.req.param('id')));
    return c.body(null, 204);
  });
  routes.delete('/items/:id/done', async c => {
    await boarding.setNotDone(persona(c), param(c.req.param('id')));
    return c.body(null, 204);
  });
  routes.get('/layers', adminOnly, async c => c.json(await boarding.layers(persona(c)), 200, privateHeaders));
  routes.post('/layers/import', adminOnly, async c =>
    c.json(
      await boarding.importLayers(persona(c), await body(c.req.raw, validators.import, IMPORT_BODY_MAX)),
      200,
      privateHeaders,
    ),
  );
  routes.onError((error, c) => failure(c, error));
  return routes;
}
