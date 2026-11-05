import { createHmac } from 'node:crypto';
import type { PanelViewSpec, SearchResult, View } from '@clew/contracts';
import { createConnector, manifest } from '../../connectors/telefonbok/connector.mjs';
import { user } from './data';

/**
 * The phone book connector itself (D38), answering the mocked `/api/cap/telefonbok.*` the way Clew's server would: the
 * real connector on its made-up organisation is called over the protocol with a signed assertion, and its own manifest
 * supplies the view. So the suite draws what the connector really declares, not a copy of it.
 */
const secret = 'a11y-secret-a11y-secret';
const service = createConnector({ secret });
const capabilities = (manifest as { capabilities: Array<{ name: string; view?: View }> }).capabilities;
const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
function assertion() {
  const body = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ iss: 'clew', aud: 'telefonbok', sub: user.id, actor: user, exp: Math.floor(Date.now() / 1000) + 120 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export async function telefonbok(name: string, input: unknown): Promise<{ status: number; body: { output: unknown; view?: PanelViewSpec } | { error: string } }> {
  const response = await service.handle(new Request(`http://telefonbok/clew/capabilities/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + assertion() }, body: JSON.stringify({ actor: user, input }) }));
  const answer = await response.json() as { output?: unknown; error?: { message: string } };
  if (answer.error) return { status: 400, body: { error: answer.error.message } };
  const view = capabilities.find(c => c.name === name)?.view;
  // What the registry adds for the browser: whose view it is, and that a row with a ref can be chipped (the connector is a search source).
  const spec = view ? { ...view, capability: name, connector: 'telefonbok', source: 'Telefonboken', chip: (view.kind === 'table' || view.kind === 'list') && !!view.ref } as PanelViewSpec : undefined;
  return { status: 200, body: { output: answer.output, ...(spec ? { view: spec } : {}) } };
}
/** The composite search when a name is typed: one person, with the contact card as the hit's view and no review date to miss. */
export const personSearch: SearchResult = {
  rows: [{ ref: 'person:p1003', connector: 'telefonbok', kind: 'person', label: 'Anna Lindqvist', snippet: 'Lärare · Bergsåkers skola', source: 'Telefonboken', link: 'https://telefonbok.kommun.example/personer/p1003', stale: null,
    view: { capability: 'telefonbok.person', input: { ref: 'person:p1003' }, title: 'Kontaktkort', source: 'Telefonboken' } }],
  sources: [{ id: 'telefonbok', source: 'Telefonboken', status: 'ok' }],
};
