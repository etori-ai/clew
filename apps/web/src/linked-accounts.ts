import type { LinkedAccountEntry } from '@clew/contracts';

/**
 * A person's linked accounts (D147) in words: what Hem says under "Behöver dig" when a system needs the person's
 * account, what a row of the page "Kopplade konton" says, and what the address says when the person comes back from a
 * system. Pure: the components that draw these are in `components/accounts`.
 *
 * A link that was lost and a first link are two things. A lost link is something that worked and stopped: its line
 * carries the page's badge, says since when and cannot be put off. A first link is an offer: no badge, and "Inte nu"
 * takes it off Hem. One system of a kind is named and linked from the line; two or more of a kind become one line that
 * leads to the page, where the person goes through them, one sign-in each. There are never more than two lines, and
 * never two buttons to the same place: when both kinds are several they are one line, the lost ones first.
 */
export const ACCOUNTS_PATH = '/accounts';
export const ACCOUNTS_TITLE = 'Kopplade konton';

export interface AccountLine {
  key: string;
  /** `lost`: the badge and no way to put it off. `first`: quiet. */
  weight: 'lost' | 'first';
  title: string;
  line: string;
  /** The one system the line's button links, or null when the button leads to the page. */
  link: LinkedAccountEntry | null;
  /** The button's words. */
  action: string;
  /** The systems "Inte nu" puts off; empty where the line cannot be put off. */
  later: string[];
}

