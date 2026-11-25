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

type Node = {
  type: number;
  value?: unknown;
  pluralType?: 'cardinal' | 'ordinal';
  options?: Record<string, { value: Node[] }>;
  children?: Node[];
};
/**
 * What value each node of the message format's syntax tree takes (`TYPE` in `@formatjs/icu-messageformat-parser`):
 * a plain placeholder takes any text, a number and a plural take a number (an ordinal plural its own rules), a select
 * takes one of its words, a date or a time takes a date, and a tag takes a function. 0 is literal text and 7 a plural's
 * `#`, which name no argument.
 */
const VALUE: Record<number, string> = {
  1: 'text',
  2: 'number',
  3: 'date',
  4: 'date',
  5: 'select',
  6: 'number',
  8: 'tag',
};
/**
 * The arguments a message takes, each with the kind of value it takes ("count:number", "label:text"), whatever words
 * stand around them. A name that a message both formats and echoes as plain text inside it ("{lines} lines" under
 * `{lines, plural, ...}`) takes the formatted kind. A Swedish message that takes a count as plain text where the English
 * one formats it as a number, or a number where the English one has a select, formats Astryx's values wrongly; one that
 * writes a plural's count as `{chars, number}` takes the same number and is the same.
 */
function argumentsOf(message: string, locale: string): string[] {
  const kinds = new Map<string, Set<string>>();
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      const value = node.type === 6 && node.pluralType === 'ordinal' ? 'ordinal' : VALUE[node.type];
      if (value && typeof node.value === 'string')
        kinds.set(node.value, (kinds.get(node.value) ?? new Set()).add(value));
      for (const option of Object.values(node.options ?? {})) walk(option.value);
      if (node.children) walk(node.children);
    }
  };
  walk(new IntlMessageFormat(message, locale).getAst() as Node[]);
  return [...kinds]
    .map(([name, set]) => {
      const formatted = [...set].filter(k => k !== 'text');
      return `${name}:${(formatted.length ? formatted : ['text']).sort().join('+')}`;
    })
    .sort();
}

describe("Astryx's words in Swedish (WA-L11)", () => {
  test('every key of the English catalogue has a Swedish value', () => {
    const missing = Object.keys(english).filter(key => !catalogue[key]?.defaultMessage?.trim());
    expect(missing).toEqual([]);
  });

  test('each Swedish message parses and takes the English message’s placeholders, each taking the same kind of value', () => {
    const differ = Object.keys(english).filter(
      key =>
        argumentsOf(catalogue[key]!.defaultMessage, 'sv-SE').join() !==
        argumentsOf(english[key]!.defaultMessage, 'en').join(),
    );
    expect(differ).toEqual([]);
  });

  test('a placeholder of another kind is told apart from the same name', () => {
    expect(argumentsOf('{count, plural, one {# rad} other {# rader}}', 'sv-SE')).toEqual(['count:number']);
    expect(argumentsOf('{count, plural, other {{count} rader}}', 'sv-SE')).toEqual(['count:number']);
    expect(argumentsOf('{count, number} rader', 'sv-SE')).toEqual(['count:number']);
    expect(argumentsOf('{count} rader', 'sv-SE')).toEqual(['count:text']);
    expect(argumentsOf('{bounds, select, min {från {min}} other {}}', 'sv-SE')).toEqual(['bounds:select', 'min:text']);
    expect(argumentsOf('{n, selectordinal, one {#:a} other {#:e}}', 'sv-SE')).toEqual(['n:ordinal']);
    expect(argumentsOf('{when, date, long}', 'sv-SE')).toEqual(['when:date']);
    expect(argumentsOf('<b>{name}</b>', 'sv-SE')).toEqual(['b:tag', 'name:text']);
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
