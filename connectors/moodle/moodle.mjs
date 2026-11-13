// Moodle LMS's REST web service API behind the learning-platform port (learning.mjs): the only code here that knows it.
// Every call is a POST to /webservice/rest/server.php with the service account's token in the form body (never in the
// address, so it stays out of access logs), and nothing from the incoming request. Moodle answers an error as HTTP 200
// with `exception` and `errorcode` in the body. What each answer means is recorded in samples/README.md; the comments
// below cite those samples by number.
import { ItemUnreadable, SourceRefused, SourceUnavailable } from './learning.mjs';

const ENDPOINT = '/webservice/rest/server.php';
/** How many values one core_user_get_users_by_field call asks for. */
const LOOKUP_BATCH = 50;
/**
 * Moodle's front page course (`SITEID`), which Moodle installs as course 1. Every account is "enrolled" on it, so its
 * participants are the site's accounts: the list the installation's read of every holding walks (D119).
 */
export const SITE_COURSE = 1;
/** The user fields asked for when the site's accounts are listed: what finds a person, nothing more. */
const LISTED_FIELDS = 'id,username,idnumber';
/**
 * The error codes that mean the connector's own token or account is refused, whatever is asked: an unknown or expired
 * token (14), a function the service does not list or an account the service does not admit (15), the service account
 * suspended, deleted, unconfirmed or not set up.
 */
const REFUSED = new Set([
  'invalidtoken',
  'invalidtimedtoken',
  'accessexception',
  'servicerequireslogin',
  'usernotfullysetup',
  'forcepasswordchangenotice',
  'wsaccessusersuspended',
  'wsaccessusernologin',
  'wsaccessuserdeleted',
  'wsaccessuserunconfirmed',
  'wsaccessuserexpired',
]);
/**
 * The error codes Moodle gives for one person or one course while the rest can be read: a right withheld in one
 * course's or one user's context, a course the account cannot enter, a person deleted or not confirmed
 * (`core_user::require_active_user`), the completion report closed for them, and the guest account, whose badges Moodle
 * will not read (35): the site's list of accounts, which the installation's read walks, has the guest in it.
 */
const ITEM = new Set([
  'guestsarenotallowed',
  'nopermissions',
  'requireloginerror',
  'restrictedcontextexception',
  'cannotviewreport',
  'accessdenied',
  'usernotconfirmed',
  'userdeleted',
  'invaliduser',
  'suspended',
]);
/** Moodle's username as `clean_param(PARAM_USERNAME)` leaves it without extended characters: anything else is refused. */
const PLAIN_USERNAME = /^[-.@_a-z0-9]+$/;

/** An error Moodle reported in a 200 body, by its code. Internal: each method decides what a code means for it. */
class MoodleException extends Error {
  constructor(code) {
    super('Moodle answered ' + code + '.');
    this.code = code;
  }
}

/** The error in a Moodle answer, if it is one: `{ exception, errorcode }` (samples 04, 09, 10, 13 to 16). */
export function moodleError(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  if (typeof body.exception !== 'string' && typeof body.errorcode !== 'string') return undefined;
  return { exception: String(body.exception ?? ''), errorcode: String(body.errorcode ?? 'unknown') };
}

const positive = value => (Number.isSafeInteger(value) && value > 0 ? value : undefined);
const text = value => (typeof value === 'string' ? value.trim() : '');
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/**
 * Text Moodle escaped for HTML, as text again: `&#38;`, `&#x26;` and the few named entities. A badge's name comes back
 * escaped whatever `moodlewssettingraw` says (22, 23): Moodle's exporter runs `clean_string` on it. Clew draws text.
 */
export function unescapeText(value) {
  return text(value)
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]{1,7});/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => NAMED[name]);
}
/**
 * A course summary as plain text: the HTML a teacher wrote, a block's end a line break, a cell's a space, every other
 * tag out (so "<em>iordningställa</em>," stays one word and its comma), its entities read, its spaces folded.
 */
