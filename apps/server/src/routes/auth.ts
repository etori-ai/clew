import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { LOGIN_TRANSACTION_MS, readSession, revokeSession, touchSession } from '../auth';
import { CAPABILITIES, sessionUser } from '@clew/contracts';
import {
  AuthError,
  authSettings,
  beginLogin,
  completeLogin,
  cookieOptions,
  devLogin,
  listDevAccounts,
  logout,
  receiveFrontChannelLogout,
  receiveLogout,
  verifyMutation,
  LOGIN_COOKIE,
  SESSION_COOKIE,
} from '../auth';
import { tokenDigest } from '../auth-crypto';
import { failureDetails } from '../auth-refresh';
import { protectedRoute, privateHeaders, type Env } from '../context';
import { logger } from '../logging';

/**
 * Sign-in and logout. A sign-in or logout that fails is answered as the person or the provider needs it, and said in
 * one log line with scope `auth` (L11 of the 2026-11-12 users review): what failed, never the error itself, whose cause
 * can carry the ID token's claims, nor the values of a statement that failed (`failureDetails`).
 */
export const authRoutes = new Hono<Env>();
authRoutes.get('/login', async c => {
  try {
    if (c.req.header('sec-fetch-site') === 'cross-site') return c.body(null, 403);
    const login = await beginLogin(c.req.query('returnTo') ?? null);
    setCookie(c, LOGIN_COOKIE, login.cookie, { ...cookieOptions(), maxAge: LOGIN_TRANSACTION_MS / 1000 });
    return c.redirect(login.url.href, 303);
  } catch (error) {
    // The provider or the database cannot be reached, or sign-in is not configured: nobody can sign in.
    logger.error({ scope: 'auth', failure: failureDetails(error) }, 'sign-in could not start');
    return c.redirect('/login?reason=unavailable', 303);
  }
});
authRoutes.get('/callback', async c => {
  const cookie = getCookie(c, LOGIN_COOKIE);
  deleteCookie(c, LOGIN_COOKIE, { path: '/' });
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  try {
    const result = await completeLogin(new URL(c.req.url), cookie);
    const old = getCookie(c, SESSION_COOKIE);
    if (old) await revokeSession(tokenDigest(old), 'replaced');
    setCookie(c, SESSION_COOKIE, result.cookie, { ...cookieOptions(), maxAge: 8 * 3600 });
    return c.redirect(result.returnTo, 303);
  } catch (error) {
    logger.warn({ scope: 'auth', failure: failureDetails(error) }, 'sign-in failed at the callback');
    return c.redirect('/login?reason=' + (error instanceof AuthError ? error.code : 'invalid'), 303);
  }
});
// Development sign-in (D6): the personas the sign-in page lists, and one click as one of them. 404 when it is off.
authRoutes.get('/dev', async c => {
  const accounts = await listDevAccounts();
  if (!accounts) return c.body(null, 404);
  c.header('Cache-Control', 'no-store');
  return c.json({ accounts });
});
authRoutes.get('/dev/login', async c => {
  if (c.req.header('sec-fetch-site') === 'cross-site') return c.body(null, 403);
  if (!(await listDevAccounts())) return c.body(null, 404);
  c.header('Cache-Control', 'no-store');
  try {
    const result = await devLogin(c.req.query('as') ?? '', c.req.query('returnTo') ?? null);
    const old = getCookie(c, SESSION_COOKIE);
    if (old) await revokeSession(tokenDigest(old), 'replaced');
    setCookie(c, SESSION_COOKIE, result.cookie, { ...cookieOptions(), maxAge: 8 * 3600 });
    return c.redirect(result.returnTo, 303);
  } catch (error) {
    return c.redirect('/login?reason=' + (error instanceof AuthError ? error.code : 'invalid'), 303);
  }
});
authRoutes.get('/session', protectedRoute(), c => {
  const session = c.get('session');
  // `admin` only decides whether the browser shows the entry point; every admin call is checked again on the server (D23).
  return c.json({
    user: sessionUser(session.context),
    admin: CAPABILITIES.some(c => session.context.capabilities.includes(c)),
    csrfToken: session.csrfToken,
    sessionKey: session.sessionKey,
    expiresAt: session.context.expiresAt,
  });
});
authRoutes.post('/activity', protectedRoute(), async c => {
  const row = await touchSession(c.get('session').row.digest);
  if (!row) return c.json({ error: 'Din inloggning har gått ut.', code: 'expired' }, 401, privateHeaders);
  return c.json({ expiresAt: new Date(Math.min(row.idleExpiresAt.getTime(), row.expiresAt.getTime())).toISOString() });
});
// Logout must not depend on refreshing an IdP token or retaining a local access grant.
authRoutes.post('/logout', async c => {
  try {
    const raw = getCookie(c, SESSION_COOKIE);
    // Any listed front end may sign out (D67 item 6): the portal's "Logga ut" was refused when only PUBLIC_URL was.
    if (!authSettings().origins.includes(c.req.header('origin') ?? '')) throw new AuthError(403, 'invalid');
    const session = raw ? await readSession(tokenDigest(raw)) : undefined;
    if (session) verifyMutation(c.req.raw, session.csrf);
    const url = await logout(raw);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ url }, 200, privateHeaders);
  } catch (error) {
    return c.json(
      { error: 'Utloggningen kunde inte bekräftas. Försök igen.' },
      error instanceof AuthError ? error.status : 503,
      privateHeaders,
    );
  }
});
authRoutes.post('/backchannel-logout', async c => {
  try {
    if (!c.req.header('content-type')?.startsWith('application/x-www-form-urlencoded')) throw new Error('Format');
    const body = await c.req.text();
    if (body.length > 16000) throw new Error('Limit');
    const token = new URLSearchParams(body).get('logout_token');
    if (!token) throw new Error('Missing');
    await receiveLogout(token);
    return c.body(null, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    logger.warn({ scope: 'auth', failure: failureDetails(error) }, 'back-channel logout refused');
    return c.json({ error: 'Ogiltig utloggning.' }, 400, { 'Cache-Control': 'no-store' });
  }
});
/**
 * OpenID Connect Front-Channel Logout 1.0 (D118): the identity provider loads this address in a cross-site frame when
 * the person signs out there, with `iss` and `sid` in the query (`receiveFrontChannelLogout`). No cookie reaches the
 * frame and the request changes nothing the person asked for, so nothing here asks for a session, an origin or a CSRF
 * token. The answer is empty and never cached; another issuer is refused with 400.
 */
authRoutes.get('/frontchannel-logout', async c => {
  try {
    await receiveFrontChannelLogout(c.req.query('iss'), c.req.query('sid'));
    return c.body(null, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    logger.warn({ scope: 'auth', failure: failureDetails(error) }, 'front-channel logout refused');
    return c.body(null, 400, { 'Cache-Control': 'no-store' });
  }
});
