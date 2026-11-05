import { actorOf } from '@clew/connectors';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ActInput, AskInput, AvailabilityInput, CancelEventInput, ConfirmInput, ConversationInput, CreateEventInput, ModelChoiceInput, MoveProposalInput, ReplanInput, ReplyInput, RescheduleEventInput, SnoozeInput } from '@clew/contracts';
import type { ModelChoiceInput as ModelChoiceInputType } from '@clew/contracts';
import type { AvailabilityInput as AvailabilityInputType, CancelEventInput as CancelEventInputType, CreateEventInput as CreateEventInputType, MoveProposalInput as MoveProposalInputType, RescheduleEventInput as RescheduleEventInputType } from '@clew/contracts';
import type { ConversationEvent, ConversationInput as ConversationInputType } from '@clew/contracts';
import { CalendarError } from '@clew/calendar/model';
import { TurnStopped } from '../assistant';
import type { ActInput as ActInputType } from '@clew/contracts';
import { InputError, protectedRoute, type Env } from '../context';
import { readFigures } from '../modules/figures/domain';
import { verbsFor } from '../assistant/verbs';
import { registry, runCapability } from '../connectors/registry';
import { assistant, calendar, events, mocks, models, reminders, threads, refreshConnectors, refresh, attention } from '../composition';
import { Type } from '@sinclair/typebox';
import { executions } from '../composition/executions';
import { changesFor } from '../composition/changes';
import { authenticate, AuthError, SESSION_COOKIE } from '../auth';
import { getCookie } from 'hono/cookie';

const { act, attentionFor, dismissAny, ensureThreads, listAreas, listThreadsFor, reopenThread, snoozeOptions, snoozeThread, threadFor, undoReceipt } = threads;
const { cancelReminder, remind } = reminders;
const { confirm, readToday, replan, samtalStatus, undo, weekOverview } = calendar;
const { resetMocks } = mocks;
const { ask, completionsFor, converse, listObjects, reply } = assistant;
const ajv = addFormats(new Ajv({ allErrors: false }));
const approval = ajv.compile(Type.Object({ decisionId: Type.String({ minLength: 1, maxLength: 200 }), operation: Type.String({ minLength: 1, maxLength: 80 }), payload: Type.Unknown(), compensates: Type.Optional(Type.String({ maxLength: 100 })) }, { additionalProperties: false }));
const RemindInput = Type.Object({ seconds: Type.Integer({ minimum: 1, maximum: 30 * 86400 }) }, { additionalProperties: false });
const CancelReminderInput = Type.Object({ workflowId: Type.String({ minLength: 1, maxLength: 200 }) }, { additionalProperties: false });
const validators = { remind: ajv.compile(RemindInput), snooze: ajv.compile(SnoozeInput), cancelReminder: ajv.compile(CancelReminderInput), ask: ajv.compile(AskInput), reply: ajv.compile(ReplyInput), confirm: ajv.compile(ConfirmInput), replan: ajv.compile(ReplanInput), act: ajv.compile(ActInput), conversation: ajv.compile(ConversationInput),
  modelChoice: ajv.compile(ModelChoiceInput), createEvent: ajv.compile(CreateEventInput), rescheduleEvent: ajv.compile(RescheduleEventInput), cancelEvent: ajv.compile(CancelEventInput), moveProposal: ajv.compile(MoveProposalInput), availability: ajv.compile(AvailabilityInput) };
async function body<T>(request: Request, validate: (value: unknown) => value is T): Promise<T> {
  const text = await request.text();
  if (text.length > 4000) throw new InputError('För stor förfrågan.');
  let value: unknown; try { value = JSON.parse(text); } catch { throw new InputError('Ogiltig förfrågan.'); }
  if (!validate(value)) throw new InputError('Ogiltig förfrågan.');
  return value;
}

