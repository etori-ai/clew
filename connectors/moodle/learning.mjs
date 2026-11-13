// The learning-platform port, its errors, and an in-memory stand-in for the unit tests and the connector's fixture mode.
// moodle.mjs is the same port over Moodle's REST web service API; connector.mjs knows only the port. The connector reads
// as one service account, so no method takes a person's token.
//
// The port (each method takes `{ signal }` last: when it aborts, the call stops and throws SourceUnavailable):
//   accounts(field, values)    the accounts whose `field` ("username" or "idnumber") equals one of `values`, compared as
//                              Moodle compares it (exactly); [{ id, username, idnumber, suspended }]
//   everyone(from, count)      every account of the site in id order, deleted ones left out and suspended ones kept,
//                              `count` of them from position `from`: [{ id, username, idnumber }]; an account whose
//                              details the service account may not see comes with its id alone (empty username)
//   courses(userId)            the courses the account is enrolled in: [{ id, name, idnumber, completed, tracked }],
//                              `tracked` when the course records completion
//   completion(userId, courseId)  when the account completed the course, in Unix seconds; null when it has not, is not
//                              enrolled, or the date cannot be read
//   completionStatus(userId, courseId)  the same, whole: { completed, at, criteria: [{ type, title, complete, at }] },
//                              `type` being Moodle's COMPLETION_CRITERIA_TYPE_*; null where completion() is
//   course(courseId)           one course: { id, name, idnumber, category, summary } with the summary as plain text;
//                              null when there is none the service account may see
//   badges(userId)             the badges the account holds: [{ id, name, issuedAt, expiresAt }], expiresAt null when
//                              the badge does not expire
// Each method throws SourceUnavailable when the platform does not answer usefully, SourceRefused when it refuses the
// connector's own credential or rights, and ItemUnreadable when it refuses this one person or course only.

/** The platform did not answer, or answered something that cannot be read. */
export class SourceUnavailable extends Error {}
/** The platform refused the connector's credential or its rights: an operator's matter, not the person's. */
export class SourceRefused extends Error {}
/**
 * The platform refused one person's or one course's data (a right withheld on one course, an account deleted or not
 * confirmed): that item is left out, and the rest of the answer stands.
 */
export class ItemUnreadable extends Error {}

const DAY = 86_400;

/**
 * The seed's people (.devcontainer/moodle/seed.php), in its order, with the user name as `username` and `idnumber`;
 * then two the stand-in adds: `sara`, whose idnumber is an employee number, and `lisa`, who has an account and no course;
 * and Moodle's own guest account, user 1, as every Moodle has it.
 * Nothing here says who reports to whom: that is Clew's to say on each call (D117).
 */
const PEOPLE = ['hillevi', 'hassan', 'mikael', 'anna', 'erik', 'maria', 'johan', 'karin'];
/** The seed's five courses with completion by a teacher's word, in its order. */
const SEED_COURSES = [
  ['brandskydd', 'Brandskydd, grundutbildning'],
  ['hlr', 'Hjärt-lungräddning med hjärtstartare'],
  ['informationssakerhet', 'Informationssäkerhet för medarbetare'],
  ['livsmedelshygien', 'Livsmedelshygien'],
  ['lakemedel', 'Läkemedelshantering, delegeringsutbildning'],
];
/** The seed's ages of a completion in days, chosen by position so the same person always gets the same history. */
const AGES = [40, 200, 330, 345, 400, 700, 760, 1100];

/**
 * A made-up learning platform shaped like the seeded development Moodle: the same people, courses, completion pattern
 * and badge, dated from `now`, plus what the seed lacks and the tests need: a person matched only by username, a person
 * with an account and no course, a course without an idnumber, a course that records no completion, and a badge that has
 * run out. `controls` change it the way an operator or a network does.
 */
