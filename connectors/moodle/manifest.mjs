// Clew reads this contract to find what a learning platform knows about a person: the courses they have completed and
// the badges they hold. Three reads a person makes and one Clew makes as the installation; no writes, no scan.
// `moodle.person` is about a person (D97) and draws a section on the opened person; `moodle.courses` is the fuller read
// that section opens, and a course's row in it opens `moodle.course`. `moodle.holdings` is not a capability: it is the
// installation's read of the holdings profile (D108 item 9, D119), every account and what it holds a page at a time, for
// Clew's competence register to copy, answered to no person. connector.mjs holds the handlers, moodle.mjs the only code
// that knows Moodle's API, learning.mjs the port and the in-memory stand-in.

export const CONNECTOR = 'moodle';
/** The system's name as a person reads it, captioning the section. An installation may call its platform otherwise. */
export const DEFAULT_SOURCE = 'Lärplattformen';
/** The most keys one call takes. Clew splits a longer list into calls of this size, four at once (D97 item 7). */
export const PERSON_KEYS_MAX = 50;
/**
 * The most accounts one page of the installation's holdings read answers (D119). An account costs two Moodle calls and
 * one per completed course, and a page also stops taking accounts halfway to its deadline, so a slower Moodle answers
 * shorter pages rather than none.
 */
export const HOLDINGS_PAGE = 25;
/** The most holdings one row carries; an account with more is answered with these and marked partial. */
export const HOLDINGS_PER_ROW = 500;
/** The cursor of the next page: the id of the last account answered and its place in Moodle's list, `<id>:<place>`. */
export const cursorPattern = '^[0-9]{1,10}:[0-9]{1,9}$';

/** What a course or a badge is to the person, in their words. Only a badge that has run out carries a tone. */
export const STATUS = { completed: 'Genomförd', ongoing: 'Pågår', valid: 'Giltigt', expired: 'Utgånget' };
export const KIND = { course: 'Kurs', badge: 'Märke' };

const calendarDay = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', maxLength: 10 };
const userName = { type: 'string', minLength: 1, maxLength: 512 };
const text = (maxLength = 400) => ({ type: 'string', minLength: 1, maxLength });
const count = { type: 'integer', minimum: 0 };
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const keysInput = max => object({ keys: { type: 'array', items: userName, maxItems: max } });
/** Who a read answers about (D117): the reader, and a manager's direct reports under D99. Never a colleague. */
const ADMITS = ['self', 'managed'];
/** A Moodle course id, as digits: it travels in a page's address when a row is opened. */
export const courseIdPattern = '^[1-9][0-9]{0,9}$';
const courseId = { type: 'string', pattern: courseIdPattern, maxLength: 10 };
const link = { type: 'string', pattern: '^https?://', maxLength: 2000 };
/** How long a course summary may be, and how many completion criteria a course read lists. */
export const SUMMARY_MAX = 600;
export const CRITERIA_MAX = 12;
const everyone = {};
const courses = { one: 'kurs', other: 'kurser' };

/**
 * One holding as D108 item 9 names it: the source's own row id and type id, the type's label as the source names it,
 * the day it was issued and, when the source keeps one, the day it ends. Nothing else about the person.
 */
export const Holding = object(
  {
    id: { type: 'string', pattern: '^(course|badge):[1-9][0-9]*:user:[1-9][0-9]*$', maxLength: 80 },
    type: text(200),
    label: text(),
    kind: { type: 'string', enum: ['course', 'badge'] },
    issuedOn: calendarDay,
    expiresOn: calendarDay,
  },
  ['id', 'type', 'label', 'kind', 'issuedOn'],
);
/** The installation's read takes the cursor of the page it wants, none for the first (D119). No key, no person. */
export const HoldingsInput = object({ cursor: { type: 'string', pattern: cursorPattern, maxLength: 21 } }, []);
/**
 * The holdings profile's answer, one page of the site's accounts in Moodle's id order (D119): one row per account,
 * carrying its key (the value of the match field, what Clew compares with a person's user name) and every holding of
 * that account the platform can see, none when it sees none; `next` for the following page, absent on the last. An
 * account with no row is one this page did not answer for, never one that holds nothing.
 *
 * `withdrawalsReported: false`, always: Moodle leaves things out without saying so (an ended enrolment, a course the
 * service account cannot enter, a badge its holder does not show publicly, course badges switched off), so a holding
 * missing from a later answer is never a revocation. `partial` on a row says that something of that person was refused
 * or could not be dated and was left out of this answer; its absence does not make the row complete.
 */
export const HoldingsOutput = object(
  {
    withdrawalsReported: {
      const: false,
      description:
        'Whether a holding missing from a later answer means it was withdrawn. Always false here: the source leaves things out without saying so, so absence is never a revocation.',
    },
    rows: {
      type: 'array',
      maxItems: HOLDINGS_PAGE,
      items: object(
        {
          key: userName,
          holdings: { type: 'array', items: Holding, maxItems: HOLDINGS_PER_ROW },
          partial: {
            const: true,
            description: 'Something of this person was refused or could not be dated, and is left out of this answer.',
          },
        },
        ['key', 'holdings'],
      ),
    },
    next: {
      type: 'string',
      pattern: cursorPattern,
      maxLength: 21,
      description: 'The cursor of the following page; absent on the last.',
    },
  },
  ['withdrawalsReported', 'rows'],
);

