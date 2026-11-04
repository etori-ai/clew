import { inScope } from '@clew/connectors';
import { Hono } from 'hono';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ActInput, AskInput, ConfirmInput, ConversationInput, ReplanInput, ReplyInput } from '@clew/contracts';
import type { ConversationInput as ConversationInputType } from '@clew/contracts';
import type { ActInput as ActInputType } from '@clew/contracts';
import { InputError, protectedRoute, type Env } from '../context';
import { readFigures } from '../modules/figures/domain';
import { verbsFor } from '../assistant/verbs';
import { registry, runCapability } from '../connectors/registry';
import { assistant, calendar, mocks, reminders, threads } from '../composition';
import { Type } from '@sinclair/typebox';

const { act, attentionFor, dismissAny, ensureThreads, listAreas, listThreadsFor, reopenThread, snoozeThread, threadFor, undoReceipt } = threads;
const { cancelReminder, remind } = reminders;
const { confirm, readToday, replan, samtalStatus, undo, weekOverview } = calendar;
const { resetMocks } = mocks;
const { ask, completionsFor, converse, listObjects, reply } = assistant;
const ajv = addFormats(new Ajv({ allErrors: false }));
const RemindInput = Type.Object({ seconds: Type.Integer({ minimum: 1, maximum: 86400 }) }, { additionalProperties: false });
const CancelReminderInput = Type.Object({ workflowId: Type.String({ minLength: 1, maxLength: 200 }) }, { additionalProperties: false });
const validators = { remind: ajv.compile(RemindInput), cancelReminder: ajv.compile(CancelReminderInput), ask: ajv.compile(AskInput), reply: ajv.compile(ReplyInput), confirm: ajv.compile(ConfirmInput), replan: ajv.compile(ReplanInput), act: ajv.compile(ActInput), conversation: ajv.compile(ConversationInput) };
async function body<T>(request: Request, validate: (value: unknown) => value is T): Promise<T> {
  const text = await request.text();
  if (text.length > 4000) throw new InputError('För stor förfrågan.');
  let value: unknown; try { value = JSON.parse(text); } catch { throw new InputError('Ogiltig förfrågan.'); }
  if (!validate(value)) throw new InputError('Ogiltig förfrågan.');
  return value;
}

export const api = new Hono<Env>();
api.use('*', protectedRoute());
api.get('/threads', async c => {
  const persona = c.get('session').context;
  await ensureThreads(persona, 'Första besöket i dag');
  return c.json({ threads: await listThreadsFor(persona) });
});
api.get('/areas', async c => c.json({ areas: await listAreas(c.get('session').context) }));
/** The registry as data: what the architecture derives everything from. Read-only, scoped to the caller. */
api.get('/connectors', c => {
  const persona = c.get('session').context;
  return c.json({ connectors: registry.list().map(m => ({ id: m.id, kind: m.kind, source: m.source, areas: m.areas.map(a => ({ id: a.id, title: a.title, roles: a.roles })),
    capabilities: m.capabilities.map(x => ({ name: x.name, kind: x.kind, title: x.title, model: x.model, inScope: inScope(x.scope, persona) })) })), tools: registry.tools(persona).map(t => t.name) });
});
/** Standing actions and panel views: run one capability directly. GET for reads (input as JSON in `input`), POST for the rest. */
api.get('/cap/:name', async c => {
  const name = c.req.param('name'); const found = registry.find(name);
  if (!found || found.capability.kind !== 'read') return c.json({ error: 'Okänd förmåga.' }, 404);
  let input: unknown = {}; const raw = c.req.query('input'); if (raw) { try { input = JSON.parse(raw); } catch { throw new InputError('Ogiltig förfrågan.'); } }
  return c.json({ output: await runCapability(c.get('session').context, name, input) });
});
api.post('/cap/:name', async c => {
  const name = c.req.param('name'); const found = registry.find(name);
  if (!found) return c.json({ error: 'Okänd förmåga.' }, 404);
  const text = await c.req.raw.text(); if (text.length > 8000) throw new InputError('För stor förfrågan.');
  let input: unknown = {}; try { input = text ? JSON.parse(text) : {}; } catch { throw new InputError('Ogiltig förfrågan.'); }
  return c.json({ output: await runCapability(c.get('session').context, name, input) });
});
api.post('/threads/:id/act', async c => { const input = await body(c.req.raw, validators.act as unknown as (value: unknown) => value is ActInputType); return c.json(await act(c.get('session').context, c.req.param('id'), input.actionId, input.refs)); });
api.post('/mocks/reset', async c => { await resetMocks(c.get('session').context); return c.json({ ok: true }); });
api.post('/threads/:id/undo-receipt', async c => c.json(await undoReceipt(c.get('session').context, c.req.param('id'))));
api.post('/threads/:id/snooze', async c => c.json(await snoozeThread(c.get('session').context, c.req.param('id'))));
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
/** What `@` can point at: the objects on the page first, then every capability in scope. */
api.get('/objects', async c => { const q = c.req.query('q') ?? ''; if (q.length > 80) throw new InputError('För lång sökning.'); return c.json({ objects: await listObjects(c.get('session').context, q) }); });
api.get('/threads/:id/verbs', async c => {
  const thread = await threadFor(c.get('session').context, c.req.param('id'));
  return thread ? c.json({ verbs: verbsFor(thread) }) : c.json({ error: 'Tråden finns inte.' }, 404);
});
api.get('/assistant/status', c => c.json(assistant.status()));
api.post('/threads/:id/reopen', async c => c.json(await reopenThread(c.get('session').context, c.req.param('id'))));
api.get('/today', async c => c.json(await readToday(c.get('session').context)));
api.get('/figures', async c => { const persona = c.get('session').context; return c.json({ figures: readFigures(persona, await samtalStatus(persona), new Date().toISOString()) }); });
api.get('/calendar', async c => c.json(await weekOverview(c.get('session').context, c.req.query('from'))));
api.get('/attention', async c => c.json(await attentionFor(c.get('session').context)));
