// The POB connector's reads and HTTP boundary: the errands a person handles (D35, D89), what the person reported
// (D123), and one of either.
// manifest.mjs owns the contract and views; identity.mjs proves who the person is; cases.mjs owns the access rule, the
// port to POB and a made-up POB.
//
// POB cannot take a person's token: it is reached with one account that can read every errand. So this connector is
// the trust boundary. It validates the person's own token itself, checks that it is the person Clew signed for, finds
// that person's records in POB, and only then asks POB, narrowed to them. Every errand that comes back is checked
// against the person once more before any of it is answered. Without a valid token no call is made to POB at all.
import { createHash } from 'node:crypto';
import { createVerifier } from './verification.mjs';
import { ACCOUNT_PATTERN, createTokenVerifier } from './identity.mjs';
import {
  COST_CODE,
  FIXTURE_PROBLEM_MEMO,
  SourceUnavailable,
  createFixtureCases,
  fixtureCaseTypes,
  fixtureCreate,
  fixtureStatusKinds,
  holds,
  plainText,
  resolved,
  toSourceAgreement,
  toSourceCase,
} from './cases.mjs';
import {
  CONNECTOR,
  DEFAULT_AUDIENCE,
  DEFAULT_SOURCE,
  KEYS_MAX,
  REQUEST_AREA,
  createManifest,
  errandRefParts,
} from './manifest.mjs';

export { createManifest };

/**
 * What a POB status can mean for the shared state. Statuses are an installation's own, so the meaning of each is
 * configuration (`POB_STATUS_KINDS`).
 *   new: nobody has started. open: being handled. waiting-reporter: the reporter has to answer.
 *   waiting-other: someone other than the handler or the reporter has to act. closed: finished.
 */
export const STATUS_KINDS = ['new', 'open', 'waiting-reporter', 'waiting-other', 'closed'];

const refPattern = new RegExp(`^errand:pob:(${errandRefParts.id})$`);
const requestPattern = new RegExp(`^request:pob:(${errandRefParts.id})$`);
/** How long a request the desk has closed stays in the person's list. */
const CLOSED_SHOWN_MS = 30 * 86_400_000;

const stateOrder = ['waiting-on-me', 'new', 'active', 'waiting-on-others', 'closed'];
const shortDate = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' });
const DESCRIPTION_LIMIT = 4000;
const PERSON_TTL = 300_000;
/**
 * What a code is where the installation has not said (`costs.codePattern`): the port's own bound, `COST_CODE`. An
 * identifier of the right type that is shorter, longer or anything else is not a code here: a one-character prefix
 * would read as nearly every account in the system. An installation's own pattern is asked besides the bound and never
 * in its place.
 */
export const DEFAULT_COST_CODE = COST_CODE.source;
/** What only needs the person proven, and nothing of theirs in POB: a read about a unit asks for no person's records. */
const WITHOUT_PERSON = new Set(['pob.unitCosts']);
const PERSON_LIMIT = 2000;
const TITLE_LIMIT = 80;

class Invalid extends Error {}
class NotFound extends Error {}
class Refusal extends Error {}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function errorResponse(code, message, status) {
  return jsonResponse({ error: { code, message } }, status);
}
const clip = (text, limit) => (text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + '…');

/**
 * source: the case port (the made-up POB by default). identity: the identity provider the person's token must come
 * from: `issuer`, and `jwksUrl` or, in tests, `jwks`. accountClaim: the claim that carries the directory account.
 * statusKinds: what each POB status means. caseTypes: the case types this installation lets Clew read; an errand of
 * another type is not listed and not found. problemMemo: the one memo type that is the reporter's own text. caseLink:
 * an address with `{id}` or `{number}` in it, for the link out. log: one line per list and per opened errand, since
 * POB's own log shows only the service account. writes: what the installation has switched on beyond reading;
 * `create` adds the fault report. create: the case type, the category and the group a reported fault gets. urgentNote:
 * a sentence for faults that cannot wait, shown on the fault report before it is sent.
 */
