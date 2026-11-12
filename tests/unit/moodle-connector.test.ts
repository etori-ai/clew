import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { openRef, type Relation, type ViewOpen } from '@clew/contracts';
import {
  Registry,
  openGovernance,
  placesOf,
  type Actor,
  type RelationResolver,
} from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { namedInputs } from '../../packages/connectors/src/named';
import { manifestProblems, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector } from '../../connectors/moodle/connector.mjs';
import {
  ItemUnreadable,
  SourceRefused,
  SourceUnavailable,
  createFixtureLearning,
  type LearningSource,
} from '../../connectors/moodle/learning.mjs';
import {
  createMoodleLearning,
  formOf,
  parseCompletion,
  plainText,
  unescapeText,
} from '../../connectors/moodle/moodle.mjs';
import { HoldingsOutput, manifest as moodleManifest } from '../../connectors/moodle/manifest.mjs';
import { assertionFor, signedRequest, testJwks } from '../connector-authority';

/**
 * The Moodle connector: what a learning platform knows about a person, read as one service account. Who may be asked
 * about is Clew's (D117): the connector answers exactly the keys a verified request vouches for as `self` or `managed`.
 * The connector over its in-memory stand-in (learning.mjs) through Clew's registry, with a directory that says how each
 * reader stands to each person, and straight to the service as Clew would call it; the conformance check; and the API
 * adapter (moodle.mjs) against the answers the development Moodle gave (connectors/moodle/samples).
 */
const ID = 'moodle';
const secret = 'test-secret-test-secret';
const at = Date.parse('2026-11-12T10:00:00Z');
const DAY = 86_400_000;
const days = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const spoken = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
/** The day `n` days before the test's clock, as the connector writes a day. */
const ago = (n: number) => days.format(new Date(at - n * DAY));
const PUBLIC = 'https://larplattform.example';
const NOT_FOUND = 'Personen finns inte i Lärplattformen, eller så får du inte se uppgifterna.';
/** What Clew's registry answers a call whose one person the caller may not be asked about (D117). */
const REFUSED_BY_CLEW = 'Okänd förmåga.';

const person = (userName: string, name: string, role: Actor['role'] = 'employee', unitId = 'unit-skola'): Actor => ({
  id: 'person-' + userName,
  name,
  unitId,
  unitLabel: 'Enheten',
  role,
  userName,
});
// Hillevi as Clew signs her in: her user name in another case.
const hillevi = person('Hillevi', 'Hillevi Berg', 'manager');
const anna = person('anna', 'Anna Lindqvist');
const hassan = person('hassan', 'Hassan Ali', 'employee', 'unit-omsorg');
// A manager of two units, Hassan's and Mikael's; Clew signs one of them as the actor's unit.
const twoUnits = person('omsorg.chef', 'Chef Omsorg', 'manager', 'unit-omsorg');
// A manager higher in the tree: the school's manager, Hillevi, reports to them.
const rektor = person('rektor', 'Rektor Områdeschef', 'manager', 'unit-grundskola');
const ajv = addFormats(new Ajv({ strict: false }));

/**
 * How each reader stands to each person, as Clew's directory says it (D117, D99): their own, their direct reports, and
 * anyone else Clew knows is a colleague. `nobody` is a person Clew knows and Moodle does not. Spelt in lower case, as the
 * directory spells user names.
 */
const READS: Record<string, Record<string, Relation>> = {
  hillevi: {
    hillevi: 'self',
    anna: 'managed',
    erik: 'managed',
    maria: 'managed',
    johan: 'managed',
    karin: 'managed',
    lisa: 'managed',
    sara: 'managed',
    nobody: 'managed',
  },
  anna: { anna: 'self' },
  hassan: { hassan: 'self' },
  'omsorg.chef': { 'omsorg.chef': 'self', hassan: 'managed', mikael: 'managed' },
  rektor: { rektor: 'self', hillevi: 'managed' },
};
const KNOWN = new Set([...Object.keys(READS), ...Object.values(READS).flatMap(Object.keys)]);
/** The test's directory as Clew's rule: the relation of each key the reader may be asked about under `admits`. */
const directory: RelationResolver = async (actor, entity, keys, admits) =>
  keys.flatMap(asked => {
    const key = asked.toLowerCase();
    if (entity !== 'person' || !actor.userName || !KNOWN.has(key)) return [];
    const relation = READS[actor.userName.toLowerCase()]?.[key] ?? 'colleague';
    return admits.includes(relation) ? [{ asked, key, relation }] : [];
  });
/** What Clew would vouch for in `about`, from the same directory, for a call made straight to the service. */
const vouch = (actor: Actor, keys: string[]) => ({
  entity: 'person',
  relations: Object.fromEntries(
    keys.flatMap(k => {
      const relation = READS[(actor.userName ?? '').toLowerCase()]?.[k.toLowerCase()];
      return relation === 'self' || relation === 'managed' ? [[k, relation]] : [];
    }),
  ),
});

type Row = Record<string, unknown>;
type Holding = { id: string; type: string; label: string; kind: string; issuedOn: string; expiresOn?: string };
type HoldingsRow = { key: string; holdings: Holding[]; partial?: true };
type HoldingsAnswer = { withdrawalsReported: false; rows: HoldingsRow[] };

function stack(options: Parameters<typeof createConnector>[0] = {}) {
  const learning = createFixtureLearning({ now: () => at });
  const service = createConnector({ jwks: testJwks, secret, source: learning, now: () => at, ...options });
  const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
  const registry = new Registry({ relations: directory });
  registry.register(
    remoteConnector(parseManifest(service.manifest, ID), {
      url: 'http://moodle-connector',
      key: secret,
      assert: assertionFor(ID, secret),
      fetch: connectorFetch,
    }),
  );
  registry.govern(ID, openGovernance());
  const personRows = async (actor: Actor, keys: string[]) =>
    (await registry.run<{ rows: Row[] }>(actor, `${ID}.person`, { keys })).rows;
  const courses = async (actor: Actor, who: string) =>
    (await registry.run<{ rows: Row[] }>(actor, `${ID}.courses`, { person: who })).rows;
  const course = (actor: Actor, who: string, id: string) =>
    registry.run<Row>(actor, `${ID}.course`, { person: who, course: id });
  /**
   * A request straight to the service as Clew sends it (D117): the body, with the `about` given, bound to the assertion.
   * Without `about` it is a call that vouches for nobody: a Clew on protocol 2, or anything that sends keys past Clew.
   */
  const post = async (
    actor: Actor,
    capability: string,
    input: object,
    { about, signal }: { about?: object; signal?: AbortSignal } = {},
  ) => {
    const request = await signedRequest(`http://moodle-connector/clew/capabilities/${capability}`, {
      id: ID,
      actor,
      key: secret,
      body: { actor, input, ...(about ? { about } : {}) },
    });
    return service.handle(signal ? new Request(request, { signal }) : request);
  };
  /**
   * The holdings profile, called as Clew would call it if it could vouch for its keys. It cannot: protocol 3 declares a
   * list of people only on a read about a person, so through the registry the read gets no `about` (tested below).
   */
  const holdingsAnswer = async (actor: Actor, keys: string[]) => {
    const response = await post(actor, `${ID}.holdings`, { keys }, { about: vouch(actor, keys) });
    if (response.status !== 200) throw new Error('holdings answered ' + response.status);
    return ((await response.json()) as { output: HoldingsAnswer }).output;
  };
  const holdings = async (actor: Actor, keys: string[]) => (await holdingsAnswer(actor, keys)).rows;
  return {
    registry,
    learning,
    service,
    connectorFetch,
    personRows,
    courses,
    course,
    holdings,
    holdingsAnswer,
    post,
  };
}

