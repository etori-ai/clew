import type { LinkedAccountAdminView, LinkedAccountServerFound } from '@clew/contracts';
import type { LinkedAccountEntry } from '@clew/contracts';
import type { LinkedAccount, LinkRefusal, LinkView } from './contracts';
import type { Approval, AuthorizationServer, LinkCount, OAuthClient, TokenSet } from './ports';

/**
 * The rules of a linked account (D147), as pure functions: when a stored token is still sent as it is, what a link is
 * after an answer or a refusal, and which client Clew is at an authorization server.
 */

/** A stored access token is sent as it is until this long before its expiry (D147 item 7). */
export const FRESH_MS = 60_000;
/** How long a person has to return from the system's authorization page. */
export const PENDING_MS = 10 * 60_000;

/** Whether the link's access token can be sent as it is. A token with no stated lifetime is sent until it is refused. */
export function isFresh(link: LinkedAccount, now: Date): boolean {
  if (link.state !== 'linked' || !link.accessToken) return false;
  if (link.expiresAt === null) return true;
  return Date.parse(link.expiresAt) - FRESH_MS > now.getTime();
}

/**
 * The link after the authorization server answered with tokens. An answer without a refresh token keeps the one held;
 * one with a refresh token replaces it, which is what a server that rotates them needs. An answer that names no scopes
 * keeps the ones held.
 */
export function withTokens(link: LinkedAccount, tokens: TokenSet, now: Date): LinkedAccount {
  return {
    ...link,
    state: 'linked',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? link.refreshToken,
    expiresAt: tokens.expiresIn === null ? null : new Date(now.getTime() + tokens.expiresIn * 1000).toISOString(),
    scopes: tokens.scopes ?? link.scopes,
    lastError: null,
    lostAt: null,
  };
}

/** The link once the system refused its tokens for good: it says why and since when, and holds no token. */
export function lost(link: LinkedAccount, code: string, now: Date): LinkedAccount {
  return {
    ...link,
    state: 'needs-link',
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    lastError: code,
    lostAt: now.toISOString(),
  };
}

/**
 * A system as the person's list shows it: what its link is, since when, and whether it is said on Hem. A system put
 * off is one the person answered "Inte nu" for or took their link away from; a link that was lost is never put off,
 * since something that worked has stopped.
 */
export function entryOf(
  system: { connectorId: string; source: string; revocable: boolean },
  link: LinkedAccount | undefined,
  putOff: boolean,
): LinkedAccountEntry {
  return {
    connectorId: system.connectorId,
    source: system.source,
    state: link ? link.state : 'not-linked',
    linkedAt: link?.linkedAt ?? null,
    lostAt: link?.state === 'needs-link' ? link.lostAt : null,
    putOff: !link && putOff,
    revocable: system.revocable,
  };
}
/** What needs the person stands first: a link that was lost, then a system not linked, then the linked; by name within. */
const RANK = { 'needs-link': 0, 'not-linked': 1, linked: 2 } as const;
export const byNeed = (a: LinkedAccountEntry, b: LinkedAccountEntry) =>
  RANK[a.state] - RANK[b.state] || a.source.localeCompare(b.source, 'sv');

export const viewOf = (link: LinkedAccount): LinkView => ({
  connectorId: link.connectorId,
  state: link.state,
  issuer: link.issuer,
  linkedAt: link.linkedAt,
});

/**
 * Which client Clew is at an authorization server (D147 item 3), in this order: the one an administrator entered; a
 * metadata document Clew serves, where the server reads those; the one Clew registered there before; a new dynamic
 * registration. A client without a secret is used only where the server says it checks PKCE.
 */
export function clientChoice(
  server: AuthorizationServer,
  known: { entered: OAuthClient | null; registered: OAuthClient | null; documentUrl: string | null },
): { use: OAuthClient } | { register: true } | { refused: LinkRefusal } {
  const usable = (client: OAuthClient): { use: OAuthClient } | { refused: LinkRefusal } =>
    client.secret || server.pkce ? { use: client } : { refused: 'secret-required' };
  if (known.entered) return usable(known.entered);
  if (server.clientDocuments && known.documentUrl)
    return usable({ id: known.documentUrl, secret: null, source: 'document' });
  if (known.registered) return usable(known.registered);
  if (server.registrationEndpoint) return { register: true };
  return { refused: 'no-client' };
}

/**
 * Where a person is returned to after linking: a path inside Clew and nothing else, so the return can never be made to
 * lead to another address. Anything else is the start page.
 */
export function localPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  for (const char of value) if (char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f) return '/';
  return value;
}

/** What an administrator weighs of a server a system names: who it is, and what Clew can do there by itself. */
export const foundOf = (server: AuthorizationServer): LinkedAccountServerFound => ({
  issuer: server.issuer,
  registers: !!server.registrationEndpoint,
  revocable: !!server.revocationEndpoint,
});

/**
 * Whether a connector's people can link (D147 item 4), from what is approved for the address its manifest names and
 * what the system names now. An entered server is asked nothing, so it is never `changed`. A system that did not
 * answer changes nothing that is approved: what it would have named is not known. An approved server where Clew is no
 * client, and cannot register itself, lets nobody link either.
 */
export function accountState(
  approval: Approval | null,
  now: { found: LinkedAccountServerFound | null; answered: boolean },
  /** Whether Clew is, or can make itself, a client at the approved server (`clientChoice`). */
  client = true,
): LinkedAccountAdminView['state'] {
  if (!approval) return now.answered && !now.found ? 'no-server' : 'waiting';
  if (approval.origin !== 'entered' && now.answered) {
    if (!now.found) return 'no-server';
    if (now.found.issuer !== approval.server.issuer) return 'changed';
  }
  return client ? 'approved' : 'no-client';
}

/**
 * How many people hold a link that works with the server approved now, and how many must link again: a link the
 * system refused, or one to another server than the approved one, which is not used (item 4). With nothing approved
 * no link works.
 */
export function peopleOf(counts: readonly LinkCount[], issuer: string | null): LinkedAccountAdminView['people'] {
  const people = { linked: 0, again: 0 };
  for (const count of counts)
    if (count.state === 'linked' && count.issuer === issuer) people.linked += count.people;
    else people.again += count.people;
  return people;
}

/**
 * The issuer of a server an administrator entered by its addresses: the origin of the address people sign in at. An
 * entered server publishes nothing that names it, and the links are kept by this word, so the same addresses give the
 * same one.
 */
export const enteredIssuer = (authorizationEndpoint: string) => new URL(authorizationEndpoint).origin;
