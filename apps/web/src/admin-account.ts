import type { LinkedAccountAdminView, LinkedAccountApprovalInput } from '@clew/contracts';

/**
 * A connector's linked account (D147 items 3 and 4) in an administrator's words, on Administration › Anslutna system:
 * the fact under Översikt, the block "Personernas konton", the notice when nobody can link or the system names another
 * server, the rows of the two reviews and what the dialog asks for. Pure: `pages/admin/connector-account.tsx` draws
 * them. Numbers only about people; an address is shown as the system or the administrator gave it.
 */
type Account = LinkedAccountAdminView;

export const ACCOUNT_FACT_LABEL = 'Personer kopplar eget konto';
export const ACCOUNTS_HEADING = 'Personernas konton';
export const NOT_DONE = 'Inte klart: uppgifter saknas';

/** The fact beside "Får personens inloggning": the two ways a system knows the person. */
export function accountFact(account: Account | null | undefined): string {
  if (account === undefined) return 'Läser …';
  if (!account || account.resource === null) return 'Nej';
  if (account.state === 'waiting') return 'Inte klart: väntar på godkännande';
  if (account.state === 'no-server' || account.state === 'no-client' || !account.approved) return NOT_DONE;
  return `Ja, hos ${account.approved.issuer}`;
}

/** Who named the server people sign in at. */
export const originWords = (origin: 'discovered' | 'entered') =>
  origin === 'discovered' ? 'Systemet uppger den' : 'Angiven av en administratör';
/** How Clew is known at the server. */
export function clientWords(account: Account): string {
  const client = account.approved?.client ?? 'none';
  if (client === 'entered') return 'Som en klient en administratör har registrerat';
  if (client === 'registered') return 'Clew registrerade sig själv';
  return account.found?.registers ? 'Clew registrerar sig själv när den första personen kopplar' : 'Inte registrerat';
}
/** How many people have linked, and how many must link again. Never who. */
export function peopleWords({ linked, again }: Account['people']): string {
  if (!linked && !again) return 'Ingen har kopplat än';
  const parts = [`${linked} ${linked === 1 ? 'kopplad' : 'kopplade'}`];
  if (again) parts.push(`${again} behöver koppla igen`);
  return parts.join(' · ');
}
/** "16 personer behöver koppla sina konton igen", or null when nobody has linked. */
export function againWords(people: Account['people']): string | null {
  const all = people.linked + people.again;
  if (!all) return null;
  return all === 1 ? '1 person behöver koppla sitt konto igen' : `${all} personer behöver koppla sina konton igen`;
}

/**
 * What the dialog asks for. The system's addresses are asked for only where the system names no server (or an
 * administrator entered them before); a system that names one shows it as a fact. A client is needed wherever Clew
 * cannot register itself, which no entered server lets it do.
 */
export function accountForm(account: Account): { addresses: boolean; clientRequired: boolean } {
  const addresses = account.approved ? account.approved.origin === 'entered' : !account.found;
  return { addresses, clientRequired: addresses || !account.found?.registers };
}

export interface AccountNotice {
  title: string;
  description: string;
  /** `enter`: the dialog that asks for a client or addresses. `review`: the review of the server the system names. */
  action: 'enter' | 'review';
  label: string;
}
/** The notice over the page while nobody can link, or while the system names another server than the approved one. */
export function accountNotice(source: string, account: Account | null | undefined): AccountNotice | null {
  if (!account || account.resource === null || account.state === 'approved') return null;
  const cannot = `${source}: personer kan inte koppla sina konton än`;
  const enter = { action: 'enter', label: 'Ange uppgifter' } as const;
  if (account.state === 'no-server')
    return {
      title: cannot,
      description: `Systemet uppger ingen inloggningsserver. Registrera Clew i ${source} och ange uppgifterna här.`,
      ...enter,
    };
  if (account.state === 'no-client')
    return {
      title: cannot,
      description: `Clew är inte registrerat hos ${source}. Registrera Clew där och ange uppgifterna här.`,
      ...enter,
    };
  if (account.state === 'changed') {
    const linked = account.people.linked;
    return {
      title: `${source}: en annan inloggningsserver väntar på ditt godkännande`,
      description:
        'Ingen skickas dit förrän du har granskat och godkänt den.' +
        (linked
          ? ` ${linked === 1 ? 'Det kopplade kontot' : `De ${linked} kopplade kontona`} används som förut så länge systemet godtar ${linked === 1 ? 'det' : 'dem'}.`
          : ''),
      // A server Clew cannot register itself at is approved together with the client an administrator enters.
      ...(account.found?.registers ? { action: 'review', label: 'Granska' } : enter),
    };
  }
  if (!account.answered)
    return {
      title: cannot,
      description:
        'Systemet svarade inte när Clew frågade var personer loggar in. Läs sidan igen om en stund, eller ange uppgifterna här.',
      ...enter,
    };
  return {
    title: `${source}: var personer loggar in väntar på ditt godkännande`,
    description: 'Ingen kan koppla sitt konto förrän du har granskat och godkänt det.',
    ...(account.found?.registers ? { action: 'review', label: 'Granska' } : enter),
  };
}

export interface ReviewRow {
  key: string;
  tone: 'success' | 'warning' | 'error';
  /** The dot's word, which the row's own words begin with or say. */
  dot: string;
  label: string;
  lines: string[];
}
/** What Clew asks for at the system, in the system's own words; nothing when it asks for nothing by name. */
const asksFor = (scopes: string[]) => (scopes.length ? [`Clew ber om: ${scopes.join(', ')}.`] : []);