export const api = new Hono<Env>();
api.use('*', protectedRoute());
api.use('*', async (_c, next) => { await refreshConnectors(); await next(); });
/** Payload-free, authenticated invalidation. Browser reads stay in TanStack Query; no browser polling. */
api.get('/changes', c => streamSSE(c, async stream => {
  const cookie = getCookie(c, SESSION_COOKIE);
  let previous = '', heartbeat = 0, stopped = false;
  stream.onAbort(() => { stopped = true; });
  while (!stopped) {
    try {
      const session = await authenticate(cookie);
      const change = await changesFor(session.context.id);
      const value = JSON.stringify(change);
      if (value !== previous) { await stream.writeSSE({ data: value, id: change.policy + ':' + change.revision, retry: 5000 }); previous = value; }
      else if (++heartbeat % 8 === 0) await stream.write(': keepalive\n\n');
    } catch (error) {
      // A database/network outage closes the stream so EventSource reconnects.
      // Only an explicit session denial should send the person back to login.
      if (error instanceof AuthError && (error.status === 401 || error.status === 403))
        await stream.writeSSE({ data: JSON.stringify({ ended: true }) });
      break;
    }
    await stream.sleep(2000);
  }
}));
/** Human approval is deliberately separate from capabilities and model tools. */
api.post('/executions', async c => {
  const input = await body(c.req.raw, approval), persona = c.get('session').context;
  if (registry.allowed(persona, input.operation)?.capability.kind !== 'execute') throw new InputError('Okänd förmåga.');
  return c.json(await executions.approve(persona, input), 202);
});
api.get('/executions/:id', async c => {
  const execution = await executions.read(c.get('session').context, c.req.param('id'));
  return execution ? c.json(execution) : c.json({ error: 'Åtgärden finns inte.' }, 404);
});
api.post('/executions/:id/reconcile', async c => c.json(await executions.reconcile(c.get('session').context, c.req.param('id')), 202));
// Legacy calendar endpoints have the same connector audience as its capabilities.
api.use('*', async (c, next) => {
  const path = c.req.path;
  if (/^\/api\/(calendar(?:\/|$)|today$)/.test(path) && !registry.visible(c.get('session').context, 'calendar')) return c.json({ error: 'Okänd förmåga.' }, 404);
  await next();
});
api.use('/threads/:id/*', async (c, next) => {
  if (!await threadFor(c.get('session').context, c.req.param('id')!)) return c.json({ error: 'Tråden finns inte.' }, 404);
  await next();
});
api.get('/threads', async c => {
  const persona = c.get('session').context;
  await ensureThreads(persona);
  const [threads, sources, deliveries] = await Promise.all([listThreadsFor(persona), refresh.statuses(persona), attention.pending(persona)]);
  return c.json({ threads, sources, deliveries });
});
api.post('/deliveries/:id/claim', async c => c.json({ claimed: await attention.claim(c.get('session').context, c.req.param('id')) }));
api.get('/areas', async c => { const context = c.get('session').context; return c.json({ areas: await listAreas(context), menu: registry.menu(actorOf(context)) }); });
/** The registry as data: what the architecture derives everything from. Read-only, and only what the caller can see (D23). */
api.get('/connectors', c => {
  const actor = actorOf(c.get('session').context);
  return c.json({ connectors: registry.listFor(actor).map(m => ({ id: m.id, kind: m.kind, source: m.source, areas: m.areas.map(a => ({ id: a.id, title: a.title, roles: a.roles })),
    capabilities: m.capabilities.map(x => ({ name: x.name, kind: x.kind, title: x.title, model: x.model, inScope: !!registry.allowed(actor, x.name) })) })), tools: registry.tools(actor).map(t => t.name) });
});
/** Standing actions and panel views: run one capability directly. GET for reads (input as JSON in `input`), POST for the rest. */
api.get('/cap/:name', async c => {
  const name = c.req.param('name'); const found = registry.find(name);
  if (!found || found.capability.kind !== 'read') return c.json({ error: 'Okänd förmåga.' }, 404);
  let input: unknown = {}; const raw = c.req.query('input'); if (raw) { try { input = JSON.parse(raw); } catch { throw new InputError('Ogiltig förfrågan.'); } }
  // The output and, when the capability declares one, how to draw it (D38): the browser never guesses a declared view.
  const persona = c.get('session').context;
  const output = await runCapability(persona, name, input);
  const view = registry.viewFor(actorOf(persona), name);
  return c.json({ output, ...(view ? { view } : {}) });
});
api.post('/cap/:name', async c => {
  const name = c.req.param('name'); const found = registry.find(name);
  if (!found || found.capability.kind === 'execute') return c.json({ error: 'Okänd förmåga.' }, 404);
  const text = await c.req.raw.text(); if (text.length > 8000) throw new InputError('För stor förfrågan.');
  let input: unknown = {}; try { input = text ? JSON.parse(text) : {}; } catch { throw new InputError('Ogiltig förfrågan.'); }
  return c.json({ output: await runCapability(c.get('session').context, name, input) });
});
api.post('/threads/:id/act', async c => { const input = await body(c.req.raw, validators.act as unknown as (value: unknown) => value is ActInputType); return c.json(await act(c.get('session').context, c.req.param('id'), input.actionId, input.refs)); });
api.post('/threads/:id/execution/check', async c => {
  const persona = c.get('session').context, id = c.req.param('id');
  const thread = await threadFor(persona, id);
  if (!thread) return c.json({ error: 'Tråden finns inte.' }, 404);
  if (thread.execution && (thread.execution.state === 'unknown' || thread.execution.reason)) await executions.reconcile(persona, thread.execution.id);
  return c.json(await threadFor(persona, id));
});
api.post('/mocks/reset', async c => { await resetMocks(c.get('session').context); return c.json({ ok: true }); });
api.post('/threads/:id/undo-receipt', async c => c.json(await undoReceipt(c.get('session').context, c.req.param('id'))));
/** Inte nu (D29): a preset, free text or an instant in the body; an empty body means the next review. */
api.post('/threads/:id/snooze', async c => c.json(await snoozeThread(c.get('session').context, c.req.param('id'), await body(c.req.raw, validators.snooze as unknown as (value: unknown) => value is SnoozeInput))));
api.get('/snooze/presets', async c => c.json({ presets: await snoozeOptions(c.get('session').context) }));
/** A person's own timer (D17): a Temporal reminder workflow that pushes a card back at this thread. */
api.post('/threads/:id/remind', async c => c.json(await remind(c.get('session').context, c.req.param('id'), (await body(c.req.raw, validators.remind as unknown as (value: unknown) => value is { seconds: number })).seconds)));
api.post('/threads/:id/remind/cancel', async c => c.json(await cancelReminder(c.get('session').context, c.req.param('id'), (await body(c.req.raw, validators.cancelReminder as unknown as (value: unknown) => value is { workflowId: string })).workflowId)));
api.get('/threads/:id', async c => {
  const thread = await threadFor(c.get('session').context, c.req.param('id'));
  return thread ? c.json(thread) : c.json({ error: 'Tråden finns inte.' }, 404);
});
api.post('/threads/:id/reply', async c => c.json(await reply(c.get('session').context, c.req.param('id'), (await body(c.req.raw, validators.reply)).body)));
api.post('/threads/:id/confirm', async c => c.json(await confirm(c.get('session').context, c.req.param('id'), (await body(c.req.raw, validators.confirm)).proposalIds)));
api.post('/threads/:id/undo', async c => c.json(await undo(c.get('session').context, c.req.param('id'))));
api.post('/threads/:id/replan', async c => c.json(await replan(c.get('session').context, c.req.param('id'), (await body(c.req.raw, validators.replan)).week)));
api.post('/threads/:id/dismiss', async c => c.json(await dismissAny(c.get('session').context, c.req.param('id'))));
api.post('/ask', async c => c.json(await ask(c.get('session').context, (await body(c.req.raw, validators.ask)).question)));
api.get('/completions', async c => c.json(await completionsFor(c.get('session').context)));
/** One conversation turn (D12): text plus chips; answers in one of three shapes; nothing is executed here. */
api.post('/conversation', async c => c.json(await converse(c.get('session').context, await body(c.req.raw, validators.conversation as unknown as (value: unknown) => value is ConversationInputType))));
/**
 * The same turn as server-sent events (D36): its steps and the model's text while it runs, then the finished turn, or
 * the Swedish error the JSON route would give. The body is validated before the stream opens, so a bad request is a
 * plain 400. A closed connection is the person pressing Stoppa: the turn stops and nothing is written.
 */
