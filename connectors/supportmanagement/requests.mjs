// The errand owner's side of the SupportManagement connector (D123, and the plan in
// docs/reviews/2026-11-23-an-errand-owner-answers-supportmanagement-from-clew.md): the errands a person owns, one of
// them with the messages between the drake and them, the answer through Open-E, and a card while an errand waits on
// them.
//
// SupportManagement trusts whatever `X-Sent-By` names and, with access control off, answers anything in a namespace.
// So this side is the trust boundary, as the POB connector is for POB: it validates the person's own token itself,
// checks that it is the person Clew signed for, and applies the rule in owner.mjs to every errand and every message
// before any of it leaves. Without a valid token no call is made to the source at all.
import { createHash } from 'node:crypto';
import { ACCOUNT_PATTERN } from './identity.mjs';
import { SourceDenied, SourceNotFound, SourceUnavailable } from './errands.mjs';
import { CONNECTOR, errandRefParts } from './manifest.mjs';
import { channelOf, lastFromDrake, owns, requestState, shownTo, threadMarkdown } from './owner.mjs';

/** A refusal, an invalid input or a missing errand, with the Swedish the person reads. */
export class OwnerError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** The area a card is filed under: Clew's own for what a person sent in (D123 item 5). */
export const REQUEST_AREA = 'requests';
const requestPattern = new RegExp(
  `^request:${CONNECTOR}:(${errandRefParts.municipalityId}):(${errandRefParts.namespace}):(${errandRefParts.id})$`,
);
/** How long a closed errand stays in the owner's list. */
const CLOSED_SHOWN_MS = 30 * 86_400_000;
const ANSWER_LIMIT = 4000;
const NOT_FOUND = 'Ärendet finns inte, eller så har du inte tillgång till det.';
const shortDate = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' });

/**
 * source: the errand port's owner side (errands.mjs). verifyToken: identity.mjs's verifier. accountClaim: the claim
 * that carries the AD account. kindOf: a status's meaning. linkOf: the link out to an errand. replyAddresses: namespace
 * -> the address its e-mail reader reads. stateSeconds: how long an errand's state is kept, the state alone.
 * readLimit and parallel: how many errands' messages one list reads, and how many at a time.
 */
