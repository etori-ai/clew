// The Moodle connector's handlers and HTTP boundary: what a learning platform knows about a person, read as one service
// account. manifest.mjs owns the contract, learning.mjs the port, moodle.mjs Moodle's API. A person is found by the key
// Clew asks with (the provisioned user name, D97) in the Moodle field the installation names: `username` by default,
// which a Moodle user cannot change, `idnumber` as the alternative. Who may be asked about is Clew's to decide (D117):
// every call that names a person carries, in a body the assertion is bound to, how the caller stands to each key, and
// this connector answers a key only when that relation is `self` or `managed`. It keeps no copy of the organisation.
// Nothing is stored or cached between requests.
import { createVerifier } from './verification.mjs';
import { ItemUnreadable, SourceRefused, SourceUnavailable, createFixtureLearning } from './learning.mjs';
import {
  CONNECTOR,
  CRITERIA_MAX,
  DEFAULT_SOURCE,
  HOLDINGS_KEYS_MAX,
  KIND,
  PERSON_KEYS_MAX,
  STATUS,
  SUMMARY_MAX,
  courseIdPattern,
  createManifest,
} from './manifest.mjs';

export { createManifest };

export const MATCH_FIELDS = ['username', 'idnumber'];
/**
 * How long one read may take, in milliseconds, before its outstanding Moodle calls are stopped and it answers that the
 * platform did not answer: inside the four seconds Clew gives every source of a section or a list (D97 item 7) for the
 * read about a person, inside the ten seconds Clew waits for any call for the others.
 */
export const DEADLINES = { person: 3000, courses: 8000, course: 8000, holdings: 8000 };
/** The relations (D117) under which a person is answered about: their own, and a manager's direct report. */
export const ANSWERED = ['self', 'managed'];
const KEY_MAX = 512;
/** A course idnumber that looks like one of this connector's own type ids is not used as one: the type would be ambiguous. */
const OWN_TYPE = /^(course|badge):[0-9]+$/;
const COURSE_ID = new RegExp(courseIdPattern);
/**
 * A completion criterion as a person reads it, by Moodle's COMPLETION_CRITERIA_TYPE_* and its title, which is the
 * source's own name of the activity, role or course it concerns.
 */
const CRITERION = {
  1: () => 'Markerad som klar av deltagaren',
  2: () => 'Datum',
  3: () => 'Avregistrering',
  4: title => (title ? `Aktivitet: ${title}` : 'Aktivitet'),
  5: () => 'Tid som deltagare',
  6: () => 'Kursbetyg',
  7: title => (title ? `Markerad som klar av ${title}` : 'Markerad som klar av en lärare'),
  8: title => (title ? `Kurs: ${title}` : 'Annan kurs'),
};

class Invalid extends Error {}
class NotFound extends Error {}

const fold = value => value.toLowerCase();
const clip = (value, limit) => {
  const line = String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim();
  return line.length <= limit ? line : line.slice(0, limit - 1).trimEnd() + '…';
};
const byName = (a, b) => a.name.localeCompare(b.name, 'sv');
const stopped = () => new SourceUnavailable('The read was stopped.');

/**
 * At most `n` source calls at once for one read, however the work below fans out. Each call gets the read's signal;
 * once it aborts (the deadline, Clew going away) nothing still queued is started. A call that fails the read (anything
 * but one item refused) calls `failed` before the next call can start, which aborts the read.
 */
function limiter(n, signal, failed) {
  let active = 0;
  const waiting = [];
  const next = () => {
    while (waiting.length && (signal.aborted || active < n)) {
      const { task, resolve, reject } = waiting.shift();
      if (signal.aborted) {
        reject(stopped());
        continue;
      }
      active++;
      Promise.resolve()
        .then(() => task(signal))
        .then(resolve, error => {
          if (!(error instanceof ItemUnreadable)) failed();
          reject(error);
        })
        .finally(() => {
          active--;
          next();
        });
    }
  };
  signal.addEventListener('abort', next, { once: true });
  return task =>
    new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject });
      next();
    });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const fail = (code, message, status) => json({ error: { code, message } }, status);

/**
 * source: the learning-platform port (the stand-in by default). match: the Moodle field that holds the key Clew sends.
 * sourceLabel: the system's name as a person reads it. publicUrl: the address a person's browser reaches Moodle at, for
 * links to a course; without it there are none. timeZone: the zone a Moodle time is read as a day in. concurrency: how
 * many Moodle calls one read may have open at once. deadlines: per read, see DEADLINES. Identity, and how the caller
 * stands to each person named, come from the verified request, never from anything the connector works out itself.
 */
