import { describe, expect, test } from 'bun:test';
import type { GroupCapabilityRule } from '../apps/server/src/modules/people/domain';
import type { ProvisionStore } from '../apps/server/src/modules/people/ports';
import { provisioningUsecases } from '../apps/server/src/modules/people/usecases';

/**
 * The provisioning contract (D68, D85, D25): one suite, two adapters. `tests/unit/provisioning.test.ts` runs it on the
 * memory adapter, `tests/db/postgres-provisioning.test.ts` on Postgres. The harness seeds people, groups, members and
 * group-capability rows the way a SCIM client and an administrator would, and reads back what the derivation wrote.
 */
export interface Seed {
  people: Array<{ id: string; organisationId: string }>;
  groups: Array<{ externalId: string; label: string }>;
  members: Array<{ group: string; person: string }>;
  groupCapabilities?: GroupCapabilityRule[];
  units?: Array<{ id: string; organisationId: string; label: string }>;
}
export interface ProvisioningHarness {
  store: ProvisionStore;
  /** A grant written before provisioning existed, with whatever capabilities the seed of the day gave it. */
  legacyGrant?(
    personId: string,
    grant: { unitId: string; unitLabel: string; role: 'manager' | 'employee'; capabilities: string[] },
  ): Promise<void>;
  /** A prefix this run may use for every id (the Postgres harness removes them afterwards). */
  prefix: string;
  seed(seed: Seed): Promise<void>;
  setMembers(members: Array<{ group: string; person: string }>): Promise<void>;
  setGroupCapabilities(rows: GroupCapabilityRule[]): Promise<void>;
  grant(
    personId: string,
  ): Promise<{ unitId: string; unitLabel: string; role: string; capabilities: string[] } | undefined>;
  assignments(personId: string): Promise<Array<{ unitId: string; role: string }>>;
  unitLabel(unitId: string): Promise<string | undefined>;
  audit(personId: string): Promise<Array<{ actor: string; action: string; details: Record<string, unknown> }>>;
}
export function provisioningContract(name: string, make: () => Promise<ProvisioningHarness>) {
  describe(`${name} provisioning`, () => {
    test('manager wins over employee for the same unit, the unit takes its label, capabilities come by key and by mapping, and an unchanged derivation is silent', async () => {
      const h = await make(),
        p = h.prefix,
        anna = p + '-anna';
      await h.seed({
        people: [{ id: anna, organisationId: 'org' }],
        groups: [
          { externalId: 'unit:' + p + '-skola', label: 'Bergsåkers skola' },
          { externalId: 'unit-manager:' + p + '-skola', label: 'Rektorer' },
          { externalId: 'capability:admin.connectors', label: 'Clew-administratörer' },
          { externalId: p + ':ad-anything', label: 'Some directory group' },
          { externalId: 'capability:admin.everything', label: 'Not a capability' },
        ],
        members: [
          { group: 'unit:' + p + '-skola', person: anna },
          { group: 'unit-manager:' + p + '-skola', person: anna },
          { group: 'capability:admin.connectors', person: anna },
          { group: p + ':ad-anything', person: anna },
          { group: 'capability:admin.everything', person: anna },
        ],
        groupCapabilities: [
          { groupExternalId: p + ':ad-anything', capability: 'admin.users' },
          { groupExternalId: p + ':ad-anything', capability: 'nonsense' },
        ],
      });
      const usecases = provisioningUsecases({ store: h.store });
      const derived = await usecases.derivePerson('system:test', anna);
      expect(derived?.protected).toBe(false);
      expect(await h.grant(anna)).toEqual({
        unitId: p + '-skola',
        unitLabel: 'Bergsåkers skola',
        role: 'manager',
        capabilities: ['admin.connectors', 'admin.users'],
      });
      expect(await h.assignments(anna)).toEqual([{ unitId: p + '-skola', role: 'manager' }]);
      expect(await h.unitLabel(p + '-skola')).toBe('Bergsåkers skola');
      await usecases.derivePerson('system:test', anna);
      const rows = await h.audit(anna);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor: 'system:test',
        action: 'grant.derived',
        details: {
          unitId: p + '-skola',
          role: 'manager',
          capabilities: ['admin.connectors', 'admin.users'],
          assignments: 1,
        },
      });
    });
    test('several units: every assignment is kept, the active one is a managed unit before an employed one and then the lowest id', async () => {
      const h = await make(),
        p = h.prefix,
        lena = p + '-lena';
      await h.seed({
        people: [{ id: lena, organisationId: 'org' }],
        groups: [
          { externalId: 'unit:' + p + '-a', label: 'A' },
          { externalId: 'unit:' + p + '-c', label: 'C' },
          { externalId: 'unit-manager:' + p + '-c', label: 'Chefer C' },
          { externalId: 'unit-manager:' + p + '-b', label: 'Chefer B' },
        ],
        members: [
          { group: 'unit:' + p + '-a', person: lena },
          { group: 'unit:' + p + '-c', person: lena },
          { group: 'unit-manager:' + p + '-c', person: lena },
          { group: 'unit-manager:' + p + '-b', person: lena },
        ],
        units: [{ id: p + '-b', organisationId: 'org', label: 'B från tidigare' }],
      });
      const usecases = provisioningUsecases({ store: h.store });
      await usecases.derivePerson('system:test', lena);
      expect(await h.assignments(lena)).toEqual([
        { unitId: p + '-a', role: 'employee' },
        { unitId: p + '-b', role: 'manager' },
        { unitId: p + '-c', role: 'manager' },
      ]);
      // b is managed without a unit: group of its own, so its label comes from the unit table.
      expect(await h.grant(lena)).toMatchObject({ unitId: p + '-b', unitLabel: 'B från tidigare', role: 'manager' });
    });
    test('no unit membership means no grant: the projection is removed and the audit row says so', async () => {
      const h = await make(),
        p = h.prefix,
        omar = p + '-omar';
      await h.seed({
        people: [{ id: omar, organisationId: 'org' }],
        groups: [
          { externalId: 'unit:' + p + '-x', label: 'X' },
          { externalId: 'capability:admin.users', label: 'Admins' },
        ],
        members: [
          { group: 'unit:' + p + '-x', person: omar },
          { group: 'capability:admin.users', person: omar },
        ],
      });
      const usecases = provisioningUsecases({ store: h.store });
      await usecases.derivePerson('system:test', omar);
      expect(await h.grant(omar)).toMatchObject({ unitId: p + '-x', role: 'employee', capabilities: ['admin.users'] });
      await h.setMembers([{ group: 'capability:admin.users', person: omar }]);
      await usecases.derivePerson('system:test', omar);
      expect(await h.grant(omar)).toBeUndefined();
      expect(await h.assignments(omar)).toEqual([]);
      const rows = await h.audit(omar);
      expect(rows).toHaveLength(2);
      expect(rows[1]!.details).toEqual({ removed: true });
    });
    test('a mapping change re-derives every member of the group, and an unknown person derives to nothing', async () => {
      const h = await make(),
        p = h.prefix,
        [a, b] = [p + '-a', p + '-b'],
        group = p + ':it-staff';
      await h.seed({
        people: [
          { id: a, organisationId: 'org' },
          { id: b, organisationId: 'org' },
        ],
        groups: [
          { externalId: 'unit:' + p + '-it', label: 'IT' },
          { externalId: group, label: 'IT staff' },
        ],
        members: [
          { group: 'unit:' + p + '-it', person: a },
          { group: 'unit:' + p + '-it', person: b },
          { group, person: a },
          { group, person: b },
        ],
      });
      const usecases = provisioningUsecases({ store: h.store });
      await usecases.derivePerson('system:test', a);
      await usecases.derivePerson('system:test', b);
      expect((await h.grant(a))!.capabilities).toEqual([]);
      await h.setGroupCapabilities([{ groupExternalId: group, capability: 'admin.users' }]);
      expect(await usecases.deriveGroup('person:mikael', group)).toEqual([a, b]);
      expect((await h.grant(a))!.capabilities).toEqual(['admin.users']);
      expect((await h.grant(b))!.capabilities).toEqual(['admin.users']);
      expect((await h.audit(b)).at(-1)).toMatchObject({ actor: 'person:mikael', action: 'grant.derived' });
      expect(await usecases.derivePerson('system:test', p + '-nobody')).toBeUndefined();
    });
    test('a manager of a unit nobody has pushed a unit: group for gets the unit row at once, labelled by its id until the group names it', async () => {
      const h = await make(),
        p = h.prefix,
        nour = p + '-nour',
        ola = p + '-ola',
        unit = p + '-ny';
      await h.seed({
        people: [{ id: nour, organisationId: 'org' }],
        groups: [{ externalId: 'unit-manager:' + unit, label: 'Chefer' }],
        members: [{ group: 'unit-manager:' + unit, person: nour }],
      });
      const usecases = provisioningUsecases({ store: h.store });
      // On Postgres the assignment references the unit row, so the row has to exist before the assignment is written.
      await usecases.derivePerson('system:test', nour);
      expect(await h.unitLabel(unit)).toBe(unit);
      expect(await h.assignments(nour)).toEqual([{ unitId: unit, role: 'manager' }]);
      expect(await h.grant(nour)).toMatchObject({ unitId: unit, unitLabel: unit, role: 'manager' });
      await h.seed({
        people: [{ id: ola, organisationId: 'org' }],
        groups: [{ externalId: 'unit:' + unit, label: 'Nya enheten' }],
        members: [{ group: 'unit:' + unit, person: ola }],
      });
      await usecases.derivePerson('system:test', ola);
      await usecases.derivePerson('system:test', nour);
      expect(await h.unitLabel(unit)).toBe('Nya enheten');
      expect(await h.grant(nour)).toMatchObject({ unitId: unit, unitLabel: 'Nya enheten', role: 'manager' });
    });
    test('a grant from before provisioning is rewritten even when only a name outside the closed list differs', async () => {
      const h = await make(),
        p = h.prefix,
        hillevi = p + '-hillevi';
      if (!h.legacyGrant) return;
      await h.seed({
        people: [{ id: hillevi, organisationId: 'org' }],
        groups: [{ externalId: 'unit:' + p + '-skola', label: 'Skolan' }],
        members: [{ group: 'unit:' + p + '-skola', person: hillevi }],
      });
      await h.legacyGrant(hillevi, {
        unitId: p + '-skola',
        unitLabel: 'Skolan',
        role: 'employee',
        capabilities: ['calendar:plan'],
      });
      await provisioningUsecases({ store: h.store }).derivePerson('system:test', hillevi);
      expect(await h.grant(hillevi)).toEqual({
        unitId: p + '-skola',
        unitLabel: 'Skolan',
        role: 'employee',
        capabilities: [],
      });
      expect(await h.audit(hillevi)).toHaveLength(1);
    });
    test('a transaction that fails leaves no grant and no audit row', async () => {
      const h = await make(),
        p = h.prefix,
        eva = p + '-eva';
      await h.seed({
        people: [{ id: eva, organisationId: 'org' }],
        groups: [{ externalId: 'unit:' + p + '-y', label: 'Y' }],
        members: [{ group: 'unit:' + p + '-y', person: eva }],
      });
      const usecases = provisioningUsecases({ store: h.store });
      await expect(
        h.store.transaction(async tx => {
          await usecases.deriveWithin(tx, 'system:test', eva);
          throw new Error('source said no');
        }),
      ).rejects.toThrow('source said no');
      expect(await h.grant(eva)).toBeUndefined();
      expect(await h.audit(eva)).toEqual([]);
    });
  });
}
