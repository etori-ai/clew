// The Moodle connector's handlers and HTTP boundary: what a learning platform knows about a person, read as one service
// account. manifest.mjs owns the contract, learning.mjs the port, moodle.mjs Moodle's API. A person is found by the key
// Clew asks with (the provisioned user name, D97) in the Moodle field the installation names: `username` by default,
// which a Moodle user cannot change, `idnumber` as the alternative. Who may be asked about is Clew's to decide (D117):
// every call that names a person carries, in a body the assertion is bound to, how the caller stands to each key, and
// this connector answers a key only when that relation is `self` or `managed`. It keeps no copy of the organisation.
// One read is the installation's own (D119): every account and what it holds, a page at a time, answered only to Clew's
// assertion that no person is behind the call. Nothing is stored or cached between requests.
import { createVerifier } from './verification.mjs';
import { ItemUnreadable, SourceRefused, SourceUnavailable } from './learning.mjs';
import {
  CONNECTOR,
  COURSES_ROWS_MAX,
  CRITERIA_MAX,
  DEFAULT_SOURCE,
  HOLDINGS_PAGE,
  HOLDINGS_PER_ROW,
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
/**
 * How many places before the cursor a page of the installation's holdings read starts to read Moodle's list (D119).
 * Moodle pages its list of accounts by place, and an account deleted before the cursor moves every later one up a place:
 * reading from earlier and skipping what was answered keeps a page from passing over an account. When more were deleted
 * than this, the page steps back further, to the list's start at worst.
 */
export const OVERLAP = 10;
/**
 * Moodle's guest account, as `isguestuser()` knows it: the local account named `guest`, which Moodle creates at install
 * and keeps in `$CFG->siteguest`, and whose name cannot be changed. It is nobody's: no read answers it (D119).
 */
export const GUEST = 'guest';
const isGuest = account => account?.username === GUEST;
/** The route of a read Clew makes as the installation (D119). */
const INSTALLATION_ROUTE = '/clew/installation/';
/** The cursor as the manifest declares it (`cursorPattern`), its two numbers taken apart. */
const CURSOR = /^([0-9]{1,10}):([0-9]{1,9})$/;
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
 * but one item refused) calls `failed` with its error before the next call can start, which aborts the read.
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
          if (!(error instanceof ItemUnreadable)) failed(error);
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
 * source: the learning-platform port, always given: nothing here falls back to the stand-in. match: the Moodle field that holds the key Clew sends.
 * sourceLabel: the system's name as a person reads it. publicUrl: the address a person's browser reaches Moodle at, for
 * links to a course; without it there are none. timeZone: the zone a Moodle time is read as a day in. concurrency: how
 * many Moodle calls one read may have open at once. deadlines: per read, see DEADLINES. Identity, and how the caller
 * stands to each person named, come from the verified request, never from anything the connector works out itself.
 */
