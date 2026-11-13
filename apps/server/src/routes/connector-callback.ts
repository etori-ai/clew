import { Hono } from 'hono';
import { Value } from 'typebox/value';
import { CapabilityError, UNKNOWN, type Registry } from '@clew/connectors';
import { CallbackRequestSchema, type ProtocolErrorCode } from '@clew/connectors/protocol';
import type { AuthenticatedContext } from '@clew/contracts';
import { InputError, privateHeaders } from '../context';
import { AssertionError, type CallbackGrant } from '../connectors/authority';

/**
 * The one way back in for a remote connector (D21): run another connector's `read` or `propose` as the person the connector
 * is serving. The bearer is the assertion Clew issued for this call; identity is rebuilt from the person's grant, so
 * the connector cannot widen what the person could reach themselves. `execute` is refused, as for in-process connectors.
 * `routes/connectors.ts` serves it over the live registry; a test passes its own.
 */
export interface ConnectorCallbackDeps {
  /** The callback grant the bearer carries; throws `AssertionError` for one Clew did not issue. */
  verify(token: string): Promise<CallbackGrant>;
  /** The person as their current grant reads, for work this connector does for them; undefined without a grant. */
  person(id: string, connectorId: string): Promise<AuthenticatedContext | undefined>;
  /** The connectors and their governance, read again before the call. */
  refresh(): Promise<void>;
  registry: Pick<Registry, 'visible' | 'clewFor'>;
  /** A callback that failed for a reason that is not the caller's to know: logged, and answered 503. */
  failed(error: unknown, connectorId?: string): void;
}
const error = (code: string, message: string, status: 400 | 401 | 403 | 404 | 503) =>
  Response.json({ error: { code, message } }, { status, headers: privateHeaders });
/**
 * The status of each code, as the published contract gives it (`/api/connectors/call` in the connector OpenAPI
 * document): a target the person may not know of is `not-found`, exactly as one nobody registered (D23); the scope, an
 * execute and a target's refusal of the person are `denied`; input and a circular call are `invalid`; a target that is
 * down, or answers what Clew cannot verify, is `unavailable`.
 */
const STATUS = {
  invalid: 400,
  denied: 403,
  'not-found': 404,
  unavailable: 503,
  unknown: 503,
} as const satisfies Record<ProtocolErrorCode, 400 | 403 | 404 | 503>;
export function connectorCallback(deps: ConnectorCallbackDeps) {
  const { registry } = deps;
  const routes = new Hono();
  routes.post('/call', async c => {
    const header = c.req.header('authorization') ?? '';
    if (!header.startsWith('Bearer ')) return error('denied', 'Saknar behörighetsbevis.', 401);
    let assertion: CallbackGrant;
    try {
      assertion = await deps.verify(header.slice(7).trim());
    } catch (e) {
      if (!(e instanceof AssertionError)) deps.failed(e);
      return error('denied', 'Ogiltigt behörighetsbevis.', 401);
    }
    const text = await c.req.raw.text();
    if (text.length > 8000) return error('invalid', 'För stor förfrågan.', 400);
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      return error('invalid', 'Ogiltig förfrågan.', 400);
    }
    if (!Value.Check(CallbackRequestSchema, body)) return error('invalid', 'Ogiltig förfrågan.', 400);
    const persona = await deps.person(assertion.actor.id, assertion.connectorId);
    if (!persona) return error('denied', 'Okänd person.', 403);
    try {
      await deps.refresh();
      if (
        persona.unitId !== assertion.actor.unitId ||
        persona.role !== assertion.actor.role ||
        !registry.visible(persona, assertion.connectorId) ||
        !assertion.uses.includes(body.name)
      )
        return error('denied', 'Ogiltigt behörighetsbevis.', 403);
      const output = await registry
        .clewFor(persona, { chain: assertion.chain }, assertion.connectorId)
        .call(body.name, body.input ?? {});
      return c.json({ output }, 200, privateHeaders);
    } catch (e) {
      // The registry's refusals and a target's own answer carry the protocol's code (`CapabilityError`); one of Clew's
      // modules may refuse without one, or with the server's `InputError`, in Swedish for the person as on `/api/cap`.
      if (e instanceof CapabilityError || e instanceof InputError) {
        const code = (e instanceof CapabilityError && e.code) || (e.message === UNKNOWN ? 'not-found' : 'invalid');
        return error(code, e.message, STATUS[code]);
      }
      deps.failed(e, assertion.connectorId);
      return error('unavailable', 'Tjänsten går inte att nå just nu.', 503);
    }
  });
  return routes;
}
