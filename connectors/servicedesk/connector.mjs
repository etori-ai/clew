// The service-desk fixture's handlers and HTTP boundary. manifest.mjs owns the contract, desk.mjs the source port and
// the one mapping from the desk's records to Clew's rows, fixture.mjs the generated records, state.mjs the store.
// Independently runnable with Node; imports nothing from the rest of the repository (D21).
//
// The desk knows a person by their user name (`actor.userName`, the directory's, D68), the same key Clew asks about a
// person with (D97). Who may be asked about is Clew's (D117): an order, its effect, the summary and the equipment answer
// only a key the verified request vouches for as the caller themself or a manager's direct report. What the person made
// is theirs alone: the list and one request answer the caller's own and nobody else's, and a manager reading the summary
// about a report counts only what someone else ordered on the report's behalf. A caller without a user name is refused,
// never answered as someone who has nothing.
import { createHash } from 'node:crypto';
import { createVerifier } from './verification.mjs';
import { manifest, ADMITS, CATALOGUE, CONNECTOR, KEYS_MAX, SOURCE, STATES } from './manifest.mjs';
import { shortDate } from './fixture.mjs';
import { equipmentRow, fixtureDesk, isOpen, numberOf, requestDetail, requestRow } from './desk.mjs';
import { memoryState } from './state.mjs';

export { manifest };

class Invalid extends Error {}
class Denied extends Error {}
class NotFound extends Error {}
class Conflict extends Error {}
/** The realism switches, process configuration only (never a route): what a real source does to a connector now and then. */
export const FAULTS = ['', 'unavailable', 'slow', 'unauthorized', 'conflict', 'crash-after-commit'];
/** The states a request can be moved to on the fixture's own route. */
export const ADVANCES = ['active', 'waiting-on-me', 'closed'];
const FIXTURE_ROUTE = '/fixture/requests/';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fail = (code, message, status) => json({ error: { code, message } }, status);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fold = value => String(value).toLowerCase();
const CATALOGUE_VALUES = CATALOGUE.map(c => c.value);
const NOTE_MAX = 1000;
const NOT_THERE = 'Personen finns inte i IT-servicedesken, eller så får du inte se uppgifterna.';
/** A caller the desk cannot know: no user name in the assertion. Refused, never answered as someone with nothing. */
const UNKNOWN_CALLER = 'IT-servicedesken känner inte igen dig.';
const SAME_ID = 'Beslutet gäller annat innehåll.';

/**
 * `state` is the source's own store (SQLite in the service, memory in tests); `clock` is the source's clock; `fault` one
 * of FAULTS; `fixtureKey` opens the fixture's own route that moves a request forward (`POST /fixture/requests/<number>`,
 * outside the protocol, as the HR fixture's feed is): without it the route answers 401. `desk` is the source port
 * (desk.mjs); the fixture over `state` by default. `fresh` reseeds the records.
 */
