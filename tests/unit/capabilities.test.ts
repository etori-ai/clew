import { describe, expect, test } from 'bun:test';
import { CAPABILITIES, CapabilitySchema, isCapability } from '../../packages/contracts/src/index';

/** The grant capabilities are a closed list (D85): nothing outside it passes the schema or the guard. */
describe('capabilities', () => {
  test('the list names what the server enforces', () => {
    expect([...CAPABILITIES]).toEqual(['admin.connectors', 'admin.users', 'admin.appearance', 'admin.competence']);
  });
  test('the schema is the same list as literals, and the guard refuses a free string', () => {
    expect(CapabilitySchema.anyOf.map(s => s.const)).toEqual([...CAPABILITIES]);
    for (const c of CAPABILITIES) expect(isCapability(c)).toBe(true);
    for (const c of ['calendar:plan', 'admin.everything', '']) expect(isCapability(c)).toBe(false);
  });
});
