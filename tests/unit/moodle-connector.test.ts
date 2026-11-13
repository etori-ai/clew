import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  HoldingsOutputSchema,
  openRef,
  type HoldingsOutput as Page,
  type Relation,
  type ViewOpen,
} from '@clew/contracts';
import {
  InstallationReadError,
  Registry,
  openGovernance,
  placesOf,
  type Actor,
  type RelationResolver,
} from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { namedInputs } from '../../packages/connectors/src/named';
import { manifestProblems, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { adapterOf } from '../../connectors/moodle/config.mjs';
import { OVERLAP, createConnector } from '../../connectors/moodle/connector.mjs';
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
  parseListedAccounts,
  plainText,
  unescapeText,
} from '../../connectors/moodle/moodle.mjs';
import {
  COURSES_ROWS_MAX,
  HOLDINGS_PAGE,
  HoldingsOutput,
  manifest as moodleManifest,
} from '../../connectors/moodle/manifest.mjs';
import {
  assertionFor,
  installationAssertionFor,
  installationRequest,
  signedRequest,
  testAuthority,
  testJwks,
} from '../connector-authority';

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
      installation: installationAssertionFor(ID, secret),
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
  /** One page of every holding, read as the installation through Clew's registry, as the competence register reads it (D119). */
  const page = (cursor?: string) => registry.readHoldings(ID, cursor);
  /** Every page to the end, following `next`. */
  const sweep = async () => {
    const pages: Page[] = [];
    let cursor: string | undefined;
    do {
      const answer = await page(cursor);
      pages.push(answer);
      cursor = answer.next;
    } while (cursor && pages.length < 200);
    return pages;
  };
  /** Every row of every page, in order. */
  const rows = async () => (await sweep()).flatMap(p => p.rows);
  /** The row of one account in the first page. */
  const row = async (key: string) => (await page()).rows.find(r => r.key === key);
  /** Straight to the service's installation route, as Clew sends a read it makes itself (D119). */
  const asInstallation = async (
    input: object,
    { signal, name = `${ID}.holdings` } = {} as { signal?: AbortSignal; name?: string },
  ) => {
    const request = await installationRequest(`http://moodle-connector/clew/installation/${name}`, {
      id: ID,
      key: secret,
      body: { input },
    });
    return service.handle(signal ? new Request(request, { signal }) : request);
  };
  return {
    registry,
    learning,
    service,
    connectorFetch,
    personRows,
    courses,
    course,
    post,
    page,
    sweep,
    rows,
    row,
    asInstallation,
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
    everyone: through('everyone') as LearningSource['everyone'],
    courses: through('courses') as LearningSource['courses'],
    completion: through('completion') as LearningSource['completion'],
    completionStatus: through('completionStatus') as LearningSource['completionStatus'],
    course: through('course') as LearningSource['course'],
    badges: through('badges') as LearningSource['badges'],
  };
}

