// The approval port: what the connector asks of Nextcloud's Approval app, whatever answers it. Two adapters answer it,
// chosen by configuration in server.mjs: nextcloud.mjs, the real API, and the in-memory stand-in below, which decides
// as Approval 3.3.2 decides in the recorded exchanges (samples/): the same states, the same order of checks and the same
// refusals that cannot be told apart. Every method takes the person's own token, and nothing is kept between calls.
import { createHash } from 'node:crypto';

/** The token was refused: no token, not a token, another audience, expired, no account or a disabled one (401). */
export class SourceDenied extends Error {}
/** A read got no usable answer, or a write was not sent. Nothing changed. */
export class SourceUnavailable extends Error {}
/** A write was sent and no usable answer came back: it may or may not have taken effect. */
export class SourceLost extends Error {}

/**
 * Approval's state of one file for the asking person. 0: nothing (also: no access, no such file), 1: pending for someone
 * else, 2: approved, 3: rejected, 4: pending and approvable by me. For 1 and 4 who, when and message are the request's;
 * for 2 and 3 the decision's.
 */
export const STATE = { none: 0, others: 1, approved: 2, rejected: 3, mine: 4 };

// ---- The stand-in: a made-up Nextcloud with one approval rule, the same people and files as the development seed. ----

const accounts = {
  hillevi: 'Hillevi Berg',
  hassan: 'Hassan Ali',
  mikael: 'Mikael Lind',
  erik: 'Erik Sandström',
  karin: 'Karin Lindqvist',
};
/** [id, owner, approver it is shared with, name, minutes since the request], as `approval-seed.php` sets them up. */
const files = [
  [625, 'erik', 'hillevi', 'Inköp av läsplattor.txt', 3],
  [626, 'erik', 'hillevi', 'Schema för studiedag.txt', 7],
  [627, 'erik', 'hillevi', 'Plan för klassresa.txt', 6],
  [631, 'karin', 'hassan', 'Beställning av förbrukningsmaterial.txt', 6],
  [632, 'karin', 'hassan', 'Rutin för överlämning.txt', 6],
];

/**
 * The claims of the person's token, read without checking the signature. Enough for made-up data and nothing else:
 * Nextcloud's user_oidc checks the signature against the identity provider's keys.
 */
