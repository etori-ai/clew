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
