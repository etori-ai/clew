import type { PanelViewSpec, RequestsResult } from '@clew/contracts';
import { requestCapabilities } from '../../apps/server/src/modules/requests/capabilities';
import { REQUEST_STATE_WORDS } from '../../apps/server/src/modules/requests/domain';
import { manifest as desk } from '../../connectors/servicedesk/manifest.mjs';

/**
 * What a person ordered or reported, as the server answers `clew.requests` (D123): rows from two service desks, each
 * with the view that opens it in its own system, and a third desk that did not answer. The list's view is the one the
 * core connector really declares, and the service desk's rows open the view the fixture connector `servicedesk` really
 * declares (`connectors/servicedesk/manifest.mjs`), so the suite draws the declarations and cannot drift from them. A
 * row's state is the word the requests module gives the shared state (`REQUEST_STATE_WORDS`), as the server answers it.
 */
const declared = requestCapabilities({ list: async () => ({ rows: [], systems: [], unanswered: [] }) }, () => true)
  .capabilities[0]!;
const deskView = (name: string) => desk.capabilities.find(c => c.name === name)!.view!;
/** What a service-desk row opens, as the desk's list declares it: the read and its title. */
const deskOpen = deskView('servicedesk.requests').open as { capability: string; title: string };
/** The panel's heading for one request: the title the desk's list gives what it opens. */
export const deskRequestTitle = deskOpen.title;
/** What the registry adds for the browser: whose view it is, and that its rows may open in another connector. */
export const requestsSpec = {
  ...declared.view!,
  capability: 'clew.requests',
  connector: 'clew',
  source: 'Startsidan',
  chip: false,
  rowViews: true,
} as PanelViewSpec;

const opens = (ref: string) => ({
  capability: deskOpen.capability,
  input: { ref },
  title: deskOpen.title,
  source: desk.source,
});
export const deskRequestRef = 'request:servicedesk:SD-26110042';
export const requestsOutput: RequestsResult = {
  rows: [
    {
      ref: deskRequestRef,
      label: 'SD-26110042 · Behörighet, Beställning',
      state: REQUEST_STATE_WORDS['waiting-on-me'],
      status: 'Väntar på ditt svar',
      since: '2026-11-10T08:12:00.000Z',
      connector: 'servicedesk',
      system: 'IT-servicedesken',
      view: opens(deskRequestRef),
    },
    {
      ref: 'request:servicedesk:SD-26100917',
      label: 'SD-26100917 · Dator, Beställning',
      state: REQUEST_STATE_WORDS.active,
      status: 'Under leverans',
      since: '2026-10-30T13:40:00.000Z',
      expectedAt: '2026-11-18',
      connector: 'servicedesk',
      system: 'IT-servicedesken',
      view: opens('request:servicedesk:SD-26100917'),
    },
    {
      ref: 'request:facilities:FJ-2026-0311',
      label: 'FJ-2026-0311 · Lokal, Felanmälan',
      state: REQUEST_STATE_WORDS.new,
      status: 'Mottagen',
      since: '2026-11-11T07:05:00.000Z',
      connector: 'facilities',
      system: 'Fastighetsjouren',
      view: {
        capability: 'facilities.request',
        input: { ref: 'request:facilities:FJ-2026-0311' },
        title: 'Felanmälan',
        source: 'Fastighetsjouren',
      },
    },
  ],
  systems: [
    { id: 'servicedesk', source: 'IT-servicedesken', status: 'ok' },
    { id: 'facilities', source: 'Fastighetsjouren', status: 'ok' },
    { id: 'hr', source: 'HR-servicedesken', status: 'timeout' },
  ],
  unanswered: ['HR-servicedesken'],
};

/** One request as `servicedesk.request` answers it, with the free text read live for the panel, under its declared view. */
export const deskRequestSpec = {
  ...deskView('servicedesk.request'),
  capability: 'servicedesk.request',
  connector: desk.id,
  source: desk.source,
  chip: false,
} as PanelViewSpec;
export const deskRequestOutput = {
  ref: deskRequestRef,
  label: 'SD-26110042 · Behörighet, Beställning',
  state: 'waiting-on-me',
  status: 'Väntar på ditt svar',
  since: '2026-11-10T08:12:00.000Z',
  group: 'Behörighetsadministration',
  title: 'Läsbehörighet till ekonomisystemets rapporter',
  description: 'Läsbehörighet till rapporterna för skolans kostnadsställe.',
  latest: 'Vilken enhet ska behörigheten gälla för? Svara i ärendet så går beställningen vidare.',
};
