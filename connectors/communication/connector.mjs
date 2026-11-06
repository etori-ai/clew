// The communication fixture's handlers and HTTP boundary. manifest.mjs owns the contract, fixture.mjs the generated
// records, state.mjs the store. Independently runnable with Node; imports nothing from the rest of the repository (D21).
import { createHash } from 'node:crypto';
import { createVerifier } from './verification.mjs';
import { manifest, CONNECTOR } from './manifest.mjs';
import { dateIn, seed } from './fixture.mjs';
import { memoryState } from './state.mjs';

export { manifest };

class Invalid extends Error {}
class Conflict extends Error {}
export const FAULTS = ['', 'unavailable', 'slow', 'unauthorized', 'conflict', 'crash-after-commit'];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fail = (code, message, status) => json({ error: { code, message } }, status);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createConnector({
  secret,
  jwks,
  clewUrl = process.env.CLEW_URL ?? '',
  fetch: fetchImpl = globalThis.fetch,
  state = memoryState(),
  clock = () => new Date(),
  fault = '',
  unitMap = {},
  personMap = {},
  fresh = false,
} = {}) {
  if (!FAULTS.includes(fault)) throw new Error(`FIXTURE_FAULT must be one of ${FAULTS.filter(Boolean).join(', ')}`);
  const verify = createVerifier({ secret, jwks, clewUrl, fetch: fetchImpl }, CONNECTOR);
  const today = () => dateIn(clock());
  const now = () => clock().toISOString();
  if (fresh) for (const key of state.keys('')) state.delete(key);
  if (!state.get('records')) state.set('records', seed(today()));
  const notices = () => state.get('records').notices;

  const unitOf = actor => unitMap[actor.unitId] ?? actor.unitId;
  const personOf = actor => personMap[actor.id] ?? actor.id;
  const personKey = actor => unitOf(actor) + ':' + personOf(actor);
  /** Receipts per person: who has read what, and when. The one record this system keeps about a person. */
  const receipts = () => state.get('receipts', {});
  const forActor = actor => notices().filter(n => n.audience === 'all' || actor.role === 'manager');

  const reads = {
    'communication.notices': actor => {
      const mine = receipts()[personOf(actor)] ?? {};
      return {
        rows: forActor(actor).map(n => ({
          ref: n.ref,
          title: n.title,
          requiresReceipt: n.requiresReceipt,
          acknowledged: !!mine[n.ref],
        })),
      };
    },
    'communication.lookup': (actor, input) => {
      const op = state.get('op:' + input.operationId);
      return op && op.person === personKey(actor) ? { found: true, result: op.result } : { found: false };
    },
  };

  const writes = {
    'communication.acknowledge': (actor, input) => {
      if (fault === 'conflict')
        return {
          headline: 'Kvittot kunde inte registreras.',
          rows: input.refs.map(ref => ({
            ref,
            label: 'Meddelande',
            outcome: 'failed',
            detail: 'meddelandet har ändrats, läs det igen',
          })),
        };
      const all = receipts();
      const mine = (all[personOf(actor)] ??= {});
      const at = now();
      const rows = input.refs.map(ref => {
        const notice = forActor(actor).find(n => n.ref === ref);
        if (!notice) return { ref, label: 'Meddelande', outcome: 'failed', detail: 'finns inte' };
        mine[ref] = at;
        return {
          ref,
          label: notice.title,
          outcome: 'done',
          detail: `kvitterat ${new Date(at).toLocaleTimeString('sv-SE', { timeStyle: 'short', timeZone: 'Europe/Stockholm' })}`,
        };
      });
      state.set('receipts', all);
      return { headline: 'Läskvittot är registrerat.', rows };
    },
  };

  function execute(actor, name, input, operationId) {
    return state.transaction(() => {
      const digest = hash({ person: personKey(actor), name, input });
      if (operationId) {
        const existing = state.get('op:' + operationId);
        if (existing) {
          if (existing.person !== personKey(actor) || existing.digest !== digest)
            throw new Conflict('Beslutet gäller annat innehåll.');
          return existing.result;
        }
      }
      const result = writes[name](actor, input);
      if (operationId) state.set('op:' + operationId, { person: personKey(actor), name, digest, result, at: now() });
      return result;
    });
  }

  function scan(actor) {
    const mine = receipts()[personOf(actor)] ?? {};
    return forActor(actor)
      .filter(n => n.requiresReceipt && !mine[n.ref])
      .map(n => {
        const draft = {
          topic: `communication:${n.ref}`,
          area: 'important-now',
          title: n.title,
          summary: n.body,
          reason: `Publicerat ${new Date(n.publishedAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Stockholm' })} · läskvitto krävs`,
          items: [{ ref: n.ref, label: n.title, detail: 'kräver läskvitto', selectable: false, selected: true }],
          actions: [
            {
              id: 'ack',
              label: 'Jag har läst',
              capability: 'communication.acknowledge',
              kind: 'execute',
              role: 'primary',
              usesItems: true,
            },
          ],
        };
        return {
          ...draft,
          occurrences: draft.items.map(i => ({
            key: i.ref,
            revision: hash([i.label, i.detail, draft.summary, draft.actions]),
            period: 'once',
          })),
        };
      });
  }

  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) return fail('not-found', 'Okänd adress.', 404);
    if (fault === 'unavailable') return fail('unavailable', 'Kommunikation svarar inte just nu.', 503);
    if (fault === 'slow') await new Promise(resolve => setTimeout(resolve, 1500));
    if (fault === 'unauthorized') return fail('denied', 'Kommunikation godtar inte anslutningens behörighet.', 401);
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(token, request.headers.get('x-clew-connector-key'));
    if (!actor) return fail('denied', 'Ogiltigt behörighetsbevis.', 401);
    let body;
    try {
      body = await request.json();
    } catch {
      return fail('invalid', 'Ogiltig förfrågan.', 400);
    }
    try {
      if (url.pathname === '/clew/scan') {
        const drafts = scan(actor);
        return json({
          drafts,
          observation: {
            scope: unitOf(actor) + ':' + actor.role,
            observedAt: now(),
            version: hash(drafts),
            completeness: 'complete',
            exhausted: true,
          },
        });
      }
      if (url.pathname === '/clew/figure') return json({ figure: null });
      const name = decodeURIComponent(url.pathname.slice('/clew/capabilities/'.length));
      const declared = manifest.capabilities.find(c => c.name === name);
      if (!declared) return fail('not-found', 'Okänd förmåga.', 404);
      if (declared.scope.roles && !declared.scope.roles.includes(actor.role))
        return fail('denied', 'Du saknar behörighet för åtgärden.', 403);
      const input = body && typeof body.input === 'object' && body.input ? body.input : {};
      let output;
      if (reads[name]) output = reads[name](actor, input);
      else {
        output = execute(actor, name, input, request.headers.get('x-clew-operation-id') ?? undefined);
        if (fault === 'crash-after-commit') return fail('unavailable', 'Kommunikation svarar inte just nu.', 503);
      }
      return json({ output });
    } catch (error) {
      if (error instanceof Invalid) return fail('invalid', error.message, 400);
      if (error instanceof Conflict) return fail('invalid', error.message, 409);
      console.error(error);
      return fail('unavailable', 'Kommunikation svarar inte just nu.', 503);
    }
  }

  return { manifest, handle, close: () => state.close() };
}