export function plainText(html) {
  return unescapeText(
    text(html)
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|blockquote|pre)>/gi, '\n')
      .replace(/<\/(td|th)>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** The accounts in a core_user_get_users_by_field answer (01, 03): id, username, idnumber, suspended. */
export function parseAccounts(body) {
  if (!Array.isArray(body)) throw new SourceUnavailable('Moodle answered the user lookup without a list.');
  return body.flatMap(raw => {
    const id = positive(raw?.id);
    if (!id || typeof raw.username !== 'string') return [];
    return [
      {
        id,
        username: raw.username,
        idnumber: text(raw.idnumber),
        suspended: raw.suspended === true,
      },
    ];
  });
}

/**
 * The accounts in a core_enrol_get_enrolled_users answer for the front page (30 to 32): id, username and idnumber, in
 * the order asked (by id). An account whose details the service account may not see comes with its id and full name
 * only; it is kept with an empty username so the list's positions stay as Moodle counts them. The full name is not read.
 */
export function parseListedAccounts(body) {
  if (!Array.isArray(body)) throw new SourceUnavailable("Moodle answered the site's accounts without a list.");
  return body.flatMap(raw => {
    const id = positive(raw?.id);
    if (!id) return [];
    return [{ id, username: typeof raw.username === 'string' ? raw.username : '', idnumber: text(raw.idnumber) }];
  });
}

/** The courses in a core_enrol_get_users_courses answer (05, 06): completed or not, and whether completion is tracked. */
export function parseCourses(body) {
  if (!Array.isArray(body)) throw new SourceUnavailable('Moodle answered the courses without a list.');
  return body.flatMap(raw => {
    const id = positive(raw?.id);
    const name = text(raw?.displayname) || text(raw?.fullname);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        idnumber: text(raw.idnumber),
        completed: raw.completed === true,
        // Absent on an older Moodle: then the completion status is asked, and a refusal reads as no date.
        tracked: raw.enablecompletion !== false && raw.completionhascriteria !== false,
      },
    ];
  });
}

/**
 * When a course was completed, from a core_completion_get_course_completion_status answer (07, 08), in Unix seconds:
 * Moodle gives a time per criterion, not for the course. Its completion cron stamps the course with the latest time of
 * the criteria met, whatever the aggregation (`max` in lib/completionlib.php, then `mark_complete`), so the same is
 * taken here. Null when it is not completed or no criterion has a time.
 */
export function parseCompletion(body) {
  const status = parseCompletionStatus(body);
  return status.completed ? status.at : null;
}

/**
 * The whole completion status (07, 08): whether the course is completed, when (as parseCompletion), and each criterion
 * with its type (Moodle's COMPLETION_CRITERIA_TYPE_*), its title (an activity's or a role's name), whether it is met and
 * when.
 */
export function parseCompletionStatus(body) {
  const status = body?.completionstatus;
  if (!status || typeof status !== 'object')
    throw new SourceUnavailable('Moodle answered without a completion status.');
  const criteria = (Array.isArray(status.completions) ? status.completions : []).flatMap(c =>
    c && typeof c === 'object'
      ? [
          {
            type: positive(c.type) ?? 0,
            title: unescapeText(c.title),
            complete: c.complete === true,
            at: c.complete === true ? (positive(c.timecompleted) ?? null) : null,
          },
        ]
      : [],
  );
  const times = criteria.map(c => c.at).filter(Boolean);
  const completed = status.completed === true;
  return { completed, at: completed && times.length ? Math.max(...times) : null, criteria };
}

/** One course from a core_course_get_courses_by_field answer by id (26): its name, category and summary as text. */
export function parseCourse(body, courseId) {
  if (!Array.isArray(body?.courses)) throw new SourceUnavailable('Moodle answered the course without a list.');
  const raw = body.courses.find(c => c?.id === courseId);
  if (!raw) return null;
  return {
    id: courseId,
    name: text(raw.displayname) || text(raw.fullname),
    idnumber: text(raw.idnumber),
    category: text(raw.categoryname),
    summary: plainText(raw.summary),
  };
}

/** The badges in a core_badges_get_user_badges answer (11, 12): id, name, issued and, when it has one, its end. */
export function parseBadges(body) {
  if (!Array.isArray(body?.badges)) throw new SourceUnavailable('Moodle answered the badges without a list.');
  return body.badges.flatMap(raw => {
    const id = positive(raw?.id);
    const name = unescapeText(raw?.name);
    const issuedAt = positive(raw?.dateissued);
    if (!id || !name || !issuedAt) return [];
    return [{ id, name, issuedAt, expiresAt: positive(raw.dateexpire) ?? null }];
  });
}

