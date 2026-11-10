import { SEARCH_CONNECTOR, type Capability, type Connector } from '@clew/connectors';
import { HelpInputSchema, HelpOutputSchema, type HelpInput, type HelpOutput } from './contracts';
import type { HelpUsecases } from './usecases';

/**
 * The help as part of Clew's core connector (D97): `clew.help` is one read with a declared text view, so the card's
 * step, the person dialog, the menu and the question box all open the same thing in the panel. The registry joins it
 * with the search and the errand list under the core connector's id, so this module names no connector and imports no
 * other module (D20).
 */
export const HELP_CAPABILITY = SEARCH_CONNECTOR + '.help';
export const HELP_TITLE = 'Så fungerar Startsidan';

export function helpCapabilities(help: HelpUsecases): Pick<Connector, 'capabilities'> {
  const read: Capability<HelpInput, HelpOutput> = {
    name: HELP_CAPABILITY,
    kind: 'read',
    title: HELP_TITLE,
    model: true,
    description:
      'Hjälp och introduktion: vad personen kan göra här på Startsidan, hur frågerutan och korten fungerar, och vilka system, områden och verktyg personen har. Använd när personen undrar vad Startsidan är, vad man kan göra här, vill komma igång eller ber om hjälp med sidan.',
    input: HelpInputSchema,
    output: HelpOutputSchema,
    scope: () => true,
    menu: { label: 'Hjälp', icon: 'book' },
    // The text is shown, never paraphrased: the model is told that it is in the view (D38, D97 item 7).
    view: { kind: 'text', body: 'body', modelReads: 'summary' },
    run: actor => help.read(actor),
  };
  return { capabilities: [read as Capability] };
}
