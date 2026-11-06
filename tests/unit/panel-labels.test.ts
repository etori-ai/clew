import { describe, expect, test } from 'bun:test';
import { fieldLabels, fieldValue, hiddenFields } from '../../apps/web/src/components/panel-labels';
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
      { readToday: never, weekView: never, samtalStatus: never },
      { dayView: never, listRooms: never },
    );
    const fields = new Set(calendar.capabilities.flatMap(c => keys(c.output as Schema)));
    expect(fields).toContain('gaps');
    expect(fields).toContain('equipment');
    expect([...fields].filter(key => !fieldLabels[key] && !hiddenFields.has(key))).toEqual([]);
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
