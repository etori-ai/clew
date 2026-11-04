import { describe, expect, test } from 'bun:test';
import { fieldLabels, fieldValue, hiddenFields, rowView } from '../../apps/web/src/components/panel-labels';
import { memoryState } from '../../packages/modules/src/memory-state';
import { heromaModule } from '../../packages/modules/src/mock/heroma';
import { kommunikationModule } from '../../packages/modules/src/mock/kommunikation';
import { raindanceModule } from '../../packages/modules/src/mock/raindance';
import { treservaModule } from '../../packages/modules/src/mock/treserva';
import { mockSupportManagement } from '../../packages/errands/src/mock-support-management';
import { errandModule } from '../../apps/server/src/errand-module';

type Schema = { properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[] };
const keys = (schema: Schema): string[] => [
  ...Object.entries(schema.properties ?? {}).flatMap(([key, value]) => [key, ...keys(value)]),
  ...(schema.items ? keys(schema.items) : []),
  ...(schema.anyOf ?? []).flatMap(keys),
];

describe('side panel labels (3.1.2)', () => {
  test('every field a module returns has a Swedish name', () => {
    const state = memoryState();
    const modules = [heromaModule(state), raindanceModule(state), treservaModule(state), kommunikationModule(state), errandModule(mockSupportManagement(state))];
    const fields = new Set(modules.flatMap(m => m.capabilities.flatMap(c => keys(c.output as Schema))));
    expect(fields.size).toBeGreaterThan(20);
    expect([...fields].filter(key => !fieldLabels[key] && !hiddenFields.has(key))).toEqual([]);
  });
  test('values read as text', () => {
    expect(fieldValue(true)).toBe('Ja');
    expect(fieldValue(1234)).toBe('1\u00a0234');
    expect(fieldValue({ name: 'Sara Nyström', kind: 'short' })).toBe('Sara Nyström · sjuk');
    expect(fieldValue([{ ref: 'x', title: 'En' }, { ref: 'y', title: 'Två' }])).toBe('En, Två');
  });
  test('drill-down metadata is recognised and kept out of visible field values', () => {
    const view = { capability: 'errand.view', input: { ref: 'errand:sm:2281:KC:1' }, title: 'KC-1', source: 'Exempeldata' };
    expect(rowView({ label: 'KC-1', view })).toEqual(view);
    expect(fieldValue({ label: 'KC-1', view })).toBe('KC-1');
    expect(rowView({ view: { ...view, input: [] } })).toBeUndefined();
    expect(rowView({ view: { title: 'Felaktig vy' } })).toBeUndefined();
  });
});