describe('the Moodle connector', () => {
  test('declares protocol 3, what each read admits, that none of them is a tool, and the holdings read for the installation alone', () => {
    expect(manifestProblems(moodleManifest, ID)).toEqual([]);
    const m = parseManifest(moodleManifest, ID);
    expect([m.protocol, m.kind, m.source, m.scan, m.areas]).toEqual([3, 'passthrough', 'Lärplattformen', false, []]);
    expect(m.capabilities.map(c => [c.name, c.kind, c.model, c.about ?? null, c.view?.kind ?? null])).toEqual([
      ['moodle.person', 'read', false, { entity: 'person' }, 'list'],
      ['moodle.courses', 'read', false, null, 'list'],
      ['moodle.course', 'read', false, null, 'detail'],
    ]);
    // A person reads their own; a manager their direct reports; never a colleague (D117).
    expect(m.capabilities.map(c => [c.name, c.person ?? null])).toEqual([
      ['moodle.person', { admits: ['self', 'managed'] }],
      ['moodle.courses', { param: 'person', admits: ['self', 'managed'] }],
      ['moodle.course', { param: 'person', admits: ['self', 'managed'] }],
    ]);
    // The holdings profile is the installation's read (D119): not a capability, so no person's path can name it.
    expect(m.installation!.map(r => [r.name, r.title])).toEqual([['moodle.holdings', 'Genomförda kurser och märken']]);
    const { registry } = stack();
    expect(registry.find('moodle.holdings')).toBeUndefined();
    expect(registry.capabilitiesFor(hillevi).map(c => c.capability.name)).not.toContain('moodle.holdings');
    // Clew resolves the three; the installation's read names nobody.
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

  test('moodle.holdings, read as the installation: every account a page at a time, each with its completed courses and badges and their days; holding nothing is a row; absence is never a withdrawal', async () => {
    const { page } = stack();
    const answer = await page();
    // The connector's own declaration and the protocol's profile (D119), both of which Clew checks every page against.
    expect(ajv.validate(HoldingsOutput as object, answer)).toBe(true);
    expect(ajv.validate(JSON.parse(JSON.stringify(HoldingsOutputSchema)), answer)).toBe(true);
    // The source says outright that it reports no withdrawals: a holding missing next time is not revoked.
    expect(answer.withdrawalsReported).toBe(false);
    // Every account of the stand-in, in Moodle's id order, keyed by its username; one page, so no `next`.
    expect(answer.rows.map(r => r.key)).toEqual([
      'hillevi',
      'hassan',
      'mikael',
      'anna',
      'erik',
      'maria',
      'johan',
      'karin',
      'sara',
      'lisa',
    ]);
    expect(answer.next).toBeUndefined();
    // Moodle's guest account is listed with everyone and answered by no row: nothing is partial because of it.
    expect(answer.rows.map(r => r.key)).not.toContain('guest');
    expect(answer.rows.some(r => r.partial)).toBe(false);
    const h = answer.rows[0]!;
    expect(h.holdings).toEqual([
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
    expect(h.partial).toBeUndefined();
    // Lisa has an account and holds nothing: a row with no holdings, so the register can tell her from someone unknown.
    expect(answer.rows.find(r => r.key === 'lisa')).toEqual({ key: 'lisa', holdings: [] });
    // A badge keeps its end date after it has run out: the register decides what that means.
    expect(answer.rows.find(r => r.key === 'erik')!.holdings.find(x => x.kind === 'badge')).toEqual({
      id: 'badge:2:user:7',
      type: 'badge:2',
      label: 'Heta arbeten',
      kind: 'badge',
      issuedOn: ago(400),
      expiresOn: ago(35),
    });
    // Nothing about the person beyond the key: no name.
    expect(JSON.stringify(answer)).not.toContain('Hillevi');
    // With idnumber as the match field, the key is the idnumber: Sara's employee number.
    expect((await stack({ match: 'idnumber' }).page()).rows.map(r => r.key)).toContain('1007');
  });

  test('pages to the end: every account once, in id order, `next` until the last page, and the same cursor gives the same page', async () => {
    const { page, sweep, learning } = stack();
    for (let i = 1; i <= 60; i++) learning.controls.add(`extra${i}`, `extra${i}`);
    const pages = await sweep();
    // Moodle's guest account is listed first and answered by no row, so the first page has one row fewer.
    expect(pages.map(p => p.rows.length)).toEqual([HOLDINGS_PAGE - 1, HOLDINGS_PAGE, 21]);
    expect(pages.map(p => p.next !== undefined)).toEqual([true, true, false]);
    const keys = pages.flatMap(p => p.rows.map(r => r.key));
    expect(keys).toHaveLength(70);
    expect(new Set(keys).size).toBe(70);
    expect(keys.slice(0, 3)).toEqual(['hillevi', 'hassan', 'mikael']);
    expect(keys.at(-1)).toBe('extra60');
    // A cursor is the last account answered and its place: the same cursor reads the same page again.
    expect(pages[0]!.next).toMatch(/^\d+:\d+$/);
    expect(await page(pages[0]!.next)).toEqual(pages[1]!);
    // A cursor that is not one is refused by Clew against the declaration, before the connector is asked.
    const before = learning.controls.calls.everyone;
    await expect(page('not-a-cursor')).rejects.toMatchObject({ code: 'invalid' });
    expect(learning.controls.calls.everyone).toBe(before);
    // An account added during the read comes last, on a later page.
    const first = await page();
    learning.controls.add('newcomer', 'newcomer');
    const rest: string[] = [];
    for (let cursor = first.next; cursor;) {
      const next = await page(cursor);
      rest.push(...next.rows.map(r => r.key));
      cursor = next.next;
    }
    expect(rest.at(-1)).toBe('newcomer');
    expect([...first.rows.map(r => r.key), ...rest]).toHaveLength(71);
  });

  test('accounts deleted before the cursor never make a page pass over one, even more than the overlap', async () => {
    const { page, learning } = stack();
    for (let i = 1; i <= 60; i++) learning.controls.add(`extra${i}`, `extra${i}`);
    const first = await page();
    const firstKeys = first.rows.map(r => r.key);
    // Three accounts the first page answered are deleted: everyone after them moves up three places.
    for (const name of ['anna', 'erik', 'extra1']) learning.controls.remove(name);
    const second = await page(first.next);
    expect(second.rows[0]!.key).toBe('extra15');
    // More than the overlap are deleted before the next cursor: the page steps back and still starts where it should.
    for (const name of second.rows.slice(0, OVERLAP + 5).map(r => r.key)) learning.controls.remove(name);
    const calls = learning.controls.calls.everyone;
    const third = await page(second.next);
    expect(third.rows[0]!.key).toBe('extra40');
    expect(learning.controls.calls.everyone - calls).toBe(2);
    // Nobody was passed over: every account still there and not yet answered is on the third page.
    expect(third.rows.map(r => r.key)).toEqual(Array.from({ length: 21 }, (_, i) => `extra${40 + i}`));
    expect(third.next).toBeUndefined();
    expect(firstKeys).toContain('anna');
  });

  test('an account Moodle withholds has no row, two accounts sharing a key are no one, and a suspended account is answered', async () => {
    const { page, learning, post } = stack();
    // Moodle's guest account is nobody's, for a person's read too, whatever Clew vouches.
    const guest = await post(
      hillevi,
      'moodle.person',
      { keys: ['guest'] },
      { about: { entity: 'person', relations: { guest: 'managed' } } },
    );
    expect(((await guest.json()) as { output: { rows: Row[] } }).output.rows).toEqual([]);
    learning.controls.withhold('karin');
    learning.controls.suspend('johan');
    const keys = (await page()).rows.map(r => r.key);
    // Karin's details are withheld from the service account: no key, so no row, and the page goes on past her.
    expect(keys).not.toContain('karin');
    expect(keys).toContain('sara');
    // Johan's account is suspended: what he completed stays true, and his row is there.
    const johan = (await page()).rows.find(r => r.key === 'johan')!;
    expect(johan.holdings.length).toBeGreaterThan(0);
    // Matched on idnumber, two accounts that share a key are no one, as in every read, and so is one whose key has a
    // capital letter: only the lower-case spelling is anyone's.
    const twins = stack({ match: 'idnumber' });
    twins.learning.controls.add('kim.a', 'kim');
    twins.learning.controls.add('kim.b', 'kim');
    twins.learning.controls.add('lo.a', 'Lo');
    const twinKeys = (await twins.page()).rows.map(r => r.key);
    expect(twinKeys).not.toContain('kim');
    expect(twinKeys).not.toContain('Lo');
    expect(twinKeys).toContain('lisa');
  });

  test('a completed course whose day cannot be read is left out and the row says it is partial', async () => {
    const { row, learning } = stack();
    const before = (await row('maria'))!;
    expect(before.partial).toBeUndefined();
    expect(before.holdings).toHaveLength(4);
    // Maria's welcome course records no completion; marked complete anyway, Moodle has no day to give for it.
    learning.controls.complete('maria', 8, 3);
    const after = (await row('maria'))!;
    expect(after.partial).toBe(true);
    expect(after.holdings).toEqual(before.holdings);
  });

  test("one person's or one course's refusal leaves that item out and marks the person partial; the rest of the page stands", async () => {
    const { row, page, personRows, courses, learning, post } = stack();
    const full = (await page()).rows;
    const of = (key: string) => full.find(r => r.key === key)!;
    // Moodle withholds one course's completion for Hillevi, and Anna's whole course list.
    learning.controls.unreadable('completion', 'hillevi', 2);
    learning.controls.unreadable('courses', 'anna');
    const h = (await row('hillevi'))!;
    expect(h.partial).toBe(true);
    expect(h.holdings.map(x => x.id)).toEqual(
      of('hillevi')
        .holdings.map(x => x.id)
        .filter(id => id !== 'course:2:user:3'),
    );
    expect(await row('anna')).toEqual({
      key: 'anna',
      holdings: of('anna').holdings.filter(x => x.kind === 'badge'),
      partial: true,
    });
    expect(await row('maria')).toEqual(of('maria'));
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
    const e = (await row('erik'))!;
    expect(e.partial).toBe(true);
    expect(e.holdings.every(x => x.kind === 'course')).toBe(true);
    expect(e.holdings.length).toBeGreaterThan(0);
  });

  test("a failing page is refused in the protocol's kinds: down is unavailable, a refused token denied; a failing call stops the rest", async () => {
    const { page, learning, asInstallation } = stack();
    learning.controls.outage();
    await expect(page()).rejects.toBeInstanceOf(InstallationReadError);
    await expect(page()).rejects.toMatchObject({ code: 'unavailable', message: 'Lärplattformen svarar inte just nu.' });
    expect((await asInstallation({})).status).toBe(503);
    learning.controls.outage(false);
    learning.controls.refuse();
    // The connector says "Lärplattformen godtar inte anslutningens behörighet."; Clew keeps the kind and says it in its
    // own words, so nothing a connector writes reaches a log or an administrator (D91).
    expect((await (await asInstallation({})).json()).error.message).toBe(
      'Lärplattformen godtar inte anslutningens behörighet.',
    );
    await expect(page()).rejects.toMatchObject({ code: 'denied', message: 'Lärplattformen godtar inte Clews intyg.' });
    learning.controls.refuse(false);
    // Input that is not the profile's, straight to the service.
    for (const input of [{ cursor: 'x' }, { cursor: 7 }, { keys: ['anna'] }, { cursor: '1:1', more: true }])
      expect((await asInstallation(input)).status).toBe(400);
    // A call that fails the page stops it: nothing still queued is started.
    const started: string[] = [];
    const source = wrapped(async (method, call) => {
      started.push(method);
      if (method === 'courses') throw new SourceUnavailable('down');
      return call();
    });
    const one = stack({ source, concurrency: 1 });
    expect((await one.asInstallation({})).status).toBe(503);
    expect(started).toEqual(['everyone', 'accounts', 'courses']);
  });

  test('a page stops taking accounts halfway to its deadline and answers those it finished; the read moves on to the end', async () => {
    // Every Moodle call takes a while: a page cannot finish all ten accounts before its deadline.
    const slow = wrapped(async (_method, call) => {
      await new Promise(resolve => setTimeout(resolve, 8));
      return call();
    });
    const { sweep } = stack({
      source: slow,
      concurrency: 2,
      deadlines: { person: 3000, courses: 3000, course: 3000, holdings: 120 },
    });
    const pages = await sweep();
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap(p => p.rows.map(r => r.key))).toEqual([
      'hillevi',
      'hassan',
      'mikael',
      'anna',
      'erik',
      'maria',
      'johan',
      'karin',
      'sara',
      'lisa',
    ]);
    expect(pages.flatMap(p => p.rows).every(r => !r.partial)).toBe(true);
  });

  test('a deadline inside the first account answers what was read of it, marked partial, and moves on; nothing read at all is unavailable', async () => {
    // Courses never answer by themselves, only the page's deadline ends them; badges do answer.
    const source = wrapped(async (method, call, { signal }) => {
      if (method === 'courses')
        return new Promise((_, reject) =>
          signal?.addEventListener('abort', () => reject(new SourceUnavailable('stopped'))),
        );
      return call();
    });
    const { page } = stack({ source, deadlines: { person: 3000, courses: 3000, course: 3000, holdings: 60 } });
    const first = await page();
    expect(first.rows).toEqual([
      {
        key: 'hillevi',
        holdings: [
          {
            id: 'badge:1:user:3',
            type: 'badge:1',
            label: 'HLR-instruktör',
            kind: 'badge',
            issuedOn: ago(100),
            expiresOn: ago(-265),
          },
        ],
        partial: true,
      },
    ]);
    expect(first.next).toMatch(/^3:\d+$/);
    // Neither her courses nor her badges answer in time: nothing of her was read, and she is still answered, partial
    // and empty, so the cursor moves past her. Answered unavailable, the sweep would stop at her on every try.
    const slow = new Set(['courses', 'badges']);
    const silent = wrapped(async (method, call, { signal }) =>
      slow.has(method)
        ? new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new SourceUnavailable('stopped'))))
        : call(),
    );
    const stalled = stack({ source: silent, deadlines: { person: 3000, courses: 3000, course: 3000, holdings: 60 } });
    const past = await stalled.page();
    expect(past.rows).toEqual([{ key: 'hillevi', holdings: [], partial: true }]);
    expect(past.next).toMatch(/^3:\d+$/);
    // The next page begins after her.
    slow.clear();
    const after = await stalled.page(past.next);
    expect(after.rows[0]?.key).not.toBe('hillevi');
    expect(after.rows.length).toBeGreaterThan(0);
  });

  test("only the installation is answered: a person's assertion on its route, the installation's on a person's route, and one bound to another body or name are refused", async () => {
    const { service, registry, learning, asInstallation } = stack();
    const url = 'http://moodle-connector/clew/installation/moodle.holdings';
    const text = JSON.stringify({ input: {} });
    const send = (token: string, at = url, body = text) =>
      service.handle(
        new Request(at, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + token,
            'x-clew-connector-key': secret,
          },
          body,
        }),
      );
    const authority = await testAuthority(secret);
    const before = { ...learning.controls.calls };
    // A person's assertion, valid and bound to this very request, whoever the person is: refused, nothing read.
    for (const actor of [hillevi, anna, rektor])
      expect(
        (await send(await authority.assert(ID, actor, [], [], { body: text, capability: 'moodle.holdings' }))).status,
      ).toBe(401);
    expect(learning.controls.calls).toEqual(before);
    // The installation's own assertion, on a person's route: not a person, so refused there.
    const personUrl = 'http://moodle-connector/clew/capabilities/moodle.person';
    const personBody = JSON.stringify({ actor: hillevi, input: { keys: ['hillevi'] } });
    const onPersonRoute = await authority.installation(ID, { body: personBody, capability: 'moodle.person' });
    expect((await send(onPersonRoute, personUrl, personBody)).status).toBe(401);
    // Bound to another body, or to another name: refused.
    const installation = await authority.installation(ID, { body: text, capability: 'moodle.holdings' });
    expect((await send(installation, url, JSON.stringify({ input: { cursor: '3:1' } }))).status).toBe(401);
    expect((await send(installation, 'http://moodle-connector/clew/installation/moodle.other')).status).toBe(401);
    // Signed by another installation: refused.
    const foreign = await (
      await testAuthority('another-secret-entirely')
    ).installation(ID, { body: text, capability: 'moodle.holdings' });
    expect((await send(foreign)).status).toBe(401);
    // No assertion at all.
    expect((await send('')).status).toBe(401);
    // The installation's own, as Clew sends it: answered. A name it does not declare: not found.
    expect((await send(installation)).status).toBe(200);
    expect((await asInstallation({}, { name: 'moodle.everything' })).status).toBe(404);
    // Through Clew, no person can name it on any path: it is not a capability.
    for (const actor of [hillevi, anna, rektor]) {
      await expect(registry.run(actor, 'moodle.holdings', {})).rejects.toThrow(REFUSED_BY_CLEW);
      await expect(registry.validate(actor, 'moodle.holdings', {})).rejects.toThrow(REFUSED_BY_CLEW);
      await expect(registry.clewFor(actor, {}, ID).call('moodle.holdings', {})).rejects.toThrow(REFUSED_BY_CLEW);
    }
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

  test('the adapter is always named: no default, and a half-configured deployment does not start on made-up data', () => {
    const url = 'https://larplattform.example';
    const token = 'c1e0de0000000000000000000000d0e5';
    expect(adapterOf({ MOODLE_ADAPTER: 'moodle', MOODLE_URL: url, MOODLE_TOKEN: token })).toBe('moodle');
    expect(adapterOf({ MOODLE_ADAPTER: 'fixture' })).toBe('fixture');
    // What compose passes for an unset variable is the empty string.
    expect(adapterOf({ MOODLE_ADAPTER: 'fixture', MOODLE_URL: '', MOODLE_TOKEN: '' })).toBe('fixture');
    // A real address and token without the adapter named used to start the stand-in.
    expect(() => adapterOf({ MOODLE_URL: url, MOODLE_TOKEN: token })).toThrow('MOODLE_ADAPTER is not set');
    expect(() => adapterOf({})).toThrow('MOODLE_ADAPTER is not set');
    expect(() => adapterOf({ MOODLE_ADAPTER: ' ' })).toThrow('MOODLE_ADAPTER is not set');
    expect(() => adapterOf({ MOODLE_ADAPTER: 'live' })).toThrow('Unknown MOODLE_ADAPTER "live"');
    expect(() => adapterOf({ MOODLE_ADAPTER: 'moodle', MOODLE_URL: url })).toThrow('MOODLE_TOKEN is not set');
    expect(() => adapterOf({ MOODLE_ADAPTER: 'moodle' })).toThrow('MOODLE_URL and MOODLE_TOKEN are not set');
    expect(() => adapterOf({ MOODLE_ADAPTER: 'fixture', MOODLE_URL: url, MOODLE_TOKEN: token })).toThrow(
      'MOODLE_ADAPTER is "fixture" but MOODLE_URL and MOODLE_TOKEN are set',
    );
    expect(() => adapterOf({ MOODLE_ADAPTER: 'fixture', MOODLE_TOKEN: token })).toThrow('but MOODLE_TOKEN is set');
    // The connector itself never picks a source either.
    expect(() => createConnector({ secret })).toThrow('A source is required');
  });

  test('moodle.courses: a list longer than the answer may be is cut where a person can see it, never refused whole', async () => {
    // 3 courses under way, 300 completed and 400 badges: 703 rows where the declared answer holds 500.
    const many = (n: number, of: (i: number) => Row) => Array.from({ length: n }, (_, i) => of(i));
    const source = wrapped(async (method, call) => {
      if (method === 'courses')
        return [
          ...many(3, i => ({ id: 1000 + i, name: `Pågående ${i}`, idnumber: '', completed: false, tracked: true })),
          ...many(300, i => ({ id: 2000 + i, name: `Klar ${i}`, idnumber: '', completed: true, tracked: true })),
        ];
      if (method === 'completion') return Math.floor(at / 1000) - 86_400;
      if (method === 'badges')
        return many(400, i => ({
          id: 3000 + i,
          name: `Märke ${i}`,
          issuedAt: Math.floor(at / 1000) - i * 86_400,
          expiresAt: null,
        }));
      return call();
    });
    const { courses } = stack({ source });
    // Through Clew's registry, which validates the answer against the declared schema: it is answered, not refused.
    const rows = await courses(hillevi, 'hillevi');
    expect(rows).toHaveLength(COURSES_ROWS_MAX);
    expect(rows.at(-1)).toEqual({ name: 'Listan är avkortad: 204 kurser och märken till visas inte här.' });
    // The oldest completed courses go first: all 204 fit there, so what is under way and every badge is still listed.
    const count = (kind: string, status?: string) =>
      rows.filter(r => r.kind === kind && (!status || r.status === status)).length;
    expect([count('Kurs', 'Pågår'), count('Kurs', 'Genomförd'), count('Märke')]).toEqual([3, 96, 400]);
    // Exactly as many as the answer holds is the whole list, with no line.
    const exact = wrapped(async (method, call) =>
      method === 'courses'
        ? []
        : method === 'badges'
          ? many(COURSES_ROWS_MAX, i => ({
              id: 3000 + i,
              name: `Märke ${i}`,
              issuedAt: Math.floor(at / 1000),
              expiresAt: null,
            }))
          : call(),
    );
    const whole = await stack({ source: exact }).courses(hillevi, 'hillevi');
    expect(whole).toHaveLength(COURSES_ROWS_MAX);
    expect(whole.every(r => r.kind === 'Märke')).toBe(true);
  });

  test('the match field: username by default, which a Moodle user cannot change; idnumber when the installation says so', async () => {
    // Sara's idnumber is an employee number, her username her user name; Lisa's idnumber is her user name.
    const byUsername = stack();
    expect(await byUsername.personRows(hillevi, ['Sara'])).toEqual([{ key: 'sara', completed: 1, ongoing: 0 }]);
    const byIdnumber = stack({ match: 'idnumber' });
    expect((await byIdnumber.personRows(hillevi, ['sara', 'lisa'])).map(r => r.key)).toEqual(['lisa']);
    expect(() => createConnector({ secret, match: 'email' as never })).toThrow('Unknown match field');
  });

  test('matched on idnumber, two accounts that differ only in case on different pages are never both a row', async () => {
    const { learning, sweep } = stack({ match: 'idnumber' });
    // On the first page: an idnumber with a capital letter, and one in lower case.
    learning.controls.add('ab.one', 'Ab12');
    learning.controls.add('cd.one', 'cd34');
    // Enough accounts between for a page of their own, then the twins in other spellings.
    for (let i = 0; i < HOLDINGS_PAGE + 5; i++) learning.controls.add(`filler.${i}`, `filler-${i}`);
    learning.controls.add('ab.two', 'AB12');
    learning.controls.add('cd.two', 'CD34');
    const pages = await sweep();
    expect(pages.length).toBeGreaterThan(1);
    const pageOf = (key: string) => pages.findIndex(p => p.rows.some(r => r.key === key));
    const keys = pages.flatMap(p => p.rows.map(r => r.key));
    // Clew compares keys without regard to case: no two rows of the whole read may be the same person to it.
    const folded = keys.map(k => k.toLowerCase());
    expect(new Set(folded).size).toBe(folded.length);
    // Neither spelling with a capital letter is anyone; the lower-case one is, alone, on its own page.
    expect(folded.filter(k => k === 'ab12')).toEqual([]);
    expect(keys.filter(k => k.toLowerCase() === 'cd34')).toEqual(['cd34']);
    expect(pageOf('cd34')).toBe(0);
    expect(pageOf(`filler-${HOLDINGS_PAGE + 4}`)).toBeGreaterThan(0);
  });

  test('a key that two accounts hold is no one, under any relation', async () => {
    const { learning, post } = stack({ match: 'idnumber' });
    // Two Moodle accounts with the same idnumber: Moodle does not keep it unique.
    learning.controls.add('kim.a', 'kim');
    learning.controls.add('kim.b', 'kim');
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

  test('a key is looked up in lower case alone: the account that holds it so is the person, however the key is asked', async () => {
    const asked: string[][] = [];
    const twins: LearningSource = {
      async accounts(_field, values) {
        asked.push([...values]);
        const all = [
          { id: 11, username: 'a1', idnumber: 'Kim', suspended: false },
          { id: 12, username: 'a2', idnumber: 'kim', suspended: false },
          { id: 13, username: 'a3', idnumber: 'Lo', suspended: false },
          { id: 14, username: 'a4', idnumber: 'Lo', suspended: false },
        ];
        return all.filter(a => values.includes(a.idnumber));
      },
      everyone: async () => [],
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
    // However the key is asked, the account is the one that holds it in lower case; "Kim" is nobody's and takes
    // nothing from it. The answer never depends on which spellings happened to be asked.
    expect(await keys(['Kim'])).toEqual(['Kim']);
    expect(await keys(['KIM'])).toEqual(['KIM']);
    expect(asked).toEqual([['kim'], ['kim']]);
    // No account holds "lo" in lower case, and the two that hold "Lo" are no one, rather than either.
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
    expect((await post(hillevi, 'moodle.courses', {}, { about })).status).toBe(400);
    // The holdings read is the installation's (D119): on a person's route it is no capability at all.
    expect((await post(hillevi, 'moodle.holdings', {})).status).toBe(404);
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

  test('call volume: one lookup per batch, one call per person for moodle.person; for a page of holdings one list, one lookup, two per account and one per completed course', async () => {
    const { learning, personRows, page } = stack();
    const calls = learning.controls.calls;
    await personRows(hillevi, ['hillevi', 'anna', 'erik', 'nobody']);
    expect({ ...calls }).toEqual({ accounts: 1, everyone: 0, courses: 3, completion: 0, badges: 0, course: 0 });
    for (const key of Object.keys(calls)) calls[key as keyof typeof calls] = 0;
    const answer = await page();
    // Ten accounts, and one completion call for each completed course: every one of them is dated in the stand-in.
    const completed = answer.rows.flatMap(r => r.holdings).filter(h => h.kind === 'course').length;
    expect(answer.rows).toHaveLength(10);
    expect(answer.rows.some(r => r.partial)).toBe(false);
    expect({ ...calls }).toEqual({
      accounts: 1,
      everyone: 1,
      courses: 10,
      completion: completed,
      badges: 10,
      course: 0,
    });
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
    const { page } = stack({ source, concurrency: 2 });
    expect((await page()).rows).toHaveLength(10);
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
    const response = await post(hillevi, 'moodle.person', { keys }, { about: vouch(hillevi, keys) });
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
      assertInstallation: installationAssertionFor(ID, secret),
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
    // The installation's read (D119): its page as Clew reads it, counted and not shown, and a person refused on its route.
    expect(
      report.findings
        .filter(f => f.text.startsWith('moodle.holdings'))
        .map(f => `${f.level} ${f.text.replace(/\d+ ms$/, 'n ms')}`),
    ).toEqual([
      'ok moodle.holdings as the installation: 1 page, 10 rows, 34 holdings, 0 partial, the last page reached, withdrawalsReported false, n ms',
      "ok moodle.holdings as the installation: a person's assertion on its route is refused (401)",
    ]);
    const item = report.items.find(i => i.capability === 'moodle.holdings')!;
    expect(item).toMatchObject({ level: 'ok', label: 'Genomförda kurser och märken' });
    expect(item.description).not.toContain('hillevi');
    // Without the installation's signer the page is not read, and the person is still refused.
    const unsigned = await checkConnector({
      key: secret,
      url: 'http://moodle-connector',
      id: ID,
      assert: assertionFor(ID, secret),
      assertForeign: assertionFor(ID, 'another-secret-entirely'),
      fetch: connectorFetch,
    });
    expect(unsigned.findings.filter(f => f.text.startsWith('moodle.holdings')).map(f => f.level)).toEqual([
      'warn',
      'ok',
    ]);
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
 * token, whose parameters are those of 17, 22 to 25, made while a name was changed for the recording, and 34, made
 * before the service account could list the site's accounts.
 */
function recordedMoodle(
  override: (params: URLSearchParams) => (() => Promise<Response>) | undefined = () => undefined,
) {
  const byParams = new Map(
    readdirSync(SAMPLES)
      .filter(f => f.endsWith('.json') && !/^(14|22|23|24|25|34)-/.test(f))
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

  test("lists the site's accounts a window at a time, in id order, and an empty window past the end (30 to 32); refused without the right to list them (34)", async () => {
    const { source, calls } = recorded('30', '31', '32');
    const first = await source.everyone(0, 26);
    expect(first.map(a => a.id)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    expect(first[2]).toEqual({ id: 3, username: 'hillevi', idnumber: 'hillevi' });
    // The guest has no idnumber; nobody's full name is kept.
    expect(first[0]).toEqual({ id: 1, username: 'guest', idnumber: '' });
    expect(JSON.stringify(first)).not.toContain('Berg');
    expect((await source.everyone(5, 6)).map(a => a.username)).toEqual([
      'anna',
      'erik',
      'maria',
      'johan',
      'karin',
      'lars.bergstrom',
    ]);
    expect(await source.everyone(100, 26)).toEqual([]);
    for (const [i, n] of ['30', '31', '32'].entries()) sentAsRecorded(calls[i]!, n);
    // The guest is listed with everyone (30) and no read answers it; were another such account asked, its badges are that
    // one account's refusal (35) and its courses none (36).
    await expect(recorded('35').source.badges(1)).rejects.toBeInstanceOf(ItemUnreadable);
    expect(await recorded('36').source.courses(1)).toEqual([]);
    // An account whose details are withheld comes with its id alone, and keeps its place.
    expect(parseListedAccounts([{ id: 40, fullname: 'Dold' }])).toEqual([{ id: 40, username: '', idnumber: '' }]);
    // Without moodle/site:viewparticipants the list is refused: the service's matter, not one person's.
    await expect(recorded('34').source.everyone(0, 5)).rejects.toBeInstanceOf(SourceRefused);
  });

  test("behind the connector: the first page of every holding, Hillevi's list and two of her courses from the recorded answers", async () => {
    // The site's list (30) and its keys but the guest's (33) as recorded; Hillevi's courses, completions and badges (05,
    // 07, 18 to 20, 11); for every other account the recorded answers of an account with nothing (06, 12), since the
    // development Moodle's other accounts were not recorded one by one. Nothing is asked of the guest.
    const { source, asked } = recordedMoodle(params => {
      const fn = params.get('wsfunction');
      const user = params.get('userid');
      if (user === '1') throw new Error('The guest account was asked about.');
      if (fn === 'core_enrol_get_users_courses' && user !== '3') return async () => answer(sample('06'));
      if (fn === 'core_badges_get_user_badges' && user !== '3') return async () => answer(sample('12'));
      return undefined;
    });
    const { page, courses, course } = stack({ source, publicUrl: PUBLIC });
    const first = await page();
    expect(first.next).toBeUndefined();
    expect(first.withdrawalsReported).toBe(false);
    expect(first.rows.map(r => r.key)).toEqual([
      'moodle-admin',
      'hillevi',
      'hassan',
      'mikael',
      'anna',
      'erik',
      'maria',
      'johan',
      'karin',
      'lars.bergstrom',
      'maria.eriksson',
      'omar.hosseini',
      'petra.karlsson',
      'sven.lundgren',
      'yusuf.lindqvist',
      'clew-connector',
    ]);
    // Moodle's guest account (user 1 in 30) has no row, so nothing is partial; everyone else but Hillevi holds nothing.
    expect(first.rows.some(r => r.partial)).toBe(false);
    const others = first.rows.filter(r => r.key !== 'hillevi');
    expect(others.every(r => r.holdings.length === 0 && !r.partial)).toBe(true);
    expect(first.rows.find(r => r.key === 'hillevi')).toEqual({
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
    });
    const count = (fn: string) => asked.filter(a => a === fn).length;
    expect([
      count('core_enrol_get_enrolled_users'),
      count('core_user_get_users_by_field'),
      count('core_enrol_get_users_courses'),
      count('core_badges_get_user_badges'),
      count('core_completion_get_course_completion_status'),
    ]).toEqual([1, 1, 16, 16, 4]);
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

  test('behind the connector: Moodle withholding one course leaves the rest of the page whole', async () => {
    const { source } = recordedMoodle(params => {
      const fn = params.get('wsfunction');
      if (fn === 'core_completion_get_course_completion_status' && params.get('courseid') === '2')
        return moodleSays('nopermissions');
      if (fn === 'core_enrol_get_users_courses' && params.get('userid') !== '3')
        return async () => answer(sample('06'));
      if (fn === 'core_badges_get_user_badges' && params.get('userid') !== '3') return async () => answer(sample('12'));
      return undefined;
    });
    const row = (await stack({ source }).page()).rows.find(r => r.key === 'hillevi')!;
    expect(row.partial).toBe(true);
    expect(row.holdings.map(x => x.id)).toEqual([
      'course:6:user:3',
      'course:5:user:3',
      'course:3:user:3',
      'badge:1:user:3',
    ]);
  });
});
