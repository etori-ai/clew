import { textOfAtMost } from '../bounded-body';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { Value } from 'typebox/value';
import {
  AskValuesSchema,
  OPEN_THING_INPUT_MAX,
  RecordDraftRefSchema,
  type AskValues,
  type RecordActionInput,
  type RecordDraftRef,
} from '@clew/contracts';
import { failure, InputError, privateHeaders, protectedRoute, type Env } from '../context';
import type { RecordActionUsecases } from '../modules/records/actions';

/**
 * Actions about a record (D137): what a record's page offers under its title, and starting or deciding one. The record
 * is the read in the address and the input that read was made with, as the page's address holds it: in `input` as JSON
 * on the read, in the body on a write. Each route parses, validates, calls one use case and answers what it returns. A
 * read the reader may not call, a record they cannot read and an action the record does not offer them all answer the
 * same 404 as an unknown address, so the answer never tells which.
 */
export interface RecordRouteDeps {
  actions: Pick<RecordActionUsecases, 'list' | 'start' | 'effect'> & Partial<Pick<RecordActionUsecases, 'decide'>>;
  /** The session guard; a test passes its own. */
  guard?: MiddlewareHandler<Env>;
}
/** A capability's name: `<connector id>.<verb>`, as the registry knows it. */
const CAPABILITY = /^[a-z][a-z0-9-]{0,39}\.[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const notFound = (c: Context) => c.json({ error: 'Okänd adress.' }, 404, privateHeaders);
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function capabilityOf(value: unknown) {
  if (typeof value !== 'string' || !CAPABILITY.test(value)) throw new InputError('Ogiltig förfrågan.');
  return value;
}
/** The record's input, an object no longer as JSON than an address holds (D136), or a refusal. */
function inputOf(value: unknown): Record<string, unknown> {
  if (!isObject(value) || JSON.stringify(value).length > OPEN_THING_INPUT_MAX)
    throw new InputError('Ogiltig förfrågan.');
  return value;
}
/**
 * The body of a start, a decision or an effect: `{ input, capability }`, the person's answers in `values` and, on a start
 * or a decision (`sends`), the assistant's draft it was sent from in `draft`; nothing else.
 */
async function actionInput(request: Request, sends = false): Promise<RecordActionInput> {
  const text = await textOfAtMost(request, 32_000);
  let value: unknown;
  try {
    value = text === undefined ? undefined : JSON.parse(text);
  } catch {
    value = undefined;
  }
  const allowed = sends ? ['input', 'capability', 'values', 'draft'] : ['input', 'capability', 'values'];
  if (!isObject(value) || Object.keys(value).some(k => !allowed.includes(k)))
    throw new InputError('Ogiltig förfrågan.');
  const { input, capability, values, draft } = value;
  if (values !== undefined && !Value.Check(AskValuesSchema, values)) throw new InputError('Ogiltig förfrågan.');
  if (draft !== undefined && !Value.Check(RecordDraftRefSchema, draft)) throw new InputError('Ogiltig förfrågan.');
  return {
    input: inputOf(input),
    capability: capabilityOf(capability),
    ...(values !== undefined ? { values: values as AskValues } : {}),
    ...(draft !== undefined ? { draft: draft as RecordDraftRef } : {}),
  };
}

export function recordRoutes(deps: RecordRouteDeps) {
  const { actions } = deps;
  const routes = new Hono<Env>();
  routes.use('*', deps.guard ?? protectedRoute());
  const readOf = (c: Context<Env>) => {
    const read = c.req.param('read');
    return read && CAPABILITY.test(read) ? read : undefined;
  };
  const answer = <T>(c: Context<Env>, value: T | undefined) => (value === undefined ? notFound(c) : c.json(value));
  /** The actions about the record the read draws with `input` (JSON), each with what it asks (`RecordActions`). */
  routes.get('/:read/actions', async c => {
    const read = readOf(c);
    if (!read) return notFound(c);
    let input: unknown = {};
    const raw = c.req.query('input');
    if (raw)
      try {
        input = JSON.parse(raw);
      } catch {
        throw new InputError('Ogiltig förfrågan.');
      }
    return answer(c, await actions.list(c.get('session').context, read, inputOf(input)));
  });
  /** Start one: a propose with its answers becomes its card; an execute a card for a decision on it (`{ threadId }`). */
  routes.post('/:read/actions', async c => {
    const read = readOf(c);
    if (!read) return notFound(c);
    const { input, capability, values, draft } = await actionInput(c.req.raw, true);
    return answer(c, await actions.start(c.get('session').context, read, input, capability, values, draft));
  });
  /**
   * An execute sent from the action dialog's last button (D126 item 7): its card and its human decision with the
   * person's answers, in that order; nothing of it exists before this request (`{ threadId }`).
   */
  if (actions.decide) {
    const decide = actions.decide;
    routes.post('/:read/decide', async c => {
      const read = readOf(c);
      if (!read) return notFound(c);
      const { input, capability, values, draft } = await actionInput(c.req.raw, true);
      return answer(c, await decide(c.get('session').context, read, input, capability, values, draft));
    });
  }
  /** "Det här händer" before the card exists (D112): what the action would write (`EffectPreview`); nothing is written. */
  routes.post('/:read/effect', async c => {
    const read = readOf(c);
    if (!read) return notFound(c);
    const { input, capability, values } = await actionInput(c.req.raw);
    return answer(c, await actions.effect(c.get('session').context, read, input, capability, values));
  });
  routes.onError((error, c) => failure(c, error));
  return routes;
}
