import { describe, expect, test } from 'bun:test';
import { matchName, mentionedIn, namesIn, type ManagedPerson } from '../../apps/server/src/assistant/people';
import { asksForFigures, asksWhatToDo } from '../../apps/server/src/assistant/fixed';

/**
 * How a question's names are read (D115): among the people the asker manages and nobody else, a whole name in any case,
 * a single name only when written as one, several matches named back, and the router's figure rule kept to questions
 * about the figures.
 */
const person = (key: string, name: string): ManagedPerson => ({ key, name, unit: 'Skönsmons skola' });
const people = [
  person('anna', 'Anna Lindqvist'),
  person('karin', 'Karin Lindqvist'),
  person('maria', 'Maria Källström'),
  person('maria.eriksson', 'Maria Eriksson'),
  person('per', 'Per Lindahl'),
  person('aisha', 'Aisha El Amin'),
];
const who = (found: ReturnType<typeof matchName>) =>
  found.match === 'one' ? found.person.name : found.match === 'several' ? found.people.map(p => p.name) : null;

describe('a name as the asker wrote it', () => {
  test('the whole name, else the first name, else the family name decides, without regard to case', () => {
    expect(who(matchName(people, 'Anna'))).toBe('Anna Lindqvist');
    expect(who(matchName(people, 'anna lindqvist'))).toBe('Anna Lindqvist');
    expect(who(matchName(people, '  ANNA   Lindqvist '))).toBe('Anna Lindqvist');
    expect(who(matchName(people, 'Lindqvist'))).toEqual(['Anna Lindqvist', 'Karin Lindqvist']);
    expect(who(matchName(people, 'Maria'))).toEqual(['Maria Eriksson', 'Maria Källström']);
    expect(who(matchName(people, 'El Amin'))).toBe('Aisha El Amin');
    expect(who(matchName(people, 'Amin'))).toBe('Aisha El Amin');
    // A Swedish genitive is read as the name when the word names nobody as written.
    expect(who(matchName(people, 'Annas'))).toBe('Anna Lindqvist');
    expect(who(matchName(people, 'Olle'))).toBeNull();
    expect(who(matchName(people, ''))).toBeNull();
    expect(who(matchName(people, 'a'.repeat(201)))).toBeNull();
  });
});

describe('the names a question writes', () => {
  const read = (text: string) => namesIn(people, text).map(n => [n.written, who(n.found)]);
  test('a capitalised name or a whole name in any case; the words of a question are not names', () => {
    expect(read('Anna har varit sjuk i två veckor, vad gör jag?')).toEqual([['Anna', 'Anna Lindqvist']]);
    expect(read('vad gör jag när anna lindqvist är sjuk?')).toEqual([['anna lindqvist', 'Anna Lindqvist']]);
    expect(read('hur ser frånvaron ut per person?')).toEqual([]);
    expect(read('anna har varit sjuk')).toEqual([]);
    expect(read('Hur ser sjukfrånvaron ut?')).toEqual([]);
    expect(read('Annas sjukfrånvaro, vad gör jag?')).toEqual([['Annas', 'Anna Lindqvist']]);
  });
  test('several matches are named back; a name in a run names one person or nobody', () => {
    expect(read('Maria är sjuk igen')).toEqual([['Maria', ['Maria Eriksson', 'Maria Källström']]]);
    expect(read('Vad gör jag när Maria Källström är sjuk?')).toEqual([['Maria Källström', 'Maria Källström']]);
    expect(read('Jag pratade med Anna Svensson i går.')).toEqual([]);
    expect(read('Boka Anna på torsdag.')).toEqual([['Anna', 'Anna Lindqvist']]);
    expect(read('Anna och Per är sjuka.')).toEqual([
      ['Anna', 'Anna Lindqvist'],
      ['Per', 'Per Lindahl'],
    ]);
    // One person once, by the first name that resolved to them.
    expect(read('Anna är sjuk. Anna Lindqvist alltså.')).toEqual([['Anna Lindqvist', 'Anna Lindqvist']]);
  });
  test('the people the asker’s own words could name, in any case and by any part: what is guarded', () => {
    expect(mentionedIn(people, ['anna är sjuk']).map(p => p.key)).toEqual(['anna']);
    expect(mentionedIn(people, ['hur ser frånvaron ut per person?']).map(p => p.key)).toEqual(['per']);
    expect(mentionedIn(people, ['Lindqvists']).map(p => p.key)).toEqual(['anna', 'karin']);
    expect(mentionedIn(people, ['Vem är på plats?'])).toEqual([]);
  });
});

describe('the figure rule is kept to the figures (D115)', () => {
  test('a question about the figures, never one that asks what to do or names someone', () => {
    expect(asksForFigures('hur ser sjukfrånvaron ut?', false)).toBe(true);
    expect(asksForFigures('hur ligger budgeten?', false)).toBe(true);
    expect(asksForFigures('vad gör jag åt sjukfrånvaron?', false)).toBe(false);
    expect(asksForFigures('anna har varit sjuk i två veckor', false)).toBe(false);
    expect(asksForFigures('hur är läget med anna?', true)).toBe(false);
    expect(asksWhatToDo('Vad ska jag göra?')).toBe(true);
    expect(asksWhatToDo('hur gör man')).toBe(true);
    expect(asksWhatToDo('vad behöver vi')).toBe(true);
    expect(asksWhatToDo('hur ska vinsten fördelas')).toBe(false);
  });
});