/**
 * The row of the review of a changed system (D144) that names the account, as that review names whose sign-in a system
 * gets: that people link an account of their own, the server they are sent to, what Clew asks for and how Clew is
 * known there. One approval covers the system and the server.
 */
export function manifestAccountRow(
  change: { to: { resource: string; scopes: string[] } | null },
  offered: Account['offered'] | undefined,
): ReviewRow {
  if (!change.to)
    return {
      key: 'account',
      tone: 'warning',
      dot: 'Konto',
      label: 'Personer kopplar inte längre ett eget konto i systemet',
      lines: ['Konton som är kopplade används inte mer.'],
    };
  const where = !offered
    ? []
    : offered.found
      ? [`De loggar in hos ${offered.found.issuer}, som systemet uppger.`]
      : offered.answered
        ? ['Systemet uppger ingen inloggningsserver: du anger den när du har godkänt.']
        : ['Systemet svarade inte på var de loggar in.'];
  const client = !offered?.found
    ? []
    : offered.found.registers
      ? ['Clew registrerar sig själv där.']
      : ['Du anger hur Clew är känt där när du har godkänt.'];
  return {
    key: 'account',
    tone: 'warning',
    dot: 'Konto',
    label: 'Personer kopplar ett eget konto i systemet',
    lines: [...where, ...asksFor(change.to.scopes), ...client],
  };
}

export interface ServerReview {
  title: string;
  subtitle: string;
  keep: string;
  approve: string;
  rows: ReviewRow[];
}
/**
 * The review of the server a system names: another one than the approved (what it costs is said before the press: how
 * many people must link again), or the first, for a system approved before anybody approved its server.
 */
export function serverReview(account: Account): ServerReview | null {
  const found = account.found;
  if (!found) return null;
  if (account.state === 'changed' && account.approved) {
    const again = againWords(account.people);
    return {
      title: 'Systemet uppger en annan inloggningsserver',
      subtitle:
        'Godkänn den bara om du vet att systemet har bytt. Konton som är kopplade till den gamla används inte mer.',
      keep: 'Behåll den gamla',
      approve: 'Godkänn den nya',
      rows: [
        {
          key: 'server',
          tone: 'warning',
          dot: 'Ändrat',
          label: `Personer loggar in hos ${found.issuer}`,
          lines: [`I dag: ${account.approved.issuer}.`],
        },
        ...(again
          ? [
              {
                key: 'again',
                tone: 'error' as const,
                dot: 'Kopplas om',
                label: again,
                lines: ['De får veta det där systemets innehåll saknas.'],
              },
            ]
          : []),
      ],
    };
  }
  if (account.state !== 'waiting') return null;
  return {
    title: 'Godkänn var personer loggar in',
    subtitle: 'Personer skickas dit för att koppla sina konton. Godkänn den bara om du känner igen adressen.',
    keep: 'Inte nu',
    approve: 'Godkänn',
    rows: [
      {
        key: 'server',
        tone: 'warning',
        dot: 'Konto',
        label: `Personer loggar in hos ${found.issuer}`,
        lines: ['Systemet uppger den.', ...asksFor(account.scopes), 'Clew registrerar sig själv där.'],
      },
    ],
  };
}

export interface AccountDraft {
  clientId: string;
  secret: string;
  authorize: string;
  token: string;
  revoke: string;
}
/** The dialog's fields as it opens: what is approved today, and never a secret. */
export const draftOf = (account: Account): AccountDraft => ({
  clientId: account.approved?.clientId ?? '',
  secret: '',
  authorize: account.approved?.origin === 'entered' ? account.approved.authorizationEndpoint : '',
  token: account.approved?.origin === 'entered' ? account.approved.tokenEndpoint : '',
  revoke: account.approved?.origin === 'entered' ? (account.approved.revocationEndpoint ?? '') : '',
});
/** Whether the secret may be left out: the one saved for the same client is kept. */
export const keepsSecret = (account: Account, draft: AccountDraft) =>
  !!account.approved?.clientId && account.approved.clientId === draft.clientId.trim();
/** Whether the dialog can be saved: what is required is there. What an address must be is the server's to say. */
export function draftReady(account: Account, draft: AccountDraft): boolean {
  const { addresses, clientRequired } = accountForm(account);
  const id = draft.clientId.trim();
  if (addresses && !(draft.authorize.trim() && draft.token.trim())) return false;
  if (clientRequired && !id) return false;
  // An entered server always needs the secret; one the system names may know Clew without one.
  if (addresses && !draft.secret && !keepsSecret(account, draft)) return false;
  return true;
}
/** What is sent: a client when one is typed, the addresses when the dialog asks for them. */
export function approvalOf(account: Account, draft: AccountDraft): LinkedAccountApprovalInput {
  const { addresses } = accountForm(account);
  const id = draft.clientId.trim();
  return {
    ...(id ? { client: { id, ...(draft.secret ? { secret: draft.secret } : {}) } } : {}),
    ...(addresses
      ? {
          server: {
            authorizationEndpoint: draft.authorize.trim(),
            tokenEndpoint: draft.token.trim(),
            ...(draft.revoke.trim() ? { revocationEndpoint: draft.revoke.trim() } : {}),
          },
        }
      : {}),
  };
}
