import { describe, expect, test } from 'bun:test';
import { START_WORDS, STEP_WORDS, swedishQuotes } from '../../apps/web/src/pages/protocol-preview-model';

/**
 * The English preview names words of Clew's Swedish interface in quotation marks; those words, and only those, are the
 * parts the page marks `lang="sv"` (3.1.2, WA-L13).
 */
describe('Swedish words quoted in the English preview (WA-L13)', () => {
  test('a quoted word is a Swedish part; the quotation marks and the rest stay English', () => {
    expect(swedishQuotes('A suggestion under “Menar du”')).toEqual([
      { text: 'A suggestion under “', swedish: false },
      { text: 'Menar du', swedish: true },
      { text: '”', swedish: false },
    ]);
    expect(swedishQuotes('“Uppgifter”, the first step')).toEqual([
      { text: '“', swedish: false },
      { text: 'Uppgifter', swedish: true },
      { text: '”, the first step', swedish: false },
    ]);
    expect(swedishQuotes('No Swedish here')).toEqual([{ text: 'No Swedish here', swedish: false }]);
    // A quotation mark left open is English text, not a Swedish part that never ends.
    expect(swedishQuotes('An open “quote')).toEqual([{ text: 'An open “quote', swedish: false }]);
  });

  test('every word of the interface the tables name is quoted, so none is read as English', () => {
    const sentences = [
      ...Object.values(START_WORDS).flatMap(w => [w.where, w.draws]),
      ...Object.values(STEP_WORDS).flatMap(w => [w.name, w.what, w.drawn]),
    ];
    const swedish = sentences.flatMap(s =>
      swedishQuotes(s)
        .filter(p => p.swedish)
        .map(p => p.text),
    );
    expect(swedish).toEqual(['Personal', 'Menar du', 'Uppgifter', 'Det här händer', 'Händelser']);
    // What is left outside the quotation marks has no Swedish letters in it.
    for (const s of sentences)
      for (const part of swedishQuotes(s).filter(p => !p.swedish)) expect(part.text).not.toMatch(/[åäöÅÄÖ]/);
  });
});
