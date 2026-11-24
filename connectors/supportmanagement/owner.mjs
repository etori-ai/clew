// The rules for an errand's owner (docs/reviews/2026-11-23-an-errand-owner-answers-supportmanagement-from-clew.md):
// whose errand it is, which of its messages are between the drake and the owner, how an answer goes, where the errand
// stands for the owner, and the thread as the owner reads it. Pure: no I/O, no clock (time is passed in), nothing kept.
//
// A message, as the source port hands it over (errands.mjs):
//   { id, channel: 'email' | 'webmessage' | 'conversation', direction: 'out' (from the drake) | 'in' (to the drake),
//     internal?, at, from?: { name?, address?, account? }, to?: string[], cc?: string[], text, attachments?: string[],
//     conversation?: { type: 'EXTERNAL' | 'INTERNAL', related: boolean, participants: string[] } }
// An owner: { username, email?, eService? }, from the errand's `PRIMARY` stakeholder. `eService` is true only when the
// errand's Open-E flow instance is theirs too: the e-service's messages are the flow instance owner's, not the errand's.

export const CHANNELS = ['email', 'webmessage', 'conversation'];

const same = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The errand is the person's: its `PRIMARY` stakeholder's account is theirs. Nothing else makes it so. */
export function owns(record, account) {
  return !!record?.owner && same(record.owner.username, account);
}

/** An e-mail's sender or one of its recipients is the owner's address. */
const mailsOwner = (message, owner) =>
  !!owner.email &&
  (same(message.from?.address, owner.email) ||
    [...(message.to ?? []), ...(message.cc ?? [])].some(address => same(address, owner.email)));

/**
 * The owner wrote it: an e-mail from their own address, an e-service message in, a conversation message of theirs. An
 * inbound mail from anyone else (the e-mail reader files mail from any sender) is not the owner's, whoever it copies.
 */
export function byOwner(message, owner) {
  if (!owner || message.direction !== 'in') return false;
  if (message.channel === 'email') return !!owner.email && same(message.from?.address, owner.email);
  if (message.channel === 'webmessage') return owner.eService === true;
  if (message.channel === 'conversation') return same(message.from?.account, owner.username);
  return false;
}

/**
 * The drake wrote it to the owner: an outbound mail with the owner among its recipients in To (a copy is for their
 * information, and the question is someone else's), an e-service message out, a conversation message out.
 */
export function toTheOwner(message, owner) {
  if (!owner || message.direction !== 'out') return false;
  if (message.channel === 'email')
    return !!owner.email && (message.to ?? []).some(address => same(address, owner.email));
  if (message.channel === 'webmessage') return owner.eService === true;
  return message.channel === 'conversation';
}

/**
 * Whether the owner may see a message. Owning an errand opens only what passed between the drake and the owner: an
 * e-mail not marked internal with the owner as its sender or among its recipients, the e-service's messages, and an
 * external conversation the owner takes part in that is not shared with another errand. An internal mail, a mail to
 * someone else, the handover to another department, an internal conversation and the one KC shares with a minidrake
 * stay with the drake.
 */
export function toOwner(message, owner) {
  if (!message || !owner || message.internal) return false;
  if (message.channel === 'email') return mailsOwner(message, owner);
  if (message.channel === 'webmessage') return owner.eService === true;
  if (message.channel === 'conversation')
    return (
      message.conversation?.type === 'EXTERNAL' &&
      !message.conversation.related &&
      (message.conversation.participants ?? []).some(account => same(account, owner.username))
    );
  return false;
}

