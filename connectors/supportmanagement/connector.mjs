// The SupportManagement connector's reads and HTTP boundary (D35, D89): the errands a person has, and one errand.
// manifest.mjs owns the contract and views; errands.mjs and supportmanagement.mjs own source access and mapping.
// It acts as the person: Clew sends an identity provider token for SupportManagement beside its assertion, every
// source call carries that token and nothing else, and SupportManagement decides what the person may see. Nothing is
// stored or cached per person here, and no group, namespace or access rule is interpreted.
import { createVerifier } from './verification.mjs';
import { SourceDenied, SourceNotFound, SourceUnavailable, createFixtureErrands } from './errands.mjs';
import { CONNECTOR, DEFAULT_AUDIENCE, DEFAULT_SOURCE, createManifest, errandRefParts } from './manifest.mjs';

export { createManifest };

/**
 * What a SupportManagement status means for the shared state. Statuses are per namespace, so an operator can extend or
 * override this (`SM_STATUS_KINDS`); a status without an entry counts as `open`.
 *   new: nobody has started. open: being handled. waiting-reporter: the reporter has to answer.
 *   waiting-other: someone other than the handler or the reporter has to act. closed: finished.
 */
export const defaultStatusKinds = {
  NEW: 'new',
  ONGOING: 'open',
  ASSIGNED: 'open',
  REOPENED: 'open',
  PENDING: 'waiting-reporter',
  AWAITING_INTERNAL_RESPONSE: 'waiting-other',
  SUSPENDED: 'waiting-other',
  SOLVED: 'closed',
};
export const STATUS_KINDS = ['new', 'open', 'waiting-reporter', 'waiting-other', 'closed'];

const refPattern = new RegExp(
  `^errand:sm:(${errandRefParts.municipalityId}):(${errandRefParts.namespace}):(${errandRefParts.id})$`,
);

const stateOrder = ['waiting-on-me', 'new', 'active', 'waiting-on-others', 'closed'];
const shortDate = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' });
const DESCRIPTION_LIMIT = 4000;

class Invalid extends Error {}
class NotFound extends Error {}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function errorResponse(code, message, status) {
  return jsonResponse({ error: { code, message } }, status);
}
const clip = (text, limit) => (text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + '…');

/**
 * source: the errand port (the fixture by default). municipalityId: the installation's, part of every ref.
 * audience and sourceLabel: see createManifest. statusKinds: additions to defaultStatusKinds. links: namespace -> an
 * address with `{errandNumber}` in it, for the link out to the errand in its own system. Identity comes from the
 * verified assertion and the delegated token, never from the request body.
 */