api.post('/conversation/stream', async c => {
  const persona = c.get('session').context;
  const input = await body(c.req.raw, validators.conversation as unknown as (value: unknown) => value is ConversationInputType);
  return streamSSE(c, async stream => {
    const stop = new AbortController();
    stream.onAbort(() => stop.abort());
    const send = (event: ConversationEvent) => stream.writeSSE({ data: JSON.stringify(event) }).catch(() => undefined);
    try {
      const response = await converse(persona, input, { emit: event => void send(event), signal: stop.signal });
      await send({ type: 'done', response });
    } catch (error) {
      if (error instanceof TurnStopped || stop.signal.aborted) return;
      if (!(error instanceof InputError || error instanceof CalendarError)) console.error(error);
      await send({ type: 'error', message: error instanceof InputError || error instanceof CalendarError ? error.message : 'Frågan kunde inte ställas. Försök igen.' });
    }
  });
});
/** What `@` can point at, in the box's context: `near` is a comma-separated list of the refs the person is looking at. */
api.get('/objects', async c => {
  const q = c.req.query('q') ?? '';
  const near = (c.req.query('near') ?? '').split(',').filter(Boolean);
  if (q.length > 80) throw new InputError('För lång sökning.');
  if (near.length > 40 || near.some(r => r.length > 200 || !/^[a-z]+:[A-Za-z0-9:_.@-]+$/.test(r))) throw new InputError('Ogiltigt sammanhang.');
  return c.json({ objects: await listObjects(c.get('session').context, q, near) });
});
api.get('/threads/:id/verbs', async c => {
  const thread = await threadFor(c.get('session').context, c.req.param('id'));
  return thread ? c.json({ verbs: verbsFor(thread) }) : c.json({ error: 'Tråden finns inte.' }, 404);
});
/** The person's models (D24): the ones they may pick, the one in use and whether it answers; choosing one is their own preference. */
api.get('/assistant/status', async c => c.json(await models.statusFor(c.get('session').context)));
api.patch('/assistant/model', async c => c.json(await models.choose(c.get('session').context, (await body(c.req.raw, validators.modelChoice as unknown as (value: unknown) => value is ModelChoiceInputType)).modelId)));
api.post('/threads/:id/reopen', async c => c.json(await reopenThread(c.get('session').context, c.req.param('id'))));
/** The manager's own follow-up (D30): a card to everyone who has not answered, at any time. */
api.post('/threads/:id/remind-invitees', async c => c.json(await calendar.remindInvitees(c.req.param('id'), c.get('session').context)));
api.get('/today', async c => c.json(await readToday(c.get('session').context)));
api.get('/figures', async c => {
  const persona = c.get('session').context;
  const owners: Record<string, string> = { korttidsfranvaro: 'heroma', budgetavvikelse: 'raindance', hme: 'heroma', utvecklingssamtal: 'calendar' };
  const samtal = registry.visible(persona, 'calendar') ? await samtalStatus(persona) : { held: 0, booked: 0, deadline: '' };
  return c.json({ figures: readFigures(persona, samtal, new Date().toISOString()).filter(figure => !!owners[figure.id] && registry.visible(persona, owners[figure.id]!)) });
});
api.get('/calendar', async c => c.json(await weekOverview(c.get('session').context, c.req.query('from'))));
/** A person's own bookings (D28): members and rooms for the form, a free-busy check, create, move and cancel; a proposal moved by drag or keyboard. */
api.get('/calendar/members', async c => c.json({ members: await events.listMembers(c.get('session').context) }));
api.get('/calendar/rooms', async c => c.json({ rooms: await events.listRooms(c.get('session').context) }));
api.post('/calendar/availability', async c => c.json(await events.checkAvailability(c.get('session').context, await body(c.req.raw, validators.availability as unknown as (value: unknown) => value is AvailabilityInputType))));
api.post('/calendar/events', async c => c.json(await events.createEvent(c.get('session').context, await body(c.req.raw, validators.createEvent as unknown as (value: unknown) => value is CreateEventInputType)), 202));
api.post('/calendar/events/reschedule', async c => c.json(await events.rescheduleEvent(c.get('session').context, await body(c.req.raw, validators.rescheduleEvent as unknown as (value: unknown) => value is RescheduleEventInputType)), 202));
api.post('/calendar/events/cancel', async c => c.json(await events.cancelEvent(c.get('session').context, await body(c.req.raw, validators.cancelEvent as unknown as (value: unknown) => value is CancelEventInputType))));
api.post('/threads/:id/proposals/:proposalId/move', async c => c.json(await events.moveProposal(c.get('session').context, c.req.param('id'), c.req.param('proposalId'), await body(c.req.raw, validators.moveProposal as unknown as (value: unknown) => value is MoveProposalInputType))));
api.get('/attention', async c => c.json(await attentionFor(c.get('session').context)));
