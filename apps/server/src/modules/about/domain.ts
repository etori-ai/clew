import { ABOUT_KEYS_MAX, type AboutSection } from '@clew/contracts';

/**
 * The rules of the read across sources about an entity (D97 item 7) as pure functions: which of the asked keys are
 * sent, and which of a source's rows are kept.
 */

/**
 * The keys a source is asked with: the asked ones the reader may see, each once, in the order asked, at most
 * `ABOUT_KEYS_MAX`. A key outside the reach is dropped without a word, so asking tells nobody whether it exists.
 */
export function askedKeys(keys: readonly string[], reach: ReadonlySet<string>): string[] {
  return [...new Set(keys)].filter(key => reach.has(key)).slice(0, ABOUT_KEYS_MAX);
}
/**
 * A source's rows as Clew keeps them: undefined when the source answered a key it was not asked with, or one key
 * twice, since a source that does either is broken and none of its rows can be trusted to be about whom they say.
 */
export function keptRows(rows: AboutSection['rows'], asked: readonly string[]): AboutSection['rows'] | undefined {
  const allowed = new Set(asked),
    seen = new Set<string>();
  for (const row of rows) {
    if (!allowed.has(row.key) || seen.has(row.key)) return undefined;
    seen.add(row.key);
  }
  return rows;
}
