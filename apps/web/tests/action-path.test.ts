import { describe, expect, test } from 'bun:test';
import type { ActionPath, Ask } from '@clew/contracts';
import {
  askProblem,
  askProblems,
  blockedText,
  clashes,
  dayWords,
  fillInLabel,
  firstStep,
  instantText,
  meetingEnd,
  meetingParts,
  meetingStart,
  opensDialog,
  refusalProperty,
  sentValues,
  slotText,
  stepsOf,
  valueText,
} from '../src/action-path';

/**
 * The action dialog's pure part (D111 item 10): which actions open it, where it opens, the answers checked in the
 * server's sentences, a refusal placed on its field, and the words for the values and the person's day. The HR fixture's
 * "Boka samtalet" and "Godkänn" as the server resolves their paths.
 */
const when: Ask = { kind: 'meeting', property: 'when', label: 'När', required: true, durationMinutes: 45 };
const place: Ask = { kind: 'text', property: 'place', label: 'Plats', required: false };
const message: Ask = { kind: 'long-text', property: 'message', label: 'Meddelande till medarbetaren', required: false };
const comment: Ask = { kind: 'long-text', property: 'comment', label: 'Kommentar till medarbetaren', required: false };
const from: Ask = { kind: 'date', property: 'from', label: 'Första frånvarodagen', required: true };
const kind: Ask = {
  kind: 'choice',
  property: 'kind',
  label: 'Typ',
  required: true,
  options: [
    { value: 'sick', label: 'Sjuk' },
    { value: 'vab', label: 'Vård av barn' },
  ],
};
const book: ActionPath = { asks: [when, place, message], effect: true, description: 'Registrerar ett omtankesamtal.' };
const approve: ActionPath = { asks: [comment], effect: false, description: 'Beslutar en ledighetsansökan.' };
const NOW = '2026-11-04T08:00:00.000Z';
const SLOT = '2026-11-05T12:15:00.000Z';

describe('which actions open the dialog', () => {
  test('one that asks, or says beforehand what it writes; a reviewed one keeps its review; the rest stay one press', () => {
    expect(opensDialog({ path: book })).toBe(true);
    expect(opensDialog({ path: { asks: [], effect: true, description: '' } })).toBe(true);
    expect(opensDialog({ path: approve })).toBe(true);
    expect(opensDialog({ path: { asks: [], effect: false, description: '' } })).toBe(false);
    expect(opensDialog({})).toBe(false);
    expect(opensDialog({ path: book, review: 'each' })).toBe(false);
  });
  test('"Uppgifter" only when something is asked, "Det här händer" always and last', () => {
    expect(stepsOf(book)).toEqual(['fill-in', 'effect']);
    expect(stepsOf({ asks: [], effect: true, description: '' })).toEqual(['effect']);
  });
});

describe('where the dialog opens', () => {
  test('a path that requires an answer opens at the fill-in; one that requires nothing at Det här händer', () => {
    expect(firstStep(book, {}, NOW)).toEqual({ step: 'fill-in', attempted: false });
    expect(firstStep(book, { when: SLOT }, NOW)).toEqual({ step: 'fill-in', attempted: false });
    // An approval with an optional comment is two presses: the button, then the dialog's own.
    expect(firstStep(approve, {}, NOW)).toEqual({ step: 'effect', attempted: false });
    expect(firstStep({ asks: [], effect: true, description: '' }, {}, NOW)).toEqual({
      step: 'effect',
      attempted: false,
    });
  });
  test("the caller's step wins (an assistant's draft), and an effect start whose values do not pass shows why", () => {
    expect(firstStep(approve, {}, NOW, 'fill-in')).toEqual({ step: 'fill-in', attempted: false });
    expect(firstStep(book, { when: SLOT }, NOW, 'effect')).toEqual({ step: 'effect', attempted: false });
    expect(firstStep(book, {}, NOW, 'effect')).toEqual({ step: 'fill-in', attempted: true });
    expect(firstStep(book, { when: '2026-11-01T08:00:00.000Z' }, NOW, 'effect')).toEqual({
      step: 'fill-in',
      attempted: true,
    });
  });
});

