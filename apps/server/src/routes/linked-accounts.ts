import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { LinkedAccountApprovalInput } from '@clew/contracts';
import { InputError, failure, privateHeaders, type Env } from '../context';
import { textOfAtMost } from '../bounded-body';
import { logger } from '../logging';
import { LinkRefusedError, LinkUnavailableError } from '../modules/linked-accounts/contracts';
import type { LinkedAccounts } from '../modules/linked-accounts/usecases';

/**
 * A person's linked accounts (D147), mounted under `/api/linked-accounts` behind the session guard. Thin: parse, call
 * one use case, map its refusals.
 *
 * - `GET /` lists every system the person can link an account at, with what its link is; never a token.
 * - `POST /later` puts off the systems the body names ("Inte nu"), so that Hem stops saying they need the account.
 * - `POST /:connector/link` starts linking and answers the address of the system's authorization page, which the page
 *   opens in a window of its own (or leaves for in the same tab, where the browser opens no window). A post, so that
 *   it carries the session's CSRF token and no other site can start it.
 * - `GET /callback` is where the system returns the person. It finishes the link and redirects to the address the
 *   link was started with (the window's return page, or the page they left), with `account=linked`,
 *   `account=declined` or `account=failed` and, when it is known, `system=<connector id>` for the page to say what
 *   happened. A link that cannot be placed (an unknown or outrun state, another person's) ends on the start page.
 * - `DELETE /:connector` takes the link away and says whether the system could be told.
 */
