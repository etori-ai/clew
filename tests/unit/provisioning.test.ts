import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  activeOf,
  assertAcceptedKey,
  deriveAuthority,
  derivePositions,
  givesAuthority,
  sameGrant,
  samePositions,
  unitGroupOf,
  unitOfKey,
} from '../../apps/server/src/modules/people/domain';
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
  test('a position group gives a position by its code and its group name, and nothing of the grant (D108 item 5)', () => {
    const d = deriveAuthority(
      [
        { externalId: 'unit:u1', label: 'Enhet 1' },
        { externalId: 'position:usk', label: 'Undersköterska' },
        { externalId: 'position:mf', label: 'Maskinförare' },
        // Stored before the key was read: what D96 refuses now gives nothing.
        { externalId: 'position:', label: 'Empty key' },
        { externalId: 'position: ssk', label: 'Space after the colon' },
        { externalId: 'Position:hl', label: 'Another case' },
        { externalId: 'positional:x', label: 'A plain group' },
      ],
      [],
    );
    expect(d.positions).toEqual([
      { code: 'mf', label: 'Maskinförare' },
      { code: 'usk', label: 'Undersköterska' },
    ]);
    expect(d.grant).toEqual({ unitId: 'u1', unitLabel: 'Enhet 1', role: 'employee', capabilities: [] });
    expect(derivePositions([{ externalId: 'unit:u1', label: 'Enhet 1' }])).toEqual([]);
    // Compared by code: a relabelled position is the same one, a code more or less is not.
    expect(samePositions([{ code: 'usk', label: 'USK' }], [{ code: 'usk', label: 'Undersköterska' }])).toBe(true);
    expect(samePositions([], [{ code: 'usk', label: 'Undersköterska' }])).toBe(false);
    expect(samePositions([{ code: 'usk', label: 'USK' }], [])).toBe(false);
    expect(samePositions([], [])).toBe(true);
  });
  test('the lowest unit id is the lowest by code unit, which no locale and no upgrade of ICU moves (A5, Q4)', () => {
    // Each pair sorts the other way under the English collation that once chose: an id is a key, not a word.
    for (const [first, second] of [
      ['Bx', 'ax'],
      ['Skola', 'förskola'],
      ['Z-skola', 'a-skola'],
      ['skola-2', 'skola_2'],
    ] as const) {
      expect(first.localeCompare(second, 'en')).toBe(1);
      const both = [
        { unitId: second, role: 'employee' as const },
        { unitId: first, role: 'employee' as const },
      ];
      expect(activeOf(both)).toEqual({ unitId: first, role: 'employee' });
      expect(activeOf([...both].reverse())).toEqual({ unitId: first, role: 'employee' });
      const derived = deriveAuthority(
        [
          { externalId: 'unit:' + second, label: 'Second' },
          { externalId: 'unit:' + first, label: 'First' },
        ],
        [],
      );
      expect(derived.assignments.map(a => a.unitId)).toEqual([first, second]);
      expect(derived.grant).toMatchObject({ unitId: first, unitLabel: 'First' });
    }
    // A managed unit still comes before an employed one, whatever its id.
    expect(
      activeOf([
        { unitId: 'Bx', role: 'employee' },
        { unitId: 'ax', role: 'manager' },
      ]),
    ).toEqual({ unitId: 'ax', role: 'manager' });
  });
  test('a group gives its members something by a key the derivation reads or by a D85 row that names it, and otherwise nothing (B1)', () => {
    const rules = [{ groupExternalId: 'S-1-5-21-ad', capability: 'admin.users' }];
    for (const key of ['unit:skola', 'unit-manager:skola', 'capability:admin.users', 'protected', 'S-1-5-21-ad'])
      expect(givesAuthority(key, rules)).toBe(true);
    // A capability name outside the closed list gives nothing, yet its group's members are derived when it is written,
    // so a name a later release takes off the list is taken back from them.
    expect(givesAuthority('capability:admin.nope', [])).toBe(true);
    // A plain key, one no row of this organisation names, a key the derivation does not read (one whose shape is
    // written wrong, D96), and no key at all.
    for (const key of [
      'ad:audience',
      'S-1-5-21-other',
      'Unit:skola',
      'units:skola',
      'capability: admin.users',
      'unit-manager: skola',
      null,
    ])
      expect(givesAuthority(key, rules)).toBe(false);
    expect(givesAuthority('S-1-5-21-ad', [])).toBe(false);
    // What the derivation makes of the same keys.
    expect(
      deriveAuthority(
        [
          { externalId: 'Unit:skola', label: 'X' },
          { externalId: 'ad:audience', label: 'Y' },
        ],
        rules,
      ),
    ).toMatchObject({
      assignments: [],
      capabilities: [],
    });
  });
  test('a unit key the SCIM boundary refuses gives nothing, also on a group stored before D96 refused it: the boundary and the derivation read a key one way', () => {
    const accepted = (externalId: string) => {
      try {
        assertAcceptedKey({ externalId, label: 'Stored before D96', parent: null, members: [] });
        return true;
      } catch {
        return false;
      }
    };
    // Space after the prefix, at the end or in place of an id, written with a tab or a no-break space too, and the
    // reserved words written wrong that never derived anything; beside them the keys written right, one with space
    // inside the id, which is part of the id.
    const written = [
      'unit: skola',
      'unit:skola ',
      'unit-manager: skola',
      'unit-manager:skola ',
      'unit: ',
      'unit-manager:\tskola',
      'unit: skola',
      'unit:',
      'Unit:skola',
      ' unit:skola',
      'unit :skola',
    ];
    for (const key of [...written, 'unit:skola', 'unit-manager:skola', 'unit:sko la']) {
      const derived = deriveAuthority([{ externalId: key, label: 'Stored before D96' }], []);
      expect([key, derived.assignments.length > 0, givesAuthority(key, [])]).toEqual([
        key,
        accepted(key),
        accepted(key),
      ]);
    }
    expect(deriveAuthority([{ externalId: 'unit:sko la', label: 'X' }], []).assignments).toEqual([
      { unitId: 'sko la', role: 'employee' },
    ]);
    // A manager's key written wrong beside a unit key written right: the person is an employee of the unit the right
    // key names, and manages nothing.
    expect(
      deriveAuthority(
        [
          { externalId: 'unit:skola', label: 'Skolan' },
          { externalId: 'unit-manager: skola', label: 'Chefer' },
          { externalId: 'unit-manager:skola ', label: 'Chefer' },
        ],
        [],
      ),
    ).toMatchObject({
      assignments: [{ unitId: 'skola', role: 'employee' }],
      grant: { unitId: 'skola', unitLabel: 'Skolan', role: 'employee', capabilities: [] },
    });
    expect(unitOfKey('unit-manager: skola')).toBeUndefined();
    expect(unitGroupOf('unit:skola ')).toBeUndefined();
    expect([unitOfKey('unit-manager:skola'), unitGroupOf('unit:skola')]).toEqual(['skola', 'skola']);
  });
  test('sameGrant compares authority and label, not identity', () => {
    const g = { unitId: 'u', unitLabel: 'U', role: 'manager' as const, capabilities: ['admin.users' as const] };
    expect(sameGrant(g, { ...g })).toBe(true);
    expect(sameGrant(g, { ...g, unitLabel: 'V' })).toBe(false);
    expect(sameGrant(g, { ...g, capabilities: [] })).toBe(false);
    expect(sameGrant(undefined, undefined)).toBe(true);
    expect(sameGrant(g, undefined)).toBe(false);
    // D121: a relation to people is authority too; none and an empty list are the same.
    expect(sameGrant(g, { ...g, relations: ['registrar'] })).toBe(false);
    expect(sameGrant(g, { ...g, relations: [] })).toBe(true);
  });
  test('a relation to people comes from a row of its own table alone: no group key gives it, and it is never a capability (D121, D118)', () => {
    const memberships = [
      { externalId: 'unit:u1', label: 'Enhet 1' },
      { externalId: 'g-hr', label: 'HR' },
      // A key that names it is no capability and gives nothing; the SCIM boundary refuses it (D96).
      { externalId: 'capability:registrar', label: 'Not a capability' },
    ];
    const relations = [
      { groupExternalId: 'g-hr', relation: 'registrar' },
      { groupExternalId: 'g-hr', relation: 'admin.users' },
      { groupExternalId: 'g-other', relation: 'registrar' },
    ];
    const d = deriveAuthority(memberships, [{ groupExternalId: 'g-hr', capability: 'registrar' }], {}, relations);
    expect(d.relations).toEqual(['registrar']);
    expect(d.capabilities).toEqual([]);
    expect(d.grant).toEqual({
      unitId: 'u1',
      unitLabel: 'Enhet 1',
      role: 'employee',
      capabilities: [],
      relations: ['registrar'],
    });
    // Without the row, nothing; and without a unit there is no grant to carry it (fail closed).
    expect(deriveAuthority(memberships, [], {}, []).relations).toEqual([]);
    expect(deriveAuthority([{ externalId: 'g-hr', label: 'HR' }], [], {}, relations).grant).toBeUndefined();
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
    async setGroupRelations(rows) {
      s.groupRelations = rows.map(row => ({ organisationId: 'org', ...row }));
    },
    async relations(id) {
      return s.grants.get(id)?.relations ?? [];
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