export function createOwnerSide({
  source,
  verifyToken,
  accountClaim = 'preferred_username',
  municipalityId,
  sourceLabel,
  kindOf,
  linkOf = () => undefined,
  replyAddresses = {},
  stateSeconds = 120,
  readLimit = 25,
  parallel = 4,
  now = () => Date.now(),
  say = () => {},
}) {
  const refusals = {
    missing: `Din inloggning kan inte styrkas mot ${sourceLabel} i den här sessionen.`,
    refused: `${sourceLabel} godtar inte din inloggning just nu.`,
    'no-user-name': `Ditt konto i Clew saknar användarnamn, så din inloggning kan inte styrkas mot ${sourceLabel}.`,
    mismatch: `Inloggningen mot ${sourceLabel} hör till en annan person än den som använder Clew.`,
  };
  const refuse = reason => new OwnerError('denied', refusals[reason] ?? refusals.refused, 403);
  const invalid = message => new OwnerError('invalid', message, 400);
  const notFound = () => new OwnerError('not-found', NOT_FOUND, 404);

  /**
   * Who asks, or a refusal. In order: the person's token is there; the identity provider signed it for this audience
   * and it has not expired; its account is the person Clew signed for. Nothing here calls SupportManagement.
   */
  async function identify(actor, token) {
    if (!token) throw refuse('missing');
    const checked = await verifyToken(token);
    if (checked.status === 'unavailable') throw new SourceUnavailable('The keys could not be fetched.');
    if (checked.status !== 'ok') throw refuse('refused');
    const account = checked.claims[accountClaim];
    if (typeof account !== 'string' || !ACCOUNT_PATTERN.test(account)) throw refuse('refused');
    if (typeof actor.userName !== 'string' || !actor.userName) throw refuse('no-user-name');
    if (account.toLowerCase() !== actor.userName.toLowerCase()) throw refuse('mismatch');
    return account;
  }

  // An errand's state for its owner, kept a short while: the state, the channel and when the drake last wrote, never a
  // message. Without it every list would read every open errand's messages again.
  const states = new Map();
  const stateKey = (account, errand) => `${account.toLowerCase()}|${errand.namespace}|${errand.id}`;
  const kept = (account, errand) => {
    const entry = states.get(stateKey(account, errand));
    return entry && entry.until > now() && entry.since === errand.since ? entry : undefined;
  };
  function keep(account, errand, entry) {
    states.set(stateKey(account, errand), { ...entry, since: errand.since, until: now() + stateSeconds * 1000 });
    if (states.size > 5000) states.delete(states.keys().next().value);
  }

  const refOf = errand => `request:${CONNECTOR}:${municipalityId}:${errand.namespace}:${errand.id}`;
  const labelOf = errand => (errand.type ? `${errand.errandNumber} · ${errand.type}` : errand.errandNumber);
  const closed = errand => kindOf(errand.status) === 'closed';

  /** The row D123 lists, and nothing besides. */
  function rowOf(record, state) {
    const shown = {
      ref: refOf(record.errand),
      label: labelOf(record.errand),
      state,
      status: record.errand.statusLabel,
      // When it was registered; a source that does not say gives when it last changed.
      since: record.created ?? record.errand.since,
    };
    const link = linkOf(record.errand);
    if (link) shown.link = link;
    return shown;
  }

  /**
   * The owner as the rules in owner.mjs see them. The e-service's messages are the Open-E flow instance owner's, so they
   * are this person's only when the source says the flow instance is theirs too; otherwise they are neither shown nor
   * answered, whoever the errand's `PRIMARY` stakeholder is.
   */
  const viewerOf = (record, account) => ({
    ...record.owner,
    eService:
      !!record.flowInstanceId &&
      typeof record.flowInstanceOwner === 'string' &&
      record.flowInstanceOwner.toLowerCase() === account.toLowerCase(),
  });

  /** The messages the owner may see, and what follows from them. */
  async function thread(account, record) {
    const owner = viewerOf(record, account);
    const shown = shownTo(await source.messages(account, record), owner);
    const entry = {
      state: requestState({ kind: kindOf(record.errand.status), read: true, shown, owner }),
      channel: channelOf(shown, owner),
      revision: lastFromDrake(shown, owner)?.at,
    };
    keep(account, record.errand, entry);
    return { shown, owner, ...entry };
  }

  /** Runs `work` over `items`, at most `limit` at a time. */
  async function inTurn(items, limit, work) {
    const results = new Array(items.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
          const i = next++;
          results[i] = await work(items[i]);
        }
      }),
    );
    return results;
  }

  /**
   * The errands the person owns, open and closed in the last thirty days, each with where it stands. The newest open
   * errands are read for their messages, at most `readLimit`; a read that fails, and any errand beyond the limit, takes
   * its state from its status. What waits on the person first, then what is open from the oldest, then what is closed
   * from the newest (D123 item 4).
   */
  async function requestsFor(account) {
    const owned = (await source.owned(account)).filter(
      record =>
        owns(record, account) && (!closed(record.errand) || now() - Date.parse(record.errand.since) <= CLOSED_SHOWN_MS),
    );
    const open = owned
      .filter(record => !closed(record.errand))
      .sort((a, b) => Date.parse(b.errand.since) - Date.parse(a.errand.since));
    const read = new Set(open.slice(0, readLimit));
    const seen = await inTurn(owned, parallel, async record => {
      const fallback = { state: requestState({ kind: kindOf(record.errand.status), read: false }), channel: null };
      if (!read.has(record)) return { record, ...fallback };
      const known = kept(account, record.errand);
      if (known) return { record, ...known };
      try {
        return { record, ...(await thread(account, record)) };
      } catch (error) {
        if (!(error instanceof SourceUnavailable || error instanceof SourceNotFound || error instanceof SourceDenied))
          throw error;
        return { record, ...fallback };
      }
    });
    const order = item => (item.state === 'waiting-on-me' ? 0 : item.state === 'closed' ? 2 : 1);
    return seen
      .map(item => ({ ...item, row: rowOf(item.record, item.state) }))
      .sort(
        (a, b) =>
          order(a) - order(b) ||
          (a.state === 'closed' ? -1 : 1) * (Date.parse(a.row.since) - Date.parse(b.row.since)) ||
          a.row.ref.localeCompare(b.row.ref),
      );
  }

  /** One errand the person owns, or not found: an errand that is not theirs answers exactly as one that does not exist. */
  async function ownedRecord(account, ref, event) {
    const match = typeof ref === 'string' ? requestPattern.exec(ref) : null;
    if (!match) throw invalid('Ogiltig referens.');
    const [, municipality, namespace, id] = match;
    const record = municipality === municipalityId ? await source.record(account, namespace, id) : null;
    if (!record || !owns(record, account)) {
      say({ event, account, errand: id, outcome: 'not-found' });
      throw notFound();
    }
    return record;
  }

  const answerOf = input => {
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text) throw invalid('Skriv ditt svar.');
    if (text.length > ANSWER_LIMIT) throw invalid(`Svaret får vara högst ${ANSWER_LIMIT} tecken.`);
    return text;
  };

  /** The errand can be answered from Clew: it is open and the drake last wrote in the e-service. */
  function answerable(record, seen) {
    const area = record.errand.area;
    if (closed(record.errand)) throw invalid('Ärendet är avslutat.');
    if (seen.channel === 'email') throw invalid('Svara via e-postlänken på ärendet.');
    if (seen.channel === 'conversation')
      throw invalid(`${area} skrev i en konversation på ärendet. Att svara där från Clew finns inte ännu.`);
    if (seen.channel !== 'webmessage') throw invalid(`${area} har inte skrivit till dig på ärendet.`);
  }

  const capabilities = {
    'sm.requests': async (_input, { account }) => {
      const rows = (await requestsFor(account)).map(item => item.row);
      say({ event: 'requests', account, outcome: 'shown', rows: rows.length });
      return { rows };
    },

    'sm.request': async (input, { account }) => {
      const record = await ownedRecord(account, input.ref, 'open-request');
      const seen = await thread(account, record);
      say({ event: 'open-request', account, errand: record.errand.id, outcome: 'shown', messages: seen.shown.length });
      return {
        ...rowOf(record, seen.state),
        body: threadMarkdown({
          errand: { ...record.errand, created: record.created },
          area: record.errand.area,
          owner: seen.owner,
          shown: seen.shown,
          closed: closed(record.errand),
          replyAddress: replyAddresses[record.errand.namespace],
        }),
      };
    },

    'sm.replyEffect': async (input, { account }) => {
      const record = await ownedRecord(account, input.ref, 'prepare-answer');
      const seen = await thread(account, record);
      answerable(record, seen);
      const last = lastFromDrake(seen.shown, seen.owner);
      const from = last?.from?.name ? `${last.from.name}s` : 'handläggarens';
      return {
        rows: [
          {
            label: `Ditt svar skickas till ${record.errand.area} genom e-tjänsten`,
            detail: `Du svarar på ${from} meddelande från ${shortDate.format(new Date(last.at))} i ärende ${record.errand.errandNumber}. Svaret syns för handläggaren inom några minuter och kan inte tas tillbaka.`,
          },
        ],
      };
    },

    'sm.reply': async (input, { account, operationId }) => {
      const text = answerOf(input);
      const record = await ownedRecord(account, input.ref, 'answer');
      // The errand as it is now: the drake may have closed it, or mailed since the card was made.
      const seen = await thread(account, record);
      answerable(record, seen);
      await source.postOwnerMessage(account, record, text, operationId);
      states.delete(stateKey(account, record.errand));
      say({ event: 'answer', account, errand: record.errand.id, outcome: 'sent', channel: 'webmessage' });
      return {
        headline: 'Svaret är skickat',
        rows: [
          {
            ref: refOf(record.errand),
            label: labelOf(record.errand),
            outcome: 'done',
            detail: `Ditt svar finns nu i e-tjänsten och syns för ${record.errand.area} inom några minuter.`,
          },
        ],
      };
    },
  };

  /** One card: an errand that waits for its owner's answer. Its text is the row's and the channel's, never a message. */
  function draftOf({ record, row, channel, revision }) {
    const area = record.errand.area;
    const by = channel === 'webmessage' ? 'i e-tjänsten' : channel === 'email' ? 'med e-post' : 'på ärendet';
    const show = {
      id: 'show',
      label: 'Visa',
      capability: 'sm.request',
      kind: 'read',
      role: channel === 'webmessage' ? 'secondary' : 'primary',
      target: 'panel',
      input: { ref: row.ref },
    };
    return {
      topic: `${CONNECTOR}:request:${record.errand.id}`,
      area: REQUEST_AREA,
      title: `${area} väntar på ditt svar`,
      summary: `${row.label}. Status: ${row.status}. ${area} skrev till dig ${by}${revision ? ' ' + shortDate.format(new Date(revision)) : '.'}`,
      reason: `Ett ärende du skickat till ${area} väntar på ditt svar`,
      items: [{ ref: row.ref, label: row.label, detail: row.status, selectable: false, selected: false }],
      actions:
        channel === 'webmessage'
          ? [
              {
                id: 'reply',
                label: 'Svara',
                capability: 'sm.reply',
                kind: 'execute',
                role: 'primary',
                input: { ref: row.ref },
              },
              show,
            ]
          : [show],
      // The errand is the work. When the drake writes again it is the same work changed; when it stops waiting on the
      // person it is no longer among the drafts, and a complete scan resolves its card.
      occurrences: [{ key: row.ref, revision: revision ?? row.since, period: 'waiting-on-me' }],
    };
  }

  /** The scan: a card for every errand the person owns that waits on them. Only with their own token, as every read. */
  async function scan(actor, token) {
    const observed = (completeness, drafts = [], exhausted = false) => ({
      drafts,
      observation: {
        scope: actor.unitId + ':' + actor.role,
        observedAt: new Date(now()).toISOString(),
        version: createHash('sha256').update(JSON.stringify(drafts)).digest('hex').slice(0, 32),
        completeness,
        exhausted,
      },
    });
    try {
      const account = await identify(actor, token);
      const drafts = (await requestsFor(account)).filter(item => item.state === 'waiting-on-me').map(draftOf);
      say({ event: 'scan', account, outcome: 'shown', rows: drafts.length });
      return observed('complete', drafts, true);
    } catch (error) {
      if (error instanceof OwnerError) {
        say({ event: 'scan', outcome: 'authorization-required' });
        return observed('authorization-required');
      }
      // The source refused the person: a namespace that has switched SupportManagement's own access control on.
      if (error instanceof SourceDenied) {
        say({ event: 'scan', outcome: 'refused-by-source' });
        return observed('unavailable');
      }
      if (!(error instanceof SourceUnavailable)) console.error('sm connector: unexpected', error?.name);
      say({ event: 'scan', outcome: 'unavailable' });
      return observed('unavailable');
    }
  }

  /** Answers one of this side's capabilities for the person behind the token, or throws an OwnerError. */
  async function run(name, input, { actor, token, operationId }) {
    const account = await identify(actor, token);
    return capabilities[name](input, { account, operationId });
  }

  return { names: Object.keys(capabilities), run, scan, forget: () => states.clear() };
}
