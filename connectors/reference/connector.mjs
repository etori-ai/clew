// Synthetic durability fixture, independently runnable with Node. Never a real-system pilot.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createVerifier } from './verification.mjs';

const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const empty = object({}), text = { type: 'string' }, integer = { type: 'integer', minimum: 1 };
const input = object({ ref: { type: 'string', const: 'reference:item:1' }, revision: integer });
const resultSchema = object({ headline: text, rows: { type: 'array', items: object({ ref: text, label: text, outcome: { enum: ['done', 'failed', 'unknown', 'skipped'] }, detail: text }) }, undoCapability: text, undoMinutes: integer, undoInput: input }, ['headline', 'rows']);
export const manifest = {
  protocol: 2, id: 'reference', kind: 'passthrough', source: 'Testkälla', uses: [], scan: true,
  areas: [{ id: 'reference', title: 'Testkälla', roles: ['manager'], standing: ['reference.items'], schedules: [] }],
  capabilities: [
    { name: 'reference.items', kind: 'read', title: 'Visa testpost', description: 'En syntetisk post för återstartstester.', model: true, scope: { roles: ['manager'] }, input: empty, output: object({ rows: { type: 'array' } }) },
    ...['complete', 'undo'].map(name => ({ name: 'reference.' + name, kind: 'execute', title: name === 'complete' ? 'Markera klar' : 'Ångra', description: 'Utför det godkända beslutet på testposten.', model: false, scope: { roles: ['manager'] }, input, output: resultSchema, execution: { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'reference.lookup' } })),
    { name: 'reference.lookup', kind: 'read', title: 'Kontrollera åtgärd', description: 'Läser tillbaka samma operation från källans beständiga logg.', model: false, scope: { roles: ['manager'] }, input: object({ operationId: text }), output: object({ found: { type: 'boolean' }, result: resultSchema }, ['found']) },
  ],
};
export function createConnector({ path, secret, clewUrl, jwks, fault = '' }) {
  if (!path) throw new Error('A persistent SQLite path is required');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS item (person TEXT PRIMARY KEY, revision INTEGER NOT NULL, done INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS operation (id TEXT PRIMARY KEY, person TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL);');
  const verify = createVerifier({ secret, clewUrl, jwks }, 'reference');
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const fail = (message, status = 400) => json({ error: { code: status === 401 ? 'denied' : 'invalid', message } }, status);
  const personKey = actor => actor.unitId + ':' + actor.id;
  const item = actor => db.prepare('SELECT revision, done FROM item WHERE person = ?').get(personKey(actor)) ?? { revision: 1, done: 0 };
  async function handle(request) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/clew/manifest') return json(manifest);
    const actor = await verify((request.headers.get('authorization') ?? '').replace(/^Bearer /, ''), request.headers.get('x-clew-connector-key'));
    if (!actor || actor.role !== 'manager') return fail('Du saknar behörighet.', 401);
    if (request.method !== 'POST') return fail('Okänd adress.', 404);
    let body; try { body = await request.json(); } catch { return fail('Ogiltig förfrågan.'); }
    if (path === '/clew/scan') {
      const current = item(actor);
      return json({ observation: { scope: actor.unitId + ':' + actor.role, observedAt: new Date().toISOString(), version: String(current.revision), completeness: 'complete', exhausted: true }, drafts: current.done ? [] : [{ topic: 'reference:item:1', occurrences: [{ key: 'reference:item:1', period: 'once', revision: String(current.revision) }], area: 'reference', title: 'Hantera testposten', summary: 'En syntetisk post för kontroll av återstart.', reason: 'Testkällan har en öppen post.', actions: [{ id: 'complete', label: 'Markera klar', capability: 'reference.complete', kind: 'execute', role: 'primary', input: { ref: 'reference:item:1', revision: current.revision } }] }] });
    }
    const name = decodeURIComponent(path.slice('/clew/capabilities/'.length));
    if (name === 'reference.items') return json({ output: { rows: [{ ref: 'reference:item:1', ...item(actor) }] } });
    if (name === 'reference.lookup') {
      const row = db.prepare('SELECT result FROM operation WHERE id = ? AND person = ?').get(body.input?.operationId ?? '', personKey(actor));
      return json({ output: row ? { found: true, result: JSON.parse(row.result) } : { found: false } });
    }
    if (!['reference.complete', 'reference.undo'].includes(name)) return fail('Okänd förmåga.', 404);
    const approved = body.input, operationId = request.headers.get('x-clew-operation-id');
    if (!operationId || operationId.length > 200 || approved?.ref !== 'reference:item:1' || !Number.isInteger(approved.revision)) return fail('Ett beständigt beslut och en aktuell version krävs.');
    const digest = createHash('sha256').update(JSON.stringify({ person: personKey(actor), name, ref: approved.ref, revision: approved.revision })).digest('hex');
    let result;
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = db.prepare('SELECT person, digest, result FROM operation WHERE id = ?').get(operationId);
      if (existing) {
        if (existing.person !== personKey(actor) || existing.digest !== digest) { db.exec('ROLLBACK'); return fail('Beslutet gäller annat innehåll.'); }
        result = JSON.parse(existing.result);
      } else {
        const before = item(actor), done = name === 'reference.complete';
        const accepted = before.revision === approved.revision;
        if (accepted) db.prepare('INSERT INTO item(person, revision, done) VALUES (?, ?, ?) ON CONFLICT(person) DO UPDATE SET revision = excluded.revision, done = excluded.done').run(personKey(actor), before.revision + 1, done ? 1 : 0);
        result = { headline: accepted ? 'Bekräftat i testkällan.' : 'Posten har ändrats.', rows: [{ ref: approved.ref, label: 'Testpost', outcome: accepted ? 'done' : 'failed', detail: accepted ? 'Version ' + (before.revision + 1) : 'Läs tillbaka aktuell version.' }], ...(accepted && done ? { undoCapability: 'reference.undo', undoMinutes: 10, undoInput: { ref: approved.ref, revision: before.revision + 1 } } : {}) };
        db.prepare('INSERT INTO operation(id, person, digest, result) VALUES (?, ?, ?, ?)').run(operationId, personKey(actor), digest, JSON.stringify(result));
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    if (fault === 'crash-after-commit') process.exit(73);
    if (fault === 'drop-after-commit') throw new Error('TEST_DROP_RESPONSE');
    if (fault === 'malformed-after-commit') return json({ output: { malformed: true } });
    return json({ output: result });
  }
  return { handle, close: () => db.close() };
}
