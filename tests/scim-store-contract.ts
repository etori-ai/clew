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
  /** `previous` is a rotated-out token's digest that still answers until the instant given. */
  seedProvisioner(
    p: Provisioner,
    digest: string,
    revoked?: boolean,
    previous?: { digest: string; until: string },
  ): Promise<void>;
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
  phoneNumbers: [],
  employments: [],
  title: null,
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
  parentUnitId: null,
  createdAt: T,
  updatedAt: T,
  ...extra,
});
/**
 * The unique index a write ran into, read as the SCIM route reads it to answer 409 with the attribute: Postgres names
 * the constraint, and the driver may wrap the error once. Undefined when the write went through.
 */
const violated = (write: Promise<unknown>) =>
  write.then(
    () => undefined,
    (error: unknown) => {
      const e = error as {
        code?: string;
        constraint_name?: string;
        cause?: { code?: string; constraint_name?: string };
      };
      return { code: e.code ?? e.cause?.code, constraint: e.constraint_name ?? e.cause?.constraint_name };
    },
  );
export function scimStoreContract(name: string, make: () => Promise<ScimStoreHarness>) {
  describe(`${name} SCIM store`, () => {
    test('users are found, filtered and paged within their organisation only, and updated by field', async () => {
      const { store, prefix: p } = await make();
      const work = { type: 'work', value: '010-100 00 01' };
      const mobile = { type: 'mobile', value: '070-100 00 02' };
      const [a, b, c, other] = [p + '-a', p + '-b', p + '-c', p + '-other'];
      await store.transaction(async tx => {
        await tx.insertUser(userRow(a, p + '-org', { phoneNumbers: [work, mobile] }));
        await tx.insertUser(userRow(b, p + '-org'));
        await tx.insertUser(userRow(c, p + '-org', { enabled: false }));
        await tx.insertUser(userRow(other, p + '-elsewhere'));
      });
      await store.transaction(async tx => {
        expect((await tx.readUser(p + '-org', a))?.userName).toBe('u:' + a);
        expect(await tx.readUser(p + '-org', a)).toMatchObject({
          phoneNumbers: [work, mobile],
        });
        await tx.updateUser(a, { phoneNumbers: [work], updatedAt: T });
        // Which of many ids are users of the organisation, in one read: its own people, deactivated ones too, and
        // nobody else's.
        expect((await tx.usersAmong(p + '-org', [c, other, a, p + '-nobody'])).sort()).toEqual([a, c]);
        expect(await tx.usersAmong(p + '-org', [])).toEqual([]);
        const many = Array.from({ length: 2500 }, (_, i) => p + '-missing-' + i);
        expect(await tx.usersAmong(p + '-org', [...many, b])).toEqual([b]);
        expect(await tx.readUser(p + '-org', other)).toBeUndefined();
        expect((await tx.readUser(p + '-org', a, true))?.id).toBe(a);
        expect(await tx.readUser(p + '-org', other, true)).toBeUndefined();
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
        expect(filtered.rows[0]).toMatchObject({ phoneNumbers: [work] });
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
          title: null,
          updatedAt: '2026-11-09T07:00:00.000Z',
          createdAt: T,
        });
        // D110: a title is set and cleared like any other field, and an update that does not name it leaves it.
        await tx.updateUser(a, { title: 'Byggchef', updatedAt: '2026-11-09T08:00:00.000Z' });
        await tx.updateUser(a, { name: 'Renamed again', updatedAt: '2026-11-09T08:00:00.000Z' });
        expect((await tx.readUser(p + '-org', a))?.title).toBe('Byggchef');
        expect((await tx.findUser('externalId', 'ext:' + a))?.title).toBe('Byggchef');
        await tx.updateUser(a, { title: null, updatedAt: '2026-11-09T09:00:00.000Z' });
        expect((await tx.readUser(p + '-org', a))?.title).toBeNull();
        // D114: the employments are a list in the directory's order, set whole and left by an update that names none.
        const jobs = [
          { unitId: 'school', title: 'Lärare' },
          { unitId: 'school', title: 'Samordnare' },
          { unitId: 'office' },
        ];
        await tx.updateUser(a, { employments: jobs, updatedAt: '2026-11-09T10:00:00.000Z' });
        await tx.updateUser(a, { name: 'Renamed once more', updatedAt: '2026-11-09T10:00:00.000Z' });
        expect((await tx.readUser(p + '-org', a))?.employments).toEqual(jobs);
        expect((await tx.findUser('externalId', 'ext:' + a))?.employments).toEqual(jobs);
        await tx.updateUser(a, { employments: [], updatedAt: '2026-11-09T11:00:00.000Z' });
        expect((await tx.readUser(p + '-org', a))?.employments).toEqual([]);
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
    test("a group's key is held by one group across the installation, inserted or updated, and any number hold none (B2)", async () => {
      const { store, prefix: p } = await make();
      const [g1, g2] = [p + '-g1', p + '-g2'],
        duplicate = { code: '23505', constraint: 'auth_group_external_id' };
      await store.transaction(async tx => {
        await tx.insertGroup(groupRow(g1, p + '-org'));
        await tx.insertGroup(groupRow(g2, p + '-org'));
        await tx.insertGroup(groupRow(p + '-n1', p + '-org', { externalId: null }));
        await tx.insertGroup(groupRow(p + '-n2', p + '-org', { externalId: null }));
      });
      // A key is shared vocabulary (D68): another organisation's group with it is the same key.
      expect(
        await violated(
          store.transaction(tx => tx.insertGroup(groupRow(p + '-g3', p + '-elsewhere', { externalId: 'g:' + g1 }))),
        ),
      ).toEqual(duplicate);
      expect(
        await violated(store.transaction(tx => tx.updateGroup(g2, { externalId: 'g:' + g1, updatedAt: T }))),
      ).toEqual(duplicate);
      // Neither write left anything; a group written again under its own key, and one without a key given a new name,
      // are not duplicates.
      await store.transaction(async tx => {
        expect(await tx.readGroup(p + '-elsewhere', p + '-g3')).toBeUndefined();
        expect((await tx.readGroup(p + '-org', g2))?.externalId).toBe('g:' + g2);
        await tx.updateGroup(g1, { externalId: 'g:' + g1, label: 'Same key', updatedAt: T });
        await tx.updateGroup(p + '-n1', { label: 'Still without a key', updatedAt: T });
        expect((await tx.readGroup(p + '-org', g1))?.label).toBe('Same key');
        expect((await tx.findGroup('externalId', 'g:' + g1))?.id).toBe(g1);
      });
      // A key let go is free for another group.
      await store.transaction(async tx => {
        await tx.updateGroup(g1, { externalId: null, updatedAt: T });
        await tx.updateGroup(g2, { externalId: 'g:' + g1, updatedAt: T });
        expect((await tx.findGroup('externalId', 'g:' + g1))?.id).toBe(g2);
      });
    });
    test('assignments carry their unit label, a binding is seen, and a group-capability row is added and removed once', async () => {
      const h = await make(),
        p = h.prefix,
        a = p + '-a';
      await h.store.transaction(async tx => {
        await tx.insertUser(userRow(a, p + '-org'));
        await tx.writeUnits(p + '-org', [{ id: p + '-u1', label: 'Enhet 1' }]);
        // A unit row is the organisation's that wrote it (D101): another organisation does not read its label, and
        // one that writes the unit after the first has left it takes the row over, organisation and label.
        expect(await tx.unitLabels([p + '-u1', p + '-nowhere'], p + '-org')).toEqual({ [p + '-u1']: 'Enhet 1' });
        expect(await tx.unitLabels([p + '-u1'], p + '-elsewhere')).toEqual({});
        await tx.writeUnits(p + '-elsewhere', [{ id: p + '-u1', label: 'Annans enhet' }]);
        expect(await tx.unitLabels([p + '-u1'], p + '-org')).toEqual({});
        expect(await tx.unitLabels([p + '-u1'], p + '-elsewhere')).toEqual({ [p + '-u1']: 'Annans enhet' });
        await tx.writeUnits(p + '-org', [{ id: p + '-u1', label: 'Enhet 1' }]);
        await tx.replaceAssignments(a, [{ unitId: p + '-u1', role: 'manager' }]);
        expect(await tx.assignmentsOf(a)).toEqual([{ unitId: p + '-u1', unitLabel: 'Enhet 1', role: 'manager' }]);
        // Personal (D94): the unit's people with their role on it, as the manager's page reads them.
        const person = { id: a, name: 'Name ' + a, userName: 'u:' + a, email: a + '@example.test', enabled: true };
        expect(await tx.unitPeople([p + '-u1'])).toEqual({ [p + '-u1']: [{ ...person, role: 'manager' }] });
        // A unit nobody is assigned to is absent, as is every unit when none is asked for.
        expect(await tx.unitPeople([p + '-nowhere'])).toEqual({});
        expect(await tx.unitPeople([])).toEqual({});
        // Within one organisation only when it is named: another organisation's people are not on the unit.
        expect(await tx.unitPeople([p + '-u1', p + '-nowhere'], p + '-org')).toEqual({
          [p + '-u1']: [{ ...person, role: 'manager' }],
        });
        expect(await tx.unitPeople([p + '-u1'], p + '-elsewhere')).toEqual({});
        expect(await tx.bound(a)).toBe(false);
      });
      await h.bind(a);
      await h.store.transaction(async tx => {
        expect(await tx.bound(a)).toBe(true);
        const [org, elsewhere] = [p + '-org', p + '-elsewhere'];
        expect(await tx.setGroupCapability(org, p + ':g', 'admin.users', true)).toBe(true);
        expect(await tx.setGroupCapability(org, p + ':g', 'admin.users', true)).toBe(false);
        expect(await tx.groupCapabilities(org)).toEqual([{ groupExternalId: p + ':g', capability: 'admin.users' }]);
        // A row is the organisation's that wrote it (D101): another organisation neither reads it nor removes it,
        // and may hold a row of its own on the same id.
        expect(await tx.groupCapabilities(elsewhere)).toEqual([]);
        expect(await tx.setGroupCapability(elsewhere, p + ':g', 'admin.users', false)).toBe(false);
        expect(await tx.setGroupCapability(elsewhere, p + ':g', 'admin.users', true)).toBe(true);
        expect(await tx.setGroupCapability(org, p + ':g', 'admin.users', false)).toBe(true);
        expect(await tx.setGroupCapability(org, p + ':g', 'admin.users', false)).toBe(false);
        expect(await tx.groupCapabilities(org)).toEqual([]);
        expect(await tx.groupCapabilities(elsewhere)).toHaveLength(1);
        expect(await tx.setGroupCapability(elsewhere, p + ':g', 'admin.users', false)).toBe(true);
      });
    });
    test('a provisioner is found by the digest of its token while the token is not revoked, and remembers when it was last seen', async () => {
      const h = await make(),
        p = h.prefix;
      await h.seedProvisioner({ id: p + '-live', organisationId: p + '-org', label: 'Live' }, 'digest:' + p + ':live');
      await h.seedProvisioner(
        { id: p + '-gone', organisationId: p + '-org', label: 'Gone' },
        'digest:' + p + ':gone',
        true,
      );
      await h.seedProvisioner(
        { id: p + '-other', organisationId: p + '-elsewhere', label: 'Other' },
        'digest:' + p + ':o',
      );
      const live = { id: p + '-live', organisationId: p + '-org', label: 'Live' };
      await h.store.transaction(async tx => {
        expect(await tx.provisioner('digest:' + p + ':live', T)).toEqual({ ...live, lastSeenAt: null });
        expect(await tx.provisioner('digest:' + p + ':gone', T)).toBeUndefined();
        expect(await tx.provisioner('digest:' + p + ':unknown', T)).toBeUndefined();
        // The mark moves for the caller that read the time it replaces, and for no other.
        expect(await tx.touchProvisioner(p + '-live', '2026-11-09T07:30:00.000Z', null)).toBe(true);
        expect(await tx.touchProvisioner(p + '-live', '2026-11-09T07:45:00.000Z', null)).toBe(false);
      });
      await h.store.transaction(async tx => {
        expect(await tx.provisioner('digest:' + p + ':live', T)).toEqual({
          ...live,
          lastSeenAt: '2026-11-09T07:30:00.000Z',
        });
        // The organisation's own, without the revoked one, by id.
        expect(await tx.provisioners(p + '-org')).toEqual([
          { ...live, lastSeenAt: '2026-11-09T07:30:00.000Z', previousValidUntil: null },
        ]);
        expect((await tx.provisioners(p + '-elsewhere')).map(o => o.id)).toEqual([p + '-other']);
      });
    });
    test('a provisioner is issued, found by its id, rotated with and without a grace period, revoked and issued again under its id (D107)', async () => {
      const h = await make(),
        p = h.prefix,
        id = p + '-adm',
        org = p + '-org',
        digest = (n: number) => `digest:${p}:adm-${n}`,
        until = '2026-11-10T06:00:00.000Z';
      const issued = (label: string, n: number) => ({
        id,
        organisationId: org,
        label,
        tokenDigest: digest(n),
        createdBy: 'person:test',
        createdAt: T,
      });
      await h.store.transaction(async tx => {
        expect(await tx.provisionerById(id)).toBeUndefined();
        expect(await tx.issueProvisioner(issued('Issued', 1))).toBe(true);
        // The id is held now: issued again it is refused, by its own organisation and by another, and nothing moves.
        expect(await tx.issueProvisioner(issued('Twice', 9))).toBe(false);
        expect(await tx.issueProvisioner({ ...issued('Elsewhere', 9), organisationId: p + '-elsewhere' })).toBe(false);
        expect(await tx.provisioner(digest(9), T)).toBeUndefined();
      });
      await h.store.transaction(async tx => {
        expect(await tx.provisionerById(id)).toEqual({
          id,
          organisationId: org,
          label: 'Issued',
          revoked: false,
          previousValidUntil: null,
        });
        expect(await tx.provisioner(digest(1), T)).toEqual({
          id,
          organisationId: org,
          label: 'Issued',
          lastSeenAt: null,
        });
        expect(await tx.provisioners(org)).toEqual([
          { id, organisationId: org, label: 'Issued', lastSeenAt: null, previousValidUntil: null },
        ]);
        // A new token, and the one it replaces answers until the instant given.
        await tx.rotateProvisioner(id, digest(2), until);
      });
      await h.store.transaction(async tx => {
        expect((await tx.provisioner(digest(2), T))?.id).toBe(id);
        expect((await tx.provisioner(digest(1), T))?.id).toBe(id);
        expect(await tx.provisioner(digest(1), until)).toBeUndefined();
        expect((await tx.provisionerById(id))?.previousValidUntil).toBe(until);
        expect((await tx.provisioners(org))[0]?.previousValidUntil).toBe(until);
        // Again, with no grace: neither of the two before answers.
        await tx.rotateProvisioner(id, digest(3), null);
      });
      await h.store.transaction(async tx => {
        expect((await tx.provisioner(digest(3), T))?.id).toBe(id);
        expect(await tx.provisioner(digest(2), T)).toBeUndefined();
        expect(await tx.provisioner(digest(1), T)).toBeUndefined();
        expect((await tx.provisionerById(id))?.previousValidUntil).toBeNull();
        expect(await tx.touchProvisioner(id, '2026-11-09T07:00:00.000Z', null)).toBe(true);
        await tx.revokeProvisioner(id, '2026-11-09T08:00:00.000Z');
      });
      await h.store.transaction(async tx => {
        expect(await tx.provisioner(digest(3), T)).toBeUndefined();
        expect(await tx.provisioners(org)).toEqual([]);
        expect(await tx.provisionerById(id)).toMatchObject({ id, organisationId: org, revoked: true });
        // Another organisation does not take a revoked id; the one that held it issues it again: active, never
        // seen, and nothing from before answers.
        expect(await tx.issueProvisioner({ ...issued('Elsewhere', 9), organisationId: p + '-elsewhere' })).toBe(false);
        expect(await tx.provisionerById(id)).toMatchObject({ organisationId: org, revoked: true });
        expect(await tx.issueProvisioner(issued('Again', 4))).toBe(true);
      });
      await h.store.transaction(async tx => {
        expect(await tx.provisioner(digest(4), T)).toEqual({
          id,
          organisationId: org,
          label: 'Again',
          lastSeenAt: null,
        });
        expect(await tx.provisioner(digest(3), T)).toBeUndefined();
        expect(await tx.provisionerById(id)).toMatchObject({ revoked: false, previousValidUntil: null });
      });
    });
    test('a rotated-out token answers until its grace period ends and not after, and never for a revoked provisioner', async () => {
      const h = await make(),
        p = h.prefix,
        until = '2026-11-10T06:00:00.000Z';
      await h.seedProvisioner(
        { id: p + '-r', organisationId: p + '-org', label: 'Rotated' },
        'digest:' + p + ':new',
        false,
        {
          digest: 'digest:' + p + ':old',
          until,
        },
      );
      await h.seedProvisioner(
        { id: p + '-x', organisationId: p + '-org', label: 'Revoked' },
        'digest:' + p + ':x',
        true,
        {
          digest: 'digest:' + p + ':x-old',
          until,
        },
      );
      await h.store.transaction(async tx => {
        expect((await tx.provisioner('digest:' + p + ':new', T))?.id).toBe(p + '-r');
        expect((await tx.provisioner('digest:' + p + ':old', '2026-11-10T05:59:59.000Z'))?.id).toBe(p + '-r');
        expect(await tx.provisioner('digest:' + p + ':old', until)).toBeUndefined();
        expect(await tx.provisioner('digest:' + p + ':old', '2026-11-11T00:00:00.000Z')).toBeUndefined();
        expect((await tx.provisioner('digest:' + p + ':new', '2026-11-11T00:00:00.000Z'))?.id).toBe(p + '-r');
        expect(await tx.provisioner('digest:' + p + ':x-old', T)).toBeUndefined();
      });
    });
    test('the tree is the unit groups with their parent, the units below one are found by it, and placements list everyone (D99)', async () => {
      const { store, prefix: p } = await make();
      const org = p + '-org',
        [root, mid, leaf, lone] = [p + '-root', p + '-mid', p + '-leaf', p + '-lone'],
        [a, b, c] = [p + '-a', p + '-b', p + '-c'];
      const unit = (id: string, parentUnitId: string | null) =>
        groupRow(p + '-g-' + id, org, { externalId: 'unit:' + id, label: 'Unit ' + id, parentUnitId });
      await store.transaction(async tx => {
        await tx.lockTree(org);
        await tx.insertGroup(unit(root, null));
        await tx.insertGroup(unit(mid, root));
        await tx.insertGroup(unit(leaf, mid));
        await tx.insertGroup(unit(lone, null));
        // Neither is a node: a manager group carries no place, and another organisation has its own tree.
        await tx.insertGroup(groupRow(p + '-g-m', org, { externalId: 'unit-manager:' + mid, label: 'Managers' }));
        await tx.insertGroup(
          groupRow(p + '-g-x', p + '-elsewhere', { externalId: 'unit:' + p + '-x', label: 'Elsewhere' }),
        );
        await tx.insertUser(userRow(a, org));
        await tx.insertUser(userRow(b, org, { enabled: false }));
        await tx.insertUser(userRow(c, org));
        await tx.insertUser(userRow(p + '-z', p + '-elsewhere'));
        await tx.writeUnits(org, [
          { id: mid, label: 'Unit ' + mid },
          { id: leaf, label: 'Unit ' + leaf },
        ]);
        await tx.replaceAssignments(a, [
          { unitId: mid, role: 'manager' },
          { unitId: leaf, role: 'employee' },
        ]);
        await tx.replaceAssignments(b, [{ unitId: leaf, role: 'employee' }]);
      });
      await store.transaction(async tx => {
        expect(await tx.unitTree(org)).toEqual([
          { id: leaf, label: 'Unit ' + leaf, parentId: mid },
          { id: lone, label: 'Unit ' + lone, parentId: null },
          { id: mid, label: 'Unit ' + mid, parentId: root },
          { id: root, label: 'Unit ' + root, parentId: null },
        ]);
        // Narrowed to the ids named (D114: the units a person's employments name), in unit id order whatever order they
        // were named in; an id no unit of the organisation has, another organisation's unit among them, is absent.
        expect(await tx.unitTree(org, [lone, p + '-nowhere', leaf, p + '-x', leaf])).toEqual([
          { id: leaf, label: 'Unit ' + leaf, parentId: mid },
          { id: lone, label: 'Unit ' + lone, parentId: null },
        ]);
        expect(await tx.unitTree(org, [p + '-nowhere'])).toEqual([]);
        expect(await tx.unitTree(p + '-elsewhere', [p + '-x', leaf])).toEqual([
          { id: p + '-x', label: 'Elsewhere', parentId: null },
        ]);
        expect(await tx.childUnits(root)).toEqual([{ id: mid, label: 'Unit ' + mid }]);
        expect(await tx.childUnits(leaf)).toEqual([]);
        // Several units in one read (D99): each under its own id, by person id, a deactivated person included.
        const read = await tx.unitPeople([mid, leaf, root]);
        expect(Object.keys(read).sort()).toEqual([leaf, mid].sort());
        expect(read[mid]!.map(q => [q.id, q.role])).toEqual([[a, 'manager']]);
        expect(read[leaf]!.map(q => [q.id, q.role, q.enabled])).toEqual([
          [a, 'employee', true],
          [b, 'employee', false],
        ]);
        expect(await tx.placements(org)).toEqual([
          { personId: a, name: 'Name ' + a, enabled: true, unitId: leaf, role: 'employee' },
          { personId: a, name: 'Name ' + a, enabled: true, unitId: mid, role: 'manager' },
          { personId: b, name: 'Name ' + b, enabled: false, unitId: leaf, role: 'employee' },
          { personId: c, name: 'Name ' + c, enabled: true, unitId: null, role: null },
        ]);
        // A move is the parent on the group, and a root is no parent.
        await tx.updateGroup(p + '-g-' + leaf, { parentUnitId: root, updatedAt: '2026-11-09T07:00:00.000Z' });
        expect((await tx.childUnits(root)).map(u => u.id)).toEqual([leaf, mid]);
        await tx.updateGroup(p + '-g-' + leaf, { parentUnitId: null, updatedAt: '2026-11-09T07:00:01.000Z' });
        expect((await tx.readGroup(org, p + '-g-' + leaf))?.parentUnitId).toBeNull();
        expect((await tx.childUnits(root)).map(u => u.id)).toEqual([mid]);
      });
    });
    test('the people list is searched by word, unit, role, status and capability, in Swedish order and a page at a time (D100)', async () => {
      const h = await make(),
        p = h.prefix,
        org = p + '-org',
        [u1, u2] = [p + '-u1', p + '-u2'],
        [anna, bo, zara] = [p + '-anna', p + '-bo', p + '-zara'],
        [ake, orjan, other] = [p + '-ake', p + '-orjan', p + '-other'];
      await h.store.transaction(async tx => {
        await tx.insertUser(userRow(anna, org, { name: 'Anna Berg', userName: p + '.ANNBER' }));
        await tx.insertUser(userRow(bo, org, { name: 'Bo Av', enabled: false }));
        await tx.insertUser(
          userRow(zara, org, { name: 'Zara Öst', email: 'zara@skola.' + p + '.test', title: 'Biträdande rektor' }),
        );
        await tx.insertUser(
          userRow(ake, org, {
            name: 'Åke 100% Lind',
            employments: [
              { unitId: u1 },
              { unitId: u1, title: 'Vaktmästare' },
              { unitId: u2, title: 'Säkerhetsombud' },
            ],
          }),
        );
        await tx.insertUser(userRow(orjan, org, { name: 'Örjan Ek', userName: null, email: null }));
        await tx.insertUser(userRow(other, p + '-elsewhere', { name: 'Anna Annan' }));
        await tx.writeUnits(org, [
          { id: u1, label: 'Enhet 1' },
          { id: u2, label: 'Enhet 2' },
        ]);
        await tx.replaceAssignments(anna, [
          { unitId: u1, role: 'manager' },
          { unitId: u2, role: 'employee' },
        ]);
        await tx.replaceAssignments(zara, [{ unitId: u2, role: 'employee' }]);
        await tx.replaceAssignments(ake, [{ unitId: u2, role: 'manager' }]);
        await tx.writeGrant(anna, { unitId: u1, unitLabel: 'Enhet 1', role: 'manager', capabilities: ['admin.users'] });
        await tx.writeGrant(zara, { unitId: u2, unitLabel: 'Enhet 2', role: 'employee', capabilities: [] });
        await tx.writeGrant(ake, { unitId: u2, unitLabel: 'Enhet 2', role: 'manager', capabilities: [] });
      });
      await h.bind(anna);
      await h.store.transaction(async tx => {
        const every = { startIndex: 1, count: 100 };
        const found = async (search: Parameters<typeof tx.searchUsers>[1], organisationId = org) =>
          (await tx.searchUsers(organisationId, search, every)).rows.map(r => r.id);
        // By name as Swedish orders it: å and ö after z. Within the organisation only.
        const all = await tx.searchUsers(org, {}, every);
        expect(all.total).toBe(5);
        expect(all.rows.map(r => r.id)).toEqual([anna, bo, zara, ake, orjan]);
        expect(all.rows[0]).toEqual(userRow(anna, org, { name: 'Anna Berg', userName: p + '.ANNBER' }));
        expect(await found({}, p + '-elsewhere')).toEqual([other]);
        // A page is a slice of that order with the whole count; a count of 0 only counts.
        const second = await tx.searchUsers(org, {}, { startIndex: 2, count: 2 });
        expect(second.total).toBe(5);
        expect(second.rows.map(r => r.id)).toEqual([bo, zara]);
        expect(await tx.searchUsers(org, { words: ['berg'] }, { startIndex: 1, count: 0 })).toEqual({
          total: 1,
          rows: [],
        });
        // Words: each one somewhere in the name, the title, the user name or the e-mail, without regard to case, å included.
        expect(await found({ words: ['BERG'] })).toEqual([anna]);
        expect(await found({ words: ['åke'] })).toEqual([ake]);
        expect(await found({ words: ['ÖST'] })).toEqual([zara]);
        expect(await found({ words: ['anna', 'berg'] })).toEqual([anna]);
        expect(await found({ words: ['anna', 'öst'] })).toEqual([]);
        expect(await found({ words: [p + '.annber'] })).toEqual([anna]);
        expect(await found({ words: ['skola.' + p] })).toEqual([zara]);
        // The title is one of the places a word is looked for (D110), å, ä and ö without regard to case there too.
        expect(await found({ words: ['REKTOR'] })).toEqual([zara]);
        expect(await found({ words: ['BITRÄDANDE', 'zara'] })).toEqual([zara]);
        expect((await tx.searchUsers(org, { words: ['rektor'] }, every)).rows[0]?.title).toBe('Biträdande rektor');
        // D114: and in the title of each of a person's employments, as the list shows them.
        expect(await found({ words: ['SÄKERHETSOMBUD'] })).toEqual([ake]);
        expect(await found({ words: ['vaktmästare', 'åke'] })).toEqual([ake]);
        expect(await found({ words: ['vaktmästare', 'zara'] })).toEqual([]);
        // A word is matched as written: a per cent sign is a per cent sign.
        expect(await found({ words: ['%'] })).toEqual([ake]);
        expect(await found({ words: ['100%'] })).toEqual([ake]);
        // A unit, a role, and the two as one assignment: Anna leads the first unit and is an employee on the second.
        expect(await found({ unitIds: [u1] })).toEqual([anna]);
        expect(await found({ unitIds: [u2] })).toEqual([anna, zara, ake]);
        expect(await found({ unitIds: [u1, u2, p + '-nowhere'] })).toEqual([anna, zara, ake]);
        expect(await found({ role: 'manager' })).toEqual([anna, ake]);
        expect(await found({ unitIds: [u2], role: 'manager' })).toEqual([ake]);
        expect(await found({ unitIds: [u2], role: 'employee' })).toEqual([anna, zara]);
        // Access as the row reads it: deactivated first, then no grant, then whether a binding exists.
        expect(await found({ status: 'disabled' })).toEqual([bo]);
        expect(await found({ status: 'no-access' })).toEqual([orjan]);
        expect(await found({ status: 'signed-in' })).toEqual([anna]);
        expect(await found({ status: 'not-signed-in' })).toEqual([zara, ake]);
        expect(await found({ capability: 'admin.users' })).toEqual([anna]);
        expect(await found({ capability: 'admin.connectors' })).toEqual([]);
        // Every part narrows further.
        expect(await found({ words: ['a'], unitIds: [u2], status: 'not-signed-in' })).toEqual([zara, ake]);
        expect(await found({ words: ['zara'], role: 'manager' })).toEqual([]);
      });
    });
    test('a locked person and a locked group read as they do unlocked', async () => {
      const { store, prefix: p } = await make();
      await store.transaction(async tx => {
        await tx.insertUser(userRow(p + '-a', p + '-org'));
        await tx.insertGroup(groupRow(p + '-g', p + '-org'));
      });
      await store.transaction(async tx => {
        expect(await tx.lockPerson(p + '-a')).toEqual({ id: p + '-a', organisationId: p + '-org' });
        expect(await tx.lockPerson(p + '-nobody')).toBeUndefined();
        expect((await tx.readGroup(p + '-org', p + '-g', true))?.id).toBe(p + '-g');
        expect(await tx.readGroup(p + '-elsewhere', p + '-g', true)).toBeUndefined();
        // A unit is held whether or not it has a row, and naming one twice is one lock.
        await tx.lockUnits([p + '-unit-without-a-row', p + '-u', p + '-u']);
      });
    });
    test("an organisation's capability rows are held for a read or for a change until the transaction ends, and holding them changes nothing (B1)", async () => {
      const { store, prefix: p } = await make();
      const [org, elsewhere] = [p + '-org', p + '-elsewhere'],
        row = { groupExternalId: p + ':g', capability: 'admin.users' };
      await store.transaction(tx => tx.setGroupCapability(org, row.groupExternalId, row.capability, true));
      // Reads share the hold, a second one in the same transaction included, and another organisation's rows are held
      // apart: a change of those is taken beside them.
      await store.transaction(async tx => {
        await tx.lockGroupCapabilities(org, 'read');
        await tx.lockGroupCapabilities(org, 'read');
        await tx.lockGroupCapabilities(elsewhere, 'change');
        expect(await tx.groupCapabilities(org)).toEqual([row]);
      });
      await store.transaction(async tx => {
        await tx.lockGroupCapabilities(org, 'change');
        expect(await tx.setGroupCapability(org, row.groupExternalId, row.capability, false)).toBe(true);
      });
      // The hold ended with each transaction, so the next one takes it again at once.
      expect(
        await store.transaction(async tx => {
          await tx.lockGroupCapabilities(org, 'change');
          return tx.groupCapabilities(org);
        }),
      ).toEqual([]);
    });
    test("many people's time of change moves at once, in the transaction, and nothing else of them does (S13)", async () => {
      const { store, prefix: p } = await make();
      const [a, b, c, z] = [p + '-a', p + '-b', p + '-c', p + '-z'],
        later = '2026-11-09T07:00:00.000Z',
        row = (id: string, updatedAt = T) =>
          userRow(id, p + '-org', { title: 'Lärare', phoneNumbers: [{ type: 'work', value: '1' }], updatedAt });
      await store.transaction(async tx => {
        for (const id of [a, b, c, z]) await tx.insertUser(row(id));
      });
      // More ids than one statement takes, most of them nobody's and one of them twice; the person who sorts last is in
      // the second statement.
      const nobody = Array.from({ length: 5200 }, (_, i) => p + '-nobody-' + i);
      await store.transaction(async tx => {
        await tx.touchUsers([z, ...nobody, c, a, c], later);
        await tx.touchUsers([], later);
      });
      await store.transaction(async tx => {
        for (const id of [a, c, z]) expect(await tx.readUser(p + '-org', id)).toEqual(row(id, later));
        expect(await tx.readUser(p + '-org', b)).toEqual(row(b));
      });
      // Gone with the transaction that made it.
      await expect(
        store.transaction(async tx => {
          await tx.touchUsers([b], later);
          expect((await tx.readUser(p + '-org', b))?.updatedAt).toBe(later);
          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');
      expect(await store.transaction(tx => tx.readUser(p + '-org', b))).toEqual(row(b));
    });
  });
}
