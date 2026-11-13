import type { PanelViewSpec, RequestsResult } from '@clew/contracts';
import { requestCapabilities } from '../../apps/server/src/modules/requests/capabilities';

/**
 * What a person ordered or reported, as the server answers `clew.requests` (D123): rows from two service desks, each
 * with the view that opens it in its own system, and a third desk that did not answer. The list's view is the one the
 * core connector really declares, so the suite draws the declaration. No connector answers the profile yet, so the one
 * request's view is written here as a service desk would declare it.
 */
const declared = requestCapabilities({ list: async () => requestsOutput }, () => true).capabilities[0]!;
/** What the registry adds for the browser: whose view it is, and that its rows may open in another connector. */
export const requestsSpec = {
  ...declared.view!,
  capability: 'clew.requests',
  connector: 'clew',
  source: 'Startsidan',
  chip: false,
  rowViews: true,
} as PanelViewSpec;

const desk = (ref: string) => ({
  capability: 'servicedesk.request',
  input: { ref },
  title: 'Beställning',
  source: 'IT-servicedesken',
});
export const deskRequestRef = 'request:servicedesk:SD-26110042';
export const requestsOutput: RequestsResult = {
  rows: [
    {
      ref: deskRequestRef,
      label: 'SD-26110042 · Behörighet, Beställning',
      state: 'waiting-on-me',
      status: 'Väntar på ditt svar',
      since: '2026-11-10T08:12:00.000Z',
      connector: 'servicedesk',
      system: 'IT-servicedesken',
      view: desk(deskRequestRef),
    },
    {
      ref: 'request:servicedesk:SD-26100917',
      label: 'SD-26100917 · Dator, Beställning',
      state: 'active',
      status: 'Under leverans',
      since: '2026-10-30T13:40:00.000Z',
      expectedAt: '2026-11-18',
      connector: 'servicedesk',
      system: 'IT-servicedesken',
      view: desk('request:servicedesk:SD-26100917'),
    },
    {
      ref: 'request:facilities:FJ-2026-0311',
      label: 'FJ-2026-0311 · Lokal, Felanmälan',
      state: 'new',
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

/** One request as `servicedesk.request` would answer it, with the free text read live for the panel. */
export const deskRequestSpec = {
  kind: 'detail',
  title: 'label',
  fields: [
    { key: 'status', label: 'Status' },
    { key: 'expectedAt', label: 'Beräknas klar', format: 'date' },
    { key: 'since', label: 'Registrerad', format: 'date' },
    { key: 'title', label: 'Rubrik' },
    { key: 'description', label: 'Beskrivning' },
  ],
  capability: 'servicedesk.request',
  connector: 'servicedesk',
  source: 'IT-servicedesken',
  chip: false,
} as PanelViewSpec;
export const deskRequestOutput = {
  ref: deskRequestRef,
  label: 'SD-26110042 · Behörighet, Beställning',
  state: 'waiting-on-me',
  status: 'Väntar på ditt svar',
  since: '2026-11-10T08:12:00.000Z',
  title: 'Läsbehörighet till ekonomisystemets rapporter',
  description:
    'Servicedesken frågar vilken enhet behörigheten ska gälla för. Svara i ärendet så går beställningen vidare.',
};
