import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { InputError, failure, privateHeaders, type Env } from '../context';
import { textOfAtMost } from '../bounded-body';
import { logger } from '../logging';
import { LinkRefusedError, LinkUnavailableError } from '../modules/linked-accounts/contracts';
import type { LinkedAccounts } from '../modules/linked-accounts/usecases';

/**
 * A person's linked accounts (D147), mounted under `/api/linked-accounts` behind the session guard. Thin: parse, call
 * one use case, map its refusals.
 *
 * - `GET /` lists the person's links, never a token.
 * - `POST /:connector/link` starts linking and answers the address of the system's authorization page; the page then
 *   leaves for it in the same tab. A post, so that it carries the session's CSRF token and no other site can start it.
 * - `GET /callback` is where the system returns the person. It finishes the link and redirects to the page they left,
 *   with `account=linked`, `account=declined` or `account=failed` and, when it is known, `system=<connector id>` for the
 *   page to say what happened.
 * - `DELETE /:connector` takes the link away and says whether the system could be told.
 */
const CONNECTOR_ID = /^[a-z][a-z0-9-]{0,39}$/;
function connectorOf(c: Context<Env>) {
  const id = c.req.param('connector') ?? '';
  if (!CONNECTOR_ID.test(id)) throw new InputError('Ogiltig förfrågan.');
  return id;
}
/** Where the person is sent after the return: their page, or the start page, with what happened in the address. */
function landing(returnTo: string, outcome: 'linked' | 'declined' | 'failed', connectorId?: string) {
  const url = new URL(returnTo, 'https://clew.invalid');
  url.searchParams.set('account', outcome);
  if (connectorId) url.searchParams.set('system', connectorId);
  return url.pathname + url.search + url.hash;
}
/**
 * The person is told that linking did not work, in words that say nothing of why; the log says why, by its code, so
 * whoever runs the installation can tell an unapproved system from one whose server moved or cannot be reached.
 */
function refused(error: LinkRefusedError | LinkUnavailableError) {
  logger.warn({ scope: 'linked-accounts', code: error.code, reason: error.reason }, 'linking refused');
}
function linkFailure(c: Context<Env>, error: unknown) {
  if (error instanceof LinkRefusedError) {
    refused(error);
    return c.json(
      { error: error.message, code: error.code },
      error.reason === 'unknown-connector' ? 404 : 400,
      privateHeaders,
    );
  }
  if (error instanceof LinkUnavailableError) {
    refused(error);
    return c.json({ error: error.message, code: error.code }, 503, privateHeaders);
  }
  return failure(c, error);
}
export function linkedAccountRoutes(
  links: Pick<LinkedAccounts, 'list' | 'begin' | 'complete' | 'unlink'>,
  /** Who is signed in, for a test: the API mounts these routes behind its own session guard. */
  guard?: MiddlewareHandler<Env>,
) {
  const routes = new Hono<Env>();
  if (guard) routes.use('*', guard);
  routes.onError((error, c) => linkFailure(c, error));
  routes.get('/', async c => c.json({ links: await links.list(c.get('session').context) }, 200, privateHeaders));
  routes.get('/callback', async c => {
    try {
      const done = await links.complete(c.get('session').context, c.req.url);
      return c.redirect(landing(done.returnTo, done.linked ? 'linked' : 'declined', done.connectorId), 303);
    } catch (error) {
      // The person is at a page of their own again whatever went wrong; the page says that it did.
      if (error instanceof LinkRefusedError || error instanceof LinkUnavailableError) {
        refused(error);
        return c.redirect(landing('/', 'failed', 'connectorId' in error ? error.connectorId : undefined), 303);
      }
      throw error;
    }
  });
  routes.post('/:connector/link', async c => {
    const connectorId = connectorOf(c);
    const text = await textOfAtMost(c.req.raw, 4096);
    if (text === undefined) throw new InputError('För stor förfrågan.');
    let returnTo: unknown;
    try {
      returnTo = text ? (JSON.parse(text) as { returnTo?: unknown })?.returnTo : undefined;
    } catch {
      throw new InputError('Ogiltig förfrågan.');
    }
    if (returnTo !== undefined && typeof returnTo !== 'string') throw new InputError('Ogiltig förfrågan.');
    return c.json(await links.begin(c.get('session').context, connectorId, returnTo), 200, privateHeaders);
  });
  routes.delete('/:connector', async c =>
    c.json(await links.unlink(c.get('session').context, connectorOf(c)), 200, privateHeaders),
  );
  return routes;
}
