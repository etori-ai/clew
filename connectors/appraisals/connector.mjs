// The appraisals connector (D96 items 8 and 9): a generic stand-in for a third-party system that holds the round of
// development talks and the action points agreed in them. It answers the talks profile, `appraisals.talks` and
// `appraisals.commitments`, in the shapes Clew's pages read, keyed on the provisioned user name; Clew shows them
// read-only and a row opens this system by its link. `appraisals.person` says what its rows are about (D97): a person,
// asked by a batch of user names. Stateless: the records are the tables in fixture.mjs, dated from today. No
// dependencies beyond Node; nothing here imports Clew, so the profile's shapes are written out below.
import { createVerifier } from './verification.mjs';
import { COMMITMENTS, MANAGERS, PEOPLE, ROUND, TALKS } from './fixture.mjs';

export { COMMITMENTS, MANAGERS, PEOPLE, ROUND, TALKS };

const CONNECTOR = 'appraisals';
/** Where a row opens: the system's own pages. A placeholder host; a real connector links to its system. */
export const DEFAULT_LINK_BASE = 'https://appraisals.example';

// The talks profile's shapes (`TalksOutput`, `CommitmentsInput`, `CommitmentsOutput` in Clew's published protocol),
// written out: the same required fields, patterns and limits.
const calendarDay = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', maxLength: 10 };
const instant = { type: 'string', format: 'date-time', maxLength: 40 };
const userName = { type: 'string', minLength: 1, maxLength: 512 };
const sourceLink = { type: 'string', maxLength: 1000, pattern: '^https?://[^\\s]+$' };
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const Empty = object({});

const TalkRound = object({
  label: { type: 'string', minLength: 1, maxLength: 120 },
  opensOn: calendarDay,
  dueOn: calendarDay,
});
const TalkRow = object(
  {
    ref: { type: 'string', minLength: 1, maxLength: 200, pattern: '^talk:[a-z][a-z0-9-]*:[A-Za-z0-9:_.-]+$' },
    userName,
    name: { type: 'string', minLength: 1, maxLength: 512 },
    state: { type: 'string', enum: ['missing', 'booked', 'held'] },
    at: { anyOf: [calendarDay, instant] },
    openCommitments: { type: 'integer', minimum: 0 },
    link: sourceLink,
  },
  ['ref', 'userName', 'name', 'state', 'openCommitments'],
);
export const TalksOutput = object(
  {
    round: { anyOf: [TalkRound, { type: 'null' }] },
    rows: { type: 'array', items: TalkRow, maxItems: 500 },
    bookedUnknown: { type: 'boolean' },
  },
  ['round', 'rows'],
);
const CommitmentRow = object(
  {
    ref: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
      pattern: '^commitment:[a-z][a-z0-9-]*:[A-Za-z0-9:_.-]+$',
    },
    userName,
    name: { type: 'string', minLength: 1, maxLength: 512 },
    owner: { type: 'string', enum: ['employee', 'manager'] },
    mine: { type: 'boolean' },
    text: { type: 'string', minLength: 1, maxLength: 280 },
    dueOn: calendarDay,
    done: { type: 'boolean' },
    doneAt: instant,
    carried: { type: 'boolean' },
    link: sourceLink,
  },
  ['ref', 'userName', 'name', 'owner', 'mine', 'text', 'dueOn', 'done', 'carried'],
);
export const CommitmentsInput = object({ person: userName }, []);
export const CommitmentsOutput = object({ rows: { type: 'array', items: CommitmentRow, maxItems: 500 } });

/** The menu's view of the round: the same rows with the state as a person reads it, for this system on its own. */
const STATE_WORDS = { missing: 'Saknas', booked: 'Bokat', held: 'Hållet' };
const OverviewOutput = object({
  rows: {
    type: 'array',
    maxItems: 500,
    items: object(
      {
        ref: { type: 'string' },
        name: { type: 'string' },
        status: { type: 'string', enum: Object.values(STATE_WORDS) },
        bookedAt: instant,
        heldOn: calendarDay,
        openCommitments: { type: 'integer', minimum: 0 },
        link: sourceLink,
      },
      ['ref', 'name', 'status', 'openCommitments', 'link'],
    ),
  },
});

/**
 * A read about a person (D97): Clew asks with a batch of user names, at most 200, and the system answers one row per
 * person the caller is manager of here, carrying the key it was asked with. Anyone else is no row, never a refusal.
 */
const KEYS_MAX = 200;
export const PersonInput = object({ keys: { type: 'array', items: userName, maxItems: KEYS_MAX } });
export const PersonOutput = object({
  rows: {
    type: 'array',
    maxItems: KEYS_MAX,
    items: object(
      {
        key: userName,
        state: { type: 'string', enum: Object.values(STATE_WORDS) },
        at: { anyOf: [calendarDay, instant] },
        overdue: { type: 'integer', minimum: 0 },
      },
      ['key', 'state', 'overdue'],
    ),
  },
});