export function createConnector({
  jwks,
  secret,
  source = createFixtureCases(),
  identity = {},
  audience = DEFAULT_AUDIENCE,
  accountClaim = 'preferred_username',
  sourceLabel = DEFAULT_SOURCE,
  statusKinds = fixtureStatusKinds,
  caseTypes = fixtureCaseTypes,
  problemMemo = FIXTURE_PROBLEM_MEMO,
  caseLink,
  writes = [],
  costs,
  create = fixtureCreate,
  urgentNote,
  now = () => Date.now(),
  log = line => console.log(JSON.stringify(line)),
} = {}) {
  // The cost read (D148) is on when the installation has said which of the directory's unit identifiers the service
  // desk books costs on. `amountLabel` is set only where it has also said which field of an agreement holds an amount.
  // A code passes the port's bound and the installation's own pattern, both: the pattern narrows what a code is and
  // cannot widen it, so no configuration makes a short identifier a prefix of other units' accounts.
  const ownCostCode = costs ? new RegExp(costs.codePattern ?? DEFAULT_COST_CODE) : undefined;
  const isCostCode = value => typeof value === 'string' && COST_CODE.test(value) && ownCostCode.test(value);
  const manifest = createManifest({
    audience,
    source: sourceLabel,
    writes,
    ...(costs ? { costs: { identifier: costs.identifier, amountLabel: costs.amountLabel } } : {}),
  });
  const verify = createVerifier({ secret, jwks, clewUrl: process.env.CLEW_URL ?? '' }, CONNECTOR);
  const verifyToken = createTokenVerifier({ ...identity, audience, now });
  const types = new Set(caseTypes);
  const say = line => log({ at: new Date(now()).toISOString(), connector: CONNECTOR, ...line });

  const refusals = {
    missing: `Din inloggning kan inte styrkas mot ${sourceLabel} i den här sessionen.`,
    refused: `${sourceLabel} godtar inte din inloggning just nu.`,
    'no-user-name': `Ditt konto i Clew saknar användarnamn, så din inloggning kan inte styrkas mot ${sourceLabel}.`,
    mismatch: `Inloggningen mot ${sourceLabel} hör till en annan person än den som använder Clew.`,
    ambiguous: `Dina uppgifter i ${sourceLabel} är inte entydiga, så dina ärenden kan inte visas här.`,
    'no-customer': `Du finns inte som anmälare i ${sourceLabel}, så en felanmälan kan inte skickas härifrån.`,
  };

  // The person's records in POB, kept for five minutes: their ids and their groups' ids, nothing of an errand. Without
  // it every list is three more calls to POB. A person taken out of a group sees its queue for at most that long.
  const people = new Map();
  async function personFor(account) {
    const key = account.toLowerCase();
    const kept = people.get(key);
    if (kept && kept.until > now()) return kept.found;
    const found = await source.person(account);
    people.delete(key);
    people.set(key, { found, until: now() + PERSON_TTL });
    if (people.size > PERSON_LIMIT) people.delete(people.keys().next().value);
    return found;
  }

  const kindOf = errand => (Object.hasOwn(statusKinds, errand.status) ? statusKinds[errand.status] : 'open');
  const closed = errand => errand.closed || kindOf(errand) === 'closed';
  const suspended = errand => !!errand.suspendedTo && Date.parse(errand.suspendedTo) > now();

  /** An errand's shared state for the person who handles it: whose move it is, from its status and their relation to it. */
  function stateOf(errand, relation) {
    const kind = kindOf(errand);
    if (closed(errand)) return 'closed';
    if (suspended(errand) || kind === 'waiting-other' || kind === 'waiting-reporter') return 'waiting-on-others';
    if (relation === 'assigned') return 'waiting-on-me';
    return kind === 'new' ? 'new' : 'active';
  }

  /** Who the errand waits on, in the handler's words, where the errand says so. */
  function waitingOnOf(errand, relation, state) {
    if (state === 'closed') return undefined;
    if (suspended(errand)) return `Parkerat till ${shortDate.format(new Date(errand.suspendedTo))}`;
    if (state === 'waiting-on-me') return 'Dig';
    if (kindOf(errand) === 'waiting-reporter') return 'Anmälaren';
    if (relation === 'group') return 'Din grupp';
    return undefined;
  }

  /**
   * A request's state, seen from the person who reported it (D123): it waits on them when the desk has asked them
   * something, and otherwise on the desk, whatever the desk in turn waits for.
   */
  function requestStateOf(errand) {
    const kind = kindOf(errand);
    if (closed(errand)) return 'closed';
    if (kind === 'waiting-reporter') return 'waiting-on-me';
    return kind === 'new' && !suspended(errand) ? 'new' : 'active';
  }

  function linkOf(errand) {
    if (typeof caseLink !== 'string' || !/\{(id|number)\}/.test(caseLink)) return undefined;
    try {
      const url = new URL(
        caseLink.replace('{id}', encodeURIComponent(errand.id)).replace('{number}', encodeURIComponent(errand.number)),
      );
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  }

  /** The one text of an errand a list shows: its number and its type. Never the title, never a name. */
  const labelOf = errand => {
    const kind = [errand.type, errand.category].filter(Boolean).join(', ');
    return kind ? `${errand.number} · ${kind}` : errand.number;
  };

  /** An errand as the person who handles it lists it (D89's row). */
  function row(errand, relation) {
    const state = stateOf(errand, relation);
    const shown = {
      ref: `errand:${CONNECTOR}:${errand.id}`,
      label: labelOf(errand),
      state,
      status: errand.statusLabel,
      since: errand.since,
      area: errand.group ?? sourceLabel,
    };
    const waitingOn = waitingOnOf(errand, relation, state);
    if (waitingOn) shown.waitingOn = waitingOn;
    const link = linkOf(errand);
    if (link) shown.link = link;
    return shown;
  }

  /** The same errand as the person who reported it lists it (D123's row, and nothing besides). */
  function requestRow(errand) {
    const shown = {
      ref: `request:${CONNECTOR}:${errand.id}`,
      label: labelOf(errand),
      state: requestStateOf(errand),
      status: errand.statusLabel,
      // When it was reported; a POB that does not say gives when it last changed.
      since: errand.created ?? errand.since,
    };
    const link = linkOf(errand);
    if (link) shown.link = link;
    return shown;
  }

  /**
   * The person's errands in these relations, open and closed: asked of POB, then checked one by one. The filter sent to
   * POB is a first narrowing. This is the check: whatever came back, only what is the person's in that relation and of
   * a case type Clew may read is kept.
   */
  async function casesFor(person, relations) {
    const answers = await Promise.all(relations.map(relation => source.list(person, relation, [...types])));
    // A list that was cut would look whole. Then this system has no answer, and Clew says so.
    if (answers.some(answer => answer?.complete !== true)) throw new SourceUnavailable('The answer was cut.');
    const found = new Map();
    relations.forEach((relation, i) => {
      for (const raw of answers[i].cases ?? []) {
        const errand = toSourceCase(raw);
        if (!errand || !types.has(errand.caseType) || !holds(errand, person, relation)) continue;
        if (!found.has(errand.id)) found.set(errand.id, { errand, relation });
      }
    });
    return [...found.values()];
  }

  /** The open errands the person handles, as rows: what waits on them first, then the oldest. */
  async function handledRows(person) {
    // Without a handler record there is nothing of the person's to ask POB for.
    if (!person.handler) return [];
    return (await casesFor(person, ['assigned', 'group']))
      .filter(({ errand }) => !closed(errand))
      .map(({ errand, relation }) => row(errand, relation))
      .sort(
        (a, b) =>
          stateOrder.indexOf(a.state) - stateOrder.indexOf(b.state) ||
          Date.parse(a.since) - Date.parse(b.since) ||
          a.ref.localeCompare(b.ref),
      );
  }

  /**
   * What the person reported: everything open, and what the desk closed in the last thirty days. Each with the errand
   * it is, for the card a waiting one becomes. What waits on the person first, then what is open from the oldest, then
   * what is closed from the newest (D123 item 4).
   */
  async function requestsFor(person) {
    if (!person.customer) return [];
    const order = shown => (shown.state === 'waiting-on-me' ? 0 : shown.state === 'closed' ? 2 : 1);
    return (await casesFor(person, ['reported']))
      .filter(({ errand }) => !closed(errand) || now() - Date.parse(errand.since) <= CLOSED_SHOWN_MS)
      .map(({ errand }) => ({ errand, shown: requestRow(errand) }))
      .sort(
        (a, b) =>
          order(a.shown) - order(b.shown) ||
          (a.shown.state === 'closed' ? -1 : 1) * (Date.parse(a.shown.since) - Date.parse(b.shown.since)) ||
          a.shown.ref.localeCompare(b.shown.ref),
      );
  }

  /** A fault as the person reported it, or an Invalid that says what is missing. The reporter is never part of it. */
  function fault(input) {
    const said = key => (typeof input[key] === 'string' ? input[key].trim() : '');
    const problem = said('problem'),
      place = said('place'),
      computer = said('computer'),
      otherName = said('otherName');
    if (!problem) throw new Invalid('Beskriv vad som är fel.');
    if (!place) throw new Invalid('Ange var datorn finns.');
    if (!computer) throw new Invalid('Ange datornamnet.');
    // A name says the fault is someone else's, whether or not the choice was made: it is never dropped unsaid. With
    // "my computer" chosen as well the two contradict each other, and the person is asked which it is.
    if (otherName && input.about === 'me')
      throw new Invalid(
        'Du har valt din egen dator men angett ett namn. Ta bort namnet eller välj någon annans dator.',
      );
    const other = input.about === 'other' || !!otherName;
    if (other && !otherName) throw new Invalid('Ange vem felet gäller.');
    const firstLine = problem.split(/\r?\n|(?<=[.!?])\s/)[0] ?? problem;
    return {
      // POB wants a title; the person is asked for one text, so its first sentence is the title.
      title: clip(firstLine, TITLE_LIMIT),
      description: [
        problem,
        '',
        `Plats: ${place}`,
        `Datornamn: ${computer}`,
        ...(other ? [`Gäller: ${otherName} (anmält av en annan person)`] : []),
      ].join('\n'),
    };
  }
  /** The reporter: the one customer record of the person behind the token. Without it nothing is prepared or sent. */
  function reporter({ account, found, person }, event) {
    if (found.customer?.status === 'ambiguous') {
      say({ event, account, outcome: 'ambiguous' });
      throw new Refusal('ambiguous');
    }
    if (!person.customer) {
      say({ event, account, outcome: 'no-customer' });
      throw new Refusal('no-customer');
    }
    return person.customer.id;
  }
  const createdAs = `Typ: ${[create.caseType, create.category].filter(Boolean).join(', ')}.`;

  const capabilities = {
    'pob.errands': async (input, { account, found, person }) => {
      const view = input.view ?? 'assigned';
      if (view !== 'assigned' && view !== 'reported') throw new Invalid('Okänd vy.');
      // What a person reported in POB is a request (`pob.requests`, D123), listed apart from the errands they handle.
      // Clew's errand list says the view to every case system, so it is taken and answered: with nothing.
      if (view === 'reported') {
        say({ event: 'list', account, view, outcome: 'shown', rows: 0 });
        return { rows: [] };
      }
      if (found.handler?.status === 'ambiguous') {
        say({ event: 'list', account, view, outcome: 'ambiguous' });
        throw new Refusal('ambiguous');
      }
      const rows = await handledRows(person);
      say({ event: 'list', account, view, outcome: 'shown', rows: rows.length });
      return { rows };
    },

    'pob.errand': async (input, { account, found, person }) => {
      const match = typeof input.ref === 'string' ? refPattern.exec(input.ref) : null;
      if (!match) throw new Invalid('Ogiltig ärendereferens.');
      const id = match[1];
      const errand = toSourceCase(await source.one(id));
      // Only as its handler: their own before their group's. As its reporter the person opens it as a request.
      const relation =
        errand && types.has(errand.caseType)
          ? ['assigned', 'group'].find(candidate => holds(errand, person, candidate))
          : undefined;
      if (!errand || !relation) {
        // With two records for the account the person cannot be told from another, and is told so; otherwise an errand
        // that is not theirs answers exactly as one that does not exist.
        const ambiguous = found.handler?.status === 'ambiguous';
        say({ event: 'open', account, case: id, outcome: ambiguous ? 'ambiguous' : 'not-found' });
        throw ambiguous ? new Refusal('ambiguous') : new NotFound();
      }
      const shown = row(errand, relation);
      if (errand.title) shown.title = errand.title;
      // Only the reporter's own text. No other memo type is ever asked for: an internal note stays in POB.
      const description = plainText(await source.memo(id, problemMemo));
      if (description) shown.description = clip(description, DESCRIPTION_LIMIT);
      say({ event: 'open', account, case: id, outcome: 'shown' });
      return shown;
    },

    'pob.requests': async (_input, { account, found, person }) => {
      if (found.customer?.status === 'ambiguous') {
        say({ event: 'requests', account, outcome: 'ambiguous' });
        throw new Refusal('ambiguous');
      }
      const rows = (await requestsFor(person)).map(({ shown }) => shown);
      say({ event: 'requests', account, outcome: 'shown', rows: rows.length });
      return { rows };
    },

    'pob.request': async (input, { account, found, person }) => {
      const match = typeof input.ref === 'string' ? requestPattern.exec(input.ref) : null;
      if (!match) throw new Invalid('Ogiltig referens.');
      const id = match[1];
      const errand = toSourceCase(await source.one(id));
      // The person's own only: reported by the one customer record of the person behind the token.
      if (!errand || !types.has(errand.caseType) || !holds(errand, person, 'reported')) {
        const ambiguous = found.customer?.status === 'ambiguous';
        say({ event: 'open-request', account, case: id, outcome: ambiguous ? 'ambiguous' : 'not-found' });
        throw ambiguous ? new Refusal('ambiguous') : new NotFound();
      }
      const shown = requestRow(errand);
      if (errand.group) shown.group = clip(errand.group, 120);
      if (errand.title) shown.title = clip(errand.title, 200);
      // Only the person's own text. No other memo type is ever asked for: an internal note stays in POB.
      const description = plainText(await source.memo(id, problemMemo));
      if (description) shown.description = clip(description, DESCRIPTION_LIMIT);
      say({ event: 'open-request', account, case: id, outcome: 'shown' });
      return shown;
    },
  };

  // Reporting a fault: only when the installation has switched it on. The assistant prepares, the person sends.
  if (writes.includes('create')) {
    // Writes nothing. The work item it answers has one button, the execute below; what the assistant was told is shown
    // by Clew as a draft of that button's asks, which the person can change before anything is sent.
    capabilities['pob.reportFault'] = async (_input, context) => {
      reporter(context, 'prepare');
      return {
        topic: 'pob:fault',
        area: REQUEST_AREA,
        title: 'Felanmäl dator',
        summary:
          `Ett utkast till en felanmälan hos ${sourceLabel}. Inget är skickat: fyll i det som saknas och skicka.` +
          (urgentNote ? ' ' + urgentNote : ''),
        reason: 'Du bad om att göra en felanmälan',
        items: [],
        actions: [
          { id: 'send', label: 'Skicka felanmälan', capability: 'pob.createCase', kind: 'execute', role: 'primary' },
        ],
      };
    };

    capabilities['pob.createEffect'] = async (input, context) => {
      reporter(context, 'prepare');
      const { title } = fault(input);
      return {
        rows: [
          {
            label: `Ett ärende skapas hos ${sourceLabel}`,
            detail: `${title} Du står som anmälare. ${createdAs}`,
          },
        ],
      };
    };

    capabilities['pob.createCase'] = async (input, context) => {
      if (typeof source.create !== 'function') throw new SourceUnavailable('This source cannot create.');
      const customerId = reporter(context, 'create');
      const { title, description } = fault(input);
      // The reporter is the person the identity provider vouched for. Nothing in the input can make it someone else.
      const made = toSourceCase(
        await source.create({ customerId, title, description, ...create }, context.operationId),
      );
      if (!made) throw new SourceUnavailable('The created errand could not be read.');
      // What was reported is the person's request from now on: the receipt names it as their list will.
      const shown = requestRow(made);
      say({ event: 'create', account: context.account, case: made.id, outcome: 'created' });
      return {
        headline: 'Felanmälan är skickad',
        rows: [
          {
            ref: shown.ref,
            label: shown.label,
            outcome: 'done',
            detail: `Ärendet ${made.number} är skapat hos ${sourceLabel} med dig som anmälare.`,
          },
        ],
      };
    };
  }

  /**
   * What the agreements booked on each of these units cost (D148). The service desk is asked with the connector's own
   * account, which can read every agreement, so what stands between a person and another unit's costs is here, in
   * order:
   *   - how the person stands to the unit is Clew's word, read from the body its assertion binds, and only a unit the
   *     person leads (`manages`) is answered. Clew sends no other, and this does not rest on that;
   *   - the code the costs are booked on is the directory's, sent by Clew in the same body: the identifiers of the one
   *     type this installation configured. A unit without one, or with one that is no code, is no row. Nothing is ever
   *     worked out from the unit's id or its name;
   *   - POB is asked for the accounts that begin with the code, and every agreement that comes back is compared with
   *     the code again, so a filter POB ignored or matched loosely cannot add another unit's agreements.
   * A unit with several codes is the sum of them, each agreement counted once. An answer that was cut would look like
   * a whole sum, so then this system has no answer.
   */
  if (costs)
    capabilities['pob.unitCosts'] = async (input, { account, about }) => {
      const keys = Array.isArray(input.keys) ? [...new Set(input.keys.filter(key => typeof key === 'string'))] : [];
      if (keys.length > KEYS_MAX) throw new Invalid('För många enheter i en fråga.');
      const told = about && typeof about === 'object' && about.entity === 'unit' ? about : {};
      const of = (map, key) => (map && typeof map === 'object' && Object.hasOwn(map, key) ? map[key] : undefined);
      const rows = [];
      for (const key of keys) {
        if (of(told.relations, key) !== 'manages') continue;
        const known = of(told.identifiers, key);
        const codes = [
          ...new Set(
            (Array.isArray(known) ? known : [])
              .filter(i => i && i.type === costs.identifier && isCostCode(i.value))
              .map(i => i.value),
          ),
        ];
        if (!codes.length) continue;
        const answers = await Promise.all(codes.map(code => source.agreements(code)));
        if (answers.some(answer => answer?.complete !== true)) throw new SourceUnavailable('The answer was cut.');
        const found = new Map();
        answers.forEach((answer, i) => {
          for (const raw of answer.agreements ?? []) {
            const agreement = toSourceAgreement(raw);
            if (agreement && agreement.account.startsWith(codes[i])) found.set(agreement.id, agreement);
          }
        });
        const agreements = [...found.values()];
        const row = { key, agreements: agreements.length };
        if (costs.amountLabel && agreements.length) {
          const priced = agreements.filter(agreement => agreement.amount !== undefined);
          row.amount = Math.round(priced.reduce((sum, agreement) => sum + agreement.amount, 0) * 100) / 100;
          if (priced.length < agreements.length)
            row.note =
              priced.length === 0
                ? 'Inget av avtalen har ett belopp.'
                : `${agreements.length - priced.length} av avtalen saknar belopp och är inte med i summan.`;
        }
        rows.push(row);
      }
      // Which units were asked about is the person's own organisation; which were answered says nothing more.
      say({ event: 'unit-costs', account, outcome: 'shown', asked: keys.length, rows: rows.length });
      return { rows };
    };

  /** One card: a request that waits for the person's own answer. Its text is the row's, never the title. */
  function draftOf({ errand, shown }) {
    return {
      topic: `pob:request:${errand.id}`,
      area: REQUEST_AREA,
      title: `${sourceLabel} väntar på ditt svar`,
      summary: `${shown.label} väntar på dig. Status: ${shown.status}.`,
      reason: `Din felanmälan eller beställning väntar på ditt svar hos ${sourceLabel}`,
      items: [{ ref: shown.ref, label: shown.label, detail: shown.status, selectable: false, selected: false }],
      actions: [
        {
          id: 'show',
          label: 'Visa',
          capability: 'pob.request',
          kind: 'read',
          role: 'primary',
          target: 'panel',
          input: { ref: shown.ref },
        },
      ],
      // The request is the work. When the errand changes it is the same work changed; when it stops waiting on the
      // person it is no longer among the drafts, and a complete scan resolves its card.
      occurrences: [{ key: shown.ref, revision: errand.since, period: 'waiting-on-me' }],
    };
  }
  /**
   * The scan: a card for every request that waits on the person who made it. A handler's assigned errands are their
   * work in POB and get no cards here. It runs only with the person's own token, as every read does.
   */
  async function scan(actor, token) {
    const observed = (completeness, drafts = [], exhausted = false) => ({
      drafts,
      observation: {
        scope: actor.unitId + ':' + actor.role,
        observedAt: new Date(now()).toISOString(),
        version: createHash('sha256').update(JSON.stringify(drafts)).digest('hex').slice(0, 32),
        completeness,
        exhausted,
      },
    });
    try {
      const account = await identify(actor, token);
      const found = await personFor(account);
      // Two records for the account: who the person is cannot be told, so nothing is said and the cards stay.
      if (found.customer?.status === 'ambiguous') return observed('unavailable');
      const drafts = (await requestsFor(resolved(found)))
        .filter(({ shown }) => shown.state === 'waiting-on-me')
        .map(draftOf);
      say({ event: 'scan', account, outcome: 'shown', rows: drafts.length });
      return observed('complete', drafts, true);
    } catch (error) {
      // Why a scan gave nothing is the operator's to see: without a token there is no account to name.
      if (error instanceof Refusal) {
        say({ event: 'scan', outcome: 'authorization-required', reason: error.message });
        return observed('authorization-required');
      }
      if (!(error instanceof SourceUnavailable)) console.error('pob connector: unexpected', error?.name);
      say({ event: 'scan', outcome: 'unavailable' });
      return observed('unavailable');
    }
  }

  /**
   * Who the request is for, or a Refusal. In order: the person's token is there; the identity provider signed it for
   * this audience and it has not expired; its account is the person Clew signed for. Nothing here calls POB.
   */
  async function identify(actor, token) {
    if (!token) throw new Refusal('missing');
    const checked = await verifyToken(token);
    if (checked.status === 'unavailable') throw new SourceUnavailable('The keys could not be fetched.');
    if (checked.status !== 'ok') throw new Refusal('refused');
    const account = checked.claims[accountClaim];
    if (typeof account !== 'string' || !ACCOUNT_PATTERN.test(account)) throw new Refusal('refused');
    if (typeof actor.userName !== 'string' || !actor.userName) throw new Refusal('no-user-name');
    if (account.toLowerCase() !== actor.userName.toLowerCase()) throw new Refusal('mismatch');
    return account;
  }

  // HTTP boundary: route, verify Clew, prove the person, find them in POB, dispatch and translate errors.
  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return jsonResponse(manifest);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/'))
      return errorResponse('not-found', 'Okänd adress.', 404);

    const assertion = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(assertion, request.headers.get('x-clew-connector-key'), request);
    if (!actor) return errorResponse('denied', 'Ogiltigt behörighetsbevis.', 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return errorResponse('invalid', 'Ogiltig förfrågan.', 400);
    }

    if (url.pathname === '/clew/scan')
      return jsonResponse(await scan(actor, request.headers.get('x-clew-delegated-token')));
    if (url.pathname === '/clew/figure') return jsonResponse({ figure: null });

    let name;
    try {
      name = decodeURIComponent(url.pathname.slice('/clew/capabilities/'.length));
    } catch {
      return errorResponse('not-found', 'Okänd förmåga.', 404);
    }
    const capability = Object.hasOwn(capabilities, name) ? capabilities[name] : undefined;
    if (!capability) return errorResponse('not-found', 'Okänd förmåga.', 404);

    try {
      const account = await identify(actor, request.headers.get('x-clew-delegated-token'));
      const input = body && typeof body.input === 'object' && body.input ? body.input : {};
      // A read about a unit asks POB for nothing of the person's, so their records there are not looked up for it: a
      // person POB does not know, or knows twice, still leads their unit.
      if (WITHOUT_PERSON.has(name))
        return jsonResponse({ output: await capability(input, { account, about: body?.about }) });
      const found = await personFor(account);
      const operationId = request.headers.get('x-clew-operation-id') ?? undefined;
      return jsonResponse({
        output: await capability(input, { account, found, person: resolved(found), operationId }),
      });
    } catch (error) {
      if (error instanceof Invalid) return errorResponse('invalid', error.message, 400);
      if (error instanceof NotFound)
        return errorResponse('not-found', 'Ärendet finns inte, eller så har du inte tillgång till det.', 404);
      if (error instanceof Refusal) return errorResponse('denied', refusals[error.message] ?? refusals.refused, 403);

      // The source's error text stays here, and so does anything an unexpected error might carry: only its name is logged.
      if (!(error instanceof SourceUnavailable)) console.error('pob connector: unexpected', error?.name);
      return errorResponse('unavailable', `${sourceLabel} svarar inte just nu.`, 503);
    }
  }

  return { manifest, handle };
}
