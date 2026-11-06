import { describe, expect, test } from 'bun:test';
import { fieldLabels, fieldValue, hiddenFields } from '../../apps/web/src/components/panel-labels';
import { memoryState } from '../../packages/connectors/src/memory-state';
import { hrConnector } from '../../packages/connectors/src/mock/hr';
import { kommunikationConnector } from '../../packages/connectors/src/mock/kommunikation';
import { financeConnector } from '../../packages/connectors/src/mock/finance';
import { incidentsConnector } from '../../packages/connectors/src/mock/incidents';
import { payrollConnector } from '../../packages/connectors/src/mock/payroll';
import { timesheetConnector } from '../../packages/connectors/src/mock/timesheet';

type Schema = { properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[] };
const keys = (schema: Schema): string[] => [
  ...Object.entries(schema.properties ?? {}).flatMap(([key, value]) => [key, ...keys(value)]),
  ...(schema.items ? keys(schema.items) : []),
  ...(schema.anyOf ?? []).flatMap(keys),
];

describe('side panel labels (3.1.2)', () => {
  test('every field a connector returns has a Swedish name', () => {
    const state = memoryState();
    const connectors = [
      hrConnector(state),
      financeConnector(state),
      incidentsConnector(state),
      kommunikationConnector(state),
      payrollConnector(state),
      timesheetConnector(state),
    ];
    const fields = new Set(connectors.flatMap(m => m.capabilities.flatMap(c => keys(c.output as Schema))));
    expect(fields.size).toBeGreaterThan(20);
    expect([...fields].filter(key => !fieldLabels[key] && !hiddenFields.has(key))).toEqual([]);
  });
  test('values read as text', () => {
    expect(fieldValue(true)).toBe('Ja');
    expect(fieldValue('2026-11-04')).toBe('4 november 2026');
    expect(fieldValue(1234)).toBe('1\u00a0234');
    expect(fieldValue({ name: 'Sara Nyström', kind: 'short' })).toBe('Sara Nyström · sjuk');
    expect(
      fieldValue([
        { ref: 'x', title: 'En' },
        { ref: 'y', title: 'Två' },
      ]),
    ).toBe('En, Två');
  });
});
