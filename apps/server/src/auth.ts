import * as oidc from 'openid-client';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AuthenticatedContext } from '@clew/contracts';
import { database } from '@clew/db';
import { logger } from './logging';
import {
  ABSOLUTE_MS,
  IDLE_MS,
  LOGIN_TRANSACTION_MS,
  activeSession,
  auditAuth,
  backchannelRevoke,
  consumeLogin,
  loginTransactions,
  readSession,
  resolveSubject,
  bindFirstLogin,
  readGroups,
  revokeSession,
  sessions,
  authenticationAudit,
  type SessionRecord,
} from '@clew/db/auth';
import {
  authorizationVersion,
  decryptTokens,
  encryptTokens,
  equalToken,
  localReturnTo,
  randomToken,
  tokenDigest,
} from './auth-crypto';
import { delegationFor } from './auth-exchange';
import { frontendOrigins } from './auth-origin';

/** Ported from startsidan `packages/platform/src/auth.ts`: Authorization Code + PKCE, opaque server session cookie, sealed tokens. */
export class AuthError extends Error {
  status: 401 | 403 | 503;
  code: 'expired' | 'denied' | 'unavailable' | 'invalid';
  constructor(status: 401 | 403 | 503, code: 'expired' | 'denied' | 'unavailable' | 'invalid') {
    super(code);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}
export const SESSION_COOKIE = 'clew-session';
export const LOGIN_COOKIE = 'clew-login';
export function authSettings() {
  const issuer = process.env.OIDC_ISSUER,
    clientId = process.env.OIDC_CLIENT_ID,
    secret = process.env.OIDC_CLIENT_SECRET;
  const publicUrl = process.env.PUBLIC_URL;
  if (!issuer || !clientId || !secret || !publicUrl) throw new AuthError(503, 'unavailable');
  const base = new URL(publicUrl),
    provider = new URL(issuer);
  const local =
    process.env.AUTH_LOCAL_HTTP === 'true' &&
    ['localhost', '127.0.0.1'].includes(base.hostname) &&
    provider.hostname === 'keycloak.orb.local';
  if (
    (!local && (base.protocol !== 'https:' || provider.protocol !== 'https:')) ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    base.username ||
    base.password ||
    provider.username ||
    provider.password
  )
    throw new AuthError(503, 'unavailable');
  return {
    issuer,
    clientId,
    secret,
    origin: base.origin,
    // The front ends an operator listed besides the public one (D67 item 6), each checked at start.
    origins: frontendOrigins(base.origin, process.env.FRONTEND_ORIGINS),
    local,
    callback: base.origin + '/api/auth/callback',
    // The ID token claim a first login is matched on (D68 item 6): the account name the provisioner sets as userName.
    bindingClaim: process.env.OIDC_BINDING_CLAIM ?? 'preferred_username',
  };
}
export function cookieOptions() {
  return { httpOnly: true, secure: !authSettings().local, sameSite: 'Lax' as const, path: '/' };
}
let discovered: { key: string; value: Promise<oidc.Configuration> } | undefined;
export async function oidcConfiguration() {
  const settings = authSettings();
  const key = settings.issuer + settings.clientId + tokenDigest(settings.secret);
  if (!discovered || discovered.key !== key) {
    const value = oidc
      .discovery(new URL(settings.issuer), settings.clientId, settings.secret, undefined, {
        execute: settings.local ? [oidc.allowInsecureRequests] : undefined,
        timeout: 5,
      })
      .then(config => {
        oidc.enableNonRepudiationChecks(config);
        return config;
      });
    discovered = { key, value };
    void value.catch(() => {
      if (discovered?.key === key) discovered = undefined;
    });
  }
  return discovered.value;
}
export async function beginLogin(returnTo: string | null) {
  const config = await oidcConfiguration(),
    settings = authSettings();
  const cookie = randomToken(),
    state = randomToken(),
    nonce = randomToken(),
    verifier = oidc.randomPKCECodeVerifier();
  await database()
    .insert(loginTransactions)
    .values({
      digest: tokenDigest(cookie),
      state,
      nonce,
      verifier,
      returnTo: localReturnTo(returnTo),
      expiresAt: new Date(Date.now() + LOGIN_TRANSACTION_MS),
    });
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: settings.callback,
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    prompt: 'login',
    max_age: '0',
    ui_locales: 'sv',
  });
  return { cookie, url };
}
export async function completeLogin(currentUrl: URL, cookie: string | undefined) {
  if (!cookie) throw new AuthError(401, 'invalid');
  const transaction = await consumeLogin(tokenDigest(cookie));
  if (!transaction) throw new AuthError(401, 'invalid');
  const config = await oidcConfiguration(),
    settings = authSettings();
  // The request reaches the BFF through the Vite proxy on another port. The callback is always the configured public URL.
  const callback = new URL(settings.callback);
  callback.search = currentUrl.search;
  const tokens = await oidc.authorizationCodeGrant(config, callback, {
    pkceCodeVerifier: transaction.verifier,
    expectedState: transaction.state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true,
    maxAge: 0,
  });
  const claims = tokens.claims();
  if (!claims || !tokens.refresh_token || !tokens.id_token || typeof claims.sub !== 'string')
    throw new AuthError(401, 'invalid');
  // A subject seen before is its person. A first login binds to the provisioned person whose userName equals the
  // configured claim (D68 item 6); no match, two matches or a changed subject is a denied login, never a new user.
  const claim = settings.bindingClaim,
    value = claims[claim];
  const access =
    (await resolveSubject(settings.issuer, claims.sub)) ??
    (typeof value === 'string' && value ? await bindFirstLogin(settings.issuer, claims.sub, claim, value) : undefined);
  if (!access) {
    await auditAuth('login-denied');
    throw new AuthError(403, 'denied');
  }
  const raw = randomToken(),
    digest = tokenDigest(raw),
    now = Date.now();
  await database().transaction(async tx => {
    await tx.insert(sessions).values({
      digest,
      personId: access.person.id,
      issuer: settings.issuer,
      subject: claims.sub,
      sid: typeof claims.sid === 'string' ? claims.sid : null,
      clientId: settings.clientId,
      csrf: randomToken(),
      tokens: encryptTokens(
        { access_token: tokens.access_token, refresh_token: tokens.refresh_token, id_token: tokens.id_token },
        digest,
      ),
      tokenExpiresAt: new Date(now + Math.min(tokens.expires_in ?? 60, 300) * 1000),
      idleExpiresAt: new Date(now + IDLE_MS),
      expiresAt: new Date(now + ABSOLUTE_MS),
    });
    await tx.insert(authenticationAudit).values({ action: 'login', actor: 'person:' + access.person.id });
  });
  return { cookie: raw, returnTo: transaction.returnTo };
}
async function refreshSession(row: SessionRecord): Promise<SessionRecord> {
  if (row.tokenExpiresAt.getTime() > Date.now() + 15_000) return row;
  try {
    const config = await oidcConfiguration();
    return await database().transaction(async tx => {
      // Row lock serializes refresh-token rotation across processes and simultaneous tabs.
      const [current] = await tx.select().from(sessions).where(activeSession(row.digest)).for('update');
      if (!current) throw new AuthError(401, 'expired');
      if (current.tokenExpiresAt.getTime() > Date.now() + 15_000) return current;
      const previous = decryptTokens(current.tokens, current.digest);
      const tokens = await oidc.refreshTokenGrant(config, previous.refresh_token);
      const claims = tokens.claims();
      if (claims && claims.sub !== current.subject) throw new AuthError(401, 'invalid');
      const [updated] = await tx
        .update(sessions)
        .set({
          tokens: encryptTokens(
            {
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token ?? previous.refresh_token,
              id_token: tokens.id_token ?? previous.id_token,
            },
            current.digest,
          ),
          tokenExpiresAt: new Date(Date.now() + Math.min(tokens.expires_in ?? 60, 300) * 1000),
        })
        .where(activeSession(current.digest))
        .returning();
      if (!updated) throw new AuthError(401, 'expired');
      return updated;
    });
  } catch {
    delegation.forget(row.digest);
    await revokeSession(row.digest, 'refresh-failed');
    throw new AuthError(401, 'expired');
  }
}
/**
 * Delegation (D26): a connector that acts as the person gets a token bound to its own audience, by RFC 8693 token exchange at
 * the IdP from the session's access token. The subject token is read fresh (and refreshed under the same row lock as every
 * request); the IdP's answer is never logged, only its error code, at most once a minute per audience.
 */
