// Clew reads this contract to find what a learning platform knows about a person: the courses they have completed and
// the badges they hold. Four reads, no writes, no scan. `moodle.person` is about a person (D97) and draws a section on
// the opened person; `moodle.courses` is the fuller read that section opens, and a course's row in it opens
// `moodle.course`; `moodle.holdings` answers the reserved profile of D108 item 9, the rows Clew's competence register is
// to copy. connector.mjs holds the handlers, moodle.mjs the only code that knows Moodle's API, learning.mjs the port and
// the in-memory stand-in.

export const CONNECTOR = 'moodle';
/** The system's name as a person reads it, captioning the section. An installation may call its platform otherwise. */
export const DEFAULT_SOURCE = 'Lärplattformen';
/**
 * The most keys one call takes. Clew splits a longer list into calls of this size, four at once (D97 item 7). A person
 * row costs one Moodle call after the lookup, a holdings row two plus one per completed course, hence the smaller batch.
 */
export const PERSON_KEYS_MAX = 50;
export const HOLDINGS_KEYS_MAX = 25;

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
/**
 * The holdings profile's answer: one row per key the platform has an account for, carrying the key as it was asked and
 * every holding of that person it can see, none when it sees none. A key with no row is a person the platform does not
 * know, or one the caller may not ask about (D97 item 7): Clew must not read it as "holds nothing".
 *
 * `withdrawalsReported: false`, always: Moodle leaves things out without saying so (an ended enrolment, a course the
 * service account cannot enter, a badge its holder does not show publicly, course badges switched off), so a holding
 * missing from a later answer is never a revocation. `partial` on a row says that something of that person was refused
 * or could not be dated and was left out of this answer; its absence does not make the row complete.
 */
export const HoldingsOutput = object({
  withdrawalsReported: {
    const: false,
    description:
      'Whether a holding missing from a later answer means it was withdrawn. Always false here: the source leaves things out without saying so, so absence is never a revocation.',
  },
  rows: {
    type: 'array',
    maxItems: HOLDINGS_KEYS_MAX,
    items: object(
      {
        key: userName,
        holdings: { type: 'array', items: Holding, maxItems: 500 },
        partial: {
          const: true,
          description: 'Something of this person was refused or could not be dated, and is left out of this answer.',
        },
      },
      ['key', 'holdings'],
    ),
  },
});

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

  // The reserved profile of D108 item 9, for the competence register's copy. Not a section and never a tool. Its `keys`
  // list names people, but protocol 3 can declare a list of people only on a read about a person (D117): a read that is
  // not one names a single person in `person.param`. So Clew resolves nobody here and sends no `about`, and the
  // connector, which answers only keys Clew vouched for, answers no row. Kept, fail-closed, for the profile's shape.
  const holdings = {
    name: `${CONNECTOR}.holdings`,
    kind: 'read',
    title: 'Genomförda kurser och märken',
    description: `Genomförda kurser och märken per person i ${source}, med dag för utfärdande och slutdag, för kompetensregistret.`,
    model: false,
    scope: everyone,
    input: keysInput(HOLDINGS_KEYS_MAX),
    output: HoldingsOutput,
  };

  return [person, personCourses, personCourse, holdings];
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
    scan: false,
  };
}

export const manifest = createManifest();