export function createConnector({
  jwks,
  secret,
  source,
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
  if (!source) throw new Error('A source is required: the learning platform the connector reads.');
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
   * Then what is about Moodle and not about the organisation: a key asked twice (in any case) is answered once, the
   * account is the one that holds the key in lower case, a key no account or more than one holds so is no one
   * (`accountsOf`), and under `self` the account found must be the signed caller's own. Every read finds its people here.
   */
  async function find(actor, keys, run, relations) {
    const asked = keys.filter(key => ANSWERED.includes(relations.get(fold(key))));
    return (await accountsOf(asked, run)).filter(
      ({ key, account }) => relations.get(fold(key)) !== 'self' || signedAs(actor, account[match]),
    );
  }
  /**
   * The one Moodle account behind each key, in the order given, a key given twice (in any case) once. Clew compares a
   * key without regard to case; the account behind it is the one that holds it in lower case, as Moodle keeps every
   * username, looked up in that spelling alone. A key that no account holds so, or more than one, is no one. Moodle's
   * guest account is no one's. The rule every read finds an account by, the person's and the installation's.
   *
   * Why lower case alone: Moodle compares exactly, so a lookup cannot say whether another account holds the same
   * idnumber in another spelling (`AB12` beside `Ab12`), on this page of the installation's read or on one far from
   * it, and Clew would take both for the same person. The lower-case spelling is the one a single exact lookup
   * settles: every account that holds it comes back. An account whose idnumber has a capital letter is therefore
   * nobody's, whatever is asked, and takes nothing from the account that holds the key in lower case. A Moodle whose
   * database compares without regard to case answers the other spellings too; they are left out the same way.
   */
  async function accountsOf(keys, run) {
    const asked = [];
    const seen = new Set();
    for (const key of keys) {
      if (seen.has(fold(key))) continue;
      seen.add(fold(key));
      asked.push(key);
    }
    if (!asked.length) return [];
    const values = asked.map(fold);
    const accounts = (await run(signal => source.accounts(match, values, { signal }))).filter(a => !isGuest(a));
    return asked.flatMap(key => {
      const holders = accounts.filter(a => a[match] === fold(key));
      return holders.length === 1 ? [{ key, account: holders[0] }] : [];
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
    // one person's list, and a list with a part silently missing would read as complete. For the same reason a list
    // longer than the answer may be (COURSES_ROWS_MAX) is cut where a person can see it: the oldest completed courses go
    // first, then the oldest badges, then courses under way, and the last row says how many are not shown.
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
      const over = ongoing.length + done.length + held.length - COURSES_ROWS_MAX;
      if (over <= 0) return { rows: [...ongoing, ...done, ...held] };
      // One row is the line itself, so one more than the overflow is left out.
      let left = over + 1;
      const cut = list => {
        const kept = list.slice(0, Math.max(0, list.length - left));
        left -= list.length - kept.length;
        return kept;
      };
      const [keptDone, keptHeld, keptOngoing] = [cut(done), cut(held), cut(ongoing)];
      return {
        rows: [
          ...keptOngoing,
          ...keptDone,
          ...keptHeld,
          { name: `Listan är avkortad: ${over + 1} kurser och märken till visas inte här.` },
        ],
      };
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
  };

  /**
   * One account's holdings (D108 item 9): every completed course with the day it was completed, every badge with the day
   * it was issued and, when it has one, the day it runs out. `progress` keeps what has come back so far, so a page whose
   * deadline passes in the middle of its first account can still answer what was read of it.
   */
  async function holdingsOf(account, run, progress) {
    const id = account.id;
    await Promise.all([
      orUnreadable(() => run(signal => source.courses(id, { signal }))).then(c => (progress.courses = c ?? null)),
      orUnreadable(() => run(signal => source.badges(id, { signal }))).then(b => (progress.badges = b ?? null)),
    ]);
    await Promise.all(
      (progress.courses ?? [])
        .filter(c => c.completed)
        .map(async c =>
          progress.dated.set(
            c.id,
            c.tracked
              ? ((await orUnreadable(() => run(signal => source.completion(id, c.id, { signal })))) ?? null)
              : null,
          ),
        ),
    );
  }
  /**
   * The row of one account from what was read of it: a completed course without a day, a list Moodle refused or one not
   * read in time is left out and the row says `partial`, as is anything past the most a row carries.
   */
  function rowOf(key, account, progress) {
    const id = account.id;
    const completed = (progress.courses ?? []).filter(c => c.completed);
    const holdings = [
      ...completed.flatMap(course => {
        const at = progress.dated.get(course.id);
        return at
          ? [
              {
                id: `course:${course.id}:user:${id}`,
                type: courseType(course),
                label: clip(course.name, 400),
                kind: 'course',
                issuedOn: dayOf(at),
              },
            ]
          : [];
      }),
      ...(progress.badges ?? []).map(b => ({
        id: `badge:${b.id}:user:${id}`,
        type: `badge:${b.id}`,
        label: clip(b.name, 400),
        kind: 'badge',
        issuedOn: dayOf(b.issuedAt),
        ...(b.expiresAt !== null ? { expiresOn: dayOf(b.expiresAt) } : {}),
      })),
    ];
    const partial =
      !progress.courses ||
      !progress.badges ||
      completed.some(c => !progress.dated.get(c.id)) ||
      holdings.length > HOLDINGS_PER_ROW;
    return { key, holdings: holdings.slice(0, HOLDINGS_PER_ROW), ...(partial ? { partial: true } : {}) };
  }

  /**
   * The accounts after the one with id `after`, read from Moodle's list in id order from the place `at` the cursor
   * gives, `OVERLAP` places earlier so that an account deleted before it does not make the page pass over one. If even
   * that window starts past an account not yet answered (more were deleted), it steps back further, to the start at
   * worst. Accounts are added at the end of the list, so none appears before the cursor.
   */
  async function accountsAfter(after, at, run) {
    for (let back = OVERLAP; ; back *= 4) {
      // Every step at least four times further back, so the list's start is reached in a few calls at most.
      const from = back >= at ? 0 : at - back;
      const count = at - from + HOLDINGS_PAGE + 1;
      const listed = await run(signal => source.everyone(from, count, { signal }));
      if (from === 0 || (listed.length && listed[0].id <= after)) return { from, listed };
    }
  }

  // The reads Clew makes as the installation itself (D119): no actor, no `about`, nobody to answer about but everyone.
  const installation = {
    // The holdings profile (D108 item 9): a page of the site's accounts in Moodle's id order, each with every holding
    // the platform can see, and the cursor of the next page. An account Moodle withholds the details of has no key and
    // no row; an account that does not hold its key in lower case, or shares it with another, is no one, as in every
    // read. A page
    // stops taking accounts halfway to its deadline and answers those it finished, so a slow Moodle gives shorter pages
    // and the read still moves on; if the deadline passes before the first account is finished, that account is
    // answered with what was read of it, nothing if nothing was, and marked partial. A failing call fails the page.
    holdings: async (input, run, read) => {
      if (Object.keys(input).some(k => k !== 'cursor')) throw new Invalid('Ogiltig förfrågan.');
      const cursor =
        input.cursor === undefined ? undefined : CURSOR.exec(typeof input.cursor === 'string' ? input.cursor : '');
      if (input.cursor !== undefined && !cursor) throw new Invalid('Ogiltig förfrågan.');
      const after = cursor ? Number(cursor[1]) : 0;
      const at = cursor ? Number(cursor[2]) : 0;
      if (!Number.isSafeInteger(after) || !Number.isSafeInteger(at)) throw new Invalid('Ogiltig förfrågan.');
      const { from, listed } = await accountsAfter(after, at, run);
      const unseen = listed.filter(a => a.id > after);
      const page = unseen.slice(0, HOLDINGS_PAGE);
      // A key Moodle gave for each account, checked as every read checks one: it must find this account and no other.
      // Only a key in lower case is anyone's (`accountsOf`): an account on another page that differs from one here only
      // in case cannot be seen from here, so its other spellings are no one on every page, and one in the same spelling
      // is found by the lookup, here or elsewhere.
      // Moodle's guest account is left out: it is nobody's, and Moodle will not read its badges (35).
      const spelt = page.filter(
        a =>
          !isGuest(a) &&
          typeof a[match] === 'string' &&
          a[match] !== '' &&
          a[match].length <= KEY_MAX &&
          a[match] === fold(a[match]),
      );
      const twice = new Set(spelt.map(a => fold(a[match])).filter((k, i, all) => all.indexOf(k) !== i));
      const keyed = spelt.filter(a => !twice.has(fold(a[match])));
      const found = new Map(
        (
          await accountsOf(
            keyed.map(a => a[match]),
            run,
          )
        ).map(({ key, account }) => [account.id, key]),
      );
      const work = page.map(account => {
        const key = keyed.includes(account) ? found.get(account.id) : undefined;
        return { account, key, done: key === undefined, progress: { dated: new Map() } };
      });
      // A pool of accounts at a time, each with its calls through the read's limiter; no account is started once half
      // the deadline has passed, except the first, so every page moves on.
      let next = 0;
      let started = 0;
      const begun = Date.now();
      const worker = async () => {
        while (next < work.length && !read.signal.aborted) {
          const item = work[next];
          if (!item.done && started > 0 && Date.now() - begun >= read.deadline / 2) return;
          next++;
          if (item.done) continue;
          started++;
          await holdingsOf(item.account, run, item.progress);
          item.done = true;
        }
      };
      const settled = await Promise.allSettled(Array.from({ length: Math.max(1, Math.ceil(concurrency / 2)) }, worker));
      // A call that failed the page fails it; so does anything that is not Moodle being stopped.
      const failure = read.failure();
      if (failure) throw failure;
      const broken = settled.find(s => s.status === 'rejected' && !(s.reason instanceof SourceUnavailable));
      if (broken) throw broken.reason;
      if (settled.some(s => s.status === 'rejected') && !read.expired()) throw stopped();
      // The accounts finished, in order, up to the first that is not.
      let answered = work.findIndex(item => !item.done);
      if (answered < 0) answered = work.length;
      const rows = work
        .slice(0, answered)
        .flatMap(item => (item.key ? [rowOf(item.key, item.account, item.progress)] : []));
      if (answered < work.length && !work.slice(0, answered).some(item => item.key)) {
        // The deadline passed inside the page's first account (only accounts without a row before it): what was read of
        // it, marked partial, even when that is nothing. Answering the page unavailable instead would stop the sweep at
        // this account on every try, so a slow account would hold back every account after it for good.
        const first = work[answered];
        rows.push({ ...rowOf(first.key, first.account, first.progress), partial: true });
        answered++;
      }
      const last = work[answered - 1];
      const ended = answered === work.length && unseen.length <= HOLDINGS_PAGE;
      return {
        withdrawalsReported: false,
        rows,
        ...(ended || !last ? {} : { next: `${last.account.id}:${from + listed.indexOf(last.account) + 1}` }),
      };
    },
  };

  /** The error of a read as the protocol answers it. Moodle's own error text never leaves. */
  function answerFor(error) {
    if (error instanceof Invalid) return fail('invalid', error.message, 400);
    if (error instanceof NotFound)
      return fail('not-found', `Personen finns inte i ${sourceLabel}, eller så får du inte se uppgifterna.`, 404);
    if (error instanceof SourceRefused)
      return fail('denied', `${sourceLabel} godtar inte anslutningens behörighet.`, 401);
    if (!(error instanceof SourceUnavailable)) console.error(`${CONNECTOR} connector: unexpected`, error?.name);
    return fail('unavailable', `${sourceLabel} svarar inte just nu.`, 503);
  }
  const objectInput = body =>
    body && typeof body.input === 'object' && body.input && !Array.isArray(body.input) ? body.input : {};
  const shortName = name => (name.startsWith(CONNECTOR + '.') ? name.slice(CONNECTOR.length + 1) : '');

  /**
   * A read Clew makes as the installation (D119): answered only when the assertion is the installation's own, bound to
   * this body and this name. A person's assertion, whoever they are, is refused as an invalid credential is, before
   * anything is read, and so is one bound to another body or another name.
   */
  async function installationCall(request, url, assertion, key) {
    if (!(await verify.installation(assertion, key, request))) return fail('denied', 'Ogiltigt behörighetsbevis.', 401);
    let body;
    try {
      body = await request.json();
    } catch {
      return fail('invalid', 'Ogiltig förfrågan.', 400);
    }
    const short = shortName(decodeURIComponent(url.pathname.slice(INSTALLATION_ROUTE.length)));
    const read = Object.hasOwn(installation, short) ? installation[short] : undefined;
    if (!read) return fail('not-found', 'Okänd förmåga.', 404);
    // As a person's read: stopped at the deadline, when Clew goes away, or when a call fails it. The page also needs to
    // know which of the three it was, since the deadline alone still answers what was finished.
    const done = new AbortController();
    const deadline = deadlines[short];
    const timeout = AbortSignal.timeout(deadline);
    const signal = AbortSignal.any([done.signal, timeout, request.signal]);
    let failure;
    const run = limiter(concurrency, signal, error => {
      if (!signal.aborted) failure ??= error;
      done.abort();
    });
    try {
      return json({
        output: await read(objectInput(body), run, {
          signal,
          deadline,
          failure: () => failure,
          expired: () => timeout.aborted && !request.signal.aborted,
        }),
      });
    } catch (error) {
      return answerFor(error);
    } finally {
      done.abort();
    }
  }

  // HTTP boundary: route, verify Clew, dispatch under the read's deadline and translate errors. Moodle's own error text
  // never leaves.
  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) return fail('not-found', 'Okänd adress.', 404);

    // The assertion must have been issued for exactly this body and this capability (D117), so the `input` and the
    // `about` read below are Clew's. A Clew on protocol 2 signs no body and is refused here.
    const assertion = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const key = request.headers.get('x-clew-connector-key');
    if (url.pathname.startsWith(INSTALLATION_ROUTE)) return installationCall(request, url, assertion, key);
    // A person's call: the installation's own assertion is never one (D119), and the verifier refuses it.
    const actor = await verify(assertion, key, request);
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
    const short = shortName(name);
    const capability = Object.hasOwn(capabilities, short) ? capabilities[short] : undefined;
    if (!capability) return fail('not-found', 'Okänd förmåga.', 404);

    // The read stops at its deadline, when Clew goes away, or when one of its calls has failed it: whatever is still
    // queued is not started, and what is under way is aborted.
    const done = new AbortController();
    const signal = AbortSignal.any([done.signal, AbortSignal.timeout(deadlines[short]), request.signal]);
    try {
      return json({
        output: await capability(
          actor,
          objectInput(body),
          limiter(concurrency, signal, () => done.abort()),
          relationsOf(body?.about),
        ),
      });
    } catch (error) {
      return answerFor(error);
    } finally {
      done.abort();
    }
  }

  return { manifest, handle };
}