/**
 * Moodle's form encoding of a call: arrays as `name[0]`, `name[1]` (01), an array of objects as `name[0][key]` (30).
 * `moodlewssettingraw` asks for text as it is stored: without it Moodle escapes a course's or a badge's name for HTML
 * ("&amp;"), and Clew draws text, not HTML.
 */
export function formOf(token, wsfunction, params = {}) {
  const body = new URLSearchParams({
    wstoken: token,
    moodlewsrestformat: 'json',
    moodlewssettingraw: 'true',
    wsfunction,
  });
  for (const [name, value] of Object.entries(params)) {
    if (Array.isArray(value))
      value.forEach((v, i) => {
        if (v && typeof v === 'object')
          for (const [key, inner] of Object.entries(v)) body.append(`${name}[${i}][${key}]`, String(inner));
        else body.append(`${name}[${i}]`, String(v));
      });
    else body.append(name, String(value));
  }
  return body;
}

/**
 * url: Moodle's base address. Plain http only towards this host itself, or with `allowHttp` for a development stack on
 * a private network: the token travels in every request. token: the service account's web service token. `fetch` is
 * injectable for tests; `timeoutMs` is per call, and the caller's `signal` (the read's deadline, Clew going away)
 * stops a call before it.
 */
export function createMoodleLearning({
  url,
  token,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = 3000,
  allowHttp = false,
  userAgent = 'Clew',
} = {}) {
  if (!url) throw new Error('MOODLE_URL is required: the base address of the Moodle site.');
  if (!token || !/^[A-Za-z0-9]{16,128}$/.test(token))
    throw new Error("MOODLE_TOKEN is required: the service account's web service token.");
  const base = new URL(url);
  if (
    base.protocol !== 'https:' &&
    !(base.protocol === 'http:' && (allowHttp || ['localhost', '127.0.0.1'].includes(base.hostname)))
  )
    throw new Error('MOODLE_URL must be https outside local development (MOODLE_ALLOW_HTTP=true allows http).');
  const root = base.toString().replace(/\/+$/, '');

  async function call(wsfunction, params, signal) {
    if (signal?.aborted) throw new SourceUnavailable('The read was stopped before Moodle was asked.');
    let response;
    try {
      response = await fetchImpl(root + ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'user-agent': userAgent,
        },
        body: formOf(token, wsfunction, params).toString(),
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new SourceUnavailable('Moodle did not answer.');
    }
    if (response.status !== 200) throw new SourceUnavailable('Moodle answered ' + response.status + '.');
    let body;
    try {
      body = await response.json();
    } catch {
      throw new SourceUnavailable('Moodle answered with something that is not JSON.');
    }
    const error = moodleError(body);
    if (error) {
      if (REFUSED.has(error.errorcode)) throw new SourceRefused('Moodle refused the call: ' + error.errorcode + '.');
      throw new MoodleException(error.errorcode);
    }
    return body;
  }
  /** Any Moodle error a method does not expect is the platform not answering usefully. */
  const unexpected = error => (error instanceof MoodleException ? new SourceUnavailable(error.message) : error);
  /** An error that concerns this one person or course: the item is left out, not the read. */
  const itemOf = error =>
    error instanceof MoodleException && ITEM.has(error.code) ? new ItemUnreadable(error.message) : unexpected(error);

  const lookup = async (field, values, signal) =>
    parseAccounts(await call('core_user_get_users_by_field', { field, values }, signal));

  const api = {
    /**
     * The accounts whose idnumber or username equals one of the values (01 to 03). Moodle compares exactly. A username is
     * always lower case in Moodle and a value it would change is refused for the whole batch (04), so a username value is
     * sent in lower case; one Moodle refuses anyway (an installation with extended username characters off and a key
     * with such a character) makes the batch be asked again with the plain ones only. A refusal of the right to read
     * people is the service's, not one person's: every read needs it.
     */
    async accounts(field, values, { signal } = {}) {
      if (field !== 'idnumber' && field !== 'username') throw new Error('Unknown match field ' + field);
      const wanted = [
        ...new Set(
          values
            .filter(v => typeof v === 'string' && v.trim() !== '')
            .map(v => (field === 'username' ? v.trim().toLowerCase() : v)),
        ),
      ];
      const refusedPeople = error =>
        error instanceof MoodleException && ITEM.has(error.code)
          ? new SourceRefused('Moodle refused the service account people: ' + error.code + '.')
          : unexpected(error);
      const found = [];
      for (let i = 0; i < wanted.length; i += LOOKUP_BATCH) {
        const batch = wanted.slice(i, i + LOOKUP_BATCH);
        try {
          found.push(...(await lookup(field, batch, signal)));
        } catch (error) {
          const plain = batch.filter(v => PLAIN_USERNAME.test(v));
          const refusedValue =
            field === 'username' &&
            error instanceof MoodleException &&
            error.code === 'invalidparameter' &&
            plain.length < batch.length;
          if (!refusedValue) throw refusedPeople(error);
          try {
            if (plain.length) found.push(...(await lookup(field, plain, signal)));
          } catch (again) {
            throw refusedPeople(again);
          }
        }
      }
      return found;
    },

    /**
     * The site's accounts in id order, `count` from position `from` (30 to 32): the front page's participants, which
     * are every account Moodle has not deleted, suspended ones included. One call per window, with the user fields that
     * find a person and nothing else. It needs `moodle/site:viewparticipants`; a refusal is the service's, not one
     * person's, since the read of every holding cannot go on without it.
     */
    async everyone(from, count, { signal } = {}) {
      try {
        return parseListedAccounts(
          await call(
            'core_enrol_get_enrolled_users',
            {
              courseid: SITE_COURSE,
              options: [
                { name: 'userfields', value: LISTED_FIELDS },
                { name: 'sortby', value: 'id' },
                { name: 'limitfrom', value: from },
                { name: 'limitnumber', value: count },
              ],
            },
            signal,
          ),
        );
      } catch (error) {
        throw error instanceof MoodleException && ITEM.has(error.code)
          ? new SourceRefused("Moodle refused the service account the site's accounts: " + error.code + '.')
          : unexpected(error);
      }
    },

    /**
     * The courses the account is enrolled in, with whether each is completed (05, 06). Moodle answers active enrolments
     * only and leaves out, without a word, a course the service account cannot enter. The participant count, which this
     * read never shows, is not asked for (`returnusercount`): Moodle would count each course's people for it.
     */
    async courses(userId, { signal } = {}) {
      try {
        return parseCourses(await call('core_enrol_get_users_courses', { userid: userId, returnusercount: 0 }, signal));
      } catch (error) {
        throw itemOf(error);
      }
    },

    /**
     * When the account completed the course; null when not, when not enrolled (09), no longer there (10) or the course
     * has no criteria. A course or person Moodle withholds is ItemUnreadable.
     */
    async completion(userId, courseId, options = {}) {
      const status = await api.completionStatus(userId, courseId, options);
      return status?.completed ? status.at : null;
    },

    /** The whole completion status, criteria and all; null where completion() answers null for the same reasons. */
    async completionStatus(userId, courseId, { signal } = {}) {
      try {
        return parseCompletionStatus(
          await call('core_completion_get_course_completion_status', { courseid: courseId, userid: userId }, signal),
        );
      } catch (error) {
        if (
          error instanceof MoodleException &&
          ['usernotenroled', 'invalidrecordunknown', 'invalidrecord', 'nocriteriaset'].includes(error.code)
        )
          return null;
        throw itemOf(error);
      }
    },

    /** One course by id (26): name, category and summary as plain text; null when there is none the account may see. */
    async course(courseId, { signal } = {}) {
      try {
        return parseCourse(
          await call('core_course_get_courses_by_field', { field: 'id', value: courseId }, signal),
          courseId,
        );
      } catch (error) {
        if (error instanceof MoodleException && ['invalidrecord', 'invalidrecordunknown'].includes(error.code))
          return null;
        throw itemOf(error);
      }
    },

    /**
     * The badges the account holds (11, 12, 21): only those its holder shows publicly, since Moodle answers anyone but
     * the holder that way. None for an account that is gone (13), and none when the site has badges switched off.
     */
    async badges(userId, { signal } = {}) {
      try {
        return parseBadges(await call('core_badges_get_user_badges', { userid: userId }, signal));
      } catch (error) {
        if (
          error instanceof MoodleException &&
          ['invalidrecordunknown', 'invalidrecord', 'badgesdisabled'].includes(error.code)
        )
          return [];
        throw itemOf(error);
      }
    },
  };
  return api;
}
