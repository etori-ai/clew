import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { authorityOf, authorizationVersion } from '../../apps/server/src/auth-crypto';

process.env.MASTER_KEY ??= randomBytes(32).toString('base64');

/**
 * The authorization fingerprint covers authority alone (D68, narrowed 2026-11-09). Durable work compares it exactly,
 * so a directory update that changes a name or a label must leave it as it was, and a change of authority must not.
 */
const access = {
  person: { id: 'p1', organisationId: 'org', name: 'Hillevi Berg', enabled: true },
  grant: {
    personId: 'p1',
    unitId: 'unit-skola',
    unitLabel: 'Bergsåkers skola',
    role: 'manager' as const,
    capabilities: ['calendar:plan', 'admin.connectors'],
    version: 1,
  },
};
const version = () => authorizationVersion(access);

describe('authorizationVersion', () => {
  test('is stable across calls', () => {
    expect(version()).toBe(version());
  });
  test('ignores a corrected name, a renamed unit label and a new column', () => {
    const before = version();
    const renamed = { ...access, person: { ...access.person, name: 'Hillevi Bergström' } };
    const relabelled = { ...access, grant: { ...access.grant, unitLabel: 'Bergsåkers F-6' } };
    const widened = { ...access, person: { ...access.person, email: 'hillevi@example.test', userName: 'hilber' } };
    expect(authorizationVersion(renamed)).toBe(before);
    expect(authorizationVersion(relabelled)).toBe(before);
    expect(authorizationVersion(widened)).toBe(before);
  });
  test('ignores the order and repetition of capabilities', () => {
    expect(
      authorizationVersion({
        ...access,
        grant: { ...access.grant, capabilities: ['admin.connectors', 'calendar:plan', 'admin.connectors'] },
      }),
    ).toBe(version());
  });
  test('changes with unit, role, capabilities, enabled, organisation and grant version', () => {
    const before = version();
    const changed = [
      { ...access, grant: { ...access.grant, unitId: 'unit-omsorg' } },
      { ...access, grant: { ...access.grant, role: 'employee' as const } },
      { ...access, grant: { ...access.grant, capabilities: ['calendar:plan'] } },
      { ...access, grant: { ...access.grant, version: 2 } },
      { ...access, person: { ...access.person, enabled: false } },
      { ...access, person: { ...access.person, organisationId: 'other' } },
    ];
    const versions = changed.map(authorizationVersion);
    for (const v of versions) expect(v).not.toBe(before);
    expect(new Set(versions).size).toBe(versions.length);
  });
  test('projects exactly the authority fields', () => {
    expect(authorityOf(access)).toEqual({
      enabled: true,
      organisationId: 'org',
      unitId: 'unit-skola',
      role: 'manager',
      capabilities: ['admin.connectors', 'calendar:plan'],
      version: 1,
    });
  });
});
