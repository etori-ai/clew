import { SEARCH_CONNECTOR, type Actor, type Capability, type Connector } from '@clew/connectors';
import { NewsInputSchema, NewsResultSchema, type NewsInput } from '@clew/contracts';
import type { NewsUsecases } from './usecases';

/**
 * The combined news list as part of Clew's core connector (D111, amended 2026-11-11): `clew.news` is the one news list
 * a person sees, the block "Nyheter" on Hem and "Alla nyheter", and the one news tool the model sees, whatever the
 * number of news sources. As with the errand list (D89) the registry joins this with the composite search under the
 * core connector's id, so neither module knows the other. The model reads how many rows there are, never the rows:
 * the person reads them in the view.
 *
 * `offered` says whether the person has a news source at all: without one the read is out of scope, and Hem draws no
 * block and the menu no row.
 */
export const NEWS_CAPABILITY = SEARCH_CONNECTOR + '.news';

export function newsCapabilities(
  news: NewsUsecases,
  offered: (actor: Actor) => boolean,
): Pick<Connector, 'capabilities'> {
  const list: Capability<NewsInput> = {
    name: NEWS_CAPABILITY,
    kind: 'read',
    title: 'Nyheter',
    model: true,
    description:
      'De senaste nyheterna från alla anslutna nyhetskällor som personen får läsa, nyast först: rubrik, avsändare och när de publicerades.',
    input: NewsInputSchema,
    output: NewsResultSchema,
    scope: offered,
    menu: { label: 'Nyheter', icon: 'book' },
    view: {
      kind: 'list',
      title: 'title',
      ref: 'ref',
      modelReads: 'summary',
      noun: { one: 'nyhet', other: 'nyheter' },
      empty: 'Inga nyheter just nu.',
      fields: [
        { key: 'title', label: 'Rubrik' },
        { key: 'sender', label: 'Avsändare' },
        { key: 'publishedAt', label: 'Publicerad', format: 'date' },
        { key: 'link', label: 'Läs i källan', format: 'link' },
      ],
    },
    run: (actor, _input, clew) => news.list(actor, clew.call),
  };
  return { capabilities: [list as Capability] };
}