export const manifest = {
  protocol: 3,
  id: CONNECTOR,
  kind: 'passthrough',
  source: 'Samtalssystemet',
  areas: [],
  uses: [],
  scan: false,
  capabilities: [
    // The profile reads (D96 item 8). Free text about a person: never a model tool, and no view puts a row in a
    // conversation (no `ref` in a view).
    {
      name: 'appraisals.talks',
      kind: 'read',
      title: 'Utvecklingssamtal',
      description:
        'Den öppna omgången utvecklingssamtal och en rad per medarbetare som du är chef för: inget samtal, bokat eller hållet, och hur många åtgärdspunkter som är öppna.',
      model: false,
      scope: {},
      input: Empty,
      output: TalksOutput,
    },
    {
      name: 'appraisals.commitments',
      kind: 'read',
      title: 'Åtgärdspunkter',
      description:
        'Åtgärdspunkter från utvecklingssamtalen: en medarbetares, för medarbetarens chef, eller utan medarbetare de som är dina och de som gäller dig.',
      model: false,
      scope: {},
      // `person` names someone (D117): Clew lets through the caller themself and their reports, and says which.
      person: { param: 'person', admits: ['self', 'managed'] },
      input: CommitmentsInput,
      output: CommitmentsOutput,
      view: {
        kind: 'list',
        title: 'text',
        modelReads: 'summary',
        noun: { one: 'åtgärdspunkt', other: 'åtgärdspunkter' },
        empty: 'Inga åtgärdspunkter.',
        fields: [
          { key: 'text', label: 'Åtgärdspunkt' },
          { key: 'name', label: 'Medarbetare' },
          { key: 'dueOn', label: 'Klar senast', format: 'date' },
          { key: 'done', label: 'Klar', format: 'status' },
          { key: 'carried', label: 'Från förra omgången', format: 'status', tones: { true: 'warn' } },
          { key: 'link', label: 'Öppna i samtalssystemet', format: 'link' },
        ],
      },
    },
    // Not part of the profile: the round as a table with the state in Swedish, so the system is usable from the menu
    // on its own. `appraisals.talks` cannot carry the word, since its rows are exactly the profile's.
    {
      name: 'appraisals.round',
      kind: 'read',
      title: 'Samtalsomgången',
      description: 'Var varje medarbetare som du är chef för står i den öppna omgången utvecklingssamtal.',
      model: false,
      scope: { roles: ['manager'] },
      input: Empty,
      output: OverviewOutput,
      view: {
        kind: 'table',
        title: 'name',
        modelReads: 'summary',
        noun: { one: 'medarbetare', other: 'medarbetare' },
        empty: 'Du är inte chef för någon i den här omgången.',
        fields: [
          { key: 'name', label: 'Medarbetare' },
          { key: 'status', label: 'Samtal', format: 'status', tones: { Saknas: 'warn' } },
          { key: 'bookedAt', label: 'Bokat', format: 'instant' },
          { key: 'heldOn', label: 'Hållet', format: 'date' },
          { key: 'openCommitments', label: 'Öppna åtgärdspunkter', format: 'number' },
          { key: 'link', label: 'Öppna i samtalssystemet', format: 'link' },
        ],
      },
    },
    // What its rows are about (D97): Clew draws it as a section on the opened person, may offer it as a lens on
    // Personal, and marks a row whose talk is missing. Never a model tool; the row opens the person's action points.
    {
      name: 'appraisals.person',
      kind: 'read',
      title: 'Utvecklingssamtal',
      description:
        'Var varje medarbetare som du är chef för står i den öppna omgången utvecklingssamtal, och hur många åtgärdspunkter som är försenade.',
      model: false,
      scope: { roles: ['manager'] },
      about: { entity: 'person' },
      // Only the manager's reports are asked about (D117); the system still answers only for those it has them as manager of.
      person: { admits: ['managed'] },
      input: PersonInput,
      output: PersonOutput,
      view: {
        kind: 'list',
        title: 'state',
        empty: 'Ingen av dem är med i omgången.',
        fields: [
          { key: 'state', label: 'Samtal', format: 'status', tones: { Saknas: 'warn' } },
          { key: 'at', label: 'När', format: 'instant' },
          { key: 'overdue', label: 'Försenade', format: 'number' },
        ],
        open: { capability: 'appraisals.commitments', title: 'Åtgärdspunkter', params: { person: 'key' } },
      },
    },
  ],
};

