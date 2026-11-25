// The purchasing fixture's handlers and HTTP boundary. manifest.mjs owns the contract, fixture.mjs the generated
// records, state.mjs the store, tokens.mjs the check of the person's token. Independently runnable with Node; imports
// nothing from the rest of the repository (D21).
//
// The connector and the system it stands for are one service here. What makes it the fixture of a linked account
// (D147): it serves the protected resource metadata that names its authorization server, and it answers a call only for
// the account in a token that server issued. Clew's assertion says who is asking; the token says whose account it is.
import { createHash } from 'node:crypto';
import { createVerifier } from './verification.mjs';
import { manifestFor, CONNECTOR } from './manifest.mjs';
import { dateIn, kronor, seed, shortDate } from './fixture.mjs';
import { memoryState } from './state.mjs';
import { createTokenVerifier, IssuerUnavailable } from './tokens.mjs';

class Invalid extends Error {}
class Conflict extends Error {}
export const FAULTS = ['', 'unavailable', 'slow', 'unauthorized'];

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
  fresh = false,
  /** The system's own address, as Clew and a browser reach it. */
  resource = 'http://purchasing:4057',
  /** The authorization server whose tokens the system takes. */
  issuer = '',
  /** That server's keys, for a test; otherwise read from the issuer. */
  issuerJwks,
  scopes = [],
} = {}) {
  if (!FAULTS.includes(fault)) throw new Error(`FIXTURE_FAULT must be one of ${FAULTS.filter(Boolean).join(', ')}`);
  const manifest = manifestFor({ resource, scopes });
  const verify = createVerifier({ secret, jwks, clewUrl, fetch: fetchImpl }, CONNECTOR);
  const accountOf = createTokenVerifier({ issuer, jwks: issuerJwks, fetch: fetchImpl, clock });
  const today = () => dateIn(clock());
  const now = () => clock().toISOString();
  if (fresh) for (const key of state.keys('')) state.delete(key);
  if (!state.get('records')) state.set('records', seed(today()));
  const records = () => state.get('records');
  const pending = account => records().requests.filter(r => r.approver === account && r.state === 'pending');

  const reads = {
    'purchasing.requests': account => ({
      rows: pending(account).map(r => ({
        ref: r.ref,
        title: r.title,
        requester: r.requester,
        amount: kronor(r.amount),
        dueBy: r.dueBy,
        status: 'Väntar på dig',
      })),
    }),
    'purchasing.lookup': (account, input) => {
      const op = state.get('op:' + input.operationId);
      return op && op.account === account ? { found: true, result: op.result } : { found: false };
    },
  };

  const writes = {
    'purchasing.decide': (account, input) => {
      const all = records();
      const approve = input.decision === 'approve';
      const rows = input.refs.map(ref => {
        const request = all.requests.find(r => r.ref === ref);
        // A request of another approver is not said to exist.
        if (!request || request.approver !== account)
          return { ref, label: 'Inköp', outcome: 'failed', detail: 'finns inte bland dina inköp' };
        if (request.state !== 'pending')
          return { ref, label: request.title, outcome: 'skipped', detail: 'redan avgjort i inköpssystemet' };
        request.state = approve ? 'approved' : 'rejected';
        request.decidedAt = now();
        return {
          ref,
          label: request.title,
          outcome: 'done',
          detail: approve ? 'godkänt i inköpssystemet' : 'avslaget i inköpssystemet',
        };
      });
      state.set('records', all);
      const done = rows.filter(r => r.outcome === 'done').length;
      return {
        headline: done
          ? `${done} inköp ${approve ? 'godkända' : 'avslagna'} i inköpssystemet.`
          : 'Inköpssystemet ändrade inget.',
        rows,
      };
    },
  };

  function execute(account, name, input, operationId) {
    return state.transaction(() => {
      const digest = hash({ account, name, input });
      if (operationId) {
        const existing = state.get('op:' + operationId);
        if (existing) {
          if (existing.account !== account || existing.digest !== digest)
            throw new Conflict('Beslutet gäller annat innehåll.');
          return existing.result;
        }
      }
      const result = writes[name](account, input);
      if (operationId) state.set('op:' + operationId, { account, name, digest, result, at: now() });
      return result;
    });
  }

  function scan(account) {
    const waiting = pending(account);
    if (!waiting.length) return [];
    const items = waiting.map(r => ({
      ref: r.ref,
      label: r.title,
      detail: `${kronor(r.amount)} · ${r.requester} · senast ${shortDate(r.dueBy)}`,
      selectable: true,
      selected: true,
    }));
    const actions = [
      {
        id: 'approve',
        label: 'Godkänn valda',
        capability: 'purchasing.decide',
        kind: 'execute',
        role: 'primary',
        usesItems: true,
        input: { decision: 'approve' },
      },
      {
        id: 'reject',
        label: 'Avslå valda',
        capability: 'purchasing.decide',
        kind: 'execute',
        role: 'secondary',
        usesItems: true,
        input: { decision: 'reject' },
      },
    ];
    const summary = `${waiting.length} inköp väntar på ditt godkännande.`;
    return [
      {
        topic: 'purchasing:pending',
        area: 'purchases',
        title: 'Inköp att godkänna',
        summary,
        reason: 'Du är godkännare i inköpssystemet',
        deadline: waiting.map(r => r.dueBy).sort()[0],
        items,
        actions,
        occurrences: items.map(i => ({ key: i.ref, revision: hash([i.label, i.detail, actions]), period: 'once' })),
      },
    ];
  }

  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    // Where the system says who issues the tokens it takes (RFC 9728): what Clew discovers the server from.
    if (request.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource')
      return issuer
        ? json({ resource, authorization_servers: [issuer], bearer_methods_supported: ['header'] })
        : fail('not-found', 'Okänd adress.', 404);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) return fail('not-found', 'Okänd adress.', 404);
    if (fault === 'unavailable') return fail('unavailable', 'Inköpssystemet svarar inte just nu.', 503);
    if (fault === 'slow') await new Promise(resolve => setTimeout(resolve, 1500));
    if (fault === 'unauthorized') return fail('denied', 'Inköpssystemet godtar inte anslutningens behörighet.', 401);
    const assertion = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(assertion, request.headers.get('x-clew-connector-key'), request);
    if (!actor) return fail('denied', 'Ogiltigt behörighetsbevis.', 401);
    let body;
    try {
      body = await request.json();
    } catch {
      return fail('invalid', 'Ogiltig förfrågan.', 400);
    }
    try {
      // Every answer is for an account, and the account is the token's. No token the system takes: the person links
      // their account (again), which the protocol says with `authorization-required` and a 403.
      const account = await accountOf(request.headers.get('x-clew-delegated-token'));
      if (!account) return fail('authorization-required', 'Inköpssystemet behöver ditt konto.', 403);
      // The account is somebody's, and Clew says who is asking: where Clew knows the person's user name and it is not
      // the account's, the person has linked an account that is not theirs, and nothing is answered for it (D147).
      if (actor.userName && actor.userName !== account)
        return fail('denied', 'Kontot i inköpssystemet tillhör någon annan.', 403);
      if (url.pathname === '/clew/scan') {
        const drafts = scan(account);
        return json({
          drafts,
          observation: {
            scope: actor.unitId + ':' + actor.role,
            observedAt: now(),
            version: hash(drafts),
            completeness: 'complete',
            exhausted: true,
          },
        });
      }
      const name = decodeURIComponent(url.pathname.slice('/clew/capabilities/'.length));
      const declared = manifest.capabilities.find(c => c.name === name);
      if (!declared) return fail('not-found', 'Okänd förmåga.', 404);
      const input = body && typeof body.input === 'object' && body.input ? body.input : {};
      const output = reads[name]
        ? reads[name](account, input)
        : execute(account, name, input, request.headers.get('x-clew-operation-id') ?? undefined);
      return json({ output });
    } catch (error) {
      if (error instanceof Invalid) return fail('invalid', error.message, 400);
      if (error instanceof Conflict) return fail('invalid', error.message, 409);
      if (!(error instanceof IssuerUnavailable)) console.error(error);
      return fail('unavailable', 'Inköpssystemet svarar inte just nu.', 503);
    }
  }

  return { manifest, handle, close: () => state.close() };
}