function claimsOf(token, audience, at) {
  try {
    const claims = JSON.parse(Buffer.from(String(token).split('.')[1] ?? '', 'base64url').toString());
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (typeof claims.preferred_username !== 'string' || !claims.preferred_username) return null;
    if (!audiences.includes(audience)) return null;
    if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= at) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * The stand-in. `controls` changes it the way people do in Nextcloud (an owner saves a new version, stops sharing, asks
 * again; an administrator disables an account) and the way a network fails, for tests and for trying the connector out.
 */
export function createFixtureApproval({
  audience = 'nextcloud',
  approvers = ['hillevi', 'hassan'],
  now = () => Date.now(),
} = {}) {
  const seconds = () => Math.floor(now() / 1000);
  const people = new Map(Object.entries(accounts).map(([id, name]) => [id, { name, enabled: true }]));
  const store = new Map(
    files.map(([id, owner, approver, name, minutes]) => [
      id,
      {
        id,
        owner,
        name,
        mimetype: 'text/plain',
        version: 1,
        reach: new Set([owner, approver]),
        tag: 'pending',
        activity: { userId: owner, at: seconds() - minutes * 60, message: '' },
      },
    ]),
  );
  let outage = false;
  let lose = null;

  const account = token => {
    const claims = claimsOf(token, audience, now());
    const person = claims && people.get(claims.preferred_username);
    if (!person || !person.enabled) throw new SourceDenied('The token was not accepted.');
    return claims.preferred_username;
  };
  const read = token => {
    if (outage) throw new SourceUnavailable('The stand-in is down.');
    return account(token);
  };
  const reaches = (user, file) => !!file && file.reach.has(user);
  const etagOf = (user, file) =>
    reaches(user, file) ? createHash('md5').update(`${file.id}:${file.version}`).digest('hex') : '';
  const who = activity => ({
    userId: activity.userId,
    userName: people.get(activity.userId)?.name ?? activity.userId,
    at: activity.at,
    message: activity.message,
  });
  function stateOf(user, file) {
    if (!reaches(user, file) || !file.tag) return { state: STATE.none };
    const state =
      file.tag === 'approved'
        ? STATE.approved
        : file.tag === 'rejected'
          ? STATE.rejected
          : approvers.includes(user)
            ? STATE.mine
            : STATE.others;
    return { state, ...(file.activity ? who(file.activity) : {}) };
  }

  return {
    async whoami(token) {
      const user = read(token);
      return { id: user, name: people.get(user).name };
    },

    /** Computed on every call, complete, newest request first. */
    async pending(token) {
      const user = read(token);
      return [...store.values()]
        .filter(f => f.tag === 'pending' && approvers.includes(user) && reaches(user, f))
        .sort((a, b) => (b.activity?.at ?? 0) - (a.activity?.at ?? 0) || b.id - a.id)
        .map(f => ({
          fileId: f.id,
          name: f.name,
          mimetype: f.mimetype,
          request: f.activity ? who(f.activity) : null,
        }));
    },

    async state(token, fileId) {
      const user = read(token);
      return stateOf(user, store.get(fileId));
    },

    /** The etag of each file the person reaches in their own files, by id; the others are simply not found. */
    async versions(token, userId, fileIds) {
      const user = read(token);
      if (userId !== user) return [];
      return fileIds
        .map(id => store.get(id))
        .filter(f => reaches(user, f))
        .map(f => ({ fileId: f.id, etag: etagOf(user, f), name: f.name }));
    },

    /**
     * Approve or reject. The etag is compared first, with the empty string standing for a file the person cannot reach,
     * so a non-empty etag on such a file reads as stale content; only then is the file checked for being approvable by
     * this person now. A repeated decision is refused like a forbidden one.
     */
    async decide(token, fileId, decision, etag, message) {
      if (outage) throw new SourceLost('The stand-in is down.');
      const user = account(token);
      const mode = lose;
      lose = null;
      if (mode === 'before') throw new SourceLost('The request did not arrive.');
      const file = store.get(fileId);
      let answer;
      if (typeof etag !== 'string') answer = { outcome: 'refused', reason: 'invalid' };
      else if (etag !== etagOf(user, file)) answer = { outcome: 'refused', reason: 'stale' };
      else if (stateOf(user, file).state !== STATE.mine) answer = { outcome: 'refused', reason: 'not-allowed' };
      else {
        file.tag = decision === 'approve' ? 'approved' : 'rejected';
        file.activity = { userId: user, at: seconds(), message: message ?? '' };
        answer = { outcome: 'accepted' };
      }
      if (mode === 'after') throw new SourceLost('The answer did not come back.');
      return answer;
    },

    controls: {
      /** The owner saves new content: a new etag. */
      edit(fileId) {
        store.get(fileId).version += 1;
      },
      share(fileId, user) {
        store.get(fileId).reach.add(user);
      },
      unshare(fileId, user) {
        store.get(fileId).reach.delete(user);
      },
      /** Approval is asked for again (after a decision, too): the file waits from now. */
      request(fileId, { by, message = '' } = {}) {
        const file = store.get(fileId);
        file.tag = 'pending';
        file.activity = { userId: by ?? file.owner, at: seconds(), message };
      },
      disable(user) {
        people.get(user).enabled = false;
      },
      enable(user) {
        people.get(user).enabled = true;
      },
      outage(down = true) {
        outage = down;
      },
      /** The next decision is lost: `after` it took effect, or `before` it reached the stand-in. */
      loseNextAnswer(mode = 'after') {
        lose = mode;
      },
    },
  };
}
