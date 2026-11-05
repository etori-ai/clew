import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { AuthError, authenticate, verifyMutation, SESSION_COOKIE, type Session } from './auth';
import { CalendarError } from '@clew/calendar/model';
import { ExecutionError } from './modules/executions/model';

export type Env = { Variables: { session: Session } };
export const privateHeaders = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
export class InputError extends Error { constructor(message: string) { super(message); this.name = 'InputError'; } }
/** The person is signed in but may not do this (an administrator's action without the grant capability). */
export class ForbiddenError extends Error { constructor(message = 'Du saknar behörighet för åtgärden.') { super(message); this.name = 'ForbiddenError'; } }

/** Every protected route: a live session from the opaque cookie; mutations also need same-origin and the per-session CSRF token. */
export function protectedRoute(): MiddlewareHandler<Env> {
  return async (c, next) => {
    try {
      const session = await authenticate(getCookie(c, SESSION_COOKIE));
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD') verifyMutation(c.req.raw, session.csrfToken);
      c.set('session', session);
      await next();
      for (const [key, value] of Object.entries(privateHeaders)) c.header(key, value);
    } catch (error) { return failure(c, error); }
  };
}
export function failure(c: Context, error: unknown) {
  if (error instanceof AuthError) {
    const message = error.status === 401 ? 'Din inloggning har gått ut. Logga in igen.' : error.status === 403 ? 'Du saknar behörighet för åtgärden.' : 'Tjänsten går inte att nå just nu.';
    return c.json({ error: message, code: error.code }, error.status, privateHeaders);
  }
  if (error instanceof ForbiddenError) return c.json({ error: error.message, code: 'denied' }, 403, privateHeaders);
  if (error instanceof CalendarError || error instanceof InputError || error instanceof ExecutionError) return c.json({ error: error.message }, 400, privateHeaders);
  console.error(error);
  return c.json({ error: 'Något gick fel. Försök igen.' }, 503, privateHeaders);
}