export function createConnector({
  secret,
  jwks,
  clewUrl = process.env.CLEW_URL ?? '',
  fetch: fetchImpl = globalThis.fetch,
  state = memoryState(),
  clock = () => new Date(),
  fault = '',
  fixtureKey = '',
  fresh = false,
  desk,
} = {}) {
  if (!FAULTS.includes(fault)) throw new Error(`FIXTURE_FAULT must be one of ${FAULTS.filter(Boolean).join(', ')}`);
  const verify = createVerifier({ secret, jwks, clewUrl, fetch: fetchImpl }, CONNECTOR);
  const now = () => clock().toISOString();
  if (fresh) for (const key of state.keys('')) state.delete(key);
  const source = desk ?? fixtureDesk({ state, clock });

  /** The person as the desk knows them: their user name, or nobody. */
  const me = actor => (typeof actor.userName === 'string' && actor.userName ? actor.userName : undefined);
  /** Whose an operation is, for the operation log. */
  const actorKey = actor => me(actor) ?? 'id:' + actor.id;
  /**
   * How the caller stands to each person the request names, as Clew vouched for it (D117): the `about` of the verified
   * body, folded by key. Anything else (no `about`, another entity, a relation that is not a string) vouches for nobody.
   */
  function relationsOf(about) {
    const relations = new Map();
    if (!about || typeof about !== 'object' || about.entity !== 'person') return relations;
    const given = about.relations;
    if (!given || typeof given !== 'object' || Array.isArray(given)) return relations;
    for (const [key, relation] of Object.entries(given))
      if (typeof relation === 'string' && !relations.has(fold(key))) relations.set(fold(key), relation);
    return relations;
  }
  /** Whether Clew vouched for this person as the caller themself or a direct report, and nothing else (D117). */
  const vouched = (actor, key, relations) => {
    const relation = relations.get(fold(key));
    if (!ADMITS.includes(relation)) return false;
    return relation !== 'self' || (!!me(actor) && fold(me(actor)) === fold(key));
  };

  /** Checks an order as the desk takes it: for someone Clew vouched for, from the catalogue, a message within bounds. */
  function orderOf(actor, input, relations) {
    if (!me(actor)) throw new Invalid(UNKNOWN_CALLER);
    if (typeof input.person !== 'string' || !vouched(actor, input.person, relations))
      throw new Invalid('Personen finns inte bland dem du kan beställa åt.');
    if (!CATALOGUE_VALUES.includes(input.item)) throw new Invalid('Vad: välj något ur katalogen.');
    if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > NOTE_MAX))
      throw new Invalid(`Meddelande till servicedesken: högst ${NOTE_MAX} tecken.`);
    const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : undefined;
    return { self: fold(input.person) === fold(me(actor)), note };
  }
  /**
   * What an order answers, and what its read-back answers again: the request by number and type, for whom, and the day
   * expected. Built only from what the desk recorded when it filed the order, never from where the request stands now:
   * the number, the type, the requester and the contact do not change, and `ExpectedOn` is the day set at filing, which
   * this desk never moves (`advance` changes the status and the notes only). So a receipt rebuilt from the desk after
   * the request was closed is the receipt first given. A desk that moves its expected day would have to keep the first.
   */
  const orderReceipt = serviceCase => {
    const row = requestRow(serviceCase);
    const data = serviceCase.Data;
    return {
      headline: 'Beställningen är registrerad i IT-servicedesken.',
      rows: [
        {
          ref: row.ref,
          label: row.label,
          outcome: 'done',
          detail: [
            fold(data.Contact) === fold(data.Requester) ? 'till dig' : 'till medarbetaren',
            data.ExpectedOn && `beräknas klar ${shortDate(data.ExpectedOn)}`,
          ]
            .filter(Boolean)
            .join(', '),
        },
      ],
    };
  };
  const stateOrder = row => STATES.indexOf(row.state);

  const reads = {
    // The requests profile (D123): the caller's own, what waits on them first, then the oldest.
    // A caller the desk cannot know is refused: an empty list would say that they ordered nothing (D123 item 4).
    'servicedesk.requests': async actor => {
      const person = me(actor);
      if (!person) throw new Denied(UNKNOWN_CALLER);
      const rows = (await source.listRequests({ requester: person })).map(requestRow);
      rows.sort(
        (a, b) =>
          stateOrder(a) - stateOrder(b) || Date.parse(a.since) - Date.parse(b.since) || a.ref.localeCompare(b.ref),
      );
      return { rows };
    },
    // One request with its free text, the caller's own only: anything else is not found, so nobody learns it exists.
    'servicedesk.request': async (actor, input) => {
      const number = numberOf(input.ref);
      if (!number) throw new Invalid('Ogiltig referens.');
      const found = await source.getRequest(number);
      if (!found || !me(actor) || fold(found.Data.Requester) !== fold(me(actor))) throw new NotFound();
      return requestDetail(found);
    },
    // What servicedesk.order will do with the same input (D112), checked as the order checks it and written nowhere.
    'servicedesk.orderEffect': async (actor, input, relations) => {
      const { self, note } = orderOf(actor, input, relations);
      const entry = await source.catalogueItem(input.item);
      if (!entry) throw new Invalid('Vad: välj något ur katalogen.');
      const details = [
        self ? 'Till dig' : 'Till medarbetaren',
        `hanteras av ${entry.ResponsibleGroup}`,
        `beräknas klar ${shortDate(entry.ExpectedOn)}`,
        note ? 'med ditt meddelande' : undefined,
      ].filter(Boolean);
      return { rows: [{ label: `${entry.Subject} beställs`, detail: details.join(', ') }] };
    },
    // The read-back (D45): the operation log, and when the answer was lost before it was logged, the desk itself, which
    // filed the order under the operation id.
    'servicedesk.lookup': async (actor, input) => {
      const op = state.get('op:' + input.operationId);
      if (op) return op.person === actorKey(actor) ? { found: true, result: op.result } : { found: false };
      const filed = await source.findByReference(input.operationId);
      if (!filed || !me(actor) || fold(filed.Data.Requester) !== fold(me(actor))) return { found: false };
      return { found: true, result: orderReceipt(filed) };
    },
    // About a person (D97): one row per key Clew vouched for that the desk knows, with what is registered to them and the
    // orders for them not yet delivered. A person reading about themself counts every such order; anyone else (their
    // manager) counts only the orders someone else placed on their behalf, never what the person ordered for themself.
    // Anyone else, an unknown key and a key asked twice are no row.
    'servicedesk.person': async (actor, input, relations) => {
      const keys = input.keys;
      if (!Array.isArray(keys) || keys.length > KEYS_MAX || keys.some(k => typeof k !== 'string' || !k))
        throw new Invalid('Ogiltig förfrågan.');
      const answered = new Set();
      const rows = [];
      for (const key of keys) {
        if (answered.has(fold(key)) || !vouched(actor, key, relations)) continue;
        answered.add(fold(key));
        const [items, forThem, theirs] = await Promise.all([
          source.listEquipment(key),
          source.listRequests({ contact: key }),
          source.listRequests({ requester: key }),
        ]);
        if (!items.length && !forThem.length && !theirs.length) continue;
        const own = !!me(actor) && fold(me(actor)) === fold(key);
        const ordered = forThem.filter(
          c => isOpen(c) && c.Type === 'Service Request' && (own || fold(c.Data.Requester) !== fold(key)),
        ).length;
        rows.push({ key, devices: items.length, ...(ordered ? { ordered } : {}) });
      }
      return { rows };
    },
    // One person's equipment, opened from the section's row with the person's key.
    'servicedesk.equipment': async (actor, input, relations) => {
      if (typeof input.person !== 'string' || !vouched(actor, input.person, relations)) throw new NotFound(NOT_THERE);
      const items = await source.listEquipment(input.person);
      return {
        rows: items.map(equipmentRow).sort((a, b) => a.since.localeCompare(b.since) || a.ref.localeCompare(b.ref)),
      };
    },
  };

  // Each write is one filing in the desk. The fault `conflict` is the desk answering that it took nothing.
  const writes = {
    'servicedesk.order': async (actor, input, relations, operationId, digest) => {
      const { note } = orderOf(actor, input, relations);
      if (fault === 'conflict')
        return {
          headline: 'IT-servicedesken tog inte emot beställningen.',
          rows: [{ ref: 'request:servicedesk:none', label: 'Beställning', outcome: 'failed', detail: 'försök igen' }],
        };
      const filed = await source.createRequest({
        requester: me(actor),
        contact: input.person,
        item: input.item,
        ...(note ? { note } : {}),
        ...(operationId ? { reference: operationId, digest } : {}),
      });
      // The desk answers what it filed under this operation id before, if anything: it must be this caller's order with
      // this input, or the id is refused as the operation log refuses it.
      if (operationId && (fold(filed.Data.Requester) !== fold(me(actor)) || filed.Data.ReferenceDigest !== digest))
        throw new Conflict(SAME_ID);
      return orderReceipt(filed);
    },
  };

  /**
   * A write runs once per approved operation (D45): the same operation id answers with the first result, a different
   * input under the same id is refused, and `servicedesk.lookup` finds the result afterwards. The desk files the order
   * under the operation id too, with the same digest, so an answer lost between the desk and the log is found again and
   * the id is still refused to another caller or another input. Without an id (a direct call) it just runs.
   */
  async function execute(actor, name, input, operationId, relations) {
    const person = actorKey(actor);
    const digest = hash({ person, name, input });
    if (operationId) {
      const existing = state.get('op:' + operationId);
      if (existing) {
        if (existing.person !== person || existing.digest !== digest) throw new Conflict(SAME_ID);
        return existing.result;
      }
    }
    const result = await writes[name](actor, input, relations, operationId, digest);
    if (operationId) state.set('op:' + operationId, { person, name, digest, result, at: now() });
    return result;
  }

  /**
   * One draft per open request the person made: waiting on the desk while it is the desk's move, the person's own work
   * when the desk waits for them (no `waitingOn`), due on the day the desk expects it. The card names the request by
   * number and type only; one made for someone else names that person by key (`subject`), never by name. Every open
   * request is in every answer, so a request the desk has closed is missing from a complete observation and its card
   * resolves (D45). A caller the desk cannot know is refused before this (`handle`): an empty, complete answer would
   * resolve every card they have.
   */
  async function scan(actor, person) {
    const open = (await source.listRequests({ requester: person })).filter(isOpen);
    return open.map(serviceCase => {
      const row = requestRow(serviceCase);
      const mine = row.state === 'waiting-on-me';
      const forOther = fold(serviceCase.Data.Contact) !== fold(person);
      const incident = serviceCase.Type === 'Incident';
      const draft = {
        topic: `servicedesk:req:${serviceCase.Data.Number}`,
        area: 'it-service',
        title: row.label,
        summary: [
          `${row.status}.`,
          row.expectedAt ? `Beräknas klar ${shortDate(row.expectedAt)}.` : '',
          mine ? 'Servicedesken väntar på dig.' : '',
        ]
          .filter(Boolean)
          .join(' '),
        reason: `${incident ? 'Du felanmälde' : forOther ? 'Du beställde åt en medarbetare' : 'Du beställde'} ${shortDate(row.since)}`,
        items: [
          {
            ref: row.ref,
            label: row.label,
            detail: row.status,
            selectable: false,
            selected: true,
            ...(forOther ? { subject: { entity: 'person', key: serviceCase.Data.Contact } } : {}),
          },
        ],
        actions: [
          {
            id: 'open',
            label: incident ? 'Se felanmälan' : 'Se beställningen',
            capability: 'servicedesk.request',
            kind: 'read',
            role: mine ? 'primary' : 'secondary',
            target: 'panel',
            input: { ref: row.ref },
          },
        ],
        waitingOn: mine ? null : SOURCE,
        deadline: row.expectedAt ?? null,
      };
      return {
        ...draft,
        occurrences: [
          { key: row.ref, revision: hash([row.state, row.status, row.expectedAt ?? null]), period: 'once' },
        ],
      };
    });
  }

  /** The fixture's own route (outside the protocol, behind its key): move a request forward as the desk's staff would. */
  async function fixtureRoute(request, url) {
    if (!fixtureKey || request.headers.get('x-fixture-key') !== fixtureKey) return fail('denied', 'Okänd nyckel.', 401);
    if (request.method !== 'POST' || typeof source.advance !== 'function')
      return fail('not-found', 'Okänd adress.', 404);
    let body;
    try {
      body = await request.json();
    } catch {
      return fail('invalid', 'Ogiltig förfrågan.', 400);
    }
    if (!ADVANCES.includes(body?.to)) return fail('invalid', `to must be one of ${ADVANCES.join(', ')}.`, 400);
    let number;
    try {
      number = decodeURIComponent(url.pathname.slice(FIXTURE_ROUTE.length));
    } catch {
      return fail('invalid', 'The number is not a valid path segment.', 400);
    }
    const moved = source.advance(number, body.to);
    if (!moved) return fail('not-found', 'Okänd beställning.', 404);
    const row = requestRow(moved);
    return json({ number: moved.Data.Number, state: row.state, status: row.status });
  }

  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    if (url.pathname.startsWith(FIXTURE_ROUTE)) return fixtureRoute(request, url);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) return fail('not-found', 'Okänd adress.', 404);
    if (fault === 'unavailable') return fail('unavailable', 'IT-servicedesken svarar inte just nu.', 503);
    if (fault === 'slow') await new Promise(resolve => setTimeout(resolve, 1500));
    if (fault === 'unauthorized') return fail('denied', 'IT-servicedesken godtar inte anslutningens behörighet.', 401);
    // The assertion must have been issued for exactly this body and this capability (D117), so the `input` and the
    // `about` read below are Clew's.
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(token, request.headers.get('x-clew-connector-key'), request);
    if (!actor) return fail('denied', 'Ogiltigt behörighetsbevis.', 401);
    let body;
    try {
      body = await request.json();
    } catch {
      return fail('invalid', 'Ogiltig förfrågan.', 400);
    }
    try {
      if (url.pathname === '/clew/scan') {
        // Nobody to scan for is a failure, never a complete observation of nothing.
        if (!me(actor)) return fail('denied', UNKNOWN_CALLER, 403);
        const drafts = await scan(actor, me(actor));
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
      if (url.pathname === '/clew/figure') return json({ figure: null });
      const name = decodeURIComponent(url.pathname.slice('/clew/capabilities/'.length));
      const declared = manifest.capabilities.find(c => c.name === name);
      if (!declared) return fail('not-found', 'Okänd förmåga.', 404);
      // Scope again on this side: never trust that the caller filtered.
      if (declared.scope.roles && !declared.scope.roles.includes(actor.role))
        return fail('denied', 'Du saknar behörighet för åtgärden.', 403);
      const input = body && typeof body.input === 'object' && body.input ? body.input : {};
      const relations = relationsOf(body?.about);
      let output;
      if (reads[name]) output = await reads[name](actor, input, relations);
      else {
        output = await execute(actor, name, input, request.headers.get('x-clew-operation-id') ?? undefined, relations);
        // The order is filed; the answer is lost on the way back. Clew must read it back, never order again.
        if (fault === 'crash-after-commit') return fail('unavailable', 'IT-servicedesken svarar inte just nu.', 503);
      }
      return json({ output });
    } catch (error) {
      if (error instanceof Invalid) return fail('invalid', error.message, 400);
      if (error instanceof Denied) return fail('denied', error.message, 403);
      if (error instanceof NotFound)
        return fail('not-found', error.message || 'Beställningen finns inte, eller så får du inte se den.', 404);
      if (error instanceof Conflict) return fail('invalid', error.message, 409);
      console.error('servicedesk fixture failure:', error?.name);
      return fail('unavailable', 'IT-servicedesken svarar inte just nu.', 503);
    }
  }

  return { manifest, handle, close: () => state.close() };
}
