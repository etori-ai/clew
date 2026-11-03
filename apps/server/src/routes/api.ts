import { Hono } from 'hono';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AskInput, ConfirmInput, ReplanInput, ReplyInput, type Attention } from '@clew/contracts';
import { listThreads, readThread } from '@clew/db/threads';
import { today, weekStart } from '@clew/calendar/dates';
import { toProposal } from '@clew/db/threads';
import { database, schema } from '@clew/db';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { InputError, protectedRoute, type Env } from '../context';
import { listWeek, readToday } from '../calendar';
import { readFigures } from '../figures';
import { ask, completions, reply } from '../assistant';
import { confirm, dismiss, ensureProposalThread, replan, samtalStatus, undo } from '../planner';

const ajv = addFormats(new Ajv({ allErrors: false }));
const validators = { ask: ajv.compile(AskInput), reply: ajv.compile(ReplyInput), confirm: ajv.compile(ConfirmInput), replan: ajv.compile(ReplanInput) };
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
  await ensureProposalThread(persona, 'Första besöket i dag');
  return c.json({ threads: await listThreads(persona.id) });
});
api.get('/threads/:id', async c => {
  const found = await readThread(c.get('session').context.id, c.req.param('id'));
  return found ? c.json(found.thread) : c.json({ error: 'Tråden finns inte.' }, 404);
});
api.post('/threads/:id/reply', async c => c.json(await reply(c.get('session').context, c.req.param('id'), (await body(c.req.raw, validators.reply)).body)));
api.post('/threads/:id/confirm', async c => c.json(await confirm(c.get('session').context, c.req.param('id'), (await body(c.req.raw, validators.confirm)).proposalIds)));
api.post('/threads/:id/undo', async c => c.json(await undo(c.get('session').context, c.req.param('id'))));
api.post('/threads/:id/replan', async c => c.json(await replan(c.get('session').context, c.req.param('id'), (await body(c.req.raw, validators.replan)).week)));
api.post('/threads/:id/dismiss', async c => c.json(await dismiss(c.get('session').context, c.req.param('id'))));
api.post('/ask', async c => c.json(await ask(c.get('session').context, (await body(c.req.raw, validators.ask)).question)));
api.get('/completions', c => c.json({ completions }));
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
