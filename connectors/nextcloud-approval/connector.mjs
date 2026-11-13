// The Nextcloud Approval connector's handlers and HTTP boundary (D101): the files that wait for the person's approval,
// one file's approval, a card per waiting file, and the person's decision carried out and read back. manifest.mjs owns
// the contract, approvals.mjs the port, nextcloud.mjs the API. It acts as the person: Clew sends a token for Nextcloud
// beside its signed assertion, every Nextcloud call carries that token and nothing else, and Nextcloud decides what the
// person may see and decide. Before anything is read or written the token's account must be the person Clew signed for.
// Nothing is stored or cached per person, and no rule, share or approver list is interpreted here.
import { createHash } from 'node:crypto';
import { createVerifier } from './verification.mjs';
import { STATE, SourceDenied, SourceLost, SourceUnavailable, createFixtureApproval } from './approvals.mjs';
import {
  AREA,
  CONNECTOR,
  DEFAULT_AUDIENCE,
  DEFAULT_SOURCE,
  STATUS,
  createManifest,
  fileRefPattern,
} from './manifest.mjs';

export { createManifest };

const PREFIX = `${CONNECTOR}:file:`;
const refPattern = new RegExp(fileRefPattern);
const refOf = id => PREFIX + id;
const idOf = ref => (typeof ref === 'string' && refPattern.test(ref) ? Number(ref.slice(PREFIX.length)) : undefined);
/** A decision read back with a time this much before the request was sent was made earlier. Clocks differ a little. */
const SKEW_SECONDS = 5;

