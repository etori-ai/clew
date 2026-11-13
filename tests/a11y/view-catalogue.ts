import type { View, ViewEntry } from '@clew/contracts';
import { manifest as hr } from '../../connectors/hr/connector.mjs';
import { manifest as communication } from '../../connectors/communication/connector.mjs';
import { manifest as incidents } from '../../connectors/incidents/connector.mjs';
import { manifest as finance } from '../../connectors/finance/connector.mjs';
import { manifest as phonebook } from '../../connectors/phonebook/connector.mjs';
import { manifest as qlik } from '../../connectors/qlik/connector.mjs';
import { createManifest as supportmanagement } from '../../connectors/supportmanagement/connector.mjs';

type Manifest = { capabilities: Array<{ name: string; kind: string; title: string; view?: { kind: View['kind'] } }> };
const reads = (m: Manifest): ViewEntry[] =>
  m.capabilities
    .filter(c => c.kind === 'read')
    .map(c => ({ capability: c.name, title: c.title, ...(c.view ? { kind: c.view.kind } : {}) }));

/**
 * Every read the signed-in person may open (D116), as `/api/areas` lists them under `views`: the development stack's
 * fixture connectors from their own manifests, and Clew's own reads with the kinds they declare. It decides whether a
 * view opened on a page leads to the view's own page (a table, a list) or lies beside the page; a test that takes a
 * read away from the person removes it here.
 */
export const fixtureViews = (): ViewEntry[] => [
  ...[hr, communication, incidents, finance, phonebook, qlik, supportmanagement()].flatMap(m =>
    reads(m as unknown as Manifest),
  ),
  { capability: 'clew.search', title: 'Källor' },
  { capability: 'clew.errands', title: 'Mina ärenden', kind: 'list' },
  { capability: 'clew.requests', title: 'Beställningar och felanmälningar', kind: 'list' },
  { capability: 'servicedesk.request', title: 'Beställning', kind: 'detail' },
  { capability: 'clew.news', title: 'Nyheter', kind: 'list' },
  { capability: 'calendar.today', title: 'Dagens möten' },
  { capability: 'calendar.week', title: 'Hela veckan' },
  { capability: 'calendar.day', title: 'Dagen' },
  { capability: 'calendar.rooms', title: 'Mötesrum', kind: 'table' },
  { capability: 'talks.talks', title: 'Utvecklingssamtal', kind: 'table' },
  { capability: 'talks.commitments', title: 'Åtgärdspunkter', kind: 'list' },
  { capability: 'clew.talks', title: 'Utvecklingssamtal', kind: 'table' },
  { capability: 'clew.commitments', title: 'Åtgärdspunkter', kind: 'list' },
  // Clew's own page for its rows (`page`): the figure on Hem, a card and an answer's list lead to the matrix narrowed.
  {
    capability: 'competence.attention',
    title: 'Krav som inte uppfylls',
    kind: 'table',
    page: '/competence/matrix?only=attention',
  },
  { capability: 'competence.holdings', title: 'Mina kompetenser', kind: 'list' },
];
