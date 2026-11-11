import { SEARCH_CONNECTOR, type Actor, type Capability, type Connector } from '@clew/connectors';
import { AboutQuerySchema, AboutResultSchema, type AboutQuery } from '@clew/contracts';
import type { AboutUsecases } from './usecases';

/**
 * The read across sources about an entity as part of Clew's core connector (D97): `clew.about` is what Clew's own pages
 * ask when they list people or open one, whatever the number of sources. The registry joins this with the composite
 * search under the core connector's id, so neither module knows the other. It is not a model tool (D97 item 7) and has
 * no view of its own: each section carries the view its source declared.
 *
 * `offered` says whether any source about people answers for the person: without one the capability is out of scope.
 */
export const ABOUT_CAPABILITY = SEARCH_CONNECTOR + '.about';

export function aboutCapabilities(
  about: AboutUsecases,
  offered: (actor: Actor) => boolean,
): Pick<Connector, 'capabilities'> {
  const read: Capability<AboutQuery> = {
    name: ABOUT_CAPABILITY,
    kind: 'read',
    title: 'Om personen',
    model: false,
    description: 'Vad de anslutna källorna säger om personer du får se: en sektion per källa.',
    input: AboutQuerySchema,
    output: AboutResultSchema,
    scope: offered,
    run: (actor, input, clew) => about.read(actor, input, clew.call),
  };
  return { capabilities: [read as Capability] };
}