export function createFixtureLearning({ now = () => Date.now() } = {}) {
  const today = () => Math.floor(now() / 1000);
  const accounts = [];
  let nextUser = 3;
  const account = (username, idnumber) => {
    const a = { id: nextUser++, username, idnumber, suspended: false, deleted: false, withheld: false };
    accounts.push(a);
    return a;
  };
  /** What a lookup answers of an account, as Moodle's user lookup does. */
  const looked = a => ({ id: a.id, username: a.username, idnumber: a.idnumber, suspended: a.suspended });
  for (const username of PEOPLE) account(username, username);
  const sara = account('sara', '1007');
  account('lisa', 'lisa');
  // Moodle's guest account, which it creates first at install: listed with everyone, its badges refused (35).
  const guest = { id: 1, username: 'guest', idnumber: '', suspended: false, deleted: false, withheld: false };
  accounts.push(guest);

  const MANDATORY = 'Obligatoriska utbildningar';
  const courses = SEED_COURSES.map(([short, name], i) => ({
    id: i + 2,
    name,
    idnumber: 'clew-dev:' + short,
    tracked: true,
    category: MANDATORY,
    summary: `${name}, som arbetsgivaren kräver.`,
  }));
  const leadership = {
    id: 7,
    name: 'Arbetsmiljö för chefer',
    idnumber: '',
    tracked: true,
    category: 'Chefer',
    summary: '',
  };
  const welcome = {
    id: 8,
    name: 'Välkommen till lärplattformen',
    idnumber: '',
    tracked: false,
    category: 'Övrigt',
    summary: '',
  };
  courses.push(leadership, welcome);

  /** enrolments: `${userId}:${courseId}` -> completion age in days, or null while not completed. */
  const enrolments = new Map();
  PEOPLE.forEach((_, p) => {
    const user = accounts[p];
    SEED_COURSES.forEach((__, i) => {
      const c = i + 1;
      const slot = p * 3 + i * 5;
      enrolments.set(`${user.id}:${i + 2}`, (p + c) % 3 === 0 ? null : AGES[slot % AGES.length]);
    });
  });
  const byName = name => accounts.find(a => a.username === name);
  enrolments.set(`${byName('hillevi').id}:${leadership.id}`, 120);
  enrolments.set(`${byName('maria').id}:${welcome.id}`, null);
  enrolments.set(`${sara.id}:2`, 15);

  const badgeTypes = [
    { id: 1, name: 'HLR-instruktör', validDays: 365 },
    { id: 2, name: 'Heta arbeten', validDays: 0 },
  ];
  /** issued: `${userId}:${badgeId}` -> { issuedDaysAgo, expiresInDays (null: never) }. */
  const issued = new Map();
  for (const name of ['hillevi', 'anna'])
    issued.set(`${byName(name).id}:1`, { issuedDaysAgo: 100, expiresInDays: 265 });
  // As the seed does: Johan's was given 400 days ago, so its year ran out 35 days back.
  issued.set(`${byName('johan').id}:1`, { issuedDaysAgo: 400, expiresInDays: -35 });
  issued.set(`${byName('erik').id}:2`, { issuedDaysAgo: 400, expiresInDays: -35 });
  issued.set(`${byName('maria').id}:2`, { issuedDaysAgo: 20, expiresInDays: null });

  let down = false;
  let refused = false;
  /** What the platform refuses for one item: `courses:<user>`, `badges:<user>`, `completion:<user>:<course>`. */
  const unreadable = new Set();
  const calls = { accounts: 0, everyone: 0, courses: 0, completion: 0, badges: 0, course: 0 };
  const gate = (method, signal, item) => {
    calls[method]++;
    if (signal?.aborted) throw new SourceUnavailable('The call was stopped.');
    if (down) throw new SourceUnavailable('The learning platform is down.');
    if (refused) throw new SourceRefused('The learning platform refused the token.');
    if (item && unreadable.has(item)) throw new ItemUnreadable('The learning platform refused ' + item + '.');
  };

  return {
    async accounts(field, values, { signal } = {}) {
      gate('accounts', signal);
      if (field !== 'idnumber' && field !== 'username') throw new Error('Unknown field ' + field);
      const wanted = new Set(values);
      // Moodle returns the accounts in its own order (by id), not in the order asked, and never a deleted one.
      return accounts.filter(a => !a.deleted && !a.withheld && a[field] !== '' && wanted.has(a[field])).map(looked);
    },
    // Every account in id order, a window of the list at a time, as the site's participants are listed in Moodle.
    async everyone(from, count, { signal } = {}) {
      gate('everyone', signal);
      return accounts
        .filter(a => !a.deleted)
        .sort((a, b) => a.id - b.id)
        .slice(from, from + count)
        .map(a =>
          a.withheld
            ? { id: a.id, username: '', idnumber: '' }
            : { id: a.id, username: a.username, idnumber: a.idnumber },
        );
    },
    async courses(userId, { signal } = {}) {
      gate('courses', signal, `courses:${userId}`);
      return courses.flatMap(c => {
        const key = `${userId}:${c.id}`;
        if (!enrolments.has(key)) return [];
        return [
          { id: c.id, name: c.name, idnumber: c.idnumber, completed: enrolments.get(key) !== null, tracked: c.tracked },
        ];
      });
    },
    async completion(userId, courseId, { signal } = {}) {
      gate('completion', signal, `completion:${userId}:${courseId}`);
      const age = enrolments.get(`${userId}:${courseId}`);
      const course = courses.find(c => c.id === courseId);
      return typeof age === 'number' && course?.tracked ? today() - age * DAY : null;
    },
    // Every course here is finished by a teacher's word, as in the seed: one criterion of type 7 (role).
    async completionStatus(userId, courseId, { signal } = {}) {
      gate('completion', signal, `completion:${userId}:${courseId}`);
      const key = `${userId}:${courseId}`;
      const course = courses.find(c => c.id === courseId);
      if (!enrolments.has(key) || !course?.tracked) return null;
      const age = enrolments.get(key);
      const at = typeof age === 'number' ? today() - age * DAY : null;
      return { completed: at !== null, at, criteria: [{ type: 7, title: 'Teacher', complete: at !== null, at }] };
    },
    async course(courseId, { signal } = {}) {
      gate('course', signal);
      const course = courses.find(c => c.id === courseId);
      return course
        ? {
            id: course.id,
            name: course.name,
            idnumber: course.idnumber,
            category: course.category,
            summary: course.summary,
          }
        : null;
    },
    async badges(userId, { signal } = {}) {
      gate('badges', signal, `badges:${userId}`);
      if (userId === guest.id)
        throw new ItemUnreadable('The learning platform refused the guest: guestsarenotallowed.');
      return badgeTypes.flatMap(b => {
        const held = issued.get(`${userId}:${b.id}`);
        if (!held) return [];
        return [
          {
            id: b.id,
            name: b.name,
            issuedAt: today() - held.issuedDaysAgo * DAY,
            expiresAt: held.expiresInDays === null ? null : today() + held.expiresInDays * DAY,
          },
        ];
      });
    },
    controls: {
      /** The platform stops answering (or answers again). */
      outage(on = true) {
        down = on;
      },
      /** The platform refuses the connector's token (or accepts it again). */
      refuse(on = true) {
        refused = on;
      },
      /** The platform refuses one person's courses or badges, or one course's completion for them. */
      unreadable(what, username, courseId) {
        const user = byName(username);
        if (!user) throw new Error('No such account');
        unreadable.add(what === 'completion' ? `completion:${user.id}:${courseId}` : `${what}:${user.id}`);
      },
      /** A person finishes a course they are enrolled in, `daysAgo` days ago. */
      complete(username, courseId, daysAgo = 0) {
        const user = byName(username);
        if (!user || !enrolments.has(`${user.id}:${courseId}`)) throw new Error('Not enrolled');
        enrolments.set(`${user.id}:${courseId}`, daysAgo);
      },
      /** Another account with the given username and idnumber. */
      add(username, idnumber) {
        return looked(account(username, idnumber));
      },
      /** An account is suspended: it cannot sign in, and everything it completed stays. */
      suspend(username) {
        const user = byName(username);
        if (!user) throw new Error('No such account');
        user.suspended = true;
      },
      /** An account is deleted, as Moodle deletes one: gone from every list and lookup. */
      remove(username) {
        const user = byName(username);
        if (!user) throw new Error('No such account');
        user.deleted = true;
      },
      /** The service account may not see an account's details: the list gives its id alone. */
      withhold(username) {
        const user = byName(username);
        if (!user) throw new Error('No such account');
        user.withheld = true;
      },
      /** How many times each method was called. */
      calls,
      /** The account behind a username, for tests that need its id. */
      account: byName,
    },
  };
}