export function createConnector({
  jwks,
  secret,
  source = createFixtureErrands(),
  municipalityId = '0000',
  audience = DEFAULT_AUDIENCE,
  sourceLabel = DEFAULT_SOURCE,
  statusKinds = {},
  links = {},
  now = () => Date.now(),
} = {}) {
  const manifest = createManifest({ audience, source: sourceLabel });
  const verify = createVerifier({ secret, jwks, clewUrl: process.env.CLEW_URL ?? '' }, CONNECTOR);
  const kinds = { ...defaultStatusKinds, ...statusKinds };

  const suspended = errand => !!errand.suspendedTo && Date.parse(errand.suspendedTo) > now();

  /** The shared state: whose move it is, from the errand's status and the person's relation to it. */
  function stateOf(errand) {
    const kind = kinds[errand.status] ?? 'open';
    if (kind === 'closed') return 'closed';
    if (suspended(errand) || kind === 'waiting-other') return 'waiting-on-others';
    if (kind === 'waiting-reporter') return errand.relation === 'reported' ? 'waiting-on-me' : 'waiting-on-others';
    if (errand.relation === 'reported') return 'waiting-on-others';
    if (errand.relation === 'assigned') return 'waiting-on-me';
    return kind === 'new' ? 'new' : 'active';
  }

  /** Who the errand waits on, in the person's words, where the errand says so. */
  function waitingOnOf(errand, state) {
    if (state === 'closed') return undefined;
    if (suspended(errand)) return `Parkerat till ${shortDate.format(new Date(errand.suspendedTo))}`;
    if (state === 'waiting-on-me') return 'Dig';
    if ((kinds[errand.status] ?? 'open') === 'waiting-reporter') return 'Anmälaren';
    if (errand.relation === 'group') return 'Din grupp';
    if (errand.relation === 'reported' && state === 'waiting-on-others') return 'Handläggare';
    return undefined;
  }

  function linkOf(errand) {
    const template = links[errand.namespace];
    if (typeof template !== 'string' || !template.includes('{errandNumber}')) return undefined;
    try {
      const url = new URL(template.replace('{errandNumber}', encodeURIComponent(errand.errandNumber)));
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  }

  /** The row every list shows. The label is the errand number and its type: never the title, never a name. */
  function row(errand) {
    const state = stateOf(errand);
    const shown = {
      ref: `errand:${CONNECTOR}:${municipalityId}:${errand.namespace}:${errand.id}`,
      label: errand.type ? `${errand.errandNumber} · ${errand.type}` : errand.errandNumber,
      state,
      status: errand.statusLabel,
      since: errand.since,
      area: errand.area,
    };
    const waitingOn = waitingOnOf(errand, state);
    if (waitingOn) shown.waitingOn = waitingOn;
    const link = linkOf(errand);
    if (link) shown.link = link;
    return shown;
  }

  const capabilities = {
    'sm.errands': async (input, token) => {
      const view = input.view ?? 'assigned';
      if (view !== 'assigned' && view !== 'reported') throw new Invalid('Okänd vy.');
      const relations = view === 'assigned' ? ['assigned', 'group'] : ['reported'];
      const answers = await Promise.all(relations.map(relation => source.mine(token, relation)));
      const byRef = new Map();
      for (const errand of answers.flat()) {
        const shown = row(errand);
        if (!byRef.has(shown.ref)) byRef.set(shown.ref, shown);
      }
      // What waits on the person first, then the oldest: the order a person would work in.
      const rows = [...byRef.values()].sort(
        (a, b) =>
          stateOrder.indexOf(a.state) - stateOrder.indexOf(b.state) ||
          Date.parse(a.since) - Date.parse(b.since) ||
          a.ref.localeCompare(b.ref),
      );
      return { rows };
    },

    'sm.errand': async (input, token) => {
      const match = typeof input.ref === 'string' ? refPattern.exec(input.ref) : null;
      if (!match) throw new Invalid('Ogiltig ärendereferens.');
      const [, municipality, namespace, id] = match;
      if (municipality !== municipalityId) throw new NotFound('Ärendet finns inte.');
      const errand = await source.errand(token, namespace, id);
      if (!errand) throw new NotFound('Ärendet finns inte.');
      const shown = row(errand);
      if (errand.title) shown.title = errand.title;
      if (errand.description) shown.description = clip(errand.description, DESCRIPTION_LIMIT);
      return shown;
    },
  };

  // HTTP boundary: route, verify Clew, require the person's token, dispatch and translate errors.
  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return jsonResponse(manifest);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/'))
      return errorResponse('not-found', 'Okänd adress.', 404);

    const assertion = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(assertion, request.headers.get('x-clew-connector-key'));
    if (!actor) return errorResponse('denied', 'Ogiltigt behörighetsbevis.', 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return errorResponse('invalid', 'Ogiltig förfrågan.', 400);
    }

    if (url.pathname === '/clew/scan') return jsonResponse({ drafts: [] });
    if (url.pathname === '/clew/figure') return jsonResponse({ figure: null });

    const name = decodeURIComponent(url.pathname.slice('/clew/capabilities/'.length));
    const capability = capabilities[name];
    if (!capability) return errorResponse('not-found', 'Okänd förmåga.', 404);

    // The person's own token for SupportManagement. Without it there is nobody to act as: a scan, a figure, a
    // callback or a session without identity provider tokens.
    const token = request.headers.get('x-clew-delegated-token');
    if (!token)
      return errorResponse('denied', 'Din inloggning kan inte styrkas mot ärendesystemet i den här sessionen.', 403);

    try {
      const input = body && typeof body.input === 'object' && body.input ? body.input : {};
      return jsonResponse({ output: await capability(input, token) });
    } catch (error) {
      if (error instanceof Invalid) return errorResponse('invalid', error.message, 400);
      if (error instanceof NotFound || error instanceof SourceNotFound)
        return errorResponse('not-found', 'Ärendet finns inte, eller så har du inte tillgång till det.', 404);
      if (error instanceof SourceDenied)
        return errorResponse('denied', 'Ärendesystemet godkänner inte din inloggning.', 403);

      // The source's error text stays here, and so does anything an unexpected error might carry: only its name is logged.
      if (!(error instanceof SourceUnavailable)) console.error('sm connector: unexpected', error?.name);
      return errorResponse('unavailable', 'Ärendesystemet svarar inte just nu.', 503);
    }
  }

  return { manifest, handle };
}