const MONTHS = ['jan', 'feb', 'mars', 'apr', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec'];
const clockParts = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
/** "10 nov kl. 14:02", Swedish time, from Unix seconds. */
function when(seconds) {
  const p = Object.fromEntries(clockParts.formatToParts(new Date(seconds * 1000)).map(x => [x.type, x.value]));
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} kl. ${p.hour}:${p.minute}`;
}
const iso = seconds => new Date(seconds * 1000).toISOString();
/** Source text as one line, cut to a length. */
const clip = (value, limit) => {
  const line = String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim();
  return line.length <= limit ? line : line.slice(0, limit - 1).trimEnd() + '…';
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

class Invalid extends Error {}
class NotFound extends Error {}
/** The person cannot be established at Nextcloud: `missing`, `no-user-name`, `refused` or `mismatch`. */
class Refusal extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const fail = (code, message, status) => json({ error: { code, message } }, status);

/**
 * source: the approval port (the stand-in by default). audience and sourceLabel: see createManifest. publicUrl: the
 * address a person's browser reaches Nextcloud at, for links to a file; without it there are none. Identity comes from
 * the verified assertion and the delegated token, never from the request body.
 */
export function createConnector({
  jwks,
  secret,
  source = createFixtureApproval(),
  audience = DEFAULT_AUDIENCE,
  sourceLabel = DEFAULT_SOURCE,
  publicUrl,
  clewUrl = process.env.CLEW_URL ?? '',
  now = () => Date.now(),
} = {}) {
  const manifest = createManifest({ audience, source: sourceLabel });
  const verify = createVerifier({ secret, jwks, clewUrl }, CONNECTOR);
  const linkBase = publicUrl ? new URL(publicUrl).toString().replace(/\/+$/, '') : undefined;
  if (linkBase && !/^https?:\/\//.test(linkBase)) throw new Error('The public Nextcloud address must be http(s).');
  const linkOf = id => (linkBase ? `${linkBase}/index.php/f/${id}` : undefined);

  const refusals = {
    missing: `Din inloggning kan inte styrkas mot ${sourceLabel} i den här sessionen.`,
    'no-user-name': `Ditt konto i Clew saknar användarnamn, så din inloggning kan inte styrkas mot ${sourceLabel}.`,
    refused: `${sourceLabel} godtar inte din inloggning.`,
    mismatch: `Kontot i ${sourceLabel} har ett annat användarnamn än ditt konto i Clew.`,
  };

  /**
   * The Nextcloud account behind the token, whose id must equal the user name Clew signed for, without regard to case: a
   * token is never used under an assertion that names another user name. Names are compared, not people: an account
   * left under a name the directory has given to someone else passes (README, Identity).
   */
  async function identify(actor, token) {
    if (!token) throw new Refusal('missing');
    if (typeof actor.userName !== 'string' || !actor.userName) throw new Refusal('no-user-name');
    let me;
    try {
      me = await source.whoami(token);
    } catch (error) {
      if (error instanceof SourceDenied) throw new Refusal('refused');
      throw error;
    }
    if (me.id.toLowerCase() !== actor.userName.toLowerCase()) throw new Refusal('mismatch');
    return me;
  }

  function pendingRow(file) {
    const row = { ref: refOf(file.fileId), file: clip(file.name, 400) };
    if (file.request) {
      row.requestedBy = clip(file.request.userName, 200);
      row.requestedAt = iso(file.request.at);
    }
    const link = linkOf(file.fileId);
    if (link) row.link = link;
    return row;
  }

  const capabilities = {
    [`${CONNECTOR}.pending`]: async (actor, _input, token) => {
      await identify(actor, token);
      return { rows: (await source.pending(token)).map(pendingRow) };
    },

    [`${CONNECTOR}.state`]: async (actor, input, token) => {
      const id = idOf(input.ref);
      if (!id) throw new Invalid('Ogiltig filreferens.');
      const me = await identify(actor, token);
      const [state, versions] = await Promise.all([source.state(token, id), source.versions(token, me.id, [id])]);
      const found = versions.find(v => v.fileId === id);
      // State 0 is also what a file the person cannot reach answers; the person's own files tell the two apart.
      if (state.state === STATE.none && !found) throw new NotFound();
      const shown = {
        ref: refOf(id),
        file: clip(found?.name || `Fil ${id}`, 400),
        status:
          state.state === STATE.mine
            ? STATUS.mine
            : state.state === STATE.others
              ? STATUS.others
              : state.state === STATE.approved
                ? STATUS.approved
                : state.state === STATE.rejected
                  ? STATUS.rejected
                  : STATUS.none,
      };
      if (state.userName && state.at) {
        const decided = state.state === STATE.approved || state.state === STATE.rejected;
        shown[decided ? 'decidedBy' : 'requestedBy'] = clip(state.userName, 200);
        shown[decided ? 'decidedAt' : 'requestedAt'] = iso(state.at);
      }
      if (state.state !== STATE.none && state.message) shown.message = clip(state.message, 2000);
      const link = linkOf(id);
      if (link) shown.link = link;
      return shown;
    },

    [`${CONNECTOR}.open`]: async (_actor, input) => {
      const id = idOf(input.ref);
      if (!id) throw new Invalid('Ogiltig filreferens.');
      const url = linkOf(id);
      if (!url) throw new NotFound(`Det finns ingen adress till ${sourceLabel} inställd.`);
      return { url };
    },

    [`${CONNECTOR}.approve`]: (actor, input, token) => decide(actor, token, 'approve', input),
    [`${CONNECTOR}.reject`]: (actor, input, token) => decide(actor, token, 'reject', input),
  };

  // ---- Decisions. Nextcloud has no operation id and refuses a repeated decision like a forbidden one, so every outcome
  // ---- is settled by reading the file's state back, and only a read-back that shows the decision is a success.

  const words = {
    approve: { state: STATE.approved, done: 'Godkänd', one: 'Filen är godkänd', many: 'filer är godkända' },
    reject: { state: STATE.rejected, done: 'Avvisad', one: 'Filen är avvisad', many: 'filer är avvisade' },
  };
  const decidedWord = state => (state === STATE.approved ? 'godkänd' : 'avvisad');
  const by = state => `av ${clip(state.userName, 200)} ${when(state.at)}`;
  const quoted = state => (state.message ? ` Meddelande: ”${clip(state.message, 300)}”.` : '');

  /** One file's outcome from what Nextcloud answered and what its state says now. */
  function settle(decision, answer, state, me, sentAt) {
    const w = words[decision];
    const mine = !!state?.userId && state.userId.toLowerCase() === me.id.toLowerCase();
    if (state?.state === w.state && mine && state.at) {
      // A refused request wrote nothing, so the decision it reads back was made before; a lost one tells by its time.
      const earlier = answer.outcome === 'refused' || (answer.outcome === 'lost' && state.at < sentAt - SKEW_SECONDS);
      return {
        outcome: 'done',
        detail: earlier
          ? `Redan ${w.done.toLowerCase()} i ${sourceLabel} ${by(state)}. Inget nytt beslut behövdes.${quoted(state)}`
          : `${w.done} i ${sourceLabel} ${by(state)}.${quoted(state)}`,
      };
    }
    if (answer.outcome === 'accepted')
      return {
        outcome: 'unknown',
        detail: state
          ? `${sourceLabel} tog emot beslutet, men filens status visar något annat. Kontrollera filen i ${sourceLabel}.`
          : `${sourceLabel} tog emot beslutet, men det gick inte att läsa tillbaka. Kontrollera filen i ${sourceLabel}.`,
      };
    if (answer.outcome === 'lost')
      return {
        outcome: 'unknown',
        detail: `Svaret från ${sourceLabel} kom inte fram, och filens status visar inte beslutet. Kontrollera filen i ${sourceLabel} innan du beslutar igen.`,
      };
    // Refused: nothing was written. The state says why, as far as it can.
    const refused = detail => ({ outcome: 'failed', detail });
    if (!state) return refused(`${sourceLabel} tog inte emot beslutet.`);
    if (state.state === STATE.approved || state.state === STATE.rejected)
      return refused(`Filen är redan ${decidedWord(state.state)} ${state.at ? by(state) : ''}`.trimEnd() + '.');
    if (state.state === STATE.mine && answer.reason === 'stale')
      return refused(
        `Filen har ändrats sedan kortet skapades. Granska den nya versionen i ${sourceLabel} innan du beslutar.`,
      );
    if (state.state === STATE.others)
      return refused('Filen väntar inte längre på dig: du är inte godkännare för den nu.');
    if (state.state === STATE.none)
      return refused(`Du kommer inte längre åt filen i ${sourceLabel}, eller så finns den inte kvar.`);
    return refused(`${sourceLabel} tog inte emot beslutet.`);
  }

  function result(decision, rows) {
    const w = words[decision];
    const done = rows.filter(r => r.outcome === 'done').length;
    const headline = rows.some(r => r.outcome === 'unknown')
      ? `Det är oklart om beslutet registrerades i ${sourceLabel}.`
      : done === rows.length
        ? done === 1
          ? `${w.one} i ${sourceLabel}.`
          : `${done} ${w.many} i ${sourceLabel}.`
        : done === 0
          ? `Beslutet registrerades inte i ${sourceLabel}.`
          : `${done} av ${rows.length} beslut registrerades i ${sourceLabel}.`;
    return { headline, rows };
  }

  async function decide(actor, token, decision, input) {
    const refs = Array.isArray(input.refs) ? input.refs : [];
    if (!refs.length || refs.some(ref => !idOf(ref))) throw new Invalid('Ogiltig filreferens.');
    const seen = input.files && typeof input.files === 'object' ? input.files : {};
    const label = ref =>
      clip(typeof seen[ref]?.name === 'string' && seen[ref].name ? seen[ref].name : `Fil ${idOf(ref)}`, 400);
    const all = detail =>
      result(
        decision,
        refs.map(ref => ({ ref, label: label(ref), outcome: 'failed', detail })),
      );

    // Nothing is sent before the token's account is the person: a refusal here is a known outcome, not an unknown one.
    let me;
    try {
      me = await identify(actor, token);
    } catch (error) {
      if (error instanceof Refusal) return all(`${refusals[error.kind]} Inget beslut skickades.`);
      if (error instanceof SourceUnavailable) return all(`${sourceLabel} svarar inte just nu. Inget beslut skickades.`);
      throw error;
    }

    const rows = [];
    for (const ref of refs) {
      const id = idOf(ref);
      const etag = seen[ref]?.etag;
      const row = { ref, label: label(ref) };
      if (typeof etag !== 'string' || !etag) {
        rows.push({ ...row, outcome: 'failed', detail: 'Kortet saknar filens version. Läs in kortet igen.' });
        continue;
      }
      const sentAt = Math.floor(now() / 1000);
      let answer;
      try {
        answer = await source.decide(token, id, decision, etag);
      } catch (error) {
        if (error instanceof SourceDenied) {
          rows.push({
            ...row,
            outcome: 'failed',
            detail: `${sourceLabel} godtog inte din inloggning. Inget beslut registrerades.`,
          });
          continue;
        }
        if (!(error instanceof SourceLost) && !(error instanceof SourceUnavailable)) throw error;
        answer = { outcome: 'lost' };
      }
      let state = null;
      try {
        state = await source.state(token, id);
      } catch {
        state = null;
      }
      rows.push({ ...row, ...settle(decision, answer, state, me, sentAt) });
    }
    return result(decision, rows);
  }

  // ---- The scan: a card per waiting file. Pending is computed by Nextcloud on every call and is complete, so a file that
  // ---- no longer waits (decided, unshared, approver removed) is resolved by its absence.

  function draftOf(file, version) {
    const ref = refOf(file.fileId);
    const name = clip(file.name, 400);
    const requested = file.request ? when(file.request.at) : undefined;
    // What the person decides on: this version of this file. Nextcloud refuses a decision on any other.
    const files = { [ref]: { etag: version.etag, name } };
    const draft = {
      topic: ref,
      area: AREA,
      title: `Godkänn eller avvisa ${clip(file.name, 120)}`,
      summary: `${requested ? `Godkännande begärt ${requested}. ` : ''}Ditt beslut gäller för alla som kan godkänna filen.`,
      reason: `Du kan godkänna filen i ${sourceLabel}`,
      items: [
        {
          ref,
          revision: version.etag,
          label: name,
          detail: requested ? `Godkännande begärt ${requested}` : 'Väntar på ditt godkännande',
          selectable: false,
          selected: true,
        },
      ],
      actions: [
        {
          id: 'approve',
          label: 'Godkänn',
          capability: `${CONNECTOR}.approve`,
          kind: 'execute',
          role: 'primary',
          usesItems: true,
          input: { files },
        },
        ...(linkOf(file.fileId)
          ? [
              {
                id: 'open',
                label: `Öppna i ${sourceLabel}`,
                capability: `${CONNECTOR}.open`,
                kind: 'read',
                role: 'secondary',
                target: 'link',
                input: { ref },
              },
            ]
          : []),
        {
          id: 'state',
          label: 'Visa godkännandet',
          capability: `${CONNECTOR}.state`,
          kind: 'read',
          role: 'secondary',
          target: 'panel',
          input: { ref },
        },
        {
          id: 'reject',
          label: 'Avvisa',
          capability: `${CONNECTOR}.reject`,
          kind: 'execute',
          role: 'secondary',
          usesItems: true,
          input: { files },
          confirm: 'Avvisa filen? Ditt beslut gäller för alla som kan godkänna den.',
        },
      ],
      // The file is the work; a new request after a decision is new work on it (its own period); new content is the
      // same work changed (a new revision), so a card the person put away comes back with the version to decide on.
      occurrences: [{ key: ref, revision: version.etag, period: file.request ? String(file.request.at) : 'request' }],
    };
    return draft;
  }

  async function scan(actor, token) {
    const observed = (completeness, drafts = [], exhausted = false) => ({
      drafts,
      observation: {
        scope: actor.unitId + ':' + actor.role,
        observedAt: new Date(now()).toISOString(),
        version: hash(drafts),
        completeness,
        exhausted,
      },
    });
    try {
      const me = await identify(actor, token);
      const files = await source.pending(token);
      const versions = files.length
        ? await source.versions(
            token,
            me.id,
            files.map(f => f.fileId),
          )
        : [];
      const byId = new Map(versions.map(v => [v.fileId, v]));
      const drafts = files.filter(f => byId.has(f.fileId)).map(f => draftOf(f, byId.get(f.fileId)));
      // A waiting file whose version could not be read gets no card, and the snapshot does not claim to be whole.
      return drafts.length === files.length ? observed('complete', drafts, true) : observed('partial', drafts);
    } catch (error) {
      if (error instanceof Refusal || error instanceof SourceDenied) return observed('authorization-required');
      if (!(error instanceof SourceUnavailable)) console.error(`${CONNECTOR} connector: unexpected`, error?.name);
      return observed('unavailable');
    }
  }

  // HTTP boundary: route, verify Clew, require the person's token, dispatch and translate errors.
  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) return fail('not-found', 'Okänd adress.', 404);

    const assertion = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(assertion, request.headers.get('x-clew-connector-key'), request);
    if (!actor) return fail('denied', 'Ogiltigt behörighetsbevis.', 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return fail('invalid', 'Ogiltig förfrågan.', 400);
    }
    // The person's own token for Nextcloud. Without it there is nobody to act as: a figure, a callback, a scan or a
    // write no live session of theirs stands behind, or a session without identity provider tokens.
    const token = request.headers.get('x-clew-delegated-token') || undefined;

    if (url.pathname === '/clew/scan') return json(await scan(actor, token));
    if (url.pathname === '/clew/figure') return json({ figure: null });

    const name = decodeURIComponent(url.pathname.slice('/clew/capabilities/'.length));
    const capability = Object.hasOwn(capabilities, name) ? capabilities[name] : undefined;
    if (!capability) return fail('not-found', 'Okänd förmåga.', 404);
    const declared = manifest.capabilities.find(c => c.name === name);
    // A read refuses without the token; a decision answers what happened, which is that nothing was sent.
    if (!token && declared.kind !== 'execute') return fail('denied', refusals.missing, 403);

    try {
      const input = body && typeof body.input === 'object' && body.input ? body.input : {};
      return json({ output: await capability(actor, input, token) });
    } catch (error) {
      if (error instanceof Invalid) return fail('invalid', error.message, 400);
      if (error instanceof NotFound)
        return fail('not-found', error.message || 'Filen finns inte, eller så kommer du inte åt den.', 404);
      if (error instanceof Refusal) return fail('denied', refusals[error.kind], 403);
      if (error instanceof SourceDenied) return fail('denied', refusals.refused, 403);
      // Nextcloud's error text stays here, and so does anything an unexpected error might carry: only its name is logged.
      if (!(error instanceof SourceUnavailable) && !(error instanceof SourceLost))
        console.error(`${CONNECTOR} connector: unexpected`, error?.name);
      return fail('unavailable', `${sourceLabel} svarar inte just nu.`, 503);
    }
  }

  return { manifest, handle };
}
