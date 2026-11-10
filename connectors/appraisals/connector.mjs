// The appraisals connector (D96 items 8 and 9): a generic stand-in for a third-party system that holds the round of
// development talks and the action points agreed in them. It answers the talks profile, `appraisals.talks` and
// `appraisals.commitments`, in the shapes Clew's pages read, keyed on the provisioned user name; Clew shows them
// read-only and a row opens this system by its link. Stateless: the records are the tables in fixture.mjs, dated from
// today. No dependencies beyond Node; nothing here imports Clew, so the profile's shapes are written out below.
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

export const manifest = {
  protocol: 2,
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
        'Åtgärdspunkter från utvecklingssamtalen: en medarbetares, för medarbetarens chef, eller utan medarbetare de som är dina.',
      model: false,
      scope: {},
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
  return { round, talks, commitments, managerOf: userName => people.get(userName)?.manager };
}

const STATE_ORDER = ['missing', 'booked', 'held'];
/** Carried first, then open before done, then by the day due: the order the next talk goes through them in. */
const commitmentOrder = (a, b) =>
  Number(b.carried) - Number(a.carried) ||
  Number(a.done) - Number(b.done) ||
  a.dueOn.localeCompare(b.dueOn) ||
  a.ref.localeCompare(b.ref);

class Invalid extends Error {}

/**
 * Build the service. `jwks` and `clewUrl` are how it verifies Clew's assertions; `today` gives the day the records are
 * dated from (default: the clock, in Swedish time); `personMap` maps a Clew person id to this system's user name.
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
   * Who is asking, in this system's terms. Clew's assertion carries the person's id and name, not their user name, so:
   * the operator's map first (`FIXTURE_PERSON_MAP`), then an id that is a user name here (the persona `hillevi`),
   * then, for the development stack whose person ids are generated, the name. A real connector maps from what its
   * installation gives it; matching on a name is a fixture's shortcut.
   */
  function callerOf(actor) {
    if (typeof personMap[actor.id] === 'string') return personMap[actor.id];
    if (known.some(p => p.userName === actor.id)) return actor.id;
    return known.find(p => p.name === actor.name)?.userName ?? actor.id;
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
      const person = input.person;
      if (person !== undefined && (typeof person !== 'string' || !person.length || person.length > 512))
        throw new Invalid('Ogiltig förfrågan.');
      const { commitments, managerOf } = recordsFor(today(), linkBase);
      const rows =
        person === undefined
          ? // The caller's own: those they are to do, as the employee or as the employee's manager.
            commitments
              .filter(c => (c.owner === 'employee' ? c.userName === caller : managerOf(c.userName) === caller))
              .map(c => ({ ...c, mine: true }))
          : // One employee's, for their manager or the employee; nobody else sees them.
            managerOf(person) === caller || person === caller
            ? commitments
                .filter(c => c.userName === person)
                .map(c => ({ ...c, mine: c.owner === (person === caller ? 'employee' : 'manager') }))
            : [];
      return { rows: rows.sort(commitmentOrder) };
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
    const actor = await verify(token, request.headers.get('x-clew-connector-key'));
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
    if (name === 'appraisals.round' && actor.role !== 'manager') return fail('denied', 'Bara för chefer.', 403);
    try {
      return json({ output: capability(callerOf(actor), input) });
    } catch (error) {
      if (error instanceof Invalid) return fail('invalid', error.message, 400);
      return fail('unavailable', 'Samtalssystemet svarar inte just nu.', 503);
    }
  }
  return { manifest, handle };
}