const DAY = 86_400_000;
const stockholmDay = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const stockholmOffset = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Stockholm', timeZoneName: 'longOffset' });
/** A day `offset` days from `today` (both `YYYY-MM-DD`). */
const plusDays = (today, offset) =>
  new Date(Date.parse(today + 'T00:00:00Z') + offset * DAY).toISOString().slice(0, 10);
/** A local time in Swedish time on a day, as an instant with the offset that day has. */
function stockholmInstant(day, time) {
  const zone = stockholmOffset.formatToParts(new Date(day + 'T12:00:00Z')).find(p => p.type === 'timeZoneName')?.value;
  const offset = zone && zone !== 'GMT' ? zone.slice(3) : '+00:00';
  return `${day}T${time}:00${offset}`;
}

/** What the system holds, as of `today`: the round, each person's talk and the action points. */
export function recordsFor(today, linkBase = DEFAULT_LINK_BASE) {
  const opensOn = plusDays(today, ROUND.opensIn),
    dueOn = plusDays(today, ROUND.dueIn);
  const round = { label: `Utvecklingssamtal ${dueOn.slice(0, 4)}`, opensOn, dueOn };
  const people = new Map(PEOPLE.map(p => [p.userName, p]));
  const commitments = COMMITMENTS.filter(c => people.has(c.person)).map(c => {
    const done = typeof c.doneDaysAgo === 'number';
    return {
      ref: `commitment:${CONNECTOR}:${c.id}`,
      userName: c.person,
      name: people.get(c.person).name,
      owner: c.owner,
      text: c.text,
      dueOn: plusDays(today, c.dueIn),
      done,
      ...(done ? { doneAt: stockholmInstant(plusDays(today, -c.doneDaysAgo), '15:00') } : {}),
      carried: c.round === 'earlier' && !done,
      link: `${linkBase}/action-points/${encodeURIComponent(c.id)}`,
    };
  });
  const talks = PEOPLE.map(p => {
    const talk = TALKS[p.userName];
    const state = talk?.state ?? 'missing';
    return {
      manager: p.manager,
      row: {
        ref: `talk:${CONNECTOR}:${ROUND.id}:${p.userName}`,
        userName: p.userName,
        name: p.name,
        state,
        ...(state === 'held' ? { at: plusDays(today, talk.day) } : {}),
        ...(state === 'booked' ? { at: stockholmInstant(plusDays(today, talk.day), talk.time) } : {}),
        openCommitments: commitments.filter(c => c.userName === p.userName && !c.done).length,
        link: `${linkBase}/rounds/${ROUND.id}/talks/${encodeURIComponent(p.userName)}`,
      },
    };
  });
  return { round, talks, commitments, managerOf: userName => people.get(sameName(userName))?.manager };
}
/** User names are compared without regard to case (SCIM's default for `userName`); the tables hold them in lower case. */
const sameName = value => String(value).toLowerCase();

const STATE_ORDER = ['missing', 'booked', 'held'];
/** Carried first, then open before done, then by the day due: the order the next talk goes through them in. */
const commitmentOrder = (a, b) =>
  Number(b.carried) - Number(a.carried) ||
  Number(a.done) - Number(b.done) ||
  a.dueOn.localeCompare(b.dueOn) ||
  a.ref.localeCompare(b.ref);
/** The caller's own list: the open ones they are to do first, then the open ones about them, each carried first; done last. */
const ownOrder = (a, b) => Number(a.done) - Number(b.done) || Number(b.mine) - Number(a.mine) || commitmentOrder(a, b);

class Invalid extends Error {}

/**
 * Build the service. `jwks` and `clewUrl` are how it verifies Clew's assertions; `today` gives the day the records are
 * dated from (default: the clock, in Swedish time); `personMap` maps a Clew person id to this system's user name, for a
 * person Clew knows without one.
 */