const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const exchangeFailures = new Map<string, number>();
const delegation = delegationFor({
  clock: Date.now,
  async subjectToken(digest) {
    let row = await readSession(digest);
    if (!row) throw new AuthError(401, 'expired');
    if (!row.tokens) return undefined;
    row = await refreshSession(row);
    return decryptTokens(row.tokens, row.digest).access_token;
  },
  async exchange(subject, audience) {
    const config = await oidcConfiguration();
    try {
      const r = await oidc.genericGrantRequest(config, TOKEN_EXCHANGE, {
        subject_token: subject,
        subject_token_type: ACCESS_TOKEN_TYPE,
        requested_token_type: ACCESS_TOKEN_TYPE,
        audience,
        scope: audience + '-audience',
      });
      return {
        access_token: r.access_token,
        ...(typeof r.expires_in === 'number' ? { expires_in: r.expires_in } : {}),
      };
    } catch (e) {
      const code = e instanceof oidc.ResponseBodyError ? e.error : e instanceof Error ? e.name : 'unknown';
      const last = exchangeFailures.get(audience) ?? 0;
      if (Date.now() - last > 60_000) {
        exchangeFailures.set(audience, Date.now());
        logger.error({ scope: 'auth', audience, code }, 'token exchange failed');
      }
      throw new AuthError(503, 'unavailable');
    }
  },
});
/** The exchanged token for a session and an audience, for `scripts/auth-exchange-check.ts`; the routes reach it through `context.delegate`. */
export const delegatedToken = (digest: string, audience: string) => delegation.token(digest, audience);
export type Session = Awaited<ReturnType<typeof authenticate>>;
export async function authenticate(raw: string | undefined) {
  if (!raw) throw new AuthError(401, 'expired');
  const digest = tokenDigest(raw),
    settings = authSettings();
  let row = await readSession(digest);
  if (!row) {
    await revokeSession(digest, 'expired');
    throw new AuthError(401, 'expired');
  }
  if (row.issuer !== settings.issuer || row.clientId !== settings.clientId) throw new AuthError(401, 'expired');
  row = await refreshSession(row);
  const access = await resolveSubject(row.issuer, row.subject);
  if (!access || access.person.id !== row.personId) {
    await revokeSession(digest, 'access-revoked');
    throw new AuthError(403, 'denied');
  }
  const version = authorizationVersion(access);
  const context: AuthenticatedContext = {
    id: access.person.id,
    name: access.person.name,
    unitId: access.grant.unitId,
    unitLabel: access.grant.unitLabel,
    role: access.grant.role,
    ...(access.person.userName ? { userName: access.person.userName } : {}),
    organisationId: access.person.organisationId,
    principal: { id: 'person:' + access.person.id, kind: 'person' },
    capabilities: access.grant.capabilities,
    groups: await readGroups(access.person.id),
    authorizationVersion: version,
    sessionBinding: digest,
    expiresAt: new Date(Math.min(row.idleExpiresAt.getTime(), row.expiresAt.getTime())).toISOString(),
    async authorize() {
      const current = await readSession(digest),
        latest = await resolveSubject(row.issuer, row.subject);
      if (!current) throw new AuthError(401, 'expired');
      if (!latest || latest.person.id !== row.personId || authorizationVersion(latest) !== version)
        throw new AuthError(403, 'denied');
      return { version };
    },
    delegate: audience => delegation.token(digest, audience),
  };
  return { context, csrfToken: row.csrf, sessionKey: digest.slice(0, 24) + version.slice(0, 16), row };
}
/** A mutation must come from the public origin or a listed front end (auth-origin.ts) and carry the session's CSRF token. */
export function verifyMutation(request: Request, csrf: string) {
  if (
    !authSettings().origins.includes(request.headers.get('origin') ?? '') ||
    !equalToken(request.headers.get('x-csrf-token') ?? '', csrf)
  )
    throw new AuthError(403, 'invalid');
}
export async function logout(raw: string | undefined) {
  if (!raw) return authSettings().origin + '/login';
  const digest = tokenDigest(raw);
  delegation.forget(digest);
  await revokeSession(digest);
  try {
    // Keycloak can ask for logout confirmation. Never send retained tokens through a browser URL.
    return oidc.buildEndSessionUrl(await oidcConfiguration(), {
      client_id: authSettings().clientId,
      post_logout_redirect_uri: authSettings().origin + '/login',
      ui_locales: 'sv',
    }).href;
  } catch {
    return authSettings().origin + '/login';
  }
}
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
async function keySet() {
  const config = await oidcConfiguration(),
    uri = config.serverMetadata().jwks_uri;
  if (!uri) throw new AuthError(401, 'invalid');
  return (jwks ??= createRemoteJWKSet(new URL(uri), { timeoutDuration: 5000, cooldownDuration: 0 }));
}
export async function receiveLogout(token: string) {
  const settings = authSettings();
  const { payload } = await jwtVerify(token, await keySet(), {
    issuer: settings.issuer,
    audience: settings.clientId,
    algorithms: ['RS256'],
    maxTokenAge: '5m',
    clockTolerance: 5,
  });
  const event = 'http://schemas.openid.net/event/backchannel-logout';
  if (
    typeof payload.jti !== 'string' ||
    !payload.events ||
    typeof payload.events !== 'object' ||
    !(event in payload.events) ||
    !((payload.events as Record<string, unknown>)[event] instanceof Object) ||
    Array.isArray((payload.events as Record<string, unknown>)[event]) ||
    'nonce' in payload ||
    (!payload.sid && !payload.sub) ||
    (payload.sid !== undefined && typeof payload.sid !== 'string') ||
    (payload.sub !== undefined && typeof payload.sub !== 'string')
  )
    throw new AuthError(401, 'invalid');
  await backchannelRevoke({
    issuer: settings.issuer,
    clientId: settings.clientId,
    sid: payload.sid as string | undefined,
    subject: payload.sub,
    jti: payload.jti,
  });
}
/** Session persistence the auth routes need, re-exported so routes never import the database package (D20). */
export { LOGIN_TRANSACTION_MS, readSession, revokeSession, touchSession } from '@clew/db/auth';
