import type { ErrandsResult, PanelViewSpec, View } from '@clew/contracts';
import { errandCapabilities } from '../../apps/server/src/modules/errands/capabilities';
import { createManifest } from '../../connectors/supportmanagement/connector.mjs';

/**
 * The combined errand list as the server answers `clew.errands` (D35 item 4, D89): rows from two case systems, each
 * with the view that opens it in its own system, and a third system that did not answer. The views are the ones the
 * core connector and the SupportManagement connector really declare, so the suite draws the declarations.
 */
const declared = errandCapabilities({ list: async () => errandsOutput }, () => true).capabilities[0]!;
/** What the registry adds for the browser: whose view it is, and that its rows may open in another connector. */
export const errandsSpec = {
  ...declared.view!,
  capability: 'clew.errands',
  connector: 'clew',
  source: 'Startsidan',
  chip: false,
  rowViews: true,
} as PanelViewSpec;

const sm = (ref: string) => ({
  capability: 'sm.errand',
  input: { ref },
  title: 'Ärende',
  source: 'Ärendesystemet',
});
export const smErrandRef = 'errand:sm:0000:IK:a1f0c3d2-0001-4000-8000-000000000001';
export const errandsOutput: ErrandsResult = {
  rows: [
    {
      ref: smErrandRef,
      label: 'IK-26110007 · Behörighet, Beställning',
      state: 'waiting-on-me',
      status: 'Pågående',
      waitingOn: 'Dig',
      since: '2026-11-03T09:00:00.000Z',
      area: 'Intern kundtjänst',
      connector: 'sm',
      system: 'Ärendesystemet',
      view: sm(smErrandRef),
    },
    {
      ref: 'errand:permits:2026-000317',
      label: 'BYGG 2026-000317 · Bygglov, Komplettering',
      state: 'waiting-on-others',
      status: 'Väntar på sökande',
      waitingOn: 'Sökande',
      since: '2026-10-28T09:00:00.000Z',
      dueAt: '2026-11-12T09:00:00.000Z',
      area: 'Bygglov',
      connector: 'permits',
      system: 'Bygglovssystemet',
      view: {
        capability: 'permits.errand',
        input: { ref: 'errand:permits:2026-000317' },
        title: 'Ärende',
        source: 'Bygglovssystemet',
      },
    },
    {
      ref: 'errand:sm:0000:IK:a1f0c3d2-0004-4000-8000-000000000004',
      label: 'IK-26100031 · Behörighet, Beställning',
      state: 'waiting-on-others',
      status: 'Parkerat',
      waitingOn: 'Parkerat till 7 nov.',
      since: '2026-10-31T09:00:00.000Z',
      area: 'Intern kundtjänst',
      connector: 'sm',
      system: 'Ärendesystemet',
      view: sm('errand:sm:0000:IK:a1f0c3d2-0004-4000-8000-000000000004'),
    },
  ],
  systems: [
    { id: 'sm', source: 'Ärendesystemet', status: 'ok' },
    { id: 'permits', source: 'Bygglovssystemet', status: 'ok' },
    { id: 'social', source: 'Verksamhetssystemet', status: 'timeout' },
  ],
  unanswered: ['Verksamhetssystemet'],
};

/** One errand as `sm.errand` answers it, with the SupportManagement connector's own detail view. */
const smManifest = createManifest() as { capabilities: { name: string; view?: View }[] };
export const smErrandSpec = {
  ...smManifest.capabilities.find(c => c.name === 'sm.errand')!.view!,
  capability: 'sm.errand',
  connector: 'sm',
  source: 'Ärendesystemet',
  chip: false,
} as PanelViewSpec;
export const smErrandOutput = {
  ref: smErrandRef,
  label: 'IK-26110007 · Behörighet, Beställning',
  state: 'waiting-on-me',
  status: 'Pågående',
  waitingOn: 'Dig',
  since: '2026-11-03T09:00:00.000Z',
  area: 'Intern kundtjänst',
  title: 'Ny medarbetare behöver konto i elevregistret',
  description: 'Vikarien börjar på måndag och saknar inloggning. Beställningen gäller läsbehörighet.',
};
