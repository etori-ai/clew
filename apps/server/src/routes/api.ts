import { Hono } from 'hono';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ActInput, AskInput, ConfirmInput, ConversationInput, ReplanInput, ReplyInput, type Attention } from '@clew/contracts';
import type { ConversationInput as ConversationInputType } from '@clew/contracts';
import type { ActInput as ActInputType } from '@clew/contracts';
import { listThreads, readThread } from '@clew/db/threads';
import { today, weekStart } from '@clew/calendar/dates';
import { toProposal } from '@clew/db/threads';
import { database, schema } from '@clew/db';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { InputError, protectedRoute, type Env } from '../context';
import { listWeek, readToday } from '../calendar';
import { readFigures } from '../figures';
import { ask, completionsFor, converse, listObjects, providerStatus, reply, verbsFor } from '../assistant';
import { confirm, dismiss, replan, samtalStatus, undo } from '../planner';
import { act, dismissThread, ensureThreads, listAreas, registry, reopenThread, resetMocks, runCapability, snoozeThread, undoReceipt } from '../modules';
import { cancelReminder, remind } from '../reminders';
import { Type } from '@sinclair/typebox';

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
const isDate = (value: string | undefined) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
const ATTENTION_BUDGET = 3;

export const api = new Hono<Env>();
api.use('*', protectedRoute());
api.get('/threads', async c => {
  const persona = c.get('session').context;
  await ensureThreads(persona, 'Första besöket i dag');
  return c.json({ threads: await listThreads(persona.id) });
});
api.get('/areas', async c => c.json({ areas: await listAreas(c.get('session').context) }));
/** The registry as data: what the architecture derives everything from. Read-only, scoped to the caller. */
api.get('/modules', c => {
  const persona = c.get('session').context;
  return c.json({ modules: registry.list().map(m => ({ id: m.id, kind: m.kind, source: m.source, areas: m.areas.map(a => ({ id: a.id, title: a.title, roles: a.roles })),
    capabilities: m.capabilities.map(x => ({ name: x.name, kind: x.kind, title: x.title, model: x.model, inScope: x.scope(persona) })) })), tools: registry.tools(persona).map(t => t.name) });
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
  const found = await readThread(c.get('session').context.id, c.req.param('id'));
  return found ? c.json(found.thread) : c.json({ error: 'Tråden finns inte.' }, 404);
});
api.post('/threads/:id/reply', async c => c.json(await reply(c.get('session').context, c.req.param('id'), (await body(c.req.raw, validators.reply)).body)));
api.post('/threads/:id/confirm', async c => c.json(await confirm(c.get('session').context, c.req.param('id'), (await body(c.req.raw, validators.confirm)).proposalIds)));
api.post('/threads/:id/undo', async c => c.json(await undo(c.get('session').context, c.req.param('id'))));
api.post('/threads/:id/replan', async c => c.json(await replan(c.get('session').context, c.req.param('id'), (await body(c.req.raw, validators.replan)).week)));
api.post('/threads/:id/dismiss', async c => {
  const persona = c.get('session').context, id = c.req.param('id');
  const found = await readThread(persona.id, id);
  if (!found) return c.json({ error: 'Tråden finns inte.' }, 404);
  return c.json(found.thread.proposals.length ? await dismiss(persona, id) : await dismissThread(persona, id));
});
api.post('/ask', async c => c.json(await ask(c.get('session').context, (await body(c.req.raw, validators.ask)).question)));
api.get('/completions', async c => c.json(await completionsFor(c.get('session').context)));
/** One conversation turn (D12): text plus chips; answers in one of three shapes; nothing is executed here. */
api.post('/conversation', async c => c.json(await converse(c.get('session').context, await body(c.req.raw, validators.conversation as unknown as (value: unknown) => value is ConversationInputType))));
/** What `@` can point at: the objects on the page first, then every capability in scope. */
api.get('/objects', async c => { const q = c.req.query('q') ?? ''; if (q.length > 80) throw new InputError('För lång sökning.'); return c.json({ objects: await listObjects(c.get('session').context, q) }); });
api.get('/threads/:id/verbs', async c => {
  const found = await readThread(c.get('session').context.id, c.req.param('id'));
  return found ? c.json({ verbs: verbsFor(found.thread) }) : c.json({ error: 'Tråden finns inte.' }, 404);
});
api.get('/assistant/status', c => c.json(providerStatus()));
api.post('/threads/:id/reopen', async c => c.json(await reopenThread(c.get('session').context, c.req.param('id'))));
api.get('/today', async c => c.json(await readToday(c.get('session').context)));
api.get('/figures', async c => { const persona = c.get('session').context; return c.json({ figures: readFigures(persona, await samtalStatus(persona)) }); });
api.get('/calendar', async c => {
  const persona = c.get('session').context;
  const from = c.req.query('from');
  const start = isDate(from) ? weekStart(from!) : weekStart(today());
  const { view } = await listWeek(persona, start, 7);
  const rows = await database().select().from(schema.proposals).where(and(eq(schema.proposals.personId, persona.id), inArray(schema.proposals.status, ['proposed', 'confirmed', 'final'])));
  return c.json({ from: start, events: view, proposals: rows.map(toProposal) });
});
/** Attention budget: pushed threads today against a fixed daily budget. The rest is bundled to lunch or the next morning. */
api.get('/attention', async c => {
  const persona = c.get('session').context;
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const rows = await database().select({ id: schema.threads.id }).from(schema.threads).where(and(eq(schema.threads.personId, persona.id), eq(schema.threads.kind, 'pushed'), gte(schema.threads.createdAt, since)));
  const attention: Attention = { used: rows.length, budget: ATTENTION_BUDGET, bundledUntil: rows.length >= ATTENTION_BUDGET ? 'i morgon 06:00' : null };
  return c.json(attention);
});