export function createConnector({
  jwks,
  secret,
  source = createFixtureLearning(),
  match = 'username',
  sourceLabel = DEFAULT_SOURCE,
  publicUrl,
  timeZone = 'Europe/Stockholm',
  concurrency = 4,
  deadlines = DEADLINES,
  clewUrl = process.env.CLEW_URL ?? '',
  now = () => Date.now(),
} = {}) {
  if (!MATCH_FIELDS.includes(match))
    throw new Error(`Unknown match field "${match}". Known: ${MATCH_FIELDS.join(', ')}.`);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
    throw new Error('The concurrency must be a whole number from 1 to 16.');
  const manifest = createManifest({ source: sourceLabel });
  const verify = createVerifier({ secret, jwks, clewUrl }, CONNECTOR);
  const linkBase = publicUrl ? new URL(publicUrl).toString().replace(/\/+$/, '') : undefined;
  if (linkBase && !/^https?:\/\//.test(linkBase)) throw new Error('The public Moodle address must be http(s).');
  /** Moodle's own page for a course, in the person's browser; none without a public address. */
  const courseLink = id => (linkBase ? { link: `${linkBase}/course/view.php?id=${id}` } : {});
  const days = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  /** A Moodle time (Unix seconds) as the calendar day it falls on where the installation is. */
  const dayOf = seconds => days.format(new Date(seconds * 1000));
  const spoken = new Intl.DateTimeFormat('sv-SE', { timeZone, day: 'numeric', month: 'short', year: 'numeric' });
  /** A criterion and whether it is met, as one line: "Markerad som klar av Teacher: uppfyllt 3 okt. 2026". */
  const criterionLine = c => {
    const what = clip((CRITERION[c.type] ?? (() => 'Villkor'))(c.title ? clip(c.title, 200) : ''), 240);
    return `${what}: ${c.complete ? `uppfyllt${c.at ? ' ' + spoken.format(new Date(c.at * 1000)) : ''}` : 'inte uppfyllt'}`;
  };

  function keysOf(input, max) {
    const keys = input.keys;
    if (
      Object.keys(input).some(k => k !== 'keys') ||
      !Array.isArray(keys) ||
      keys.length > max ||
      keys.some(k => typeof k !== 'string' || !k.length || k.length > KEY_MAX)
    )
      throw new Invalid('Ogiltig förfrågan.');
    return keys;
  }

  /**
   * How the caller stands to each person the request names, as Clew vouched for it (D117): the `about` of the verified
   * body, `{ entity: "person", relations: { <key>: <relation> } }`, folded by key without regard to case. Anything else
   * (no `about`, another entity, a relation that is not a string) vouches for nobody.
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
  const signedAs = (actor, value) =>
    typeof actor.userName === 'string' && typeof value === 'string' && fold(actor.userName) === fold(value);

  /**
   * The Moodle account behind each key the caller may be answered about, in the order asked. A key is answered only when
   * Clew vouched for it as `self` or `managed`: a key it did not vouch for, a missing `about` (a Clew on protocol 2,
   * anything that sends keys past Clew) and any other relation are no one, the same as a person Moodle does not know.
   * Then what is about Moodle and not about the organisation: one account per key without regard to case, a key asked
   * twice (in any case) answered once; each key looked up as asked and in lower case, since Moodle compares exactly; a
   * key that matches no account, or more than one without regard to case, is no one; and under `self` the account found
   * must be the signed caller's own. Every read finds its people here.
   */
  async function find(actor, keys, run, relations) {
    const asked = [];
    const seen = new Set();
    for (const key of keys) {
      if (seen.has(fold(key)) || !ANSWERED.includes(relations.get(fold(key)))) continue;
      seen.add(fold(key));
      asked.push(key);
    }
    if (!asked.length) return [];
    const values = [...new Set(asked.flatMap(k => [k, fold(k)]))];
    const accounts = await run(signal => source.accounts(match, values, { signal }));
    return asked.flatMap(key => {
      const candidates = accounts.filter(a => typeof a[match] === 'string' && fold(a[match]) === fold(key));
      if (candidates.length !== 1) return [];
      const account = candidates[0];
      if (relations.get(fold(key)) === 'self' && !signedAs(actor, account[match])) return [];
      return [{ key, account }];
    });
  }

  /** A call whose refusal concerns this one item: `undefined` in its place, and the caller marks the person partial. */
  const orUnreadable = async call => {
    try {
      return await call();
    } catch (error) {
      if (error instanceof ItemUnreadable) return undefined;
      throw error;
    }
  };

  /** A course's type id for the competence register: its idnumber, which an administrator sets, else its Moodle id. */
  const courseType = course =>
    course.idnumber && !OWN_TYPE.test(course.idnumber) ? clip(course.idnumber, 200) : `course:${course.id}`;
  const expired = badge => badge.expiresAt !== null && badge.expiresAt * 1000 <= now();

  const capabilities = {
    // About a person (D97): how many courses each person has completed and how many are under way. One Moodle call
    // per person after the lookup; no completion date is read here. A person whose courses Moodle refuses has no row:
    // there is nothing true to count.
    person: async (actor, input, run, relations) => {
      const keys = keysOf(input, PERSON_KEYS_MAX);
      const people = await find(actor, keys, run, relations);
      const rows = await Promise.all(
        people.map(async ({ key, account }) => {
          const courses = await orUnreadable(() => run(signal => source.courses(account.id, { signal })));
          if (!courses) return undefined;
          return {
            key,
            completed: courses.filter(c => c.completed).length,
            ongoing: courses.filter(c => !c.completed && c.tracked).length,
          };
        }),
      );
      return { rows: rows.filter(Boolean) };
    },

    // One person's courses and badges: what is under way, what was completed and when, and the badges with their end.
    // A course that records no completion says nothing of competence and is left out; a completed course whose day
    // Moodle withholds is shown without it. A person whose course or badge list Moodle refuses is not answered: this is
    // one person's list, and a list with a part silently missing would read as complete.
    courses: async (actor, input, run, relations) => {
      const person = input.person;
      if (
        Object.keys(input).some(k => k !== 'person') ||
        typeof person !== 'string' ||
        !person.length ||
        person.length > KEY_MAX
      )
        throw new Invalid('Ogiltig förfrågan.');
      // Not there and not to be shown are the same answer: a caller cannot tell whether a colleague has an account.
      const [found] = await find(actor, [person], run, relations);
      if (!found) throw new NotFound();
      const id = found.account.id;
      let courses, badges;
      try {
        [courses, badges] = await Promise.all([
          run(signal => source.courses(id, { signal })),
          run(signal => source.badges(id, { signal })),
        ]);
      } catch (error) {
        throw error instanceof ItemUnreadable ? new SourceUnavailable(error.message) : error;
      }
      const completed = await Promise.all(
        courses
          .filter(c => c.completed)
          .map(async c => ({
            course: c,
            at: c.tracked ? await orUnreadable(() => run(signal => source.completion(id, c.id, { signal }))) : null,
          })),
      );
      // A course's row opens it (moodle.course) by the key as asked and its id, and links to it in Moodle.
      const opens = course => ({ person, course: String(course.id), ...courseLink(course.id) });
      const ongoing = courses
        .filter(c => !c.completed && c.tracked)
        .sort(byName)
        .map(c => ({ name: clip(c.name, 400), kind: KIND.course, status: STATUS.ongoing, ...opens(c) }));
      const done = completed
        .sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || byName(a.course, b.course))
        .map(({ course, at }) => ({
          name: clip(course.name, 400),
          kind: KIND.course,
          status: STATUS.completed,
          ...(at ? { date: dayOf(at) } : {}),
          ...opens(course),
        }));
      const held = badges
        .sort((a, b) => b.issuedAt - a.issuedAt || byName(a, b))
        .map(b => ({
          name: clip(b.name, 400),
          kind: KIND.badge,
          status: expired(b) ? STATUS.expired : STATUS.valid,
          date: dayOf(b.issuedAt),
          ...(b.expiresAt !== null ? { expiresOn: dayOf(b.expiresAt) } : {}),
        }));
      return { rows: [...ongoing, ...done, ...held] };
    },

    // One person's one course, opened from a row of moodle.courses. The person is found as every read finds them, and
    // the course must be one the list would show for them (enrolled, and completed or recording completion): anyone
    // else, any other course and a course that does not exist are the same not found, and nothing about the course is
    // read before that is settled.
    course: async (actor, input, run, relations) => {
      const { person, course } = input;
      if (
        Object.keys(input).some(k => k !== 'person' && k !== 'course') ||
        typeof person !== 'string' ||
        !person.length ||
        person.length > KEY_MAX ||
        typeof course !== 'string' ||
        !COURSE_ID.test(course)
      )
        throw new Invalid('Ogiltig förfrågan.');
      const courseId = Number(course);
      const [found] = await find(actor, [person], run, relations);
      if (!found) throw new NotFound();
      const id = found.account.id;
      let enrolled;
      try {
        enrolled = (await run(signal => source.courses(id, { signal }))).find(c => c.id === courseId);
      } catch (error) {
        throw error instanceof ItemUnreadable ? new SourceUnavailable(error.message) : error;
      }
      if (!enrolled || !(enrolled.completed || enrolled.tracked)) throw new NotFound();
      const [about, status] = await Promise.all([
        orUnreadable(() => run(signal => source.course(courseId, { signal }))),
        enrolled.tracked
          ? orUnreadable(() => run(signal => source.completionStatus(id, courseId, { signal })))
          : undefined,
      ]);
      const completedAt = enrolled.completed && status?.completed ? status.at : null;
      const criteria = (status?.criteria ?? []).map(criterionLine);
      const shown =
        criteria.length > CRITERIA_MAX
          ? [...criteria.slice(0, CRITERIA_MAX - 1), `och ${criteria.length - (CRITERIA_MAX - 1)} villkor till`]
          : criteria;
      const summary = about?.summary ? clip(about.summary.replace(/\s+/g, ' '), SUMMARY_MAX) : '';
      return {
        name: clip(about?.name || enrolled.name, 400),
        ...(about?.category ? { category: clip(about.category, 200) } : {}),
        status: enrolled.completed ? STATUS.completed : STATUS.ongoing,
        ...(completedAt ? { completedOn: dayOf(completedAt) } : {}),
        ...(shown.length ? { criteria: shown } : {}),
        ...(summary ? { summary } : {}),
        ...courseLink(courseId),
      };
    },

    // The holdings profile (D108 item 9): per person the platform knows, every completed course with the day it was
    // completed and every badge with the day it was issued and, when it has one, the day it runs out. What Moodle
    // refuses for one person or one course is left out and the person's row says `partial`; the answer as a whole says
    // that this source reports no withdrawals.
    holdings: async (actor, input, run, relations) => {
      const keys = keysOf(input, HOLDINGS_KEYS_MAX);
      const people = await find(actor, keys, run, relations);
      const rows = await Promise.all(
        people.map(async ({ key, account }) => {
          const id = account.id;
          const [courses, badges] = await Promise.all([
            orUnreadable(() => run(signal => source.courses(id, { signal }))),
            orUnreadable(() => run(signal => source.badges(id, { signal }))),
          ]);
          const dated = await Promise.all(
            (courses ?? [])
              .filter(c => c.completed)
              .map(async c => ({
                course: c,
                at: c.tracked ? await orUnreadable(() => run(signal => source.completion(id, c.id, { signal }))) : null,
              })),
          );
          const holdings = [
            ...dated
              .filter(d => d.at)
              .map(({ course, at }) => ({
                id: `course:${course.id}:user:${id}`,
                type: courseType(course),
                label: clip(course.name, 400),
                kind: 'course',
                issuedOn: dayOf(at),
              })),
            ...(badges ?? []).map(b => ({
              id: `badge:${b.id}:user:${id}`,
              type: `badge:${b.id}`,
              label: clip(b.name, 400),
              kind: 'badge',
              issuedOn: dayOf(b.issuedAt),
              ...(b.expiresAt !== null ? { expiresOn: dayOf(b.expiresAt) } : {}),
            })),
          ];
          const partial = !courses || !badges || dated.some(d => !d.at);
          return { key, holdings, ...(partial ? { partial: true } : {}) };
        }),
      );
      return { withdrawalsReported: false, rows };
    },
  };

  // HTTP boundary: route, verify Clew, dispatch under the read's deadline and translate errors. Moodle's own error text
  // never leaves.
  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) return fail('not-found', 'Okänd adress.', 404);

    // The assertion must have been issued for exactly this body and this capability (D117), so the `input` and the
    // `about` read below are Clew's. A Clew on protocol 2 signs no body and is refused here.
    const assertion = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(assertion, request.headers.get('x-clew-connector-key'), request);
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
    const short = name.startsWith(CONNECTOR + '.') ? name.slice(CONNECTOR.length + 1) : '';
    const capability = Object.hasOwn(capabilities, short) ? capabilities[short] : undefined;
    if (!capability) return fail('not-found', 'Okänd förmåga.', 404);
    const input = body && typeof body.input === 'object' && body.input && !Array.isArray(body.input) ? body.input : {};

    // The read stops at its deadline, when Clew goes away, or when one of its calls has failed it: whatever is still
    // queued is not started, and what is under way is aborted.
    const done = new AbortController();
    const signal = AbortSignal.any([done.signal, AbortSignal.timeout(deadlines[short]), request.signal]);
    try {
      return json({
        output: await capability(
          actor,
          input,
          limiter(concurrency, signal, () => done.abort()),
          relationsOf(body?.about),
        ),
      });
    } catch (error) {
      if (error instanceof Invalid) return fail('invalid', error.message, 400);
      if (error instanceof NotFound)
        return fail('not-found', `Personen finns inte i ${sourceLabel}, eller så får du inte se uppgifterna.`, 404);
      if (error instanceof SourceRefused)
        return fail('denied', `${sourceLabel} godtar inte anslutningens behörighet.`, 401);
      if (!(error instanceof SourceUnavailable)) console.error(`${CONNECTOR} connector: unexpected`, error?.name);
      return fail('unavailable', `${sourceLabel} svarar inte just nu.`, 503);
    } finally {
      done.abort();
    }
  }

  return { manifest, handle };
}