/** A stand-in whose methods can be wrapped: each call goes through `wrap` with its method name and options. */
function wrapped(
  wrap: (method: string, call: () => Promise<unknown>, options: { signal?: AbortSignal }) => Promise<unknown>,
): LearningSource & { inner: ReturnType<typeof createFixtureLearning> } {
  const inner = createFixtureLearning({ now: () => at });
  const through =
    (method: keyof LearningSource) =>
    (...args: unknown[]) => {
      const options = (args[args.length - 1] ?? {}) as { signal?: AbortSignal };
      return wrap(method, () => (inner[method] as (...a: unknown[]) => Promise<unknown>)(...args), options);
    };
  return {
    inner,
    accounts: through('accounts') as LearningSource['accounts'],
    courses: through('courses') as LearningSource['courses'],
    completion: through('completion') as LearningSource['completion'],
    completionStatus: through('completionStatus') as LearningSource['completionStatus'],
    course: through('course') as LearningSource['course'],
    badges: through('badges') as LearningSource['badges'],
  };
}

describe('the Moodle connector', () => {
  test('declares protocol 3, what each read admits, and that none of them is a tool', () => {
    expect(manifestProblems(moodleManifest, ID)).toEqual([]);
    const m = parseManifest(moodleManifest, ID);
    expect([m.protocol, m.kind, m.source, m.scan, m.areas]).toEqual([3, 'passthrough', 'Lärplattformen', false, []]);
    expect(m.capabilities.map(c => [c.name, c.kind, c.model, c.about ?? null, c.view?.kind ?? null])).toEqual([
      ['moodle.person', 'read', false, { entity: 'person' }, 'list'],
      ['moodle.courses', 'read', false, null, 'list'],
      ['moodle.course', 'read', false, null, 'detail'],
      ['moodle.holdings', 'read', false, null, null],
    ]);
    // A person reads their own; a manager their direct reports; never a colleague (D117).
    expect(m.capabilities.map(c => [c.name, c.person ?? null])).toEqual([
      ['moodle.person', { admits: ['self', 'managed'] }],
      ['moodle.courses', { param: 'person', admits: ['self', 'managed'] }],
      ['moodle.course', { param: 'person', admits: ['self', 'managed'] }],
      ['moodle.holdings', null],
    ]);
    // Clew resolves the three; the holdings' list of people is not something protocol 3 can declare on a read that is
    // not about a person, so nobody in it is resolved, and it gets no `about`.
    expect([...namedInputs(m).entries()].map(([name, n]) => [name, n.keys, n.params, n.admits])).toEqual([
      ['moodle.person', true, [], ['self', 'managed']],
      ['moodle.courses', false, ['person'], ['self', 'managed']],
      ['moodle.course', false, ['person'], ['self', 'managed']],
    ]);
    const declared = m.capabilities[0]!;
    // A section on the opened person and a lens an administrator may offer; no tone, so no mark.
    expect(placesOf(declared)).toEqual(['lens', 'section']);
    expect(declared.view).toMatchObject({
      kind: 'list',
      open: { capability: 'moodle.courses', title: 'Kurser och märken', params: { person: 'key' } },
    });
    // A course's row in the list opens the course, by the person's key and the course's id.
    expect(m.capabilities[1]!.view).toMatchObject({
      open: { capability: 'moodle.course', title: 'Kurs', params: { person: 'person', course: 'course' } },
    });
    expect(stack().registry.tools(hillevi)).toEqual([]);
    // The installation names its platform.
    const named = parseManifest(stack({ sourceLabel: 'Kompetensportalen' }).service.manifest, ID);
    expect(named.source).toBe('Kompetensportalen');
  });

  test('moodle.person: one row per key the platform knows, keyed as Clew spells it; a person with an account and no course has a row of zeros, a person without one has none', async () => {
    const { personRows } = stack();
    expect(await personRows(hillevi, ['hillevi', 'Anna', 'nobody', 'lisa', 'anna', 'maria'])).toEqual([
      { key: 'hillevi', completed: 5, ongoing: 1 },
      { key: 'anna', completed: 4, ongoing: 1 },
      { key: 'lisa', completed: 0, ongoing: 0 },
      // Maria's course that records no completion counts for neither.
      { key: 'maria', completed: 3, ongoing: 2 },
    ]);
    expect(await personRows(hillevi, [])).toEqual([]);
  });

  test('moodle.courses: what is under way, what was completed and when, newest first, and the badges with their end; a course row opens the course and links to it', async () => {
    const { courses } = stack({ publicUrl: PUBLIC });
    const link = (id: number) => `${PUBLIC}/course/view.php?id=${id}`;
    const opens = (id: number) => ({ person: 'hillevi', course: String(id), link: link(id) });
    expect(await courses(hillevi, 'HILLEVI')).toEqual([
      { name: 'Informationssäkerhet för medarbetare', kind: 'Kurs', status: 'Pågår', ...opens(4) },
      { name: 'Brandskydd, grundutbildning', kind: 'Kurs', status: 'Genomförd', date: ago(40), ...opens(2) },
      { name: 'Arbetsmiljö för chefer', kind: 'Kurs', status: 'Genomförd', date: ago(120), ...opens(7) },
      {
        name: 'Läkemedelshantering, delegeringsutbildning',
        kind: 'Kurs',
        status: 'Genomförd',
        date: ago(400),
        ...opens(6),
      },
      { name: 'Hjärt-lungräddning med hjärtstartare', kind: 'Kurs', status: 'Genomförd', date: ago(700), ...opens(3) },
      { name: 'Livsmedelshygien', kind: 'Kurs', status: 'Genomförd', date: ago(1100), ...opens(5) },
      // A badge opens nothing and links nowhere: Moodle's answer holds no address for it.
      { name: 'HLR-instruktör', kind: 'Märke', status: 'Giltigt', date: ago(100), expiresOn: ago(-265) },
    ]);
    expect(ago(40)).toBe('2026-10-03');
    // A badge that has run out, and one that never does.
    expect((await courses(hillevi, 'erik')).filter(r => r.kind === 'Märke')).toEqual([
      { name: 'Heta arbeten', kind: 'Märke', status: 'Utgånget', date: ago(400), expiresOn: ago(35) },
    ]);
    expect((await courses(hillevi, 'maria')).filter(r => r.kind === 'Märke')).toEqual([
      { name: 'Heta arbeten', kind: 'Märke', status: 'Giltigt', date: ago(20) },
    ]);
    // Johan's, as the seed gives it: a year from 400 days ago.
    expect((await courses(hillevi, 'johan')).filter(r => r.kind === 'Märke')).toEqual([
      { name: 'HLR-instruktör', kind: 'Märke', status: 'Utgånget', date: ago(400), expiresOn: ago(35) },
    ]);
    expect(await courses(hillevi, 'lisa')).toEqual([]);
    // A report Moodle does not know is not found, as Clew shows any read that is not found.
    await expect(courses(hillevi, 'nobody')).rejects.toThrow(NOT_FOUND);
    // Without a public address there are no links, and the row still opens the course.
    expect((await stack().courses(hillevi, 'hillevi'))[0]).toEqual({
      name: 'Informationssäkerhet för medarbetare',
      kind: 'Kurs',
      status: 'Pågår',
      person: 'hillevi',
      course: '4',
    });
  });

  test('moodle.course: one course as the list row opens it: category, status, the day, the criteria met and the summary, with a link', async () => {
    const { courses, course, registry } = stack({ publicUrl: PUBLIC });
    const row = (await courses(hillevi, 'hillevi')).find(r => r.course === '2')!;
    const declared = parseManifest(moodleManifest, ID).capabilities.find(c => c.name === 'moodle.courses')!;
    const ref = openRef((declared.view as { open: ViewOpen }).open, row, 'Lärplattformen')!;
    expect(ref.input).toEqual({ person: 'hillevi', course: '2' });
    expect(await registry.run(hillevi, ref.capability, ref.input)).toEqual({
      name: 'Brandskydd, grundutbildning',
      category: 'Obligatoriska utbildningar',
      status: 'Genomförd',
      completedOn: ago(40),
      criteria: [`Markerad som klar av Teacher: uppfyllt ${spoken.format(new Date(at - 40 * DAY))}`],
      summary: 'Brandskydd, grundutbildning, som arbetsgivaren kräver.',
      link: `${PUBLIC}/course/view.php?id=2`,
    });
    // Under way: no day, the criterion not met.
    expect(await course(hillevi, 'hillevi', '4')).toEqual({
      name: 'Informationssäkerhet för medarbetare',
      category: 'Obligatoriska utbildningar',
      status: 'Pågår',
      criteria: ['Markerad som klar av Teacher: inte uppfyllt'],
      summary: 'Informationssäkerhet för medarbetare, som arbetsgivaren kräver.',
      link: `${PUBLIC}/course/view.php?id=4`,
    });
    // The person themself, an employee, and a manager's report.
    expect((await course(anna, 'anna', '2')).status).toBe('Genomförd');
    expect((await course(hillevi, 'anna', '2')).status).toBe('Genomförd');
  });

  test('moodle.course: someone Clew will not have asked about is refused by Clew; an unknown person, a course they are not on and one that does not exist are not found, and nothing about the course is read', async () => {
    const { course, learning, post } = stack();
    const before = learning.controls.calls.course;
    // A colleague, for an employee and for a manager: Clew refuses before the connector is called.
    await expect(course(anna, 'erik', '2')).rejects.toThrow(REFUSED_BY_CLEW);
    await expect(course(hillevi, 'hassan', '2')).rejects.toThrow(REFUSED_BY_CLEW);
    for (const [who, id] of [
      ['nobody', '2'], // a report with no account in Moodle
      ['lisa', '2'], // an account on no course
      ['hillevi', '8'], // a course that exists, she is not on
      ['maria', '8'], // on it, and it records no completion: the list does not show it
      ['hillevi', '999'], // no such course
    ] as const)
      await expect(course(hillevi, who, id)).rejects.toThrow(NOT_FOUND);
    expect(learning.controls.calls.course).toBe(before);
    // The course id is the caller's: digits only, as the list gives it.
    const about = vouch(hillevi, ['hillevi']);
    for (const input of [
      { person: 'hillevi', course: 'abc' },
      { person: 'hillevi', course: '0' },
      { person: 'hillevi', course: '02' },
      { person: 'hillevi', course: 2 },
      { person: 'hillevi' },
      { person: 'hillevi', course: '2', extra: 1 },
    ])
      expect((await post(hillevi, 'moodle.course', input, { about })).status).toBe(400);
  });

  test('moodle.holdings: per person the platform knows, every completed course and badge with its days; holding nothing and being unknown are told apart; absence is never a withdrawal', async () => {
    const { holdingsAnswer } = stack();
    const answer = await holdingsAnswer(hillevi, ['hillevi', 'lisa', 'nobody', 'erik']);
    expect(ajv.validate(HoldingsOutput as object, answer)).toBe(true);
    // The source says outright that it reports no withdrawals: a holding missing next time is not revoked.
    expect(answer.withdrawalsReported).toBe(false);
    expect(ajv.validate(HoldingsOutput as object, { rows: answer.rows })).toBe(false);
    const rows = answer.rows;
    expect(rows.map(r => r.key)).toEqual(['hillevi', 'lisa', 'erik']);
    const [h, lisa, erik] = rows;
    expect(h!.holdings).toEqual([
      {
        id: 'course:2:user:3',
        type: 'clew-dev:brandskydd',
        label: 'Brandskydd, grundutbildning',
        kind: 'course',
        issuedOn: ago(40),
      },
      {
        id: 'course:3:user:3',
        type: 'clew-dev:hlr',
        label: 'Hjärt-lungräddning med hjärtstartare',
        kind: 'course',
        issuedOn: ago(700),
      },
      {
        id: 'course:5:user:3',
        type: 'clew-dev:livsmedelshygien',
        label: 'Livsmedelshygien',
        kind: 'course',
        issuedOn: ago(1100),
      },
      {
        id: 'course:6:user:3',
        type: 'clew-dev:lakemedel',
        label: 'Läkemedelshantering, delegeringsutbildning',
        kind: 'course',
        issuedOn: ago(400),
      },
      // A course without an idnumber is typed by its Moodle id.
      { id: 'course:7:user:3', type: 'course:7', label: 'Arbetsmiljö för chefer', kind: 'course', issuedOn: ago(120) },
      {
        id: 'badge:1:user:3',
        type: 'badge:1',
        label: 'HLR-instruktör',
        kind: 'badge',
        issuedOn: ago(100),
        expiresOn: ago(-265),
      },
    ]);
    expect(h!.partial).toBeUndefined();
    // Lisa has an account and holds nothing: a row with no holdings. "nobody" has no account: no row at all.
    expect(lisa).toEqual({ key: 'lisa', holdings: [] });
    // A badge keeps its end date after it has run out: the register decides what that means.
    expect(erik!.holdings.find(x => x.kind === 'badge')).toEqual({
      id: 'badge:2:user:7',
      type: 'badge:2',
      label: 'Heta arbeten',
      kind: 'badge',
      issuedOn: ago(400),
      expiresOn: ago(35),
    });
    // Nothing about the person beyond the key: no name, no Moodle user name.
    expect(JSON.stringify(rows)).not.toContain('Hillevi');
  });

  test('moodle.holdings through Clew: protocol 3 cannot declare its list of people, so Clew vouches for nobody and the read answers no row', async () => {
    const { registry, learning } = stack();
    const before = { ...learning.controls.calls };
    expect(await registry.run(hillevi, 'moodle.holdings', { keys: ['hillevi', 'anna'] })).toEqual({
      withdrawalsReported: false,
      rows: [],
    });
    // Nothing was looked up.
    expect(learning.controls.calls).toEqual(before);
  });

  test('a completed course whose day cannot be read is left out and the row says it is partial', async () => {
    const { holdings, learning } = stack();
    const before = (await holdings(hillevi, ['maria']))[0]!;
    expect(before.partial).toBeUndefined();
    expect(before.holdings).toHaveLength(4);
    // Maria's welcome course records no completion; marked complete anyway, Moodle has no day to give for it.
    learning.controls.complete('maria', 8, 3);
    const [row] = await holdings(hillevi, ['maria']);
    expect(row!.partial).toBe(true);
    expect(row!.holdings).toEqual(before.holdings);
  });

  test("one person's or one course's refusal leaves that item out and marks the person partial; the rest of the batch stands", async () => {
    const { holdings, personRows, courses, learning, post } = stack();
    const full = await holdings(hillevi, ['hillevi', 'anna']);
    // Moodle withholds one course's completion for Hillevi, and Anna's whole course list.
    learning.controls.unreadable('completion', 'hillevi', 2);
    learning.controls.unreadable('courses', 'anna');
    const [h, a] = await holdings(hillevi, ['hillevi', 'anna']);
    expect(h!.partial).toBe(true);
    expect(h!.holdings.map(x => x.id)).toEqual(full[0]!.holdings.map(x => x.id).filter(id => id !== 'course:2:user:3'));
    expect(a).toEqual({ key: 'anna', holdings: full[1]!.holdings.filter(x => x.kind === 'badge'), partial: true });
    // No true count for Anna, so no row; Hillevi's stands.
    expect((await personRows(hillevi, ['hillevi', 'anna'])).map(r => r.key)).toEqual(['hillevi']);
    // Hillevi's list shows the course without the day Moodle withheld.
    const withheld = (await courses(hillevi, 'hillevi')).find(r => r.course === '2')!;
    expect(withheld.status).toBe('Genomförd');
    expect(withheld.date).toBeUndefined();
    // One person's list with a part refused is not answered as if it were whole.
    expect(
      (await post(hillevi, 'moodle.courses', { person: 'anna' }, { about: vouch(hillevi, ['anna']) })).status,
    ).toBe(503);
    // Badges refused for one person: their courses stand.
    learning.controls.unreadable('badges', 'erik');
    const [e] = await holdings(hillevi, ['erik']);
    expect(e!.partial).toBe(true);
    expect(e!.holdings.every(x => x.kind === 'course')).toBe(true);
    expect(e!.holdings.length).toBeGreaterThan(0);
  });

  // Who may be asked about is Clew's (D117): every call that names a person carries, in a body the assertion is bound
  // to, how the caller stands to each key. The connector answers `self` and `managed`, and nothing else.
  test('Clew decides who is asked about: a person reads their own, a manager their reports, and Clew never sends a colleague', async () => {
    const { personRows, courses, registry } = stack();
    // Self: an employee, whatever they ask for, is answered about themself only.
    expect((await personRows(anna, ['anna', 'hillevi', 'erik'])).map(r => r.key)).toEqual(['anna']);
    expect((await courses(anna, 'ANNA')).length).toBeGreaterThan(0);
    // Managed: Hillevi's reports, not Hassan or Mikael, who are not hers.
    expect((await personRows(hillevi, ['anna', 'hassan', 'mikael'])).map(r => r.key)).toEqual(['anna']);
    // A colleague's single key is refused by Clew before the connector is called.
    await expect(courses(anna, 'erik')).rejects.toThrow(REFUSED_BY_CLEW);
    await expect(courses(hillevi, 'hassan')).rejects.toThrow(REFUSED_BY_CLEW);
    // A manager of several units reaches the reports on each, and a manager higher in the tree the managers below,
    // because Clew says so: the connector holds no organisation of its own.
    expect((await personRows(twoUnits, ['hassan', 'mikael', 'anna'])).map(r => r.key)).toEqual(['hassan', 'mikael']);
    expect((await personRows(rektor, ['hillevi', 'anna'])).map(r => r.key)).toEqual(['hillevi']);
    expect((await courses(rektor, 'hillevi')).length).toBeGreaterThan(0);
    // Without a user name in the assertion, Clew vouches for nobody.
    const unnamed: Actor = { ...anna, id: 'no-user-name' };
    delete unnamed.userName;
    expect(await personRows(unnamed, ['anna'])).toEqual([]);
    expect(await registry.run(hassan, 'moodle.person', { keys: ['hassan', 'johan'] })).toEqual({
      rows: [{ key: 'hassan', completed: 3, ongoing: 2 }],
    });
  });

  test('the connector fails closed: no `about`, a relation it does not answer, and `self` for an account that is not the caller are no row and not found, and nothing is looked up', async () => {
    const { post, learning } = stack();
    const rows = async (response: Response) => ((await response.json()) as { output: { rows: Row[] } }).output.rows;
    const before = { ...learning.controls.calls };
    // No `about`: a Clew on protocol 2, or anything sending keys past Clew.
    expect(await rows(await post(hillevi, 'moodle.person', { keys: ['anna', 'erik'] }))).toEqual([]);
    expect((await post(hillevi, 'moodle.courses', { person: 'anna' })).status).toBe(404);
    expect((await post(hillevi, 'moodle.course', { person: 'anna', course: '2' })).status).toBe(404);
    // A relation it does not answer, or none for the key asked.
    const colleague = { entity: 'person', relations: { erik: 'colleague' } };
    expect(await rows(await post(anna, 'moodle.person', { keys: ['erik'] }, { about: colleague }))).toEqual([]);
    expect((await post(anna, 'moodle.courses', { person: 'erik' }, { about: colleague })).status).toBe(404);
    const otherKey = { entity: 'person', relations: { anna: 'managed' } };
    expect((await post(hillevi, 'moodle.courses', { person: 'erik' }, { about: otherKey })).status).toBe(404);
    const unit = { entity: 'unit', relations: { anna: 'managed' } };
    expect(await rows(await post(hillevi, 'moodle.person', { keys: ['anna'] }, { about: unit }))).toEqual([]);
    expect(learning.controls.calls).toEqual(before);
    // `self` for someone else's account: the account found must be the signed caller's own.
    const notMine = { entity: 'person', relations: { erik: 'self' } };
    expect(await rows(await post(anna, 'moodle.person', { keys: ['erik'] }, { about: notMine }))).toEqual([]);
    expect((await post(anna, 'moodle.courses', { person: 'erik' }, { about: notMine })).status).toBe(404);
  });

  test("an `about` added to a body the assertion was not issued for is refused by the verifier, as is an assertion without Clew's body claim", async () => {
    const { service } = stack();
    const url = 'http://moodle-connector/clew/capabilities/moodle.courses';
    // Clew signed a call that vouches for nobody; the body is then sent with an `about` that vouches for Erik.
    const signed = await signedRequest(url, {
      id: ID,
      actor: anna,
      key: secret,
      body: { actor: anna, input: { person: 'erik' } },
    });
    const forged = JSON.stringify({
      actor: anna,
      input: { person: 'erik' },
      about: { entity: 'person', relations: { erik: 'managed' } },
    });
    const response = await service.handle(new Request(url, { method: 'POST', headers: signed.headers, body: forged }));
    expect(response.status).toBe(401);
    // An assertion issued for another capability is refused on this one.
    const elsewhere = await signedRequest('http://moodle-connector/clew/capabilities/moodle.person', {
      id: ID,
      actor: anna,
      key: secret,
      body: { actor: anna, input: { person: 'anna' }, about: { entity: 'person', relations: { anna: 'self' } } },
    });
    const replayed = await service.handle(
      new Request(url, { method: 'POST', headers: elsewhere.headers, body: await elsewhere.text() }),
    );
    expect(replayed.status).toBe(401);
    // An assertion with no body claim, as a Clew on protocol 2 signs it.
    const unbound = await assertionFor(ID, secret)(anna);
    const old = await service.handle(
      new Request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + unbound,
          'x-clew-connector-key': secret,
        },
        body: JSON.stringify({ actor: anna, input: { person: 'anna' } }),
      }),
    );
    expect(old.status).toBe(401);
  });

  test('the match field: username by default, which a Moodle user cannot change; idnumber when the installation says so', async () => {
    // Sara's idnumber is an employee number, her username her user name; Lisa's idnumber is her user name.
    const byUsername = stack();
    expect(await byUsername.personRows(hillevi, ['Sara'])).toEqual([{ key: 'sara', completed: 1, ongoing: 0 }]);
    const byIdnumber = stack({ match: 'idnumber' });
    expect((await byIdnumber.personRows(hillevi, ['sara', 'lisa'])).map(r => r.key)).toEqual(['lisa']);
    expect(() => createConnector({ secret, match: 'email' as never })).toThrow('Unknown match field');
  });

  test('a key that matches two accounts without regard to case is no one, under any relation', async () => {
    const { learning, post } = stack({ match: 'idnumber' });
    // Two Moodle accounts whose idnumbers differ only in case.
    learning.controls.add('kim.a', 'kim');
    learning.controls.add('kim.b', 'Kim');
    const kim = person('Kim', 'Kim Berg');
    const rows = async (actor: Actor, relation: string) =>
      (
        (await (
          await post(
            actor,
            'moodle.person',
            { keys: ['Kim'] },
            { about: { entity: 'person', relations: { Kim: relation } } },
          )
        ).json()) as { output: { rows: Row[] } }
      ).output.rows;
    expect(await rows(kim, 'self')).toEqual([]);
    expect(await rows(hillevi, 'managed')).toEqual([]);
  });

  test('a key is looked up as asked and in lower case, and two accounts sharing the value are no one', async () => {
    const twins: LearningSource = {
      async accounts(_field, values) {
        const all = [
          { id: 11, username: 'a1', idnumber: 'Kim', suspended: false },
          { id: 12, username: 'a2', idnumber: 'kim', suspended: false },
          { id: 13, username: 'a3', idnumber: 'Lo', suspended: false },
          { id: 14, username: 'a4', idnumber: 'Lo', suspended: false },
        ];
        return all.filter(a => values.includes(a.idnumber));
      },
      courses: async () => [],
      completion: async () => null,
      completionStatus: async () => null,
      course: async () => null,
      badges: async () => [],
    };
    const { post } = stack({ source: twins, match: 'idnumber' });
    const keys = async (asked: string[]) =>
      (
        (await (
          await post(
            hillevi,
            'moodle.person',
            { keys: asked },
            { about: { entity: 'person', relations: Object.fromEntries(asked.map(k => [k, 'managed'])) } },
          )
        ).json()) as { output: { rows: Row[] } }
      ).output.rows.map(r => r.key);
    // "Kim" and "kim" are both asked for and both found: no one, rather than the one spelt as asked.
    expect(await keys(['Kim'])).toEqual([]);
    // "KIM" finds the lower-case account only: Moodle compares exactly, so only spellings asked can collide.
    expect(await keys(['KIM'])).toEqual(['KIM']);
    // Two accounts with the same idnumber: no one, rather than either.
    expect(await keys(['Lo', 'lo'])).toEqual([]);
    // A key asked twice in two cases is answered once.
    expect(await keys(['kim', 'KIM'])).toEqual(['kim']);
  });

  test('errors map to the protocol: an outage is unavailable, a refused token is denied, bad input is invalid', async () => {
    const { learning, post, registry } = stack();
    const about = vouch(hillevi, ['anna']);
    learning.controls.outage();
    let response = await post(hillevi, 'moodle.person', { keys: ['anna'] }, { about });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: 'unavailable', message: 'Lärplattformen svarar inte just nu.' },
    });
    await expect(registry.run(hillevi, 'moodle.person', { keys: ['anna'] })).rejects.toThrow(
      'Lärplattformen svarar inte just nu.',
    );
    learning.controls.outage(false);
    learning.controls.refuse();
    response = await post(hillevi, 'moodle.courses', { person: 'anna' }, { about });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'denied', message: 'Lärplattformen godtar inte anslutningens behörighet.' },
    });
    learning.controls.refuse(false);
    for (const input of [
      { keys: 'anna' },
      { keys: [''] },
      { keys: ['anna'], extra: 1 },
      { keys: Array(51).fill('a') },
    ]) {
      response = await post(hillevi, 'moodle.person', input, { about });
      expect(response.status).toBe(400);
    }
    expect((await post(hillevi, 'moodle.holdings', { keys: Array(26).fill('a') }, { about })).status).toBe(400);
    expect((await post(hillevi, 'moodle.courses', {}, { about })).status).toBe(400);
    expect((await post(hillevi, 'moodle.nothing', {})).status).toBe(404);
  });

  test('a request without a valid assertion is refused', async () => {
    const { service } = stack();
    const url = 'http://moodle-connector/clew/capabilities/moodle.person';
    const body = { actor: hillevi, input: { keys: ['anna'] } };
    const call = (headers: Record<string, string>) =>
      service.handle(
        new Request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
        }),
      );
    expect((await call({})).status).toBe(401);
    expect((await call({ 'x-clew-connector-key': secret, authorization: 'Bearer x.y.z' })).status).toBe(401);
    const foreign = await signedRequest(url, {
      id: ID,
      actor: hillevi,
      key: secret,
      body,
      label: 'another-secret-entirely',
    });
    expect((await service.handle(foreign)).status).toBe(401);
    const valid = await signedRequest(url, { id: ID, actor: hillevi, key: secret, body });
    expect((await service.handle(valid)).status).toBe(200);
  });

  test('call volume: one lookup per batch, one call per person for moodle.person, two plus one per completed course for holdings', async () => {
    const { learning, personRows, holdings } = stack();
    const calls = learning.controls.calls;
    await personRows(hillevi, ['hillevi', 'anna', 'erik', 'nobody']);
    expect({ ...calls }).toEqual({ accounts: 1, courses: 3, completion: 0, badges: 0, course: 0 });
    await holdings(hillevi, ['hillevi', 'anna']);
    // Hillevi has five completed courses and Anna four.
    expect({ ...calls }).toEqual({ accounts: 2, courses: 5, completion: 9, badges: 2, course: 0 });
  });

  test('never more Moodle calls open at once than the concurrency allows', async () => {
    let open = 0,
      most = 0;
    const source = wrapped(async (_method, call) => {
      open++;
      most = Math.max(most, open);
      await new Promise(resolve => setTimeout(resolve, 2));
      try {
        return await call();
      } finally {
        open--;
      }
    });
    const { holdings } = stack({ source, concurrency: 2 });
    const rows = await holdings(hillevi, ['hillevi', 'karin', 'johan', 'anna', 'erik', 'maria']);
    expect(rows).toHaveLength(6);
    expect(most).toBe(2);
    expect(() => createConnector({ secret, concurrency: 0 })).toThrow('from 1 to 16');
  });

  test('a read that passes its deadline stops: its open calls are aborted, nothing queued starts, and it answers unavailable', async () => {
    const started: string[] = [];
    const aborted: string[] = [];
    // Courses never answer by themselves: only the read's signal ends them.
    const source = wrapped(async (method, call, { signal }) => {
      started.push(method);
      if (method !== 'courses') return call();
      await new Promise((_, reject) =>
        signal?.addEventListener('abort', () => {
          aborted.push(method);
          reject(new SourceUnavailable('stopped'));
        }),
      );
    });
    const { post } = stack({
      source,
      concurrency: 2,
      deadlines: { person: 40, courses: 40, course: 40, holdings: 40 },
    });
    const keys = ['hillevi', 'anna', 'erik', 'maria', 'johan'];
    const begun = Date.now();
    const response = await post(hillevi, 'moodle.person', { keys }, { about: vouch(hillevi, keys) });
    expect(response.status).toBe(503);
    expect(Date.now() - begun).toBeLessThan(1000);
    // Two courses calls were open and both were aborted; the three queued behind them never started.
    expect(started).toEqual(['accounts', 'courses', 'courses']);
    expect(aborted).toEqual(['courses', 'courses']);
  });

  test('a call that fails the read stops the rest: nothing still queued is started', async () => {
    const started: string[] = [];
    const source = wrapped(async (method, call) => {
      started.push(method);
      if (method === 'courses') throw new SourceUnavailable('down');
      return call();
    });
    const { post } = stack({ source, concurrency: 1 });
    const keys = ['hillevi', 'anna', 'erik', 'maria'];
    const response = await post(hillevi, 'moodle.holdings', { keys }, { about: vouch(hillevi, keys) });
    expect(response.status).toBe(503);
    expect(started).toEqual(['accounts', 'courses']);
  });

  test('when Clew goes away the read stops: its open calls are aborted', async () => {
    const aborted: string[] = [];
    let first: () => void = () => {};
    const opened = new Promise<void>(resolve => (first = resolve));
    const source = wrapped(async (method, call, { signal }) => {
      if (method !== 'courses') return call();
      first();
      await new Promise((_, reject) =>
        signal?.addEventListener('abort', () => {
          aborted.push(method);
          reject(new SourceUnavailable('stopped'));
        }),
      );
    });
    const { post } = stack({ source, concurrency: 4 });
    const gone = new AbortController();
    const keys = ['hillevi', 'anna'];
    const answered = post(hillevi, 'moodle.person', { keys }, { about: vouch(hillevi, keys), signal: gone.signal });
    await opened;
    gone.abort();
    expect((await answered).status).toBe(503);
    expect(aborted).toEqual(['courses', 'courses']);
  });

  test('the conformance check passes: the rows through the rule, an unknown key, and keys sent without a relation', async () => {
    const { connectorFetch } = stack();
    const report = await checkConnector({
      key: secret,
      url: 'http://moodle-connector',
      id: ID,
      assert: assertionFor(ID, secret),
      assertForeign: assertionFor(ID, 'another-secret-entirely'),
      fetch: connectorFetch,
      about: { keys: ['hillevi', 'anna', 'erik'], as: hillevi },
    });
    const about = report.findings
      .filter(f => f.text.startsWith('moodle.person about'))
      .map(f => `${f.level} ${f.text.replace(/\d+ ms \(/, 'n ms (')}`);
    expect(about).toEqual([
      'ok moodle.person about person, batch: 3 keys asked, 3 rows, n ms (budget 1500 ms)',
      'ok moodle.person about person, key: every row carries a key it was asked with',
      'ok moodle.person about person, one row per key',
      'ok moodle.person about person, unknown key: no row, no error',
      "ok moodle.person about person, out of scope: the 3 keys asked by the check's manager on unit-check: no row, no error",
      "ok moodle.person about person, out of scope: the 3 keys asked by the check's employee on unit-check: no row, no error",
    ]);
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

// ---- The API adapter against the recorded answers: the request it sends is the one recorded, and it reads the answer
// ---- Moodle gave. The recordings hold a placeholder for the token; here every call carries "thetoken0123456789".

const SAMPLES = join(import.meta.dir, '../../connectors/moodle/samples');
const TOKEN = 'thetoken0123456789';
type Sample = {
  request: { method: string; path: string; headers: Record<string, string>; body: string };
  response: { status: number; headers: Record<string, string>; body: unknown };
};
const sample = (n: string): Sample =>
  JSON.parse(
    readFileSync(
      join(
        SAMPLES,
        readdirSync(SAMPLES).find(f => f.startsWith(n + '-'))!,
      ),
      'utf8',
    ),
  );
/** A request's form parameters without the token, in a stable order, so a sent request can be compared to a recorded one. */
const paramsOf = (body: string) =>
  [...new URLSearchParams(body).entries()]
    .filter(([k]) => k !== 'wstoken')
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('&');
type Sent = { method: string; path: string; headers: Record<string, string>; body: string };
const answer = (s: Sample) =>
  new Response(JSON.stringify(s.response.body), { status: s.response.status, headers: s.response.headers });
const moodleSays = (errorcode: string) => async () =>
  new Response(JSON.stringify({ exception: 'moodle_exception', errorcode, message: 'Moodle says no.' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** A Moodle that answers each request with the next recording, and keeps what it was asked. */
function recorded(...names: string[]) {
  const queue = names.map(sample);
  const calls: Sent[] = [];
  const fetch = async (input: string, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      path: new URL(input).pathname,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: String(init?.body ?? ''),
    });
    const next = queue.shift();
    if (!next) throw new Error('No recording left for ' + input);
    return answer(next);
  };
  return { source: createMoodleLearning({ url: 'http://moodle', token: TOKEN, fetch, allowHttp: true }), calls };
}
/** The recorded request, as the adapter must send it: the same method, path, content type and parameters, and the token. */
function sentAsRecorded(call: Sent, n: string) {
  const { request } = sample(n);
  expect([call.method, call.path]).toEqual([request.method, request.path]);
  expect(call.headers['content-type']).toBe(request.headers['Content-Type']!);
  expect(call.headers.accept).toBe(request.headers.Accept!);
  expect(paramsOf(call.body)).toBe(paramsOf(request.body));
  expect(new URLSearchParams(call.body).get('wstoken')).toBe(TOKEN);
}
/**
 * A Moodle that answers by what is asked: the recordings indexed by their parameters. Left out: 14, made with a refused
 * token, whose parameters are those of 17, and 22 to 25, made while a name was changed for the recording.
 */
function recordedMoodle(
  override: (params: URLSearchParams) => (() => Promise<Response>) | undefined = () => undefined,
) {
  const byParams = new Map(
    readdirSync(SAMPLES)
      .filter(f => f.endsWith('.json') && !/^(14|22|23|24|25)-/.test(f))
      .map(f => JSON.parse(readFileSync(join(SAMPLES, f), 'utf8')) as Sample)
      .map(s => [paramsOf(s.request.body), s] as const),
  );
  const asked: string[] = [];
  const fetch = async (_input: string, init?: RequestInit) => {
    const params = paramsOf(String(init?.body ?? ''));
    asked.push(new URLSearchParams(params).get('wsfunction')!);
    const instead = override(new URLSearchParams(params));
    if (instead) return instead();
    const found = byParams.get(params);
    if (!found) throw new Error('Not recorded: ' + params);
    return answer(found);
  };
  return { source: createMoodleLearning({ url: 'http://moodle', token: TOKEN, fetch, allowHttp: true }), asked };
}

describe("the Moodle API adapter, against Moodle's recorded answers", () => {
  test('finds accounts by idnumber exactly and by username in lower case (01 to 03)', async () => {
    const { source, calls } = recorded('01', '02', '03');
    expect(await source.accounts('idnumber', ['hassan', 'hillevi', 'nobody'])).toEqual([
      { id: 3, username: 'hillevi', idnumber: 'hillevi', suspended: false },
      { id: 4, username: 'hassan', idnumber: 'hassan', suspended: false },
    ]);
    expect(await source.accounts('idnumber', ['HILLEVI'])).toEqual([]);
    expect((await source.accounts('username', ['Mikael', 'karin'])).map(a => a.id)).toEqual([5, 10]);
    sentAsRecorded(calls[0]!, '01');
    sentAsRecorded(calls[1]!, '02');
    sentAsRecorded(calls[2]!, '03');
    expect(calls[0]!.headers['user-agent']).toBe('Clew');
    // The token goes in the form body, never in the address; text is asked for as stored.
    expect(calls.every(c => !c.path.includes(TOKEN))).toBe(true);
    expect(calls.every(c => new URLSearchParams(c.body).get('moodlewssettingraw') === 'true')).toBe(true);
  });

  test('a username batch Moodle refuses for one value is asked again without it (04)', async () => {
    const { source, calls } = recorded('04', '03');
    expect((await source.accounts('username', ['mikael', 'karin', 'åsa'])).map(a => a.username)).toEqual([
      'mikael',
      'karin',
    ]);
    expect(calls.map(c => new URLSearchParams(c.body).getAll('values[2]'))).toEqual([['åsa'], []]);
    // On idnumber the same refusal is the platform failing, not a value to drop.
    const idnumber = recorded('04');
    await expect(idnumber.source.accounts('idnumber', ['x'])).rejects.toBeInstanceOf(SourceUnavailable);
  });

  test("reads a person's courses, completed or not, without the participant counts, and an unknown user's as none (05, 06)", async () => {
    const { source, calls } = recorded('05', '06');
    expect(await source.courses(3)).toEqual([
      {
        id: 6,
        name: 'Läkemedelshantering, delegeringsutbildning',
        idnumber: 'clew-dev:lakemedel',
        completed: true,
        tracked: true,
      },
      { id: 5, name: 'Livsmedelshygien', idnumber: 'clew-dev:livsmedelshygien', completed: true, tracked: true },
      {
        id: 4,
        name: 'Informationssäkerhet för medarbetare',
        idnumber: 'clew-dev:informationssakerhet',
        completed: false,
        tracked: true,
      },
      { id: 3, name: 'Hjärt-lungräddning med hjärtstartare', idnumber: 'clew-dev:hlr', completed: true, tracked: true },
      { id: 2, name: 'Brandskydd, grundutbildning', idnumber: 'clew-dev:brandskydd', completed: true, tracked: true },
    ]);
    expect(await source.courses(999999)).toEqual([]);
    sentAsRecorded(calls[0]!, '05');
    sentAsRecorded(calls[1]!, '06');
    expect(new URLSearchParams(calls[0]!.body).get('returnusercount')).toBe('0');
  });

  test('reads when a course was completed: the latest criterion met, as Moodle stamps the course; none when it was not, or the person is not enrolled or gone (07 to 10)', async () => {
    const { source, calls } = recorded('07', '08', '09', '10');
    expect(await source.completion(3, 6)).toBe(1759934795);
    expect(await source.completion(3, 4)).toBeNull();
    expect(await source.completion(3, 1)).toBeNull();
    expect(await source.completion(999999, 4)).toBeNull();
    for (const [i, n] of ['07', '08', '09', '10'].entries()) sentAsRecorded(calls[i]!, n);
    // Whatever the aggregation, Moodle's completion cron stamps the course with the latest criterion met.
    const two = (aggregation: number) => ({
      completionstatus: {
        completed: true,
        aggregation,
        completions: [
          { complete: true, timecompleted: 200 },
          { complete: true, timecompleted: 100 },
          { complete: false, timecompleted: null },
        ],
      },
    });
    expect([parseCompletion(two(1)), parseCompletion(two(2))]).toEqual([200, 200]);
  });

  test('reads the whole completion status with each criterion (07, 08)', async () => {
    const { source } = recorded('07', '08');
    expect(await source.completionStatus(3, 6)).toEqual({
      completed: true,
      at: 1759934795,
      criteria: [{ type: 7, title: 'Teacher', complete: true, at: 1759934795 }],
    });
    expect(await source.completionStatus(3, 4)).toEqual({
      completed: false,
      at: null,
      criteria: [{ type: 7, title: 'Teacher', complete: false, at: null }],
    });
  });

  test('reads one course by id with its summary as plain text, and none for an id that does not exist (26, 27)', async () => {
    const { source, calls } = recorded('26', '27');
    expect(await source.course(4)).toEqual({
      id: 4,
      name: 'Informationssäkerhet för medarbetare',
      idnumber: '',
      category: 'Obligatoriska utbildningar',
      summary: 'Att hantera uppgifter om elever, brukare och kollegor säkert: lösenord, e-post & utskrifter.',
    });
    expect(await source.course(999999)).toBeNull();
    sentAsRecorded(calls[0]!, '26');
    sentAsRecorded(calls[1]!, '27');
  });

  test('reads badges with the day they were issued and run out, also one that has run out; none for no badge or an unknown user (11 to 13, 21)', async () => {
    const { source, calls } = recorded('11', '21', '12', '13');
    expect(await source.badges(3)).toEqual([
      { id: 1, name: 'HLR-instruktör', issuedAt: 1794494796, expiresAt: 1826030796 },
    ]);
    // Johan's ran out 35 days before the recording: Moodle still lists it, with its end in the past.
    expect(await source.badges(9)).toEqual([
      { id: 1, name: 'HLR-instruktör', issuedAt: 1759936941, expiresAt: 1791472941 },
    ]);
    expect(await source.badges(4)).toEqual([]);
    expect(await source.badges(999999)).toEqual([]);
    for (const [i, n] of ['11', '21', '12', '13'].entries()) sentAsRecorded(calls[i]!, n);
  });

  test('names come as text: a course name raw as stored, a badge name escaped by Moodle whatever is asked and read back (22 to 25)', async () => {
    expect(formOf(TOKEN, 'core_badges_get_user_badges', { userid: 3 }).get('moodlewssettingraw')).toBe('true');
    // Without the raw setting Moodle escapes a course name for HTML (25); with it, the name is as stored (24).
    expect(
      (sample('25').response.body as Array<{ id: number; fullname: string }>).find(c => c.id === 4)!.fullname,
    ).toBe('Informationssäkerhet &amp; dataskydd för medarbetare');
    const courses = recorded('24');
    expect((await courses.source.courses(3)).find(c => c.id === 4)!.name).toBe(
      'Informationssäkerhet & dataskydd för medarbetare',
    );
    // A badge name is escaped with or without it (22, 23): the adapter reads it back.
    const badges = recorded('22');
    expect((await badges.source.badges(3))[0]!.name).toBe('HLR- & AED-instruktör');
    expect(unescapeText('a &#38; b &#x26; c &lt;d&gt; &quot;e&quot; &#39;f&#39;')).toBe(`a & b & c <d> "e" 'f'`);
    expect(plainText('<p>Ett &amp; <strong>två</strong></p><script>x()</script><ul><li>tre</li></ul>')).toBe(
      'Ett & två\ntre',
    );
  });

  test("Moodle's errors in a 200 answer: the token and the service's rights are refused, anything else is unavailable (14 to 16)", async () => {
    await expect(recorded('14').source.accounts('idnumber', ['hillevi'])).rejects.toBeInstanceOf(SourceRefused);
    await expect(recorded('15').source.courses(3)).rejects.toBeInstanceOf(SourceRefused);
    await expect(recorded('16').source.courses(3)).rejects.toBeInstanceOf(SourceUnavailable);
    const answering = (response: () => Promise<Response>) =>
      createMoodleLearning({ url: 'http://moodle', token: TOKEN, allowHttp: true, fetch: response });
    await expect(
      answering(async () => {
        throw new TypeError('fetch failed');
      }).courses(3),
    ).rejects.toBeInstanceOf(SourceUnavailable);
    await expect(answering(async () => new Response('busy', { status: 503 })).courses(3)).rejects.toBeInstanceOf(
      SourceUnavailable,
    );
    await expect(answering(async () => new Response('<html>', { status: 200 })).courses(3)).rejects.toBeInstanceOf(
      SourceUnavailable,
    );
  });

  test('one person or one course refused is that item unreadable, not the service refused; badges switched off are none', async () => {
    const answering = (errorcode: string) =>
      createMoodleLearning({ url: 'http://moodle', token: TOKEN, allowHttp: true, fetch: moodleSays(errorcode) });
    // A right withheld on one course, or the report closed for one person: that course only.
    await expect(answering('nopermissions').completion(3, 6)).rejects.toBeInstanceOf(ItemUnreadable);
    await expect(answering('cannotviewreport').completion(3, 6)).rejects.toBeInstanceOf(ItemUnreadable);
    await expect(answering('requireloginerror').completionStatus(3, 6)).rejects.toBeInstanceOf(ItemUnreadable);
    // A person deleted or not confirmed: that person only.
    await expect(answering('usernotconfirmed').courses(3)).rejects.toBeInstanceOf(ItemUnreadable);
    await expect(answering('userdeleted').badges(3)).rejects.toBeInstanceOf(ItemUnreadable);
    await expect(answering('nopermissions').badges(3)).rejects.toBeInstanceOf(ItemUnreadable);
    expect(await answering('badgesdisabled').badges(3)).toEqual([]);
    // The service account itself, and the right to read people, which every read needs: the service is refused.
    await expect(answering('invalidtoken').completion(3, 6)).rejects.toBeInstanceOf(SourceRefused);
    await expect(answering('wsaccessusersuspended').courses(3)).rejects.toBeInstanceOf(SourceRefused);
    await expect(answering('nopermissions').accounts('username', ['hillevi'])).rejects.toBeInstanceOf(SourceRefused);
  });

  test('a call the read has stopped is not sent, and one under way is aborted', async () => {
    let sent = 0;
    let seen: AbortSignal | undefined;
    const source = createMoodleLearning({
      url: 'http://moodle',
      token: TOKEN,
      allowHttp: true,
      fetch: async (_input, init) => {
        sent++;
        seen = init?.signal ?? undefined;
        return new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        );
      },
    });
    const stopped = new AbortController();
    stopped.abort();
    await expect(source.courses(3, { signal: stopped.signal })).rejects.toBeInstanceOf(SourceUnavailable);
    expect(sent).toBe(0);
    const read = new AbortController();
    const call = source.courses(3, { signal: read.signal });
    read.abort();
    await expect(call).rejects.toBeInstanceOf(SourceUnavailable);
    expect(seen?.aborted).toBe(true);
  });

  test('refuses plain http outside development and a missing token', () => {
    expect(() => createMoodleLearning({ url: 'http://moodle', token: TOKEN })).toThrow('https');
    expect(() => createMoodleLearning({ url: 'http://localhost:3024', token: TOKEN })).not.toThrow();
    expect(() => createMoodleLearning({ url: 'https://moodle.example' })).toThrow('MOODLE_TOKEN');
    expect(() => createMoodleLearning({ token: TOKEN })).toThrow('MOODLE_URL');
  });

  test("behind the connector: Hillevi's holdings, her list and two of her courses from the recorded answers", async () => {
    const { source, asked } = recordedMoodle();
    const { holdingsAnswer, courses, course } = stack({ source, publicUrl: PUBLIC });
    expect(await holdingsAnswer(hillevi, ['hillevi'])).toEqual({
      withdrawalsReported: false,
      rows: [
        {
          key: 'hillevi',
          holdings: [
            {
              id: 'course:6:user:3',
              type: 'clew-dev:lakemedel',
              label: 'Läkemedelshantering, delegeringsutbildning',
              kind: 'course',
              issuedOn: '2025-10-08',
            },
            {
              id: 'course:5:user:3',
              type: 'clew-dev:livsmedelshygien',
              label: 'Livsmedelshygien',
              kind: 'course',
              issuedOn: '2023-11-08',
            },
            {
              id: 'course:3:user:3',
              type: 'clew-dev:hlr',
              label: 'Hjärt-lungräddning med hjärtstartare',
              kind: 'course',
              issuedOn: '2024-12-12',
            },
            {
              id: 'course:2:user:3',
              type: 'clew-dev:brandskydd',
              label: 'Brandskydd, grundutbildning',
              kind: 'course',
              issuedOn: '2026-10-03',
            },
            {
              id: 'badge:1:user:3',
              type: 'badge:1',
              label: 'HLR-instruktör',
              kind: 'badge',
              issuedOn: '2026-11-12',
              expiresOn: '2027-11-12',
            },
          ],
        },
      ],
    });
    expect(asked.sort()).toEqual([
      'core_badges_get_user_badges',
      'core_completion_get_course_completion_status',
      'core_completion_get_course_completion_status',
      'core_completion_get_course_completion_status',
      'core_completion_get_course_completion_status',
      'core_enrol_get_users_courses',
      'core_user_get_users_by_field',
    ]);
    const link = (id: number) => `${PUBLIC}/course/view.php?id=${id}`;
    expect((await courses(hillevi, 'hillevi')).map(r => [r.name, r.status, r.date, r.course, r.link])).toEqual([
      ['Informationssäkerhet för medarbetare', 'Pågår', undefined, '4', link(4)],
      ['Brandskydd, grundutbildning', 'Genomförd', '2026-10-03', '2', link(2)],
      ['Läkemedelshantering, delegeringsutbildning', 'Genomförd', '2025-10-08', '6', link(6)],
      ['Hjärt-lungräddning med hjärtstartare', 'Genomförd', '2024-12-12', '3', link(3)],
      ['Livsmedelshygien', 'Genomförd', '2023-11-08', '5', link(5)],
      ['HLR-instruktör', 'Giltigt', '2026-11-12', undefined, undefined],
    ]);
    expect(await course(hillevi, 'hillevi', '6')).toEqual({
      name: 'Läkemedelshantering, delegeringsutbildning',
      category: 'Obligatoriska utbildningar',
      status: 'Genomförd',
      completedOn: '2025-10-08',
      criteria: ['Markerad som klar av Teacher: uppfyllt 8 okt. 2025'],
      summary: 'Delegering av läkemedelshantering: iordningställa, administrera och dokumentera.',
      link: link(6),
    });
    expect(await course(hillevi, 'hillevi', '4')).toEqual({
      name: 'Informationssäkerhet för medarbetare',
      category: 'Obligatoriska utbildningar',
      status: 'Pågår',
      criteria: ['Markerad som klar av Teacher: inte uppfyllt'],
      summary: 'Att hantera uppgifter om elever, brukare och kollegor säkert: lösenord, e-post & utskrifter.',
      link: link(4),
    });
  });

  test('behind the connector: Moodle withholding one course leaves the rest of the batch whole', async () => {
    const { source } = recordedMoodle(params =>
      params.get('wsfunction') === 'core_completion_get_course_completion_status' && params.get('courseid') === '2'
        ? moodleSays('nopermissions')
        : undefined,
    );
    const { holdings } = stack({ source });
    const [row] = await holdings(hillevi, ['hillevi']);
    expect(row!.partial).toBe(true);
    expect(row!.holdings.map(x => x.id)).toEqual([
      'course:6:user:3',
      'course:5:user:3',
      'course:3:user:3',
      'badge:1:user:3',
    ]);
  });
});
