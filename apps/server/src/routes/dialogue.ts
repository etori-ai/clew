import { Hono, type MiddlewareHandler } from 'hono';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  DialogueActivityAddBodySchema,
  DialogueActivityDoneBodySchema,
  DialogueActivityEditBodySchema,
  DialogueAssessBodySchema,
  DialogueNoteAddBodySchema,
  DialogueNoteEditBodySchema,
  ENTITY_KEY_MAX,
  type AuthenticatedContext,
  type DialogueActivityAddBody,
  type DialogueActivityDoneBody,
  type DialogueActivityEditBody,
  type DialogueAssessBody,
  type DialogueNoteAddBody,
  type DialogueNoteEditBody,
  type DialogueUnit,
} from '@clew/contracts';
import { failure, InputError, privateHeaders, protectedRoute, type Env } from '../context';
import type { DialogueUsecases } from '../modules/dialogue/usecases';

/**
 * The follow-up dialogue (D118): one unit's dialogue to read, and its writes: an assessment, an activity added, changed,
 * marked done, opened again or removed, and a manager's own note written, changed or removed (D120). Each route parses, validates, calls one use case and maps its errors; the use
 * cases own who may do what. Every route first refuses unless Clew's own module is switched on and visible to the
 * person, so nothing is read or written while an administrator has switched it off.
 */
export interface DialogueRouteDeps {
  dialogue: Pick<
    DialogueUsecases,
    | 'unit'
    | 'assess'
    | 'addActivity'
    | 'editActivity'
    | 'completeActivity'
    | 'reopenActivity'
    | 'removeActivity'
    | 'addNote'
    | 'editNote'
    | 'removeNote'
  >;
  /** Whether the built-in module answers for this person now (composition: `dialogueWritable`). */
  writable: (persona: AuthenticatedContext) => Promise<boolean>;
  /** The session guard; a test passes its own. */
  guard?: MiddlewareHandler<Env>;
}
export const NOT_WRITABLE = 'Dialogstödet är avstängt, så dialogen kan inte visas eller ändras här.';
const ajv = addFormats(new Ajv({ allErrors: false }));
const validators = {
  assess: ajv.compile<DialogueAssessBody>(DialogueAssessBodySchema),
  add: ajv.compile<DialogueActivityAddBody>(DialogueActivityAddBodySchema),
  edit: ajv.compile<DialogueActivityEditBody>(DialogueActivityEditBodySchema),
  done: ajv.compile<DialogueActivityDoneBody>(DialogueActivityDoneBodySchema),
  noteAdd: ajv.compile<DialogueNoteAddBody>(DialogueNoteAddBodySchema),
  noteEdit: ajv.compile<DialogueNoteEditBody>(DialogueNoteEditBodySchema),
};
async function body<T>(request: Request, validate: (value: unknown) => value is T, max = 12000): Promise<T> {
  const text = await request.text();
  if (text.length > max) throw new InputError('För stor förfrågan.');
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw new InputError('Ogiltig förfrågan.');
  }
  if (!validate(value)) throw new InputError('Ogiltig förfrågan.');
  return value;
}
/** A path id as the contracts take one; a unit's id is an entity key, longer than a record id. */
function param(value: string | undefined, max = 80) {
  if (!value || value.length > max) throw new InputError('Ogiltig förfrågan.');
  return value;
}
const unitParam = (value: string | undefined) => param(value, ENTITY_KEY_MAX);

export function dialogueRoutes(deps: DialogueRouteDeps) {
  const { dialogue } = deps;
  const routes = new Hono<Env>();
  routes.use('*', deps.guard ?? protectedRoute());
  routes.use('*', async (c, next) => {
    if (!(await deps.writable(c.get('session').context)))
      return c.json({ error: NOT_WRITABLE, code: 'denied' }, 403, privateHeaders);
    await next();
  });
  routes.get('/units/:unitId', async c => {
    const read = await dialogue.unit(c.get('session').context, unitParam(c.req.param('unitId')));
    const answer: DialogueUnit = { ...read, writable: true };
    return c.json(answer, 200, privateHeaders);
  });
  routes.post('/units/:unitId/assessments', async c => {
    const unitId = unitParam(c.req.param('unitId')),
      input = await body(c.req.raw, validators.assess);
    return c.json({ id: await dialogue.assess(c.get('session').context, unitId, input) }, 201);
  });
  routes.post('/units/:unitId/activities', async c => {
    const unitId = unitParam(c.req.param('unitId')),
      input = await body(c.req.raw, validators.add);
    return c.json({ id: await dialogue.addActivity(c.get('session').context, unitId, input) }, 201);
  });
  routes.patch('/activities/:id', async c => {
    const id = param(c.req.param('id')),
      input = await body(c.req.raw, validators.edit);
    await dialogue.editActivity(c.get('session').context, id, input);
    return c.body(null, 204);
  });
  routes.post('/activities/:id/done', async c => {
    const id = param(c.req.param('id')),
      input = await body(c.req.raw, validators.done);
    await dialogue.completeActivity(c.get('session').context, id, input);
    return c.body(null, 204);
  });
  routes.delete('/activities/:id/done', async c => {
    await dialogue.reopenActivity(c.get('session').context, param(c.req.param('id')));
    return c.body(null, 204);
  });
  routes.delete('/activities/:id', async c => {
    await dialogue.removeActivity(c.get('session').context, param(c.req.param('id')));
    return c.body(null, 204);
  });
  routes.post('/units/:unitId/notes', async c => {
    const unitId = unitParam(c.req.param('unitId')),
      input = await body(c.req.raw, validators.noteAdd);
    return c.json({ id: await dialogue.addNote(c.get('session').context, unitId, input) }, 201);
  });
  routes.patch('/notes/:id', async c => {
    const id = param(c.req.param('id')),
      input = await body(c.req.raw, validators.noteEdit);
    await dialogue.editNote(c.get('session').context, id, input);
    return c.body(null, 204);
  });
  routes.delete('/notes/:id', async c => {
    await dialogue.removeNote(c.get('session').context, param(c.req.param('id')));
    return c.body(null, 204);
  });
  routes.onError((error, c) => failure(c, error));
  return routes;
}
