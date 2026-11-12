import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { activeOf, deriveAuthority, sameGrant } from '../../apps/server/src/modules/people/domain';
import { memberKey, memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { provisioningContract, type ProvisioningHarness } from '../provisioning-store-contract';

/** The pure derivation (D68, D85) and the provisioning contract on the memory adapter. */
describe('deriveAuthority', () => {
  test('keys in externalId carry the meaning; everything else is a plain group', () => {
    const d = deriveAuthority(
      [
        { externalId: 'unit:u1', label: 'Enhet 1' },
        { externalId: 'unit-manager:u2', label: 'Chefer' },
        { externalId: 'capability:admin.users', label: 'Admins' },
        { externalId: 'protected', label: 'Skyddade' },
        { externalId: 'S-1-5-21-anything', label: 'AD group' },
        { externalId: 'unit:', label: 'Empty key' },
      ],
      [],
      { u2: 'Enhet 2' },
    );
    // One unit per assignment: u2 is managed without a `unit:` group of its own, so it takes the known label.
    expect(d.units).toEqual([
      { id: 'u1', label: 'Enhet 1' },
      { id: 'u2', label: 'Enhet 2' },
    ]);
    expect(d.assignments).toEqual([
      { unitId: 'u1', role: 'employee' },
      { unitId: 'u2', role: 'manager' },
    ]);
    expect(d.active).toEqual({ unitId: 'u2', role: 'manager' });
    expect(d.grant).toEqual({ unitId: 'u2', unitLabel: 'Enhet 2', role: 'manager', capabilities: ['admin.users'] });
    expect(d.protected).toBe(true);
  });
  test('a mapping gives a capability only to members of that group, and only from the closed list', () => {
    const rules = [
      { groupExternalId: 'g1', capability: 'admin.connectors' },
      { groupExternalId: 'g2', capability: 'admin.users' },
      { groupExternalId: 'g1', capability: 'free-text' },
    ];
    expect(deriveAuthority([{ externalId: 'g1', label: 'G1' }], rules).capabilities).toEqual(['admin.connectors']);
    expect(deriveAuthority([{ externalId: 'g1', label: 'G1' }], rules).grant).toBeUndefined();
  });
  test('activeOf prefers a managed unit, then the lowest unit id', () => {
    expect(
      activeOf([
        { unitId: 'b', role: 'employee' },
        { unitId: 'a', role: 'employee' },
      ]),
    ).toEqual({ unitId: 'a', role: 'employee' });
    expect(
      activeOf([
        { unitId: 'a', role: 'employee' },
        { unitId: 'z', role: 'manager' },
        { unitId: 'm', role: 'manager' },
      ]),
    ).toEqual({ unitId: 'm', role: 'manager' });
    expect(activeOf([])).toBeUndefined();
  });
  test('sameGrant compares authority and label, not identity', () => {
    const g = { unitId: 'u', unitLabel: 'U', role: 'manager' as const, capabilities: ['admin.users' as const] };
    expect(sameGrant(g, { ...g })).toBe(true);
    expect(sameGrant(g, { ...g, unitLabel: 'V' })).toBe(false);
    expect(sameGrant(g, { ...g, capabilities: [] })).toBe(false);
    expect(sameGrant(undefined, undefined)).toBe(true);
    expect(sameGrant(g, undefined)).toBe(false);
  });
});
provisioningContract('memory', async (): Promise<ProvisioningHarness> => {
  const store = memoryProvisionStore(),
    s = store.state,
    T = '2026-11-09T06:00:00.000Z';
  return {
    store,
    prefix: 'm-' + randomUUID().slice(0, 8),
    async seed(seed) {
      for (const p of seed.people)
        s.users.set(p.id, {
          id: p.id,
          organisationId: p.organisationId,
          externalId: 'ext:' + p.id,
          userName: p.id,
          name: p.id,
          email: p.id + '@example.test',
          phoneNumbers: [],
          employments: [],
          title: null,
          enabled: true,
          createdAt: T,
          updatedAt: T,
        });
      for (const g of seed.groups)
        s.groups.set(g.externalId, {
          id: g.externalId,
          organisationId: g.organisationId ?? 'org',
          parentUnitId: null,
          externalId: g.externalId,
          label: g.label,
          createdAt: T,
          updatedAt: T,
        });
      for (const m of seed.members) s.members.add(memberKey(m.group, m.person));
      s.groupCapabilities = (seed.groupCapabilities ?? []).map(row => ({ organisationId: 'org', ...row }));
      for (const u of seed.units ?? []) s.units.set(u.id, { organisationId: u.organisationId, label: u.label });
    },
    async setMembers(members) {
      s.members.clear();
      for (const m of members) s.members.add(memberKey(m.group, m.person));
    },
    async setGroupCapabilities(rows) {
      s.groupCapabilities = rows.map(row => ({ organisationId: 'org', ...row }));
    },
    async legacyGrant(id, grant) {
      s.grants.set(id, { ...grant });
    },
    async grant(id) {
      return s.grants.get(id);
    },
    async assignments(id) {
      return s.assignments.get(id) ?? [];
    },
    async unitLabel(id) {
      return s.units.get(id)?.label;
    },
    async audit(id) {
      return s.audit.filter(a => a.subject === 'person:' + id);
    },
  };
});
