import { SEARCH_CONNECTOR, type Actor, type Capability, type Connector } from '@clew/connectors';
import { ErrandsInputSchema, ErrandsResultSchema, type ErrandsInput } from '@clew/contracts';
import type { ErrandUsecases } from './usecases';

/**
 * The combined errand list as part of Clew's core connector (D35 item 4, D89): `clew.errands` is the one "Mina
 * ärenden" a person sees and the one errand tool the model sees, whatever the number of case systems. The registry
 * joins this with the composite search under the core connector's id, so neither module knows the other.
 *
 * `offered` says whether the person has a case system at all: without one the capability is out of scope, and with it
 * the area's button and the menu row.
 */
export const ERRANDS_CAPABILITY = SEARCH_CONNECTOR + '.errands';

export function errandCapabilities(
  errands: ErrandUsecases,
  offered: (actor: Actor) => boolean,
): Pick<Connector, 'areas' | 'capabilities'> {
  const list: Capability<ErrandsInput> = {
    name: ERRANDS_CAPABILITY,
    kind: 'read',
    title: 'Mina ärenden',
    model: true,
    description:
      'Personens öppna ärenden i alla anslutna ärendesystem samtidigt: tilldelade personen eller gruppen, eller anmälda av personen. Ärendenummer, typ, status och system; aldrig rubrik, beskrivning eller parter.',
    input: ErrandsInputSchema,
    output: ErrandsResultSchema,
    scope: offered,
    menu: { label: 'Mina ärenden', icon: 'document' },
    view: {
      kind: 'list',
      title: 'label',
      ref: 'ref',
      modelReads: 'summary',
      noun: { one: 'ärende', other: 'ärenden' },
      empty: 'Du har inga öppna ärenden här.',
      fields: [
        { key: 'label', label: 'Ärende' },
        { key: 'status', label: 'Status' },
        // Only the errand that waits on the person is given a tone.
        { key: 'waitingOn', label: 'Väntar på', format: 'status', tones: { Dig: 'warn' } },
        { key: 'dueAt', label: 'Senast', format: 'date' },
        { key: 'area', label: 'Område' },
        { key: 'system', label: 'System' },
        { key: 'since', label: 'Senast ändrat', format: 'date' },
      ],
      input: {
        filter: {
          key: 'view',
          label: 'Visa',
          options: [
            { value: 'assigned', label: 'Tilldelade mig eller min grupp' },
            { value: 'reported', label: 'Anmälda av mig' },
          ],
        },
      },
    },
    run: (actor, input, clew) => errands.list(actor, input, clew.call),
  };
  return {
    areas: [
      {
        id: 'arenden',
        title: 'Ärenden',
        icon: 'document',
        roles: ['manager', 'employee'],
        standing: [ERRANDS_CAPABILITY],
        schedules: [],
        // Without a case system there is nothing under the area, so the area is not there either.
        offered,
      },
    ],
    capabilities: [list as Capability],
  };
}
