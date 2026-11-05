/**
 * Model administration live (D24), inside the devcontainer: the Postgres store, the master-key sealer, the
 * OpenAI-compatible wire and the AI SDK, wired the way the composition root wires them, against one endpoint. Without
 * arguments it starts a stand-in endpoint on a free port (`/models`, and `/chat/completions` answering one tool call
 * and then text, refusing any request without the key); with `--url <base> --model <id>` it uses a real one, such as a
 * self-hosted open-weight model, with the key from `MODEL_KEY` if it needs one. It adds a provider and a model under
 * throwaway ids, switches the model on, picks it for a throwaway person, tests it, runs one turn with a read tool, and
 * removes everything it added, audit rows included. It never prints a key.
 *
 *   docker exec -w /workspace clew-app-1 bun scripts/models-check.ts [--url http://ollama:11434/v1 --model gpt-oss:20b]
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
try { process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local')); } catch { /* settings may come from the environment */ }
const { eq, inArray } = await import('drizzle-orm');
const { closeDatabase, database, schema } = await import('@clew/db');
const { openSecret, sealSecret } = await import('../apps/server/src/auth-crypto');
const { postgresModelStore } = await import('../apps/server/src/assistant/adapters/postgres');
const { openAICompatibleWire } = await import('../apps/server/src/assistant/adapters/openai-compatible');
const { memoryModelHealth } = await import('../apps/server/src/assistant/adapters/memory');
const { modelUsecases } = await import('../apps/server/src/assistant/usecases/models');
const { modelAnswer } = await import('../apps/server/src/assistant/model');
type Persona = import('@clew/contracts').AuthenticatedContext;

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const run = randomBytes(3).toString('hex');
const providerId = `check-${run}`, personId = `check-${run}-person`;
const checks: string[] = [];
const ok = (text: string) => { checks.push(text); console.log('ok   ' + text); };
const fail = (text: string): never => { throw new Error(text); };

