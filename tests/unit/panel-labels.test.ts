import { describe, expect, test } from 'bun:test';
import { VALUE_WORDS } from '@clew/contracts';
import {
  counted,
  dayText,
  fieldLabels,
  fieldValue,
  hiddenFields,
  longDay,
  shortDay,
  statusWord,
} from '../../apps/web/src/components/panel-labels';
import { calendarConnector } from '../../apps/server/src/modules/calendar/connector';
import { fixtureConnectors } from '../fixture-connectors';

type Schema = { properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[]; oneOf?: Schema[] };
const keys = (schema: Schema): string[] => [
  ...Object.entries(schema.properties ?? {}).flatMap(([key, value]) => [key, ...keys(value)]),
  ...(schema.items ? keys(schema.items) : []),
  ...(schema.anyOf ?? []).flatMap(keys),
  ...(schema.oneOf ?? []).flatMap(keys),
];

describe('side panel labels (3.1.2)', () => {
  test('every field a fixture connector returns has a Swedish name', () => {
    const { connectors } = fixtureConnectors();
    const fields = new Set(connectors.flatMap(m => m.capabilities.flatMap(c => keys(c.output as Schema))));
    expect(fields.size).toBeGreaterThan(20);
    expect([...fields].filter(key => !fieldLabels[key] && !hiddenFields.has(key))).toEqual([]);
  });
  test("every field the calendar's reads return has a Swedish name too (D69, amended)", () => {
    const never = () => Promise.reject(new Error('not called'));
    const calendar = calendarConnector(
      { readToday: never, weekView: never },
      { dayView: never, listRooms: never, freeTimes: never },
    );
    const fields = new Set(calendar.capabilities.flatMap(c => keys(c.output as Schema)));
    expect(fields).toContain('gaps');
    expect(fields).toContain('equipment');
    expect([...fields].filter(key => !fieldLabels[key] && !hiddenFields.has(key))).toEqual([]);
  });
  test('a status field is one word: a bare yes or no takes the label, never "Ja · Ja" (D71)', () => {
    expect(statusWord('Kvitterad', true)).toBe('Kvitterad');
    expect(statusWord('Kvitterad', false)).toBe('Inte kvitterad');
    // A status stands alone, a badge or a word on its own: its first letter capitalised, one casing on every face of a
    // register (the review of 2026-11-13); the words are VALUE_WORDS, which the model reads as they are.
    expect(statusWord('Status', 'waiting-safety-rep')).toBe('Väntar på skyddsombud');
    expect(statusWord('Status', 'Att attestera')).toBe('Att attestera');
    // A source's own words are drawn as it wrote them: only Clew's own code words are capitalised.
    expect(statusWord('Nästa samtal', 'tors 12 nov')).toBe('tors 12 nov');
    expect(statusWord('Öppna', '3 öppna')).toBe('3 öppna');
    // A person in the round of development talks (D96 item 2).
    expect(['missing', 'booked', 'held'].map(state => statusWord('Status', state))).toEqual([
      'Saknas',
      'Bokat',
      'Hållet',
    ]);
    // Where a holding stands (D108 item 4), as the matrix, the search and the declared views all write it.
    expect(['expired', 'expiring', 'valid'].map(state => statusWord('Status', state))).toEqual([
      'Utgånget',
      'Går ut snart',
      'Giltigt',
    ]);
    expect(VALUE_WORDS.expired).toBe('utgånget');
  });
  test('a day is short in a row and long in a sentence or among a record’s facts, one rule', () => {
    expect(shortDay('2026-10-13')).toBe('13 okt. 2026');
    expect(longDay('2026-10-13')).toBe('13 oktober 2026');
    expect(dayText('2027-01-10', 'short')).toBe('10 jan. 2027');
    expect(shortDay('inget datum')).toBe('inget datum');
  });
  test("a count takes the view's noun, else rader; a unit follows its number (D71)", () => {
    expect(counted(3, { one: 'faktura', other: 'fakturor' })).toBe('3 fakturor');
    expect(counted(1, { one: 'faktura', other: 'fakturor' })).toBe('1 faktura');
    expect(counted(1)).toBe('1 rad');
    expect(counted(7)).toBe('7 rader');
    expect(counted(1200, { one: 'kr', other: 'kr' })).toBe('1\u00a0200 kr');
  });
  test('values read as text', () => {
    expect(fieldValue(true)).toBe('Ja');
    expect(fieldValue('2026-11-04')).toBe('4 november 2026');
    expect(fieldValue(1234)).toBe('1 234');
    expect(fieldValue({ name: 'Sara Nyström', kind: 'short' })).toBe('Sara Nyström · sjuk');
    expect(
      fieldValue([
        { ref: 'x', title: 'En' },
        { ref: 'y', title: 'Två' },
      ]),
    ).toBe('En, Två');
  });
});