describe("the answers, checked in the server's sentences", () => {
  test('a required answer left empty, a time that has passed, a day that is not one, a value outside the choice', () => {
    expect(askProblem(when, '', NOW)).toBe('När behöver fyllas i.');
    expect(askProblem(when, '  ', NOW)).toBe('När behöver fyllas i.');
    expect(askProblem(when, 'i morgon', NOW)).toBe('När: välj en tid.');
    // An instant carries its offset, as the server's pattern asks.
    expect(askProblem(when, '2026-11-05T13:15', NOW)).toBe('När: välj en tid.');
    expect(askProblem(when, '2026-11-05T13:15:00+01:00', NOW)).toBeUndefined();
    expect(askProblem(when, '2026-11-04T07:00:00.000Z', NOW)).toBe('När: tiden har redan passerat.');
    expect(askProblem(when, SLOT, NOW)).toBeUndefined();
    expect(askProblem(from, '5 nov', NOW)).toBe('Första frånvarodagen: välj ett datum.');
    expect(askProblem(from, '2026-11-05', NOW)).toBeUndefined();
    expect(askProblem(kind, 'semester', NOW)).toBe('Typ: välj ett av alternativen.');
    expect(askProblem(kind, 'vab', NOW)).toBeUndefined();
    // An optional answer left empty is no problem: it is not sent.
    expect(askProblem(place, '', NOW)).toBeUndefined();
    expect(askProblems(book.asks, { place: 'Rum 12' }, NOW)).toEqual([['when', 'När behöver fyllas i.']]);
  });
  test('what is sent: the asked properties only, a text trimmed, an empty optional answer left out', () => {
    expect(sentValues(book.asks, { when: SLOT, place: '  Rum 12 ', message: '   ', other: 'x' })).toEqual({
      when: SLOT,
      place: 'Rum 12',
    });
  });
});

describe('a refusal placed on the field it concerns', () => {
  test('by the label the sentence starts with, the longest first; any other sentence is the step’s', () => {
    expect(refusalProperty(book.asks, 'När: tiden har redan passerat.')).toBe('when');
    expect(refusalProperty(book.asks, 'Plats behöver fyllas i.')).toBe('place');
    expect(refusalProperty(book.asks, 'Meddelande till medarbetaren: högst 400 tecken.')).toBe('message');
    expect(refusalProperty(book.asks, 'Medarbetaren finns inte i din enhet.')).toBeUndefined();
    expect(refusalProperty(book.asks, 'Närvaron kunde inte läsas.')).toBeUndefined();
    const both: Ask[] = [when, { ...place, label: 'När och var' }];
    expect(refusalProperty(both, 'När och var behöver fyllas i.')).toBe('place');
  });
});

describe('the words the dialog says', () => {
  test('a value as Det här händer lists it, a free time as the choice says it', () => {
    expect(instantText(SLOT)).toBe('Torsdag 5 november 13:15');
    expect(valueText(when, SLOT)).toBe('Torsdag 5 november 13:15');
    expect(valueText(from, '2026-11-05')).toBe('Torsdag 5 november');
    expect(valueText(kind, 'vab')).toBe('Vård av barn');
    expect(valueText(place, ' Rum 12 ')).toBe('Rum 12');
    expect(slotText({ start: SLOT, end: '2026-11-05T13:00:00.000Z' })).toEqual({
      label: 'Torsdag 5 november 13:15',
      description: 'Du är ledig 13:15–14:00 enligt din kalender',
    });
  });
  test('"Annan tid" is one instant in Swedish time once the date and the clock make one', () => {
    expect(meetingStart('2026-11-05', '13:15')).toBe('2026-11-05T12:15:00Z');
    expect(meetingStart('2026-07-01', '09:00')).toBe('2026-07-01T07:00:00Z');
    expect(meetingStart('2026-11-05', undefined)).toBeUndefined();
    expect(meetingStart(undefined, '13:15')).toBeUndefined();
    // A time the clocks skip is no time.
    expect(meetingStart('2026-03-29', '02:30')).toBeUndefined();
    expect(meetingParts(SLOT)).toEqual({ date: '2026-11-05', time: '13:15' });
    expect(meetingEnd(SLOT, 45)).toBe('2026-11-05T13:00:00.000Z');
  });
  test("the person's day in words, with whether the chosen time is free", () => {
    const day = [
      { title: 'Planeringstid', start: '2026-11-05T08:00:00.000Z', end: '2026-11-05T10:00:00.000Z', allDay: false },
      { title: 'APT', start: '2026-11-05T14:00:00.000Z', end: '2026-11-05T15:30:00.000Z', allDay: false },
    ];
    expect(dayWords(day, { start: SLOT, end: '2026-11-05T13:00:00.000Z' })).toBe(
      'Du har Planeringstid 09:00–11:00 och APT 15:00–16:30. Den valda tiden 13:15–14:00 är ledig.',
    );
    const clash = { start: '2026-11-05T14:00:00.000Z', end: '2026-11-05T14:45:00.000Z' };
    expect(clashes(day, clash)).toEqual(['APT']);
    expect(dayWords(day, clash)).toBe(
      'Du har Planeringstid 09:00–11:00 och APT 15:00–16:30. Den valda tiden 15:00–15:45 krockar med APT.',
    );
    expect(dayWords([])).toBe('Du har inget inbokat.');
  });
  test('the way back to the fill-in says what it adds until something is filled in', () => {
    expect(fillInLabel(approve.asks, {})).toBe('Lägg till kommentar till medarbetaren');
    expect(fillInLabel(approve.asks, { comment: 'Trevlig jul!' })).toBe('Ändra');
    expect(fillInLabel([place, message], {})).toBe('Fyll i uppgifterna');
    expect(blockedText(1)).toBe('En uppgift ovan behöver rättas först.');
    expect(blockedText(2)).toBe('2 uppgifter ovan behöver rättas först.');
  });
});