export function createConnector({
  jwks,
  secret,
  clewUrl = process.env.CLEW_URL ?? '',
  fetch: fetchImpl = globalThis.fetch,
  today = () => stockholmDay.format(new Date()),
  personMap = {},
  linkBase = DEFAULT_LINK_BASE,
} = {}) {
  const verify = createVerifier({ secret, jwks, clewUrl, fetch: fetchImpl }, CONNECTOR);
  const known = [...PEOPLE, ...MANAGERS];

  /**
   * Who is asking, in this system's terms. Clew signs the person's provisioned user name into the assertion (D97), and
   * that is the key this system holds: it comes first. A person Clew knows without one is found by the operator's map
   * (`FIXTURE_PERSON_MAP`, Clew person id to user name), then by an id that is a user name here (a test's persona).
   * Never by the name: two people can share one.
   */
  function callerOf(actor) {
    if (typeof actor.userName === 'string' && actor.userName) return sameName(actor.userName);
    if (typeof personMap[actor.id] === 'string') return sameName(personMap[actor.id]);
    if (known.some(p => p.userName === sameName(actor.id))) return sameName(actor.id);
    return actor.id;
  }

  const capabilities = {
    'appraisals.talks': (caller, input) => {
      if (Object.keys(input).length) throw new Invalid('Ogiltig förfrågan.');
      const { round, talks } = recordsFor(today(), linkBase);
      const rows = talks
        .filter(t => t.manager === caller)
        .map(t => t.row)
        .sort(
          (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.name.localeCompare(b.name, 'sv'),
        );
      return { round, rows };
    },
    'appraisals.commitments': (caller, input) => {
      const keys = Object.keys(input);
      if (keys.some(k => k !== 'person')) throw new Invalid('Ogiltig förfrågan.');
      if (
        input.person !== undefined &&
        (typeof input.person !== 'string' || !input.person.length || input.person.length > 512)
      )
        throw new Invalid('Ogiltig förfrågan.');
      const person = input.person === undefined ? undefined : sameName(input.person);
      const { commitments, managerOf } = recordsFor(today(), linkBase);
      const rows =
        person === undefined
          ? // The caller's: those they are to do, as the employee or as the employee's manager, and those about them.
            commitments
              .map(c => ({
                ...c,
                mine: c.owner === 'employee' ? c.userName === caller : managerOf(c.userName) === caller,
              }))
              .filter(c => c.mine || c.userName === caller)
          : // One employee's, for their manager or the employee; nobody else sees them.
            managerOf(person) === caller || person === caller
            ? commitments
                .filter(c => c.userName === person)
                .map(c => ({ ...c, mine: c.owner === (person === caller ? 'employee' : 'manager') }))
            : [];
      return { rows: rows.sort(person === undefined ? ownOrder : commitmentOrder) };
    },
    'appraisals.round': caller => {
      const { talks } = recordsFor(today(), linkBase);
      const rows = talks
        .filter(t => t.manager === caller)
        .map(({ row }) => ({
          ref: row.ref,
          name: row.name,
          status: STATE_WORDS[row.state],
          ...(row.state === 'booked' ? { bookedAt: row.at } : {}),
          ...(row.state === 'held' ? { heldOn: row.at } : {}),
          openCommitments: row.openCommitments,
          link: row.link,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
      return { rows };
    },
    // One row per key asked about a person the caller is manager of, with the key as it was asked; a key asked twice,
    // an unknown one and anyone else's person are no row.
    'appraisals.person': (caller, input) => {
      const keys = input.keys;
      if (
        Object.keys(input).some(k => k !== 'keys') ||
        !Array.isArray(keys) ||
        keys.length > KEYS_MAX ||
        keys.some(k => typeof k !== 'string' || !k.length || k.length > 512)
      )
        throw new Invalid('Ogiltig förfrågan.');
      const day = today();
      const { talks, commitments } = recordsFor(day, linkBase);
      const answered = new Set();
      const rows = [];
      for (const key of keys) {
        const talk = talks.find(t => t.row.userName === sameName(key) && t.manager === caller);
        if (!talk || answered.has(talk.row.userName)) continue;
        answered.add(talk.row.userName);
        const { state, at } = talk.row;
        rows.push({
          key,
          state: STATE_WORDS[state],
          ...(at ? { at } : {}),
          overdue: commitments.filter(c => c.userName === talk.row.userName && !c.done && c.dueOn < day).length,
        });
      }
      return { rows };
    },
  };

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fail = (code, message, status) => json({ error: { code, message } }, status);

  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) return fail('not-found', 'Okänd adress.', 404);
    // The actor is the verified assertion's, never the body's: Clew signed who is asking.
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(token, request.headers.get('x-clew-connector-key'), request);
    if (!actor) return fail('denied', 'Ogiltigt behörighetsbevis.', 401);
    let body;
    try {
      body = await request.json();
    } catch {
      return fail('invalid', 'Ogiltig förfrågan.', 400);
    }
    const name = url.pathname.startsWith('/clew/capabilities/')
      ? decodeURIComponent(url.pathname.slice('/clew/capabilities/'.length))
      : '';
    const capability = capabilities[name];
    if (!capability) return fail('not-found', 'Okänd förmåga.', 404);
    const input = body && typeof body.input === 'object' && body.input && !Array.isArray(body.input) ? body.input : {};
    if ((name === 'appraisals.round' || name === 'appraisals.person') && actor.role !== 'manager')
      return fail('denied', 'Bara för chefer.', 403);
    try {
      return json({ output: capability(callerOf(actor), input) });
    } catch (error) {
      if (error instanceof Invalid) return fail('invalid', error.message, 400);
      return fail('unavailable', 'Samtalssystemet svarar inte just nu.', 503);
    }
  }
  return { manifest, handle };
}
