import { actorOf } from '@clew/connectors';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  ActInput,
  DocumentRequestSchema,
  AskInput,
  AvailabilityInput,
  CancelEventInput,
  ConfirmInput,
  ConversationInput,
  CreateEventInput,
  EffectInput,
  ModelChoiceInput,
  MoveProposalInput,
  ReplanInput,
  ReplyInput,
  RescheduleEventInput,
  SnoozeInput,
} from '@clew/contracts';
import type { ModelChoiceInput as ModelChoiceInputType } from '@clew/contracts';
import type {
  AvailabilityInput as AvailabilityInputType,
  CancelEventInput as CancelEventInputType,
  CreateEventInput as CreateEventInputType,
  MoveProposalInput as MoveProposalInputType,
  RescheduleEventInput as RescheduleEventInputType,
} from '@clew/contracts';
import type { ConversationEvent, ConversationInput as ConversationInputType } from '@clew/contracts';
import { CalendarError } from '@clew/calendar/model';
import { TurnStopped } from '../assistant';
import type { ActInput as ActInputType, EffectInput as EffectInputType } from '@clew/contracts';
import { InputError, protectedRoute, type Env } from '../context';
import { verbsFor } from '../assistant/verbs';
import { registry, runCapability } from '../connectors/registry';
import {
  asks,
  assistant,
  calendar,
  events,
  models,
  reminders,
  threads,
  refreshConnectors,
  refresh,
  attention,
} from '../composition';
import { Type, type Static } from 'typebox';
import { executions } from '../composition/executions';
import { jobs } from '../composition/jobs-across-systems';
import { FactEnvelopeSchema, StepDraftSchema, type FactEnvelope } from '@clew/connectors/protocol';
import { changesFor } from '../composition/changes';
import { authenticate, AuthError, SESSION_COOKIE } from '../auth';
import { getCookie } from 'hono/cookie';
import { readDocument, reviewDocuments } from '../composition/documents';
import { logger } from '../logging';

