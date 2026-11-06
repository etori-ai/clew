import { describe, expect, test } from 'bun:test';
import { nextOrdinal } from '../../packages/contracts/src/index';
import {
  Registry as BaseRegistry,
  openGovernance,
  type Actor,
  type Connector,
} from '../../packages/connectors/src/index';
import { governanceOf } from '../../apps/server/src/connectors/usecases/admin';
import { hueOf, ordinalWord, systemHues } from '../../packages/ui/src/system-hues';

/**
 * The area mark's hue (D71): a system's place in the order the administrator registered it, from its row through the
 * registry's governance to what `/api/areas` gives the browser. Clew's own connectors are the house and have none.
 */
const actor: Actor = {
  id: 'person:hillevi',
  name: 'Hillevi',
  unitId: 'unit-skola',
  unitLabel: 'Skolan',
  role: 'manager',
};
const connector = (id: string, source: string, kind: Connector['kind'] = 'passthrough'): Connector => ({
  id,
  kind,
  source,
  uses: ['*'],
  areas: [],
  capabilities: [],
});
const governed = (ordinal?: number) => ({ ...openGovernance(), ...(ordinal ? { ordinal } : {}) });

describe('system marks', () => {
  test('a new system takes the lowest free ordinal: a removed one frees its place, the seventh is the seventh', () => {
    expect(nextOrdinal([])).toBe(1);
    expect(nextOrdinal([1, 2, 3])).toBe(4);
    expect(nextOrdinal([1, 3, null])).toBe(2);
    expect(nextOrdinal([1, 2, 3, 4, 5, 6])).toBe(7);
  });

  test('the registry lists the systems a person can see in registration order, Clew’s own last and without an ordinal', () => {
    const registry = new BaseRegistry();
    registry.register(connector('search', 'Sök', 'core'));
    registry.register(connector('finance', 'Ekonomisystemet'));
    registry.register(connector('calendar', 'Kalendern'));
    registry.register(connector('hr', 'Personalsystemet'));
    registry.register(connector('payroll', 'Lönesystemet'));
    registry.govern('search', governed());
    registry.govern('finance', governed(2));
    registry.govern('calendar', governed());
    registry.govern('hr', governed(1));
    registry.govern('payroll', { ...governed(7), state: 'disabled' });
    expect(registry.systems(actor)).toEqual([
      { connector: 'hr', source: 'Personalsystemet', ordinal: 1 },
      { connector: 'finance', source: 'Ekonomisystemet', ordinal: 2 },
      { connector: 'calendar', source: 'Kalendern', ordinal: null },
      { connector: 'search', source: 'Sök', ordinal: null },
    ]);
    expect(registry.ordinal('payroll')).toBe(7);
    expect(registry.ordinal('unknown')).toBeNull();
  });

  test('a core connector has no ordinal even when its row carries one', () => {
    const registry = new BaseRegistry();
    registry.register(connector('people', 'Personer', 'core'));
    registry.govern('people', governed(3));
    expect(registry.ordinal('people')).toBeNull();
  });

  test('the ordinal goes from the row into the governance; a bundled row carries none', () => {
    const row = {
      state: 'enabled',
      audience: { mode: 'all' },
      scanEnabled: true,
      toolsEnabled: true,
      capabilities: {},
    } as const;
    expect(governanceOf({ ...row, ordinal: 4 }).ordinal).toBe(4);
    expect('ordinal' in governanceOf({ ...row, ordinal: null })).toBe(false);
  });

  test('six hues in order, the seventh starts over, the house has none', () => {
    expect(systemHues).toEqual(['teal', 'purple', 'orange', 'cyan', 'pink', 'gray']);
    expect([1, 2, 6, 7, 13].map(hueOf)).toEqual(['teal', 'purple', 'gray', 'teal', 'teal']);
    expect(hueOf(null)).toBeNull();
    expect([1, 2, 3, 11, 12, 21, 22, 23].map(ordinalWord)).toEqual([
      '1:a',
      '2:a',
      '3:e',
      '11:e',
      '12:e',
      '21:a',
      '22:a',
      '23:e',
    ]);
  });
});