/** The messages the owner may see, oldest first. */
export const shownTo = (messages, owner) =>
  (messages ?? []).filter(message => toOwner(message, owner)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

const latest = (messages, test) =>
  messages.filter(test).reduce((a, b) => (!a || Date.parse(b.at) >= Date.parse(a.at) ? b : a), undefined);

/** The drake's latest message to the owner, among those shown. */
export const lastFromDrake = (shown, owner) => latest(shown, message => toTheOwner(message, owner));

/**
 * The channel an answer takes: the channel of the drake's latest message to the owner, not the one the errand came in
 * by. `null` when the drake has not written to the owner.
 */
export const channelOf = (shown, owner) => lastFromDrake(shown, owner)?.channel ?? null;

/** The drake has written to the owner since the owner last answered. */
export function waitsOnOwner(shown, owner) {
  const out = lastFromDrake(shown, owner);
  const answered = latest(shown, message => byOwner(message, owner));
  return !!out && (!answered || Date.parse(out.at) > Date.parse(answered.at));
}

/**
 * Where the errand stands for its owner (D123): closed by its status; waiting on the owner when the drake has written
 * since their last answer; otherwise new or active by its status. When the messages could not be read, a status that
 * says the reporter has to answer is taken at its word.
 */
export function requestState({ kind, read, shown, owner }) {
  if (kind === 'closed') return 'closed';
  if (read ? waitsOnOwner(shown, owner) : kind === 'waiting-reporter') return 'waiting-on-me';
  return kind === 'new' ? 'new' : 'active';
}

// ---- The mail answer. ----

// An address that can stand in a `mailto:` link as it is: nothing a URL or Markdown would read as its own.
const ADDRESS = /^[^\s@<>"'(),;:\\?&#%[\]]+@[^\s@<>"'(),;:\\?&#%[\]]+\.[^\s@<>"'(),;:\\?&#%[\]]+$/;
export const isAddress = value => typeof value === 'string' && ADDRESS.test(value);

/**
 * The subject of a mail answer. Clew writes it and never copies the drake's: SupportManagement's e-mail reader reads
 * the number after the first `#`, so a copied subject with a `#` of its own would make the answer a new errand. This is
 * what Draken itself writes, with one `#`.
 */
export const mailSubject = errandNumber => `SV: Ärende #${errandNumber}`;

/** A `mailto:` address that opens the person's own mail program with the drake's address and the subject filled in. */
export function mailLink(address, errandNumber) {
  if (!isAddress(address)) return undefined;
  const subject = encodeURIComponent(mailSubject(errandNumber)).replace(
    /[()'!*]/g,
    c => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `mailto:${address}?subject=${subject}`;
}

// ---- The thread as the owner reads it. ----

/**
 * Text from a source, made inert in Markdown: every punctuation mark that could start a link, a heading or a list is
 * escaped, and so are `:` and `@`, so that an address in the text never becomes a link, even where a renderer links
 * bare addresses (Astryx's `autolink: 'gfm'`, off in Clew's views today).
 */
export function escapeMarkdown(text) {
  return String(text)
    .replace(/[\\`*_{}[\]()#+\-!<>|~&:@]/g, '\\$&')
    .replace(/\bwww\./gi, match => match.slice(0, 3) + '\\.')
    .replace(/^(\s*\d+)\./gm, '$1\\.');
}

const SEPARATOR = /^\s*-{2,}\s*(Ursprungligt meddelande|Original Message|Vidarebefordrat meddelande)/i;
const HEADER_FROM = /^\s*(Från|From):\s/i;
const HEADER_NEXT = /^\s*(Skickat|Sent|Datum|Date|Till|To|Ämne|Subject):\s/i;
const QUOTED = /^\s*>/;

/**
 * Where a mail's quoted history begins: a separator line, or a header block (a "Från:" line with another header line
 * right under it). A line that merely starts with "Från:" is the writer's own.
 */
function historyStart(lines) {
  return lines.findIndex(
    (line, i) => SEPARATOR.test(line) || (HEADER_FROM.test(line) && HEADER_NEXT.test(lines[i + 1] ?? '')),
  );
}

/**
 * A message's own words: the quoted history a mail carries below it is cut, and so is a block of `>` lines that runs
 * to the end. A `>` line with the writer's own words after it stays.
 */
export function ownWords(text) {
  let lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const end = historyStart(lines);
  if (end !== -1) lines = lines.slice(0, end);
  let tail = lines.length;
  while (tail > 0 && (QUOTED.test(lines[tail - 1]) || !lines[tail - 1].trim())) tail--;
  // Only a block that is quoted: a trailing run of blank lines alone is not.
  if (lines.slice(tail).some(line => QUOTED.test(line))) lines = lines.slice(0, tail);
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const CHANNEL_WORDS = { email: 'E-post', webmessage: 'E-tjänsten', conversation: 'Meddelande' };
const when = new Intl.DateTimeFormat('sv-SE', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Stockholm',
});
const day = new Intl.DateTimeFormat('sv-SE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Stockholm',
});

/** A paragraph of source text, escaped, with its line breaks kept. */
const paragraphs = text =>
  text
    .split(/\n{2,}/)
    .map(part =>
      part
        .split('\n')
        .map(line => escapeMarkdown(line.trim()))
        .join('  \n'),
    )
    .join('\n\n');

/**
 * The errand and the messages between the drake and its owner, as Markdown for a `text` view, and how to answer.
 * `area` is the drake's name as a person reads it. Every piece of source text is escaped; the only link is the mail
 * answer, which the connector builds itself.
 */
export function threadMarkdown({ errand, area, owner, shown, closed, replyAddress }) {
  const facts = [
    escapeMarkdown(area),
    escapeMarkdown(errand.statusLabel),
    errand.created ? `Registrerat ${day.format(new Date(errand.created))}` : undefined,
  ].filter(Boolean);
  // The page's own title is the read's; the errand's number and type lead the text, as on its row.
  const label = [errand.errandNumber, errand.type].filter(Boolean).map(escapeMarkdown).join(' · ');
  const parts = [`**${label}**`, facts.join(' · '), '# Meddelanden'];
  if (!shown.length) parts.push(`Inga meddelanden mellan dig och ${escapeMarkdown(area)} på ärendet.`);
  for (const message of shown) {
    // The owner's own, the drake's (named with the drake), or someone else's mail that copies the owner.
    const sender = message.from?.name ?? message.from?.address;
    const who = byOwner(message, owner)
      ? 'Du'
      : message.direction === 'out'
        ? message.from?.name
          ? `${escapeMarkdown(message.from.name)}, ${escapeMarkdown(area)}`
          : escapeMarkdown(area)
        : sender
          ? escapeMarkdown(sender)
          : 'Okänd avsändare';
    parts.push(`## ${who} · ${CHANNEL_WORDS[message.channel]} · ${when.format(new Date(message.at))}`);
    const words = message.channel === 'email' ? ownWords(message.text) : String(message.text ?? '').trim();
    parts.push(words ? paragraphs(words) : '*Meddelandet har ingen text.*');
    if (message.attachments?.length) parts.push(`Bilagor: ${message.attachments.map(escapeMarkdown).join(', ')}`);
  }
  parts.push('# Svara', ...answerLines({ errand, area, owner, shown, closed, replyAddress }));
  return parts.join('\n\n');
}

function answerLines({ errand, area, owner, shown, closed, replyAddress }) {
  const name = escapeMarkdown(area);
  if (closed) return [`Ärendet är avslutat. Behöver du mer hjälp, kontakta ${name} i ett nytt ärende.`];
  const channel = channelOf(shown, owner);
  if (channel === 'email') {
    const link = mailLink(replyAddress, errand.errandNumber);
    if (!link)
      return [
        `${name} skrev till dig med e-post. Svara på mejlet i din egen e-post och behåll ärendenumret i ämnesraden.`,
      ];
    return [
      `[Svara via e-post till ${name}](${link})`,
      'Svaret skickas från din egen e-post och syns här inom några minuter. Ändra inte ärendenumret i ämnesraden.',
      'Har du redan svarat? Svaret syns här inom några minuter.',
    ];
  }
  if (channel === 'webmessage')
    return waitsOnOwner(shown, owner)
      ? [
          `${name} skrev till dig i e-tjänsten. Svara med knappen Svara på kortet ”${name} väntar på ditt svar” under Att göra. Svaret skickas genom e-tjänsten och syns för handläggaren inom några minuter.`,
        ]
      : [`Du har svarat. Skriver ${name} till dig igen kan du svara härifrån.`];
  if (channel === 'conversation')
    return [`${name} skrev till dig i en konversation på ärendet. Att svara där från Clew finns inte ännu.`];
  return [`${name} har inte skrivit till dig på ärendet.`];
}
