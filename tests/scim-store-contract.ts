import { describe, expect, test } from 'bun:test';
import type { GroupRecord, UserRecord } from '../apps/server/src/modules/people/domain';
import type { Provisioner, ProvisionStore } from '../apps/server/src/modules/people/ports';

/**
 * The SCIM half of the provisioning store (D68): users within an organisation, groups and their members, the provisioner
 * behind a token digest. One suite, two adapters: `tests/unit/scim.test.ts` on memory, `tests/db/postgres-provisioning.test.ts`
 * on Postgres.
 */
export interface ScimStoreHarness {
  store: ProvisionStore;
  prefix: string;
  seedProvisioner(p: Provisioner, digest: string, revoked?: boolean): Promise<void>;
  /** An identity binding for the person, as a first login would write it. */
  bind(personId: string): Promise<void>;
}
const T = '2026-11-09T06:00:00.000Z';
export const userRow = (id: string, organisationId: string, extra: Partial<UserRecord> = {}): UserRecord => ({
  id,
  organisationId,
  externalId: 'ext:' + id,
  userName: 'u:' + id,
  name: 'Name ' + id,
  email: id + '@example.test',
  enabled: true,
  createdAt: T,
  updatedAt: T,
  ...extra,
});
export const groupRow = (id: string, organisationId: string, extra: Partial<GroupRecord> = {}): GroupRecord => ({
  id,
  organisationId,
  externalId: 'g:' + id,
  label: 'Group ' + id,
  createdAt: T,
  updatedAt: T,
  ...extra,
});
export function scimStoreContract(name: string, make: () => Promise<ScimStoreHarness>) {
  describe(`${name} SCIM store`, () => {
    test('users are found, filtered and paged within their organisation only, and updated by field', async () => {
      const { store, prefix: p } = await make();
      const [a, b, c, other] = [p + '-a', p + '-b', p + '-c', p + '-other'];
      await store.transaction(async tx => {
        await tx.insertUser(userRow(a, p + '-org'));
        await tx.insertUser(userRow(b, p + '-org'));
        await tx.insertUser(userRow(c, p + '-org', { enabled: false }));
        await tx.insertUser(userRow(other, p + '-elsewhere'));
      });
      await store.transaction(async tx => {
        expect((await tx.readUser(p + '-org', a))?.userName).toBe('u:' + a);
        expect(await tx.readUser(p + '-org', other)).toBeUndefined();
        expect((await tx.findUser('userName', 'u:' + b))?.id).toBe(b);
        expect((await tx.findUser('userName', ('u:' + b).toUpperCase()))?.id).toBe(b);
        expect((await tx.findUser('externalId', 'ext:' + c))?.id).toBe(c);
        expect(await tx.findUser('externalId', ('ext:' + c).toUpperCase())).toBeUndefined();
        // Across the installation: a login carries no organisation.
        expect((await tx.findUser('userName', 'u:' + other))?.id).toBe(other);
        const all = await tx.listUsers(p + '-org', { startIndex: 1, count: 100 });
        expect(all.total).toBe(3);
        expect(all.rows.map(r => r.id)).toEqual([a, b, c]);
        const second = await tx.listUsers(p + '-org', { startIndex: 2, count: 1 });
        expect(second).toMatchObject({ total: 3, rows: [{ id: b }] });
        const none = await tx.listUsers(p + '-org', { startIndex: 1, count: 0 });
        expect(none).toMatchObject({ total: 3, rows: [] });
        const filtered = await tx.listUsers(
          p + '-org',
          { startIndex: 1, count: 10 },
          { attribute: 'externalId', value: 'ext:' + a },
        );
        expect(filtered.rows.map(r => r.id)).toEqual([a]);
        const byName = await tx.listUsers(
          p + '-org',
          { startIndex: 1, count: 10 },
          { attribute: 'userName', value: ('u:' + a).toUpperCase() },
        );
        expect(byName.rows.map(r => r.id)).toEqual([a]);
        await tx.updateUser(a, { name: 'Renamed', enabled: false, updatedAt: '2026-11-09T07:00:00.000Z' });
        expect(await tx.readUser(p + '-org', a)).toMatchObject({
          name: 'Renamed',
          enabled: false,
          userName: 'u:' + a,
          updatedAt: '2026-11-09T07:00:00.000Z',
          createdAt: T,
        });
      });
      // The unique indexes hold without regard to case for userName, as the use case's own check does.
      await expect(
        store.transaction(tx => tx.insertUser(userRow(p + '-dup', p + '-org', { userName: ('u:' + b).toUpperCase() }))),
      ).rejects.toBeDefined();
      expect(await store.transaction(tx => tx.readUser(p + '-org', p + '-dup'))).toBeUndefined();
    });
    test('groups hold members, members list their groups, and removing a group removes the memberships', async () => {
      const { store, prefix: p } = await make();
      const [a, b] = [p + '-a', p + '-b'],
        [g1, g2] = [p + '-g1', p + '-g2'];
      await store.transaction(async tx => {
        await tx.insertUser(userRow(a, p + '-org'));
        await tx.insertUser(userRow(b, p + '-org'));
        await tx.insertGroup(groupRow(g1, p + '-org'));
        await tx.insertGroup(groupRow(g2, p + '-org', { externalId: null, label: 'No external id' }));
        await tx.insertGroup(groupRow(p + '-g3', p + '-elsewhere'));
        await tx.setGroupMembers(g1, [a, b, a]);
        await tx.setGroupMembers(g2, [a]);
      });
      await store.transaction(async tx => {
        expect((await tx.groupMembers(g1)).map(m => m.id)).toEqual([a, b]);
        expect(await tx.userGroups(a)).toEqual([
          { id: g1, externalId: 'g:' + g1, label: 'Group ' + g1 },
          { id: g2, externalId: null, label: 'No external id' },
        ]);
        expect(await tx.memberships(a)).toEqual([{ externalId: 'g:' + g1, label: 'Group ' + g1 }]);
        expect(await tx.members('g:' + g1)).toEqual([a, b]);
        expect((await tx.findGroup('externalId', 'g:' + g1))?.id).toBe(g1);
        expect((await tx.findGroup('label', 'No external id'))?.id).toBe(g2);
        const listed = await tx.listGroups(
          p + '-org',
          { startIndex: 1, count: 100 },
          { attribute: 'label', value: 'Group ' + g1 },
        );
        expect(listed).toMatchObject({ total: 1, rows: [{ id: g1 }] });
        // Another organisation's group is found for the uniqueness check, but neither read nor listed for this one.
        expect((await tx.findGroup('externalId', 'g:' + p + '-g3'))?.organisationId).toBe(p + '-elsewhere');
        expect(await tx.readGroup(p + '-org', p + '-g3')).toBeUndefined();
        expect((await tx.listGroups(p + '-org', { startIndex: 1, count: 100 })).rows.map(r => r.id)).toEqual([g1, g2]);
        expect((await tx.listGroups(p + '-elsewhere', { startIndex: 1, count: 100 })).rows.map(r => r.id)).toEqual([
          p + '-g3',
        ]);
        await tx.updateGroup(g1, { label: 'Renamed', updatedAt: '2026-11-09T07:00:00.000Z' });
        expect(await tx.readGroup(p + '-org', g1)).toMatchObject({
          label: 'Renamed',
          externalId: 'g:' + g1,
          organisationId: p + '-org',
        });
        await tx.setGroupMembers(g1, [b]);
        expect((await tx.groupMembers(g1)).map(m => m.id)).toEqual([b]);
        await tx.deleteGroup(g1);
        expect(await tx.readGroup(p + '-org', g1)).toBeUndefined();
        expect(await tx.userGroups(b)).toEqual([]);
        expect(await tx.userGroups(a)).toEqual([{ id: g2, externalId: null, label: 'No external id' }]);
      });
    });
    test('assignments carry their unit label, a binding is seen, and a group-capability row is added and removed once', async () => {
      const h = await make(),
        p = h.prefix,
        a = p + '-a';
      await h.store.transaction(async tx => {
        await tx.insertUser(userRow(a, p + '-org'));
        await tx.writeUnits(p + '-org', [{ id: p + '-u1', label: 'Enhet 1' }]);
        await tx.replaceAssignments(a, [{ unitId: p + '-u1', role: 'manager' }]);
        expect(await tx.assignmentsOf(a)).toEqual([{ unitId: p + '-u1', unitLabel: 'Enhet 1', role: 'manager' }]);
        expect(await tx.bound(a)).toBe(false);
      });
      await h.bind(a);
      await h.store.transaction(async tx => {
        expect(await tx.bound(a)).toBe(true);
        expect(await tx.setGroupCapability(p + ':g', 'admin.users', true)).toBe(true);
        expect(await tx.setGroupCapability(p + ':g', 'admin.users', true)).toBe(false);
        expect((await tx.groupCapabilities()).filter(m => m.groupExternalId === p + ':g')).toEqual([
          { groupExternalId: p + ':g', capability: 'admin.users' },
        ]);
        expect(await tx.setGroupCapability(p + ':g', 'admin.users', false)).toBe(true);
        expect(await tx.setGroupCapability(p + ':g', 'admin.users', false)).toBe(false);
        expect((await tx.groupCapabilities()).filter(m => m.groupExternalId === p + ':g')).toEqual([]);
      });
    });
    test('a provisioner is found by the digest of its token while the token is not revoked', async () => {
      const h = await make(),
        p = h.prefix;
      await h.seedProvisioner({ id: p + '-live', organisationId: p + '-org', label: 'Live' }, 'digest:' + p + ':live');
      await h.seedProvisioner(
        { id: p + '-gone', organisationId: p + '-org', label: 'Gone' },
        'digest:' + p + ':gone',
        true,
      );
      await h.store.transaction(async tx => {
        expect(await tx.provisioner('digest:' + p + ':live')).toEqual({
          id: p + '-live',
          organisationId: p + '-org',
          label: 'Live',
        });
        expect(await tx.provisioner('digest:' + p + ':gone')).toBeUndefined();
        expect(await tx.provisioner('digest:' + p + ':unknown')).toBeUndefined();
      });
    });
  });
}
