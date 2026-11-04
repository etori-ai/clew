import { Hono } from 'hono';
import { Value } from '@sinclair/typebox/value';
import { CallbackRequestSchema } from '@clew/connectors/protocol';
import { InputError, privateHeaders } from '../context';
import { callFromConnector } from '../connectors/registry';
import { AssertionError, verifyAssertion } from '../connectors/remote';
import { systemContext } from '../system-context';

/**
 * The one way back in for a remote connector (D21): run another connector's `read` or `propose` as the person the connector
 * is serving. The bearer is the assertion Clew issued for this call; identity is rebuilt from the person's grant, so
 * the connector cannot widen what the person could reach themselves. `execute` is refused, as for in-process connectors.
 */
export const connectorRoutes = new Hono();
const error = (code: string, message: string, status: 400 | 401 | 403 | 404 | 503) => Response.json({ error: { code, message } }, { status, headers: privateHeaders });
connectorRoutes.post('/call', async c => {
  const header = c.req.header('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return error('denied', 'Saknar behörighetsbevis.', 401);
  let assertion: Awaited<ReturnType<typeof verifyAssertion>>;
  try { assertion = await verifyAssertion(header.slice(7).trim()); }
  catch (e) { if (!(e instanceof AssertionError)) console.error('connector callback', e); return error('denied', 'Ogiltigt behörighetsbevis.', 401); }
  const text = await c.req.raw.text(); if (text.length > 8000) return error('invalid', 'För stor förfrågan.', 400);
  let body: unknown; try { body = text ? JSON.parse(text) : {}; } catch { return error('invalid', 'Ogiltig förfrågan.', 400); }
  if (!Value.Check(CallbackRequestSchema, body)) return error('invalid', 'Ogiltig förfrågan.', 400);
  const persona = await systemContext(assertion.actor.id, 'connector:' + assertion.connectorId);
  if (!persona) return error('denied', 'Okänd person.', 403);
  try { return c.json({ output: await callFromConnector(persona, body.name, body.input ?? {}) }, 200, privateHeaders); }
  catch (e) {
    if (e instanceof InputError) return error(e.message === 'Okänd förmåga.' ? 'not-found' : /behörighet|annan modul/.test(e.message) ? 'denied' : 'invalid', e.message, e.message === 'Okänd förmåga.' ? 404 : 400);
    console.error('connector callback', assertion.connectorId, e);
    return error('unavailable', 'Tjänsten går inte att nå just nu.', 503);
  }
});
