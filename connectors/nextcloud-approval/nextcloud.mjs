// Nextcloud's Approval app behind the approval port (D101): the only code here that knows OCS and WebDAV. Every call
// carries the person's own token as the bearer and nothing else, no service credential and no header from the incoming
// request. What each answer means is recorded in samples/README.md; the comments below cite those samples by number.
import { SourceDenied, SourceLost, SourceUnavailable } from './approvals.mjs';

const OCS = '/ocs/v2.php';
const APPROVAL = OCS + '/apps/approval/api/v1';
/** How many file ids one WebDAV SEARCH asks for at once. */
const SEARCH_BATCH = 50;

const xmlEscape = value =>
  String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const xmlText = value =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
/** One property's text in a WebDAV response, whatever prefix the server gave its namespace. */
const prop = (xml, name) => {
  const match = new RegExp(
    `<(?:[A-Za-z][\\w.-]*:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z][\\w.-]*:)?${name}>`,
  ).exec(xml);
  return match ? xmlText(match[1].trim()) : undefined;
};
const text = value => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const seconds = value => (Number.isInteger(value) && value > 0 ? value : undefined);
const fileId = value => {
  const n = typeof value === 'string' && /^[0-9]{1,19}$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
};

/** Who did the last thing on a file, and when, as Approval reports it; undefined when it reports nothing usable. */
function activityOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const userId = text(raw.userId);
  const at = seconds(raw.timestamp);
  if (!userId || !at) return null;
  return {
    userId,
    userName: text(raw.userName) ?? userId,
    at,
    message: typeof raw.message === 'string' ? raw.message : '',
  };
}

/** The WebDAV SEARCH by file id that returns the etag approve and reject require (samples 09, 16). */
export function searchBody(userId, ids) {
  const one = id => `<d:eq><d:prop><oc:fileid/></d:prop><d:literal>${id}</d:literal></d:eq>`;
  const where = ids.length === 1 ? one(ids[0]) : `<d:or>${ids.map(one).join('')}</d:or>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<d:searchrequest xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:basicsearch>
    <d:select><d:prop><d:getetag/><oc:fileid/><d:displayname/><d:getcontenttype/><nc:approval-state/></d:prop></d:select>
    <d:from><d:scope><d:href>/files/${xmlEscape(encodeURIComponent(userId))}</d:href><d:depth>infinity</d:depth></d:scope></d:from>
    <d:where>${where}</d:where>
    <d:orderby/>
  </d:basicsearch>
</d:searchrequest>`;
}

/** The files in a SEARCH answer: id, etag without its quotes, and name. Anything without an id or an etag is skipped. */
export function parseSearch(xml) {
  const found = [];
  for (const [, response] of String(xml).matchAll(
    /<(?:[A-Za-z][\w.-]*:)?response>([\s\S]*?)<\/(?:[A-Za-z][\w.-]*:)?response>/g,
  )) {
    // Only the properties the server found: a propstat whose status is 200.
    const ok = [...response.matchAll(/<(?:[A-Za-z][\w.-]*:)?propstat>([\s\S]*?)<\/(?:[A-Za-z][\w.-]*:)?propstat>/g)]
      .map(m => m[1])
      .filter(propstat => / 200 /.test(prop(propstat, 'status') ?? ''))
      .join('');
    const id = fileId(prop(ok, 'fileid'));
    const etag = prop(ok, 'getetag')?.replace(/^"(.*)"$/, '$1');
    if (!id || !etag) continue;
    found.push({ fileId: id, etag, name: prop(ok, 'displayname') ?? '' });
  }
  return found;
}

/**
 * url: Nextcloud's base address. Plain http only towards this host itself, or with `allowHttp` for a development stack
 * on a private network: the person's token travels in every request. `fetch` is injectable for tests; `timeoutMs` keeps
 * three calls inside the ten seconds Clew waits for a connector.
 */
