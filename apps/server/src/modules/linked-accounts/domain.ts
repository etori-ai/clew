import type { LinkedAccount, LinkRefusal, LinkView } from './contracts';
import type { AuthorizationServer, OAuthClient, TokenSet } from './ports';

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
  };
}

/** The link once the system refused its tokens for good: it says why and holds no token. */
export function lost(link: LinkedAccount, code: string): LinkedAccount {
  return { ...link, state: 'needs-link', accessToken: null, refreshToken: null, expiresAt: null, lastError: code };
}

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
