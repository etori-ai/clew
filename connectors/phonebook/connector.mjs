// The phone book's read operations and HTTP boundary.
// manifest.mjs owns the contract and views; directory.mjs owns source access and mapping.
import { createVerifier } from './verification.mjs';
import { DirectoryUnavailable, createFixtureDirectory } from './directory.mjs';
import { manifest, personRefPattern } from './manifest.mjs';

export { manifest };

const DIRECTORY_LIMIT = 50;
const SEARCH_LIMIT = 10;
const personRef = new RegExp(personRefPattern);

class Invalid extends Error {}
class NotFound extends Error {}

// Map the source's normalized person to the two outputs declared in the manifest.
function personIdFromRef(ref) {
  if (typeof ref !== 'string' || !personRef.test(ref)) {
    throw new Invalid('Ogiltig referens.');
  }
  return ref.slice('person:'.length);
}

function toContactRow(person) {
  const row = {
    ref: 'person:' + person.id,
    name: person.name,
    title: person.title,
    unit: person.unit,
  };
  if (person.phone) row.phone = person.phone;
  if (person.mobile) row.mobile = person.mobile;
  if (person.email) row.email = person.email;
  return row;
}

function toSearchHit(person) {
  const hit = {
    ref: 'person:' + person.id,
    kind: 'person',
    label: person.name,
    snippet: [person.title, person.unit].filter(Boolean).join(' · '),
    source: manifest.source,
  };
  if (person.link) hit.link = person.link;
  return hit;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(code, message, status) {
  return jsonResponse({ error: { code, message } }, status);
}

/**
 * The fixture is the default source. unitMap translates Clew's unit ids to source ids.
 * Identity comes from the verified assertion, never from the request body.
 */
export function createConnector({ jwks, secret, directory = createFixtureDirectory(), unitMap = {} } = {}) {
  const verify = createVerifier({ secret, jwks, clewUrl: process.env.CLEW_URL ?? '' }, manifest.id);
  const sourceUnitOf = actor => unitMap[actor.unitId] ?? actor.unitId;

  async function findPerson(ref) {
    const person = await directory.person(personIdFromRef(ref));
    if (!person) throw new NotFound('Personen finns inte i telefonboken.');
    return person;
  }

  // Read operations: validate input, ask the source, then map the result.
  const capabilities = {
    'phonebook.directory': async (actor, input) => {
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      const invalidScope = input.scope !== undefined && input.scope !== 'all' && input.scope !== 'unit';
      if (query.length > 80 || invalidScope) {
        throw new Invalid('Ogiltig sökning.');
      }

      const options = { limit: DIRECTORY_LIMIT };
      if (input.scope === 'unit') options.unit = sourceUnitOf(actor);

      const people = await directory.search(query, options);
      return { rows: people.map(toContactRow) };
    },

    'phonebook.team': async actor => {
      const people = await directory.search('', {
        unit: sourceUnitOf(actor),
        limit: DIRECTORY_LIMIT,
      });
      return { unit: actor.unitLabel, rows: people.map(toContactRow) };
    },

    'phonebook.person': async (actor, input) => {
      const person = await findPerson(input.ref);
      const card = toContactRow(person);
      if (person.room) card.room = person.room;
      if (person.manager) card.manager = person.manager;
      if (person.link) card.link = person.link;
      return card;
    },

    'phonebook.search': async (actor, input) => {
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      if (!query || query.length > 200) {
        throw new Invalid('Ogiltig sökning.');
      }

      const people = await directory.search(query, { limit: SEARCH_LIMIT });
      return { rows: people.map(toSearchHit) };
    },

    'phonebook.fetch': async (actor, input) => {
      const person = await findPerson(input.ref);
      return toSearchHit(person);
    },
  };

  // HTTP boundary: route, verify identity, read input, dispatch and translate errors.
  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') {
      return jsonResponse(manifest);
    }
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) {
      return errorResponse('not-found', 'Okänd adress.', 404);
    }

    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(token, request.headers.get('x-clew-connector-key'), request);
    if (!actor) {
      return errorResponse('denied', 'Ogiltigt behörighetsbevis.', 401);
    }

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
    if (!capability) {
      return errorResponse('not-found', 'Okänd förmåga.', 404);
    }

    try {
      const input = body && typeof body.input === 'object' && body.input ? body.input : {};
      const output = await capability(actor, input);
      return jsonResponse({ output });
    } catch (error) {
      if (error instanceof Invalid) return errorResponse('invalid', error.message, 400);
      if (error instanceof NotFound) return errorResponse('not-found', error.message, 404);

      // Keep source error text out of responses: it may expose system internals.
      if (!(error instanceof DirectoryUnavailable)) console.error(error);
      return errorResponse('unavailable', 'Telefonboken svarar inte just nu.', 503);
    }
  }

  return { manifest, handle };
}
