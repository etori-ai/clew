import type { MenuSource } from './source';
import { sitevisionSource } from './sitevision';
import { wordpressSource } from './wordpress';

/** The menu sources by name (D87): the only file that names them. A host chooses one by configuration. */
export const menuSources: Readonly<Record<string, MenuSource>> = {
  sitevision: sitevisionSource,
  wordpress: wordpressSource,
};

export function menuSource(name: string): MenuSource {
  const source = Object.hasOwn(menuSources, name) ? menuSources[name] : undefined;
  if (!source) throw new Error(`Unknown menu source "${name}"; known: ${Object.keys(menuSources).join(', ')}.`);
  return source;
}

export {
  absoluteHref,
  walkTree,
  withListing,
  type MenuSource,
  type MenuSourceRequest,
  type SourcePage,
} from './source';