const {
  act,
  attentionFor,
  dismissAny,
  effect,
  ensureThreads,
  listAreas,
  listThreadsFor,
  preview,
  reopenThread,
  snoozeOptions,
  snoozeThread,
  threadFor,
  undoReceipt,
} = threads;
const { cancelReminder, remind } = reminders;
const { confirm, readToday, replan, samtalStatus, undo, weekOverview } = calendar;
const { ask, completionsFor, converse, listObjects, reply } = assistant;
const ajv = addFormats(new Ajv({ allErrors: false }));
const approval = ajv.compile(
  Type.Object(
    {
      decisionId: Type.String({ minLength: 1, maxLength: 200 }),
      operation: Type.String({ minLength: 1, maxLength: 80 }),
      payload: Type.Unknown(),
      compensates: Type.Optional(Type.String({ maxLength: 100 })),
    },
    { additionalProperties: false },
  ),
);
// A job (D55): the fact Clew fans out, and the proposal the person approves once, echoed back as it was assembled; the ledger re-authorizes every step.
const JobApprovalInput = Type.Object(
  {
    decisionId: Type.String({ minLength: 1, maxLength: 200 }),
    proposal: Type.Object(
      {
        fact: FactEnvelopeSchema.properties.fact,
        steps: Type.Array(
          Type.Object(
            {
              id: Type.String({ minLength: 1, maxLength: 40 }),
              binding: Type.String({ minLength: 1, maxLength: 80 }),
              connector: Type.String({ maxLength: 80 }),
              source: Type.String({ maxLength: 80 }),
              draft: StepDraftSchema,
            },
            { additionalProperties: false },
          ),
          { maxItems: 10 },
        ),
        sources: Type.Array(
          Type.Object(
            {
              binding: Type.String(),
              bindingRevision: Type.String({ minLength: 1, maxLength: 200 }),
              connector: Type.String(),
              source: Type.String(),
              capability: Type.String(),
              status: Type.Union([
                Type.Literal('ok'),
                Type.Literal('timeout'),
                Type.Literal('unavailable'),
                Type.Literal('degraded'),
                Type.Literal('disabled'),
              ]),
              reason: Type.Optional(Type.String()),
            },
            { additionalProperties: false },
          ),
          { maxItems: 50 },
        ),
        partial: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
const RemindInput = Type.Object(
  { seconds: Type.Integer({ minimum: 1, maximum: 30 * 86400 }) },
  { additionalProperties: false },
);
const CancelReminderInput = Type.Object(
  { workflowId: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);
const validators = {
  document: ajv.compile(DocumentRequestSchema),
  fact: ajv.compile(FactEnvelopeSchema),
  jobApproval: ajv.compile(JobApprovalInput),
  remind: ajv.compile(RemindInput),
  snooze: ajv.compile(SnoozeInput),
  cancelReminder: ajv.compile(CancelReminderInput),
  ask: ajv.compile(AskInput),
  reply: ajv.compile(ReplyInput),
  confirm: ajv.compile(ConfirmInput),
  replan: ajv.compile(ReplanInput),
  act: ajv.compile(ActInput),
  effect: ajv.compile(EffectInput),
  conversation: ajv.compile(ConversationInput),
  modelChoice: ajv.compile(ModelChoiceInput),
  createEvent: ajv.compile(CreateEventInput),
  rescheduleEvent: ajv.compile(RescheduleEventInput),
  cancelEvent: ajv.compile(CancelEventInput),
  moveProposal: ajv.compile(MoveProposalInput),
  availability: ajv.compile(AvailabilityInput),
};
async function body<T>(request: Request, validate: (value: unknown) => value is T, max = 4000): Promise<T> {
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

export const api = new Hono<Env>();
api.use('*', protectedRoute());
api.use('*', async (_c, next) => {
  await refreshConnectors();
  await next();
});
/** Payload-free, authenticated invalidation. Browser reads stay in TanStack Query; no browser polling. */
api.get('/changes', c =>
  streamSSE(c, async stream => {
    const cookie = getCookie(c, SESSION_COOKIE);
    let previous = '',
      heartbeat = 0,
      stopped = false;
    stream.onAbort(() => {
      stopped = true;
    });
    while (!stopped) {
      try {
        const session = await authenticate(cookie);
        const change = await changesFor(session.context.id);
        const value = JSON.stringify(change);
        if (value !== previous) {
          await stream.writeSSE({ data: value, id: change.policy + ':' + change.revision, retry: 5000 });
          previous = value;
        } else if (++heartbeat % 8 === 0) await stream.write(': keepalive\n\n');
      } catch (error) {
        // A database/network outage closes the stream so EventSource reconnects.
        // Only an explicit session denial should send the person back to login.
        if (error instanceof AuthError && (error.status === 401 || error.status === 403))
          await stream.writeSSE({ data: JSON.stringify({ ended: true }) });
        break;
      }
      await stream.sleep(2000);
    }
  }),
);
/** Human approval is deliberately separate from capabilities and model tools. */
api.post('/executions', async c => {
  const input = await body(c.req.raw, approval, 64_000),
    persona = c.get('session').context;
  if (registry.allowed(persona, input.operation)?.capability.kind !== 'execute') throw new InputError('Okänd förmåga.');
  return c.json(await executions.approve(persona, input), 202);
});
api.get('/executions/:id', async c => {
  const execution = await executions.read(c.get('session').context, c.req.param('id'));
  return execution ? c.json(execution) : c.json({ error: 'Åtgärden finns inte.' }, 404);
});
api.post('/executions/:id/reconcile', async c =>
  c.json(await executions.reconcile(c.get('session').context, c.req.param('id')), 202),
);
/** A job across systems (D55): assemble the proposal for one fact as the person (nothing is written), approve it once (the human decision endpoint, never a tool), read it back. */
api.post('/jobs/assemble', async c => {
  const { fact } = await body(c.req.raw, validators.fact as unknown as (value: unknown) => value is FactEnvelope),
    persona = c.get('session').context;
  return c.json(await jobs.assemble(actorOf(persona), fact, (name, input) => runCapability(persona, name, input)));
});
api.post('/jobs', async c => {
  const input = await body(
    c.req.raw,
    validators.jobApproval as unknown as (value: unknown) => value is Static<typeof JobApprovalInput>,
  );
  return c.json(await jobs.approve(c.get('session').context, input), 202);
});
api.get('/jobs/:id', async c => {
  const job = await executions.readJob(c.get('session').context, c.req.param('id'));
  return job ? c.json(job) : c.json({ error: 'Jobbet finns inte.' }, 404);
});
// Legacy calendar endpoints have the same connector audience as its capabilities.
api.use('*', async (c, next) => {
  const path = c.req.path;
  if (/^\/api\/(calendar(?:\/|$)|today$)/.test(path) && !registry.visible(c.get('session').context, 'calendar'))
    return c.json({ error: 'Okänd förmåga.' }, 404);
  await next();
});
api.use('/threads/:id/*', async (c, next) => {
  if (!(await threadFor(c.get('session').context, c.req.param('id')!)))
    return c.json({ error: 'Ärendet finns inte.' }, 404);
  await next();
});
api.get('/threads', async c => {
  const persona = c.get('session').context;
  await ensureThreads(persona);
  const [threads, sources, deliveries] = await Promise.all([
    listThreadsFor(persona),
    refresh.statuses(persona),
    attention.pending(persona),
  ]);
  return c.json({ threads, sources, deliveries });
});
api.post('/deliveries/:id/claim', async c =>
  c.json({ claimed: await attention.claim(c.get('session').context, c.req.param('id')) }),
);
api.get('/areas', async c => {
  const context = c.get('session').context;
  return c.json({
    areas: await listAreas(context),
    menu: registry.menu(actorOf(context)),
    systems: registry.systems(actorOf(context)),
  });
});
/** The registry as data: what the architecture derives everything from. Read-only, and only what the caller can see (D23). */
api.get('/connectors', c => {
  const actor = actorOf(c.get('session').context);
  return c.json({
    connectors: registry.listFor(actor).map(m => ({
      id: m.id,
      kind: m.kind,
      source: m.source,
      areas: m.areas.map(a => ({ id: a.id, title: a.title, roles: a.roles })),
      capabilities: m.capabilities.map(x => ({
        name: x.name,
        kind: x.kind,
        title: x.title,
        model: x.model,
        inScope: !!registry.allowed(actor, x.name),
      })),
    })),
    tools: registry.tools(actor).map(t => t.name),
  });
});
/** Standing actions and panel views: run one capability directly. GET for reads (input as JSON in `input`), POST for the rest. */
api.get('/cap/:name', async c => {
  const name = c.req.param('name');
  const found = registry.find(name);
  if (!found || found.capability.kind !== 'read') return c.json({ error: 'Okänd förmåga.' }, 404);
  let input: unknown = {};
  const raw = c.req.query('input');
  if (raw) {
    try {
      input = JSON.parse(raw);
    } catch {
      throw new InputError('Ogiltig förfrågan.');
    }
  }
  // The output and, when the capability declares one, how to draw it (D38): the browser never guesses a declared view.
  const persona = c.get('session').context;
  const output = await runCapability(persona, name, input);
  const view = registry.viewFor(actorOf(persona), name);
  return c.json({ output, source: found.connector.source, ...(view ? { view } : {}) });
});
api.post('/cap/:name', async c => {
  const name = c.req.param('name');
  const found = registry.find(name);
  if (!found || found.capability.kind === 'execute') return c.json({ error: 'Okänd förmåga.' }, 404);
  const text = await c.req.raw.text();
  if (text.length > 8000) throw new InputError('För stor förfrågan.');
  let input: unknown = {};
  try {
    input = text ? JSON.parse(text) : {};
  } catch {
    throw new InputError('Ogiltig förfrågan.');
  }
  return c.json({ output: await runCapability(c.get('session').context, name, input) });
});
api.post('/threads/:id/act', async c => {
  const input = await body(c.req.raw, validators.act as unknown as (value: unknown) => value is ActInputType, 64_000);
  return c.json(
    await act(c.get('session').context, c.req.param('id'), input.actionId, input.refs, input.reviews, input.values),
  );
});
/** "Det här händer" (D111): what the card's action would write with these rows and answers, from its effect read. Nothing is written. */
api.post('/threads/:id/effect', async c => {
  const input = await body(
    c.req.raw,
    validators.effect as unknown as (value: unknown) => value is EffectInputType,
    32_000,
  );
  return c.json(await effect(c.get('session').context, c.req.param('id'), input.actionId, input.refs, input.values));
});
/** Free times for an action's meeting ask (D111), from the person's own calendar, and their day when `date` is given. */
api.get('/asks/times', async c => {
  const capability = c.req.query('capability') ?? '',
    property = c.req.query('property') ?? '',
    date = c.req.query('date'),
    before = c.req.query('before');
  if (!capability || capability.length > 120 || !property || property.length > 80)
    throw new InputError('Ogiltig förfrågan.');
  return c.json(
    await asks.meetingTimes(c.get('session').context, capability, property, {
      ...(date ? { date } : {}),
      ...(before ? { before } : {}),
    }),
  );
});
/** Binary content never traverses model tools or conversation storage. Every request reauthorizes metadata and bytes. */
api.get('/documents/content', async c => {
  const raw = c.req.query('request') ?? '';
  if (raw.length > 8000) throw new InputError('För stor förfrågan.');
  let request: unknown;
  try {
    request = JSON.parse(raw);
  } catch {
    throw new InputError('Ogiltig förfrågan.');
  }
  if (!validators.document(request)) throw new InputError('Ogiltig förfrågan.');
  const result = await readDocument(c.get('session').context, request, c.req.raw.signal);
  const headers = {
    'Content-Type': result.mediaType,
    'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(result.filename ?? 'dokument'),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Length': String(result.bytes.length),
  };
  return c.body(new Uint8Array(result.bytes).buffer, 200, headers);
});
api.get('/documents/review', async c => {
  const capability = c.req.query('capability') ?? '',
    ref = c.req.query('ref') ?? '';
  if (!capability || capability.length > 80 || !ref || ref.length > 200) throw new InputError('Ogiltigt underlag.');
  return c.json(await reviewDocuments.preview(c.get('session').context, capability, ref));
});
api.post('/threads/:id/execution/check', async c => {
  const persona = c.get('session').context,
    id = c.req.param('id');
  const thread = await threadFor(persona, id);
  if (!thread) return c.json({ error: 'Ärendet finns inte.' }, 404);
  if (thread.execution && (thread.execution.state === 'unknown' || thread.execution.reason))
    await executions.reconcile(persona, thread.execution.id);
  return c.json(await threadFor(persona, id));
});
api.post('/threads/:id/undo-receipt', async c =>
  c.json(await undoReceipt(c.get('session').context, c.req.param('id'))),
);
api.post('/threads/:id/retry', async c =>
  c.json(await threads.retryRejected(c.get('session').context, c.req.param('id'))),
);
/** One item's document for the review flow (D70): a read through the card's own preview capability, never a decision. */
api.get('/threads/:id/preview', async c => {
  const ref = c.req.query('ref') ?? '';
  if (!ref || ref.length > 200) throw new InputError('Ogiltig förfrågan.');
  return c.json(await preview(c.get('session').context, c.req.param('id'), ref));
});
/** Inte nu (D29): a preset, free text or an instant in the body; an empty body means the next review. */
api.post('/threads/:id/snooze', async c =>
  c.json(
    await snoozeThread(
      c.get('session').context,
      c.req.param('id'),
      await body(c.req.raw, validators.snooze as unknown as (value: unknown) => value is SnoozeInput),
    ),
  ),
);
api.get('/snooze/presets', async c => c.json({ presets: await snoozeOptions(c.get('session').context) }));
/** A person's own timer (D17, D85): a durable reminder workflow that pushes a card back at this thread. */
api.post('/threads/:id/remind', async c =>
  c.json(
    await remind(
      c.get('session').context,
      c.req.param('id'),
      (await body(c.req.raw, validators.remind as unknown as (value: unknown) => value is { seconds: number })).seconds,
    ),
  ),
);
api.post('/threads/:id/remind/cancel', async c =>
  c.json(
    await cancelReminder(
      c.get('session').context,
      c.req.param('id'),
      (
        await body(
          c.req.raw,
          validators.cancelReminder as unknown as (value: unknown) => value is { workflowId: string },
        )
      ).workflowId,
    ),
  ),
);
/** A work item's "Händelser" (D111 item 4): what the person and Clew did to it, read from its audit rows. A read. */
api.get('/threads/:id/events', async c =>
  c.json(await threads.itemHistory(c.get('session').context, c.req.param('id'))),
);
api.get('/threads/:id', async c => {
  const thread = await threadFor(c.get('session').context, c.req.param('id'));
  return thread ? c.json(thread) : c.json({ error: 'Ärendet finns inte.' }, 404);
});
api.post('/threads/:id/reply', async c =>
  c.json(await reply(c.get('session').context, c.req.param('id'), (await body(c.req.raw, validators.reply)).body)),
);
api.post('/threads/:id/confirm', async c =>
  c.json(
    await confirm(c.get('session').context, c.req.param('id'), (await body(c.req.raw, validators.confirm)).proposalIds),
  ),
);
api.post('/threads/:id/undo', async c => c.json(await undo(c.get('session').context, c.req.param('id'))));
api.post('/threads/:id/replan', async c =>
  c.json(await replan(c.get('session').context, c.req.param('id'), (await body(c.req.raw, validators.replan)).week)),
);
api.post('/threads/:id/dismiss', async c => c.json(await dismissAny(c.get('session').context, c.req.param('id'))));
api.post('/ask', async c =>
  c.json(await ask(c.get('session').context, (await body(c.req.raw, validators.ask)).question)),
);
api.get('/completions', async c => c.json(await completionsFor(c.get('session').context)));
/** One conversation turn (D12): text plus chips; answers in one of three shapes; nothing is executed here. */
api.post('/conversation', async c =>
  c.json(
    await converse(
      c.get('session').context,
      await body(c.req.raw, validators.conversation as unknown as (value: unknown) => value is ConversationInputType),
    ),
  ),
);
/**
 * The same turn as server-sent events (D36): its steps and the model's text while it runs, then the finished turn, or
 * the Swedish error the JSON route would give. The body is validated before the stream opens, so a bad request is a
 * plain 400. A closed connection is the person pressing Stoppa: the turn stops and nothing is written.
 */
api.post('/conversation/stream', async c => {
  const persona = c.get('session').context;
  const input = await body(
    c.req.raw,
    validators.conversation as unknown as (value: unknown) => value is ConversationInputType,
  );
  return streamSSE(c, async stream => {
    const stop = new AbortController();
    stream.onAbort(() => stop.abort());
    const send = (event: ConversationEvent) => stream.writeSSE({ data: JSON.stringify(event) }).catch(() => undefined);
    try {
      const response = await converse(persona, input, { emit: event => void send(event), signal: stop.signal });
      await send({ type: 'done', response });
    } catch (error) {
      if (error instanceof TurnStopped || stop.signal.aborted) return;
      if (!(error instanceof InputError || error instanceof CalendarError))
        logger.error({ scope: 'assistant', error }, 'conversation turn failed');
      await send({
        type: 'error',
        message:
          error instanceof InputError || error instanceof CalendarError
            ? error.message
            : 'Frågan kunde inte ställas. Försök igen.',
      });
    }
  });
});
/** What `@` can point at, in the box's context: `near` is a comma-separated list of the refs the person is looking at. */
api.get('/objects', async c => {
  const q = c.req.query('q') ?? '';
  const near = (c.req.query('near') ?? '').split(',').filter(Boolean);
  if (q.length > 80) throw new InputError('För lång sökning.');
  if (near.length > 40 || near.some(r => r.length > 200 || !/^[a-z]+:[A-Za-z0-9:_.@-]+$/.test(r)))
    throw new InputError('Ogiltigt sammanhang.');
  return c.json({ objects: await listObjects(c.get('session').context, q, near) });
});
api.get('/threads/:id/verbs', async c => {
  const thread = await threadFor(c.get('session').context, c.req.param('id'));
  return thread ? c.json({ verbs: verbsFor(thread) }) : c.json({ error: 'Ärendet finns inte.' }, 404);
});
/** The person's models (D24): the ones they may pick, the one in use and whether it answers; choosing one is their own preference. */
api.get('/assistant/status', async c => c.json(await models.statusFor(c.get('session').context)));
api.patch('/assistant/model', async c =>
  c.json(
    await models.choose(
      c.get('session').context,
      (await body(c.req.raw, validators.modelChoice as unknown as (value: unknown) => value is ModelChoiceInputType))
        .modelId,
    ),
  ),
);
api.post('/threads/:id/reopen', async c => c.json(await reopenThread(c.get('session').context, c.req.param('id'))));
/** The manager's own follow-up (D30): a card to everyone who has not answered, at any time. */
api.post('/threads/:id/remind-invitees', async c =>
  c.json(await calendar.remindInvitees(c.req.param('id'), c.get('session').context)),
);
api.get('/today', async c => c.json(await readToday(c.get('session').context)));
api.get('/calendar', async c => c.json(await weekOverview(c.get('session').context, c.req.query('from'))));
/** A person's own bookings (D28): members and rooms for the form, a free-busy check, create, move and cancel; a proposal moved by drag or keyboard. */
api.get('/calendar/members', async c => c.json({ members: await events.listMembers(c.get('session').context) }));
api.get('/calendar/rooms', async c => c.json({ rooms: await events.listRooms(c.get('session').context) }));
api.post('/calendar/availability', async c =>
  c.json(
    await events.checkAvailability(
      c.get('session').context,
      await body(c.req.raw, validators.availability as unknown as (value: unknown) => value is AvailabilityInputType),
    ),
  ),
);
api.post('/calendar/events', async c =>
  c.json(
    await events.createEvent(
      c.get('session').context,
      await body(c.req.raw, validators.createEvent as unknown as (value: unknown) => value is CreateEventInputType),
    ),
    202,
  ),
);
api.post('/calendar/events/reschedule', async c =>
  c.json(
    await events.rescheduleEvent(
      c.get('session').context,
      await body(
        c.req.raw,
        validators.rescheduleEvent as unknown as (value: unknown) => value is RescheduleEventInputType,
      ),
    ),
    202,
  ),
);
api.post('/calendar/events/cancel', async c =>
  c.json(
    await events.cancelEvent(
      c.get('session').context,
      await body(c.req.raw, validators.cancelEvent as unknown as (value: unknown) => value is CancelEventInputType),
    ),
  ),
);
api.post('/threads/:id/proposals/:proposalId/move', async c =>
  c.json(
    await events.moveProposal(
      c.get('session').context,
      c.req.param('id'),
      c.req.param('proposalId'),
      await body(c.req.raw, validators.moveProposal as unknown as (value: unknown) => value is MoveProposalInputType),
    ),
  ),
);
api.get('/attention', async c => c.json(await attentionFor(c.get('session').context)));
