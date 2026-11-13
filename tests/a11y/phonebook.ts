import type { MenuEntry, MenuHint, PanelViewSpec, SearchResult, View } from '@clew/contracts';
import { createConnector, manifest } from '../../connectors/phonebook/connector.mjs';
import { user } from './data';
import { assertionFor, testAuthority } from '../connector-authority';

/**
 * The phone book connector itself (D38), answering the mocked `/api/cap/phonebook.*` the way Clew's server would: the
 * real connector on its made-up organisation is called over the protocol with a signed assertion, and its own manifest
 * supplies the view. So the suite draws what the connector really declares, not a copy of it.
 */
const secret = 'a11y-secret-a11y-secret';
const service = createConnector({ secret, jwks: async () => (await testAuthority(secret)).jwks });
const capabilities = (manifest as { capabilities: Array<{ name: string; view?: View }> }).capabilities;
const assertion = assertionFor('phonebook', secret);
export async function phonebook(
  name: string,
  input: unknown,
): Promise<{ status: number; body: { output: unknown; view?: PanelViewSpec } | { error: string } }> {
  // Protocol 3 (D117): the assertion is bound to the exact body and the capability it is sent for.
  const body = JSON.stringify({ actor: user, input });
  const response = await service.handle(
    new Request(`http://phonebook/clew/capabilities/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Clew-Connector-Key': secret,
        authorization: 'Bearer ' + (await assertion(user, [], { body, capability: name })),
      },
      body,
    }),
  );
  const answer = (await response.json()) as { output?: unknown; error?: { message: string } };
  // The route answers "Okänd förmåga." raised while a capability runs as it answers a name nobody registered, a 404
  // (D23), and the connector's other refusals as a bad request.
  if (answer.error)
    return { status: answer.error.message === 'Okänd förmåga.' ? 404 : 400, body: { error: answer.error.message } };
  const view = capabilities.find(c => c.name === name)?.view;
  // What the registry adds for the browser: whose view it is, and that a row with a ref can be chipped (the connector is a search source).
  const spec = view
    ? ({
        ...view,
        capability: name,
        connector: 'phonebook',
        source: 'Telefonboken',
        chip: (view.kind === 'table' || view.kind === 'list') && !!view.ref,
      } as PanelViewSpec)
    : undefined;
  return { status: 200, body: { output: answer.output, ...(spec ? { view: spec } : {}) } };
}
/** The phone book's views as rows in the menu (D40), as the server hands them over once an administrator has chosen them: named by the real manifest, in alphabetical order. */
export const menuRows: MenuEntry[] = (
  manifest as { capabilities: Array<{ name: string; title: string; menu?: MenuHint }> }
).capabilities
  .filter(c => c.menu)
  .map(c => ({
    connector: 'phonebook',
    source: 'Telefonboken',
    capability: c.name,
    title: c.title,
    label: c.menu!.label,
    icon: c.menu!.icon,
  }))
  .sort((a, b) => a.label.localeCompare(b.label, 'sv'));
export const menuRow = menuRows.find(r => r.capability === 'phonebook.directory')!;
/** The composite search when a name is typed: one person, with the contact card as the hit's view and no review date to miss. */
export const personSearch: SearchResult = {
  rows: [
    {
      ref: 'person:p1003',
      connector: 'phonebook',
      kind: 'person',
      label: 'Anna Lindqvist',
      snippet: 'Lärare · Bergsåkers skola',
      source: 'Telefonboken',
      link: 'https://phonebook.kommun.example/personer/p1003',
      stale: null,
      view: {
        capability: 'phonebook.person',
        input: { ref: 'person:p1003' },
        title: 'Kontaktkort',
        source: 'Telefonboken',
      },
    },
  ],
  sources: [{ id: 'phonebook', source: 'Telefonboken', status: 'ok' }],
};