function capabilities(source) {
  // About a person (D97): a section on the opened person, a lens and a column an administrator may choose. One row per
  // key the platform knows; a person with an account and no course has a row of zeros, a person without one has none.
  const person = {
    name: `${CONNECTOR}.person`,
    kind: 'read',
    title: 'Utbildningar',
    description: `Hur många kurser medarbetaren har genomfört i ${source} och hur många som pågår.`,
    model: false,
    scope: everyone,
    about: { entity: 'person' },
    // Clew asks about the reader and the reader's direct reports only (D117), and says which each key is.
    person: { admits: ADMITS },
    input: keysInput(PERSON_KEYS_MAX),
    output: object({
      rows: {
        type: 'array',
        maxItems: PERSON_KEYS_MAX,
        items: object({ key: userName, completed: count, ongoing: count }),
      },
    }),
    view: {
      kind: 'list',
      title: 'completed',
      empty: `${source} har inga uppgifter om dem.`,
      fields: [
        { key: 'completed', label: 'Genomförda', format: 'number', unit: courses },
        { key: 'ongoing', label: 'Pågår', format: 'number', unit: courses },
      ],
      open: { capability: `${CONNECTOR}.courses`, title: 'Kurser och märken', params: { person: 'key' } },
    },
  };

  // One person's courses and badges, the section's fuller read. Names of courses and badges only; nothing a person wrote.
  // A course's row carries the person's key as asked and the course's id, which open it in moodle.course, and, where an
  // installation gives Moodle's public address, a link to the course there. A badge's row opens nothing.
  const personCourses = {
    name: `${CONNECTOR}.courses`,
    kind: 'read',
    title: 'Kurser och märken',
    description: `En medarbetares kurser i ${source}, genomförda med datum och pågående, och märken med när de går ut.`,
    model: false,
    scope: everyone,
    person: { param: 'person', admits: ADMITS },
    input: object({ person: userName }),
    output: object({
      rows: {
        type: 'array',
        maxItems: 500,
        items: object(
          {
            name: text(),
            kind: { type: 'string', enum: Object.values(KIND) },
            status: { type: 'string', enum: Object.values(STATUS) },
            date: calendarDay,
            expiresOn: calendarDay,
            person: userName,
            course: courseId,
            link,
          },
          ['name', 'kind', 'status'],
        ),
      },
    }),
    view: {
      kind: 'list',
      title: 'name',
      empty: `Inga kurser eller märken i ${source}.`,
      fields: [
        { key: 'name', label: 'Utbildning' },
        { key: 'kind', label: 'Typ' },
        { key: 'status', label: 'Status', format: 'status', tones: { [STATUS.expired]: 'warn' } },
        { key: 'date', label: 'Datum', format: 'date' },
        { key: 'expiresOn', label: 'Gäller till', format: 'date' },
        { key: 'link', label: `Öppna i ${source}`, format: 'link' },
      ],
      open: { capability: `${CONNECTOR}.course`, title: 'Kurs', params: { person: 'person', course: 'course' } },
    },
  };

  // One person's one course, opened from a row of moodle.courses: what Moodle holds about the course and how far the
  // person has come. The summary is a teacher's text, so the read is never a tool.
  const personCourse = {
    name: `${CONNECTOR}.course`,
    kind: 'read',
    title: 'Kurs',
    description: `En medarbetares kurs i ${source}: kategori, beskrivning, status, när den genomfördes och villkoren för att bli klar.`,
    model: false,
    scope: everyone,
    person: { param: 'person', admits: ADMITS },
    input: object({ person: userName, course: courseId }),
    output: object(
      {
        name: text(),
        category: text(200),
        status: { type: 'string', enum: [STATUS.ongoing, STATUS.completed] },
        completedOn: calendarDay,
        criteria: { type: 'array', items: text(300), maxItems: CRITERIA_MAX },
        summary: text(SUMMARY_MAX),
        link,
      },
      ['name', 'status'],
    ),
    view: {
      kind: 'detail',
      title: 'name',
      fields: [
        { key: 'category', label: 'Kategori' },
        { key: 'status', label: 'Status', format: 'status' },
        { key: 'completedOn', label: 'Genomförd', format: 'date' },
        { key: 'criteria', label: 'Villkor' },
        { key: 'summary', label: 'Om kursen' },
        { key: 'link', label: `Öppna i ${source}`, format: 'link' },
      ],
    },
  };

  return [person, personCourses, personCourse];
}

/**
 * The installation's read of the holdings profile (D108 item 9, D119), for the competence register's copy: not a
 * capability, so no person reaches it, no section shows it and the model never sees it. Clew posts it to
 * /clew/installation/moodle.holdings with its own assertion, and the connector answers nobody else.
 */
function installationReads(source) {
  return [
    {
      name: `${CONNECTOR}.holdings`,
      title: 'Genomförda kurser och märken',
      description: `Alla konton i ${source} med genomförda kurser och märken, dag för utfärdande och slutdag, för kompetensregistret.`,
      input: HoldingsInput,
      output: HoldingsOutput,
    },
  ];
}

/** `source` is the system's name as a person reads it. */
export function createManifest({ source = DEFAULT_SOURCE } = {}) {
  return {
    protocol: 3,
    id: CONNECTOR,
    kind: 'passthrough',
    source,
    areas: [],
    uses: [],
    capabilities: capabilities(source),
    installation: installationReads(source),
    scan: false,
  };
}

export const manifest = createManifest();