const CONNECTOR_ID = /^[a-z][a-z0-9-]{0,39}$/;
/** The most systems one "Inte nu" puts off: the line on Hem names every system it is about. */
const MAX_LATER = 20;
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
  links: Pick<LinkedAccounts, 'accounts' | 'later' | 'begin' | 'complete' | 'unlink'>,
  /** Who is signed in, for a test: the API mounts these routes behind its own session guard. */
  guard?: MiddlewareHandler<Env>,
) {
  const routes = new Hono<Env>();
  if (guard) routes.use('*', guard);
  routes.onError((error, c) => linkFailure(c, error));
  routes.get('/', async c => c.json({ accounts: await links.accounts(c.get('session').context) }, 200, privateHeaders));
  routes.post('/later', async c => {
    const text = await textOfAtMost(c.req.raw, 4096);
    let connectors: unknown;
    try {
      connectors = text ? (JSON.parse(text) as { connectors?: unknown })?.connectors : undefined;
    } catch {
      throw new InputError('Ogiltig förfrågan.');
    }
    if (
      !Array.isArray(connectors) ||
      connectors.length < 1 ||
      connectors.length > MAX_LATER ||
      !connectors.every((id): id is string => typeof id === 'string' && CONNECTOR_ID.test(id))
    )
      throw new InputError('Ogiltig förfrågan.');
    return c.json(await links.later(c.get('session').context, connectors), 200, privateHeaders);
  });
  routes.get('/callback', async c => {
    try {
      const done = await links.complete(c.get('session').context, c.req.url);
      return c.redirect(landing(done.returnTo, done.linked ? 'linked' : 'declined', done.connectorId), 303);
    } catch (error) {
      // The person is at a page of their own again whatever went wrong; the page says that it did.
      if (error instanceof LinkRefusedError || error instanceof LinkUnavailableError) {
        refused(error);
        // A link known to be the person's own fails where it was started; any other on the start page.
        const connectorId = error.finishing?.connectorId ?? ('connectorId' in error ? error.connectorId : undefined);
        return c.redirect(landing(error.finishing?.returnTo ?? '/', 'failed', connectorId), 303);
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

/** An address an administrator typed: text of a bounded length; what it must be is the use case's to say. */
const typed = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.length <= max;
/** The body of an approval, as `LinkedAccountApprovalInput`: nothing, a client, a server's addresses, or both. */
function approvalOf(text: string | undefined): LinkedAccountApprovalInput {
  if (text === undefined) throw new InputError('För stor förfrågan.');
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new InputError('Ogiltig förfrågan.');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new InputError('Ogiltig förfrågan.');
  const { client, server } = body as { client?: Record<string, unknown>; server?: Record<string, unknown> };
  const input: LinkedAccountApprovalInput = {};
  if (client !== undefined) {
    if (typeof client !== 'object' || client === null || !typed(client.id, 400))
      throw new InputError('Ogiltig förfrågan.');
    if (client.secret !== undefined && !typed(client.secret)) throw new InputError('Ogiltig förfrågan.');
    input.client = { id: client.id, ...(client.secret ? { secret: client.secret } : {}) };
  }
  if (server !== undefined) {
    if (
      typeof server !== 'object' ||
      server === null ||
      !typed(server.authorizationEndpoint) ||
      !typed(server.tokenEndpoint) ||
      (server.revocationEndpoint !== undefined && !typed(server.revocationEndpoint))
    )
      throw new InputError('Ogiltig förfrågan.');
    input.server = {
      authorizationEndpoint: server.authorizationEndpoint.trim(),
      tokenEndpoint: server.tokenEndpoint.trim(),
      ...(server.revocationEndpoint?.trim() ? { revocationEndpoint: server.revocationEndpoint.trim() } : {}),
    };
  }
  return input;
}
/** Why an approval could not be made, in the administrator's words: what the system did not give, and the way on. */
function approvalRefusal(error: LinkRefusedError | LinkUnavailableError): string {
  if (error instanceof LinkUnavailableError)
    return 'Systemet svarade inte när Clew frågade var personer loggar in. Försök igen om en stund.';
  if (error.reason === 'no-server') return 'Systemet uppger ingen inloggningsserver. Ange adresserna.';
  if (error.reason === 'unknown-connector') return 'Anslutningen låter inte personer koppla egna konton.';
  return 'Uppgifterna kunde inte godkännas. Kontrollera dem och försök igen.';
}

/**
 * A connector's linked account for its administrator (D147 items 3 and 4), mounted under `/api/admin/connectors`
 * behind the administration's guard; the use cases check the grant `admin.connectors` themselves.
 *
 * - `GET /:id/linked-account` answers what is approved, what the system names now and how many people have linked; null for a connector
 *   that declares no linked account. Never a secret or a person.
 * - `POST /:id/linked-account` approves: with an empty body the server the system names, with `client` a client the administrator
 *   registered there, with `server` the addresses of a system that names none.
 */
export function linkedAccountAdminRoutes(
  links: Pick<LinkedAccounts, 'overview' | 'approveEntered'>,
  /** Who is signed in, for a test: the administration mounts these routes behind its own guard. */
  guard?: MiddlewareHandler<Env>,
) {
  const routes = new Hono<Env>();
  if (guard) routes.use('*', guard);
  routes.onError((error, c) => {
    if (error instanceof LinkRefusedError || error instanceof LinkUnavailableError) {
      refused(error);
      return c.json(
        { error: approvalRefusal(error) },
        error instanceof LinkUnavailableError ? 503 : 400,
        privateHeaders,
      );
    }
    return failure(c, error);
  });
  const connector = (c: Context<Env>) => {
    const id = c.req.param('id') ?? '';
    if (!CONNECTOR_ID.test(id)) throw new InputError('Ogiltig förfrågan.');
    return id;
  };
  routes.get('/:id/linked-account', async c =>
    c.json({ account: await links.overview(c.get('session').context, connector(c)) }, 200, privateHeaders),
  );
  routes.post('/:id/linked-account', async c => {
    const input = approvalOf(await textOfAtMost(c.req.raw, 16_384));
    await links.approveEntered(c.get('session').context, connector(c), input);
    return c.json({ account: await links.overview(c.get('session').context, connector(c)) }, 200, privateHeaders);
  });
  return routes;
}