// The stand-in endpoint: OpenAI-compatible enough for the AI SDK, and strict about the key so a sealed key that is not opened fails.
const standInKey = 'sk-' + randomBytes(16).toString('hex');
let server: ReturnType<typeof createServer> | undefined;
async function standIn(): Promise<string> {
  server = createServer(async (req, res) => {
    const reply = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${standInKey}`) return reply(401, { error: { message: 'invalid key' } });
    if (req.method === 'GET' && req.url === '/v1/models') return reply(200, { object: 'list', data: [{ id: 'stand-in-model', object: 'model' }] });
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let text = ''; for await (const chunk of req) text += chunk;
      const body = JSON.parse(text) as { model: string; tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string }> };
      if (body.model !== 'stand-in-model') return reply(404, { error: { message: `model "${body.model}" not found` } });
      const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
      const toolTurn = body.tools?.length && !body.messages.some(m => m.role === 'tool');
      const message = toolTurn
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: body.tools![0]!.function.name, arguments: '{}' } }] }
        : { role: 'assistant', content: 'Tre på plats. Heroma 08:00.' };
      return reply(200, { id: 'x', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message, finish_reason: toolTurn ? 'tool_calls' : 'stop' }], usage });
    }
    reply(404, { error: { message: 'not found' } });
  });
  await new Promise<void>(done => server!.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}

const realUrl = arg('--url');
const baseUrl = realUrl ?? await standIn();
const model = arg('--model') ?? (realUrl ? fail('--model is required with --url') : 'stand-in-model');
const key = realUrl ? process.env.MODEL_KEY ?? '' : standInKey;
const store = postgresModelStore(), health = memoryModelHealth();
const models = modelUsecases({ store, wire: openAICompatibleWire(), health, clock: () => new Date(),
  sealer: { seal: (value, id) => sealSecret(value, 'provider:key:' + id), open: (sealed, id) => openSecret(sealed, 'provider:key:' + id) } });
const persona = (capabilities: string[]): Persona => ({ id: personId, name: 'Kontroll', unitId: 'unit-check', unitLabel: 'Kontroll', role: 'manager', organisationId: 'check', principal: { id: 'person:' + personId, kind: 'person' },
  capabilities, authorizationVersion: 'v1', sessionBinding: 'check', expiresAt: '2099-01-01T00:00:00.000Z', async authorize() { return { version: 'v1' }; } });
const admin = persona(['admin.connectors']), person = persona([]);
let modelId: string | undefined;
try {
  await database().insert(schema.people).values({ id: personId, organisationId: 'check', name: 'Kontroll' });
  console.log(`endpoint ${realUrl ? 'given' : 'stand-in'}: ${baseUrl}, model ${model}`);
  const { provider, report } = await models.addProvider(admin, { id: providerId, title: 'Kontroll', baseUrl, ...(key ? { apiKey: key } : {}) });
  if (report.health.status === 'unreachable' || report.health.status === 'key-rejected') fail(`provider: ${report.health.status} ${report.health.detail ?? ''}`);
  ok(`provider added, health ${report.health.status}, lists ${report.models.length} model(s)${report.models.includes(model) ? ` including ${model}` : ''}`);
  const row = (await store.readProvider(providerId))!;
  if (key && (!row.apiKey || row.apiKey.includes(key) || openSecret(row.apiKey, 'provider:key:' + providerId) !== key)) fail('the key is not sealed under provider:key:<id>');
  if (JSON.stringify(provider).includes(key || '\u0000')) fail('a view carries the key');
  ok(key ? 'key sealed with the master key, opened only under its own purpose, absent from every view' : 'no key: the endpoint takes none');
  const added = await models.addModel(admin, { providerId, model, title: 'Kontrollmodell', description: 'Används av models-check.' });
  modelId = added.id;
  await models.updateModel(admin, modelId, { state: 'enabled' });
  ok(`model ${modelId} added and switched on`);
  const test = await models.testModel(admin, modelId);
  if (!test.ok) fail('model test: ' + test.findings.map(f => f.text).join('; '));
  ok('model test: one tiny completion answered');
  const status = await models.choose(person, modelId);
  if (status.current?.id !== modelId) fail('the pick did not take');
  ok(`picked for a person; ${status.choices.length} model(s) in their choices`);
  const resolved = (await models.resolve(person))!;
  const ran: string[] = [];
  const tools = [{ name: 'heroma.whoIsOn', title: 'Vem är på plats', description: 'Vilka som arbetar i dag.', source: 'Heroma', kind: 'read' as const, input: { type: 'object', properties: {}, additionalProperties: false } }];
  const answer = await modelAnswer({ system: 'Svara på svenska med en mening.', history: [], text: 'Vem är på plats i dag?', tools: tools as never, run: async name => { ran.push(name); return { rows: [{ name: 'Anna' }, { name: 'Erik' }, { name: 'Sara' }] }; }, generate: resolved.generate, timeoutMs: 60_000 });
  ok(`one turn through the AI SDK: ${ran.length ? `tool ${ran.join(', ')} called, ` : 'no tool called, '}answer "${answer.body.slice(0, 80)}"`);
  const history = await store.history('model:' + modelId);
  if (!['model.added', 'model.enabled'].every(a => history.some(h => h.action === a))) fail('audit rows missing');
  ok(`audit: ${history.map(h => h.action).join(', ')}; ${(await store.history('person:' + personId)).length} row(s) for the pick`);
  console.log(`\n${checks.length} checks passed.`);
} finally {
  if (modelId) await database().delete(schema.models).where(eq(schema.models.id, modelId));
  await database().delete(schema.modelProviders).where(eq(schema.modelProviders.id, providerId));
  await database().delete(schema.audit).where(inArray(schema.audit.subject, ['provider:' + providerId, 'person:' + personId, ...(modelId ? ['model:' + modelId] : [])]));
  await database().delete(schema.people).where(eq(schema.people.id, personId));
  await closeDatabase();
  server?.close();
}