export function createNextcloudApproval({
  url,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = 2500,
  allowHttp = false,
  userAgent = 'Clew',
} = {}) {
  if (!url) throw new Error('NEXTCLOUD_URL is required: the base address of the Nextcloud instance.');
  const base = new URL(url);
  if (
    base.protocol !== 'https:' &&
    !(base.protocol === 'http:' && (allowHttp || ['localhost', '127.0.0.1'].includes(base.hostname)))
  )
    throw new Error('NEXTCLOUD_URL must be https outside local development (NEXTCLOUD_ALLOW_HTTP=true allows http).');
  const root = base.toString().replace(/\/+$/, '');

  // Each accepted call opens a short Nextcloud session named after the user agent, which the person sees among their
  // devices and sessions; the name says who called.
  const headers = (token, extra = {}) => ({
    authorization: 'Bearer ' + token,
    'user-agent': userAgent,
    ...extra,
  });
  const ocsHeaders = token => headers(token, { 'ocs-apirequest': 'true', accept: 'application/json' });

  async function call(path, init, Failure) {
    try {
      return await fetchImpl(root + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new Failure('Nextcloud did not answer.');
    }
  }
  /** An OCS read: the `data` of a 200, the token's refusal on a 401, unavailable on anything else. */
  async function ocsRead(token, path) {
    const response = await call(path, { method: 'GET', headers: ocsHeaders(token) }, SourceUnavailable);
    if (response.status === 401) throw new SourceDenied('Nextcloud refused the token.');
    if (response.status !== 200) throw new SourceUnavailable('Nextcloud answered ' + response.status + '.');
    let body;
    try {
      body = await response.json();
    } catch {
      throw new SourceUnavailable('Nextcloud answered with something that is not JSON.');
    }
    if (!body?.ocs || !('data' in body.ocs)) throw new SourceUnavailable('Nextcloud answered without OCS data.');
    return body.ocs.data;
  }

  return {
    /** The account the token resolves to (sample 01). */
    async whoami(token) {
      const data = await ocsRead(token, OCS + '/cloud/user');
      const id = text(data?.id);
      if (!id) throw new SourceUnavailable('Nextcloud answered without an account id.');
      return { id, name: text(data.displayname) ?? text(data['display-name']) ?? id };
    },

    /** What waits for the person, computed by Nextcloud on every call, complete, newest request first (02 to 04). */
    async pending(token) {
      const data = await ocsRead(token, APPROVAL + '/pendings');
      if (!Array.isArray(data)) throw new SourceUnavailable('Nextcloud answered pendings without a list.');
      return data.flatMap(raw => {
        const id = fileId(raw?.file_id);
        const name = text(raw?.file_name);
        if (!id || !name) return [];
        return [{ fileId: id, name, mimetype: text(raw.mimetype) ?? '', request: activityOf(raw.activity) }];
      });
    },

    /** One file's state for the person; 0 also for no access and for no such file (06 to 08, 12, 22). */
    async state(token, id) {
      const data = await ocsRead(token, `${APPROVAL}/state/${encodeURIComponent(id)}`);
      const state = data?.state;
      if (![0, 1, 2, 3, 4].includes(state)) throw new SourceUnavailable('Nextcloud answered an unknown state.');
      const activity = state === 0 ? null : activityOf(data);
      return { state, ...(activity ?? {}) };
    },

    /** The current etag and name of each file the person reaches in their own files, by WebDAV SEARCH (09, 16). */
    async versions(token, userId, ids) {
      const found = [];
      for (let i = 0; i < ids.length; i += SEARCH_BATCH) {
        const batch = ids.slice(i, i + SEARCH_BATCH);
        const response = await call(
          '/remote.php/dav/',
          {
            method: 'SEARCH',
            headers: headers(token, { 'content-type': 'text/xml; charset=utf-8' }),
            body: searchBody(userId, batch),
          },
          SourceUnavailable,
        );
        if (response.status === 401) throw new SourceDenied('Nextcloud refused the token.');
        if (response.status !== 207)
          throw new SourceUnavailable('Nextcloud answered SEARCH with ' + response.status + '.');
        let xml;
        try {
          xml = await response.text();
        } catch {
          throw new SourceUnavailable('The SEARCH answer could not be read.');
        }
        found.push(...parseSearch(xml).filter(f => batch.includes(f.fileId)));
      }
      return found;
    },

    /**
     * Approve or reject with the etag the person saw. 200: accepted (11, 21, 23). 400 with `data.error`: the etag differs,
     * from changed content or from a file the person cannot reach (17, 19, 20). 400 with empty data: not approvable by
     * this person now, which includes a decision already made, also their own (13, 14, 18). 400 without JSON: a missing
     * parameter (10). 401: the token (25 to 30). No answer, or a server error, after the request left: lost.
     */
    async decide(token, id, decision, etag, message) {
      const response = await call(
        `${APPROVAL}/${decision === 'reject' ? 'reject' : 'approve'}/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          headers: { ...ocsHeaders(token), 'content-type': 'application/json' },
          body: JSON.stringify({ etag, ...(message ? { message } : {}) }),
        },
        SourceLost,
      );
      if (response.status === 200) return { outcome: 'accepted' };
      if (response.status === 401) throw new SourceDenied('Nextcloud refused the token.');
      if (response.status >= 500) throw new SourceLost('Nextcloud answered ' + response.status + '.');
      let data;
      try {
        data = (await response.json())?.ocs?.data;
      } catch {
        return { outcome: 'refused', reason: 'invalid' };
      }
      if (response.status !== 400) return { outcome: 'refused', reason: 'invalid' };
      if (data && !Array.isArray(data) && typeof data.error === 'string')
        return { outcome: 'refused', reason: 'stale' };
      return { outcome: 'refused', reason: 'not-allowed' };
    },
  };
}