const TZ = 'Europe/Stockholm';
const dayMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, day: 'numeric', month: 'long' });
const dayMonthYear = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
/** "Inköpssystemet", "Inköpssystemet och Ekonomisystemet", "A, B och C". */
export const listed = (words: string[]) =>
  words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} och ${words.at(-1)}`;
const sources = (entries: LinkedAccountEntry[]) => listed(entries.map(e => e.source));

export const LOST_BADGE = 'Behöver kopplas igen';
export const LINK_AGAIN = 'Koppla igen';
export const LINK_FIRST = 'Koppla ditt konto';
export const TO_THE_PAGE = 'Visa kopplade konton';
/** What a person is told when a system needs their account, wherever its content is missing. */
export const needsTitle = (source: string) => `${source} behöver ditt konto`;
export const lostTitle = (source: string) => `${source} godtar inte längre ditt konto`;
/** What the first sign-in is, since the button leaves Clew. */
export const firstLine = (source: string) => `Du loggar in hos ${source} en gång och kommer sedan tillbaka hit.`;
/**
 * What a lost link means here. Clew keeps the cards it had (a blocked scan closes none), so the line does not say
 * that nothing of the system is shown: it says that Clew can no longer read it, which holds for what is missing and
 * for what stands as it was.
 */
export const lostLine = (entry: Pick<LinkedAccountEntry, 'lostAt'>) =>
  entry.lostAt
    ? `Sedan ${dayMonth.format(new Date(entry.lostAt))} kan Clew inte läsa det som är ditt där.`
    : 'Clew kan inte läsa det som är ditt där.';

/**
 * One system's line, where its content is missing: on Hem, and in the system's own list, where it cannot be put off
 * since the list has nothing else to show.
 */
export function accountLine(entry: LinkedAccountEntry, options: { later?: boolean } = {}): AccountLine {
  return entry.state === 'needs-link'
    ? {
        key: 'lost',
        weight: 'lost',
        title: lostTitle(entry.source),
        line: lostLine(entry),
        link: entry,
        action: LINK_AGAIN,
        later: [],
      }
    : {
        key: 'first',
        weight: 'first',
        title: needsTitle(entry.source),
        line: firstLine(entry.source),
        link: entry,
        action: LINK_FIRST,
        later: options.later ? [entry.connectorId] : [],
      };
}

/** The lines under the rows of "Behöver dig" on Hem. */
export function accountLines(accounts: readonly LinkedAccountEntry[]): AccountLine[] {
  const lost = accounts.filter(a => a.state === 'needs-link');
  const first = accounts.filter(a => a.state === 'not-linked' && !a.putOff);
  const lines: AccountLine[] = [];
  if (lost.length === 1) lines.push(accountLine(lost[0]!));
  if (lost.length > 1) {
    const also = first.length > 1 ? ` ${sources(first)} behöver också ditt konto.` : '';
    lines.push({
      key: 'lost',
      weight: 'lost',
      title: `${lost.length} system godtar inte längre ditt konto`,
      line: `${sources(lost)}.${also}`,
      link: null,
      action: TO_THE_PAGE,
      later: [],
    });
    // Both kinds several: the one line above names them all, and its button is the one way to the page.
    if (first.length > 1) return lines;
  }
  if (first.length === 1) lines.push(accountLine(first[0]!, { later: true }));
  if (first.length > 1)
    lines.push({
      key: 'first',
      weight: 'first',
      title: `${first.length} system behöver ditt konto`,
      line: `${sources(first)}. Du loggar in hos vart och ett en gång.`,
      link: null,
      action: TO_THE_PAGE,
      later: first.map(a => a.connectorId),
    });
  return lines;
}

/** A row's supporting line on the page: "Kopplat 25 november 2026", with why it needs the person, or "Inte kopplat". */
export function accountRowLine(entry: LinkedAccountEntry): string {
  if (entry.state === 'not-linked' || !entry.linkedAt) return 'Inte kopplat';
  const linked = `Kopplat ${dayMonthYear.format(new Date(entry.linkedAt))}`;
  return entry.state === 'needs-link' ? `${linked} · ${entry.source} godtar inte längre kontot` : linked;
}

/** The systems Hem and a list say need the person's account: the cards' read then does not call them silent. */
export const needingAccount = (accounts: readonly LinkedAccountEntry[]) =>
  accounts.filter(a => a.state !== 'linked').map(a => a.connectorId);

/**
 * What the address says when the person comes back from a system (`?account=linked&system=<id>`, set by the server's
 * return route), and the address without it: the page says it once and takes it out of the address.
 */
export type AccountOutcome = 'linked' | 'declined' | 'failed';
export function accountReturn(search: string): { outcome: AccountOutcome; system: string | null; rest: string } | null {
  const params = new URLSearchParams(search);
  const outcome = params.get('account');
  if (outcome !== 'linked' && outcome !== 'declined' && outcome !== 'failed') return null;
  const system = params.get('system');
  params.delete('account');
  params.delete('system');
  const rest = params.toString();
  return { outcome, system, rest: rest ? `?${rest}` : '' };
}
/** What the toast says, or null where nothing is said (the person declined at the system: nothing changed). */
export function returnMessage(outcome: AccountOutcome, source: string | null): string | null {
  if (outcome === 'linked') return source ? `Ditt konto i ${source} är kopplat` : 'Ditt konto är kopplat';
  if (outcome === 'failed')
    return source
      ? `Det gick inte att koppla ditt konto i ${source}. Försök igen.`
      : 'Det gick inte att koppla ditt konto. Försök igen.';
  return null;
}
/** The page a person leaves for a system from, as they come back to it: without an earlier return's two parameters. */
export function returnAddress(pathname: string, search: string): string {
  return pathname + (accountReturn(search)?.rest ?? search);
}
/** The connector a capability belongs to: the name before its first dot (`purchasing.approvals`). */
export const connectorOf = (capability: string) => capability.split('.')[0] ?? '';

/**
 * Linking in a window of its own (D147 item 6, amended 2026-11-25). The press opens a small window on the system's
 * sign-in, so the page the person was on stays as it is. The system returns that window to Clew, to
 * `LINK_RETURN_PATH`, a page that tells every page of Clew in this browser what happened and closes itself. A browser
 * that will not open the window leaves the redirect in the same tab, which is the same link by another way.
 *
 * What the return page says goes over a broadcast channel of Clew's own origin, never over the window's opener: a
 * system's sign-in may cut the two windows apart, and a channel reaches the page all the same. The message names the
 * link by an id the pressing page made up, so the page that started it is the one that says so; every other page of
 * Clew only reads its lists again.
 */
export const LINK_RETURN_PATH = '/accounts/return';
export const LINK_WINDOW = 'clew-link-account';
export const LINK_CHANNEL = 'clew-linked-accounts';
const LINK_ID = /^[a-z0-9]{8,40}$/;
/** Where the system returns the window to: the return page, with the id of the link that the press started. */
export const linkReturnAddress = (linkId: string) => `${LINK_RETURN_PATH}?link=${linkId}`;
/** The window's size and place: over the middle of the page it was opened from, and never larger than the screen. */
export function linkWindowFeatures(opener: {
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
}): string {
  const width = Math.max(320, Math.min(600, opener.outerWidth));
  const height = Math.max(480, Math.min(760, opener.outerHeight));
  const left = Math.round(opener.screenX + Math.max(0, (opener.outerWidth - width) / 2));
  const top = Math.round(opener.screenY + Math.max(0, (opener.outerHeight - height) / 2));
  return `popup,width=${width},height=${height},left=${left},top=${top}`;
}
export interface LinkMessage {
  /** The id the pressing page gave the link, or null when the return could not be placed (a link that ran out). */
  link: string | null;
  outcome: AccountOutcome;
  system: string | null;
}
/** What the return page tells the other pages, read from its own address; null when the address says nothing. */
export function linkMessage(search: string): LinkMessage | null {
  const back = accountReturn(search);
  if (!back) return null;
  const link = new URLSearchParams(search).get('link');
  return { link: link && LINK_ID.test(link) ? link : null, outcome: back.outcome, system: back.system };
}
/** A message as it arrives on the channel: anything that is not one is nothing. */
export function readLinkMessage(data: unknown): LinkMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const { link, outcome, system } = data as Record<string, unknown>;
  if (outcome !== 'linked' && outcome !== 'declined' && outcome !== 'failed') return null;
  if (link !== null && !(typeof link === 'string' && LINK_ID.test(link))) return null;
  if (system !== null && typeof system !== 'string') return null;
  return { link, outcome, system };
}
/**
 * What the return page says in the window when the browser will not let it close itself: what happened, and that the
 * window can be closed. The page that started the link has been told already.
 */
export function returnPageWords(outcome: AccountOutcome | null): { title: string; line: string } {
  const line = 'Du kan stänga det här fönstret.';
  if (outcome === 'linked') return { title: 'Ditt konto är kopplat', line };
  if (outcome === 'failed') return { title: 'Det gick inte att koppla ditt konto', line: `Försök igen. ${line}` };
  return { title: 'Kontot kopplades inte', line };
}
