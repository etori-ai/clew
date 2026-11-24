import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { swedish } from '../../packages/ui/src/locale';

/**
 * Astryx's own words reach a reader in Swedish (WA-L11): every key of Astryx's English catalogue has a Swedish value in
 * the catalogue the provider is handed, so no English fallback is left, and each Swedish message takes the same
 * placeholders as the English one, so Astryx's values land where they belong. An Astryx upgrade that adds a key fails
 * here until the key is translated.
 */
const ui = resolve(import.meta.dir, '../../packages/ui');
const englishPath = Bun.resolveSync('@astryxdesign/core/locales/en.json', ui);
const english = JSON.parse(readFileSync(englishPath, 'utf8')) as Record<string, { defaultMessage: string }>;
/** Astryx's own message formatter, reached through Astryx (it is not a dependency of the root). */
type Formatter = new (
  message: string,
  locale: string,
) => { getAst(): unknown; format(values?: Record<string, unknown>): unknown };
const { default: IntlMessageFormat } = (await import(Bun.resolveSync('intl-messageformat', dirname(englishPath)))) as {
  default: Formatter;
};
const catalogue = swedish as Record<string, { defaultMessage: string }>;

type Node = { type: number; value?: unknown; options?: Record<string, { value: Node[] }>; children?: Node[] };
/** The names a message's placeholders, plurals and selects take, whatever words stand around them. */
function argumentsOf(message: string, locale: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      // 0 is literal text and 7 a plural's `#`; every other node names an argument.
      if (node.type !== 0 && node.type !== 7 && typeof node.value === 'string') names.add(node.value);
      for (const option of Object.values(node.options ?? {})) walk(option.value);
      if (node.children) walk(node.children);
    }
  };
  walk(new IntlMessageFormat(message, locale).getAst() as Node[]);
  return [...names].sort();
}

describe("Astryx's words in Swedish (WA-L11)", () => {
  test('every key of the English catalogue has a Swedish value', () => {
    const missing = Object.keys(english).filter(key => !catalogue[key]?.defaultMessage?.trim());
    expect(missing).toEqual([]);
  });

  test('each Swedish message parses and takes the English message’s placeholders', () => {
    const differ = Object.keys(english).filter(
      key =>
        argumentsOf(catalogue[key]!.defaultMessage, 'sv-SE').join() !==
        argumentsOf(english[key]!.defaultMessage, 'en').join(),
    );
    expect(differ).toEqual([]);
  });

  test('the words the review found in English are Swedish', () => {
    const say = (key: string, values?: Record<string, unknown>) =>
      new IntlMessageFormat(catalogue['@astryx.' + key]!.defaultMessage, 'sv-SE').format(values) as string;
    expect(say('scrollRegion.label')).toBe('Innehåll');
    expect(say('dateInput.nonexistentDate', { named: 'no' })).toBe('Skriv ett datum som finns');
    expect(say('dateInput.outOfRangeDate', { bounds: 'min', min: '1 december 2026' })).toBe(
      'Skriv ett datum från och med 1 december 2026',
    );
    expect(say('dateInput.formatHint', { example: '2026-11-24' })).toBe('t.ex. 2026-11-24');
    expect(say('numberInput.invalidNumber')).toBe('Det är inte ett tal');
    expect(say('chat.pastedText.label', { lines: 3, chars: 450 })).toBe('3 rader, 450 tecken');
    expect(say('tokenizer.discardChangesTitle')).toBe('Släng ändringarna?');
  });
});
