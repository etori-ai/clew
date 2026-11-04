import { describe, expect, test } from 'bun:test';
import { fieldLabels, fieldValue, hiddenFields } from '../../apps/web/src/components/panel-labels';
import { memoryState } from '../../packages/modules/src/memory-state';
import { heromaModule } from '../../packages/modules/src/mock/heroma';
import { kommunikationModule } from '../../packages/modules/src/mock/kommunikation';
import { raindanceModule } from '../../packages/modules/src/mock/raindance';
import { treservaModule } from '../../packages/modules/src/mock/treserva';

type Schema = { properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[] };
const keys = (schema: Schema): string[] => [
  ...Object.entries(schema.properties ?? {}).flatMap(([key, value]) => [key, ...keys(value)]),
  ...(schema.items ? keys(schema.items) : []),
  ...(schema.anyOf ?? []).flatMap(keys),
];

describe('side panel labels (3.1.2)', () => {
  test('every field a module returns has a Swedish name', () => {
    const state = memoryState();
    const modules = [heromaModule(state), raindanceModule(state), treservaModule(state), kommunikationModule(state)];
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
});
