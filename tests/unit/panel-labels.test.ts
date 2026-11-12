import { describe, expect, test } from 'bun:test';
import { counted, fieldLabels, fieldValue, hiddenFields, statusWord } from '../../apps/web/src/components/panel-labels';
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
    expect(statusWord('Status', 'waiting-safety-rep')).toBe('väntar på skyddsombud');
    expect(statusWord('Status', 'Att attestera')).toBe('Att attestera');
    // A person in the round of development talks (D96 item 2).
    expect(['missing', 'booked', 'held'].map(state => statusWord('Status', state))).toEqual([
      'saknas',
      'bokat',
      'hållet',
    ]);
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
