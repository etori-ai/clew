import { SEARCH_CONNECTOR, type Actor, type Capability, type Connector } from '@clew/connectors';
import { RequestsInputSchema, RequestsResultSchema, type RequestsInput, type RequestsResult } from '@clew/contracts';
import { REQUEST_STATE_WORDS } from './domain';
import type { RequestUsecases } from './usecases';

/**
 * The combined request list as part of Clew's core connector (D123): `clew.requests` is the one list of what a person
 * ordered or reported and waits for, "Beställningar och felanmälningar" on Hem, and the one such tool the model sees,
 * whatever the number of service desks. It is kept apart from the errand list, which is for the people who handle
 * cases. As with the errand list (D89) the registry joins this with the composite search under the core connector's
 * id, so neither module knows the other.
 *
 * `offered` says whether the person has a source at all: without one the capability is out of scope, and with it the
 * area's button and the menu row.
 */
export const REQUESTS_CAPABILITY = SEARCH_CONNECTOR + '.requests';

export function requestCapabilities(
  requests: RequestUsecases,
  offered: (actor: Actor) => boolean,
): Pick<Connector, 'areas' | 'capabilities'> {
  const list: Capability<RequestsInput> = {
    name: REQUESTS_CAPABILITY,
    kind: 'read',
    title: 'Beställningar och felanmälningar',
    model: true,
    description:
      'Det personen har beställt eller felanmält och väntar på, i alla anslutna system för beställningar och felanmälningar, till exempel IT-servicedesken: nummer, typ, status, när det beräknas klart och system. Det som väntar på personen först. Aldrig rubrik, beskrivning eller namn.',
    input: RequestsInputSchema,
    output: RequestsResultSchema,
    scope: offered,
    menu: { label: 'Mina beställningar', icon: 'clock' },
    view: {
      kind: 'list',
      title: 'label',
      ref: 'ref',
      modelReads: 'summary',
      noun: { one: 'beställning eller felanmälan', other: 'beställningar och felanmälningar' },
      empty: 'Du har inga beställningar eller felanmälningar här.',
      fields: [
        { key: 'label', label: 'Beställning eller felanmälan' },
        // The shared state as a badge, in Clew's words for it (`REQUEST_STATE_WORDS`, given on the rows below), the
        // same in every system: only what waits on the person has a tone, the rest are neutral, as the talks round draws
        // its states (D96).
        {
          key: 'state',
          label: 'Läge',
          format: 'status',
          tones: {
            [REQUEST_STATE_WORDS['waiting-on-me']]: 'warn',
            [REQUEST_STATE_WORDS.new]: 'none',
            [REQUEST_STATE_WORDS.active]: 'none',
            [REQUEST_STATE_WORDS.closed]: 'none',
          },
        },
        { key: 'status', label: 'Status' },
        { key: 'expectedAt', label: 'Beräknas klar', format: 'date' },
        { key: 'system', label: 'System' },
        { key: 'since', label: 'Registrerad', format: 'date' },
      ],
    },
    // The list in the order the shared state gives, each row's state then said in Clew's word for it.
    run: async (actor, _input, clew): Promise<RequestsResult> => {
      const list = await requests.list(actor, clew.call);
      return { ...list, rows: list.rows.map(row => ({ ...row, state: REQUEST_STATE_WORDS[row.state] })) };
    },
  };
  return {
    areas: [
      {
        id: 'requests',
        title: 'Beställningar och felanmälningar',
        icon: 'clock',
        roles: ['manager', 'employee'],
        standing: [REQUESTS_CAPABILITY],
        schedules: [],
        // Without a source there is nothing under the area, so the area is not there either.
        offered,
      },
    ],
    capabilities: [list as Capability],
  };
}
