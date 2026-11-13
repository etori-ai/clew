import { describe, expect, test } from 'bun:test';
import type { Assignment, GroupRecord, UserRecord } from '../apps/server/src/modules/people/domain';
import type { LeaverChange, LeaversTx, Provisioner, ProvisionStore } from '../apps/server/src/modules/people/ports';
import { directoryUsecases } from '../apps/server/src/modules/people/usecases';

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
  /**
   * An identity binding for the person, as a first login would write it: under the harness's own issuer with the
   * person's id as the subject, unless they are named.
   */
  bind(personId: string, issuer?: string, subject?: string): Promise<void>;
  /** A session of the person's, as a sign-in opens one. */
  openSession(personId: string, digest: string): Promise<void>;
  /** How many sessions the person has. */
  sessions(personId: string): Promise<number>;
  /** A row of the authentication log, as a sign-in writes one; its id. */
  logSignIn(actor: string | null, action: string): Promise<number>;
  /** The actor of a row of the authentication log, by its id. */
  signInActor(id: number): Promise<string | null | undefined>;
  /**
   * The same adapter built with a leavers binding (D108 item 14), as composition builds the SCIM store: `leavers` is the
   * port, and `failed` hears of a call that failed.
   */
  withLeavers(
    leavers: () => LeaversTx,
    failed: (error: unknown, change: LeaverChange, kind: keyof LeaversTx) => void,
  ): ProvisionStore;
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
    test("a person's source key is one person's across the installation, inserted or updated, any number hold none, and the index refuses by its name (S4)", async () => {
      const { store, prefix: p } = await make();
      const [a, b] = [p + '-a', p + '-b'],
        duplicate = { code: '23505', constraint: 'auth_person_external_id' };
      await store.transaction(async tx => {
        await tx.insertUser(userRow(a, p + '-org'));
        await tx.insertUser(userRow(b, p + '-org'));
        await tx.insertUser(userRow(p + '-n1', p + '-org', { externalId: null }));
        await tx.insertUser(userRow(p + '-n2', p + '-org', { externalId: null }));
      });
      // The index is partial (S4), and under the name the SCIM route reads to answer 409 naming externalId.
      expect(
        await violated(
          store.transaction(tx => tx.insertUser(userRow(p + '-c', p + '-elsewhere', { externalId: 'ext:' + a }))),
        ),
      ).toEqual(duplicate);
      expect(
        await violated(store.transaction(tx => tx.updateUser(b, { externalId: 'ext:' + a, updatedAt: T }))),
      ).toEqual(duplicate);
      await store.transaction(async tx => {
        await tx.updateUser(p + '-n1', { name: 'Still without a key', updatedAt: T });
        expect((await tx.findUser('externalId', 'ext:' + a))?.id).toBe(a);
        expect((await tx.readUser(p + '-org', b))?.externalId).toBe('ext:' + b);
      });
    });
    test('a user name and a group name are one name without regard to case, å, ä and ö included, to the lookup, the filter and the index (L13)', async () => {
      const { store, prefix: p } = await make();
      const org = p + '-org',
        [a, b, g] = [p + '-a', p + '-b', p + '-g'],
        // The two spellings differ only in the case of å, ä and ö, which a plain `lower` does not fold on a database
        // created with the locale C.
        name = p + '.Åsa.Öberg.Ärla',
        folded = p + '.åsa.öberg.ärla',
        duplicate = { code: '23505', constraint: 'auth_person_user_name' },
        every = { startIndex: 1, count: 10 };
      await store.transaction(async tx => {
        await tx.insertUser(userRow(a, org, { userName: name }));
        await tx.insertUser(userRow(b, org));
        await tx.insertGroup(groupRow(g, org, { label: 'Åsa Öbergs Ängar' }));
      });
      await store.transaction(async tx => {
        // As the first sign-in, the uniqueness check and the D97 lookup ask, across the installation, and as a filter.
        // In lower case and in capitals, so that each side's folding is shown: a value in capitals that is not folded
        // as the stored name is misses it on a database created with the locale C.
        for (const value of [folded, name.toUpperCase()]) {
          expect((await tx.findUser('userName', value))?.id).toBe(a);
          expect((await tx.listUsers(org, every, { attribute: 'userName', value })).rows.map(r => r.id)).toEqual([a]);
        }
        for (const value of ['åsa öbergs ängar', 'ÅSA ÖBERGS ÄNGAR'])
          expect((await tx.listGroups(org, every, { attribute: 'label', value })).rows.map(r => r.id)).toEqual([g]);
      });
      // The index holds the two spellings as one name, inserted or updated: a second person past the use case's
      // check is refused, and the route answers 409 naming userName.
      expect(
        await violated(store.transaction(tx => tx.insertUser(userRow(p + '-c', org, { userName: folded })))),
      ).toEqual(duplicate);
      expect(await violated(store.transaction(tx => tx.updateUser(b, { userName: folded, updatedAt: T })))).toEqual(
        duplicate,
      );
      // The person's own name in another case is no other person's.
      await store.transaction(tx => tx.updateUser(a, { userName: folded, updatedAt: T }));
      expect((await store.transaction(tx => tx.findUser('userName', name)))?.userName).toBe(folded);
    });
    test("an organisation's groups are named by external id in one read, and searched by name or external id (D85)", async () => {
      const { store, prefix: p } = await make();
      const [org, elsewhere] = [p + '-org', p + '-elsewhere'],
        [ekonomi, skola, atkomst, also, percent] = [
          'S-1-5-21-' + p + '-ekonomi',
          'unit:' + p + '-skola',
          'capability:' + p + '-a',
          'g-' + p + '-z',
          p + '-100%_procent',
        ];
      await store.transaction(async tx => {
        await tx.insertGroup(groupRow(p + '-s1', org, { externalId: ekonomi, label: 'Ekonomi' }));
        await tx.insertGroup(groupRow(p + '-s2', org, { externalId: skola, label: 'Älvsbyns skola' }));
        await tx.insertGroup(groupRow(p + '-s3', org, { externalId: atkomst, label: 'Åtkomst' }));
        await tx.insertGroup(groupRow(p + '-s4', org, { externalId: also, label: 'Ekonomi' }));
        await tx.insertGroup(groupRow(p + '-s5', org, { externalId: null, label: 'Ekonomi utan id' }));
        await tx.insertGroup(groupRow(p + '-s6', org, { externalId: percent, label: 'Hundra procent' }));
        await tx.insertGroup(
          groupRow(p + '-s7', elsewhere, { externalId: 'S-1-5-21-' + p + '-annan', label: 'Ekonomi' }),
        );
      });
      await store.transaction(async tx => {
        // Named by their own group, any number in one read; another organisation's group and a gone one are absent.
        expect(await tx.groupLabels(org, [ekonomi, skola, 'S-1-5-21-' + p + '-annan', p + '-gone'])).toEqual(
          new Map([
            [ekonomi, 'Ekonomi'],
            [skola, 'Älvsbyns skola'],
          ]),
        );
        expect(await tx.groupLabels(org, [])).toEqual(new Map());
        const many = Array.from({ length: 2500 }, (_, i) => p + '-missing-' + i);
        expect([...(await tx.groupLabels(org, [...many, skola])).keys()]).toEqual([skola]);
        expect(await tx.groupLabels(elsewhere, [ekonomi, 'S-1-5-21-' + p + '-annan'])).toEqual(
          new Map([['S-1-5-21-' + p + '-annan', 'Ekonomi']]),
        );
        // No words is every group with an external id, by name as Swedish orders it (å and ä after z), and one name
        // by external id compared character by character (an upper-case letter before a lower-case one).
        expect(await tx.searchGroups(org, [], 10)).toEqual([
          { externalId: ekonomi, label: 'Ekonomi' },
          { externalId: also, label: 'Ekonomi' },
          { externalId: percent, label: 'Hundra procent' },
          { externalId: atkomst, label: 'Åtkomst' },
          { externalId: skola, label: 'Älvsbyns skola' },
        ]);
        const found = async (words: string[], limit = 10) =>
          (await tx.searchGroups(org, words, limit)).map(g => g.externalId);
        expect(await found([], 2)).toEqual([ekonomi, also]);
        // Each word in the name or the external id, without regard to case, å, ä and ö included.
        expect(await found(['EKONOMI'])).toEqual([ekonomi, also]);
        expect(await found(['s-1-5-21'])).toEqual([ekonomi]);
        expect(await found(['ÄLVSBYNS', 'skola'])).toEqual([skola]);
        expect(await found(['ÅTKOMST'])).toEqual([atkomst]);
        expect(await found(['ekonomi', 'skola'])).toEqual([]);
        // A word is matched as written: a per cent sign and an underscore are themselves.
        expect(await found(['%'])).toEqual([percent]);
        expect(await found(['_'])).toEqual([percent]);
        expect(await found(['100%_'])).toEqual([percent]);
        // A group without an external id carries no meaning and another organisation's group is not there.
        expect(await found(['utan'])).toEqual([]);
        expect(await found(['annan'])).toEqual([]);
        expect((await tx.searchGroups(elsewhere, ['ekonomi'], 10)).map(g => g.externalId)).toEqual([
          'S-1-5-21-' + p + '-annan',
        ]);
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
        // Nor is a unit key written wrong, stored before the SCIM boundary refused it (D96): with a space after the
        // prefix, or at the end. It names no unit, below the root or anywhere.
        await tx.insertGroup(
          groupRow(p + '-g-spaced', org, { externalId: 'unit: ' + lone, label: 'Written wrong', parentUnitId: root }),
        );
        await tx.insertGroup(
          groupRow(p + '-g-trailing', org, { externalId: 'unit:' + p + '-t ', label: 'Written wrong' }),
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
        expect(await tx.unitTree(org, [' ' + lone, p + '-t ', p + '-t'])).toEqual([]);
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
        // Words: each one somewhere in the name, the title, the user name, the e-mail or an employment's title, without
        // regard to case, å included.
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
    test('positions are written by organisation and code, relabelled in place, held by a person as a whole set and removed with their holds (D108 item 5)', async () => {
      const { store, prefix: p } = await make();
      const [org, elsewhere] = [p + '-org', p + '-elsewhere'],
        [a, b] = [p + '-a', p + '-b'],
        [usk, ssk] = [
          { code: 'usk', label: 'Undersköterska' },
          { code: 'ssk', label: 'Sjuksköterska' },
        ];
      await store.transaction(async tx => {
        await tx.insertUser(userRow(a, org));
        await tx.insertUser(userRow(b, org));
        await tx.writePositions(org, [usk, ssk]);
        // Another organisation's rows are its own, under the same code or one this organisation does not have.
        await tx.writePositions(elsewhere, [
          { code: 'usk', label: 'Annans' },
          { code: 'only-there', label: 'Bara där' },
        ]);
        expect(await tx.positionLabels(org, ['usk', 'ssk', 'only-there', 'nowhere'])).toEqual({
          usk: 'Undersköterska',
          ssk: 'Sjuksköterska',
        });
        expect(await tx.positionLabels(elsewhere, ['usk', 'ssk'])).toEqual({ usk: 'Annans' });
        expect(await tx.positionLabels(org, [])).toEqual({});
        // A person holds the codes of their organisation that have a row, by code.
        await tx.replacePositions(a, org, ['usk', 'ssk', 'only-there', 'nowhere']);
        await tx.replacePositions(b, org, ['usk']);
        expect(await tx.positionsOf(a)).toEqual([ssk, usk]);
        expect(await tx.positionsOf(p + '-nobody')).toEqual([]);
      });
      await store.transaction(async tx => {
        // A label is written over in place, and whoever holds the position keeps it.
        await tx.writePositions(org, [{ code: 'usk', label: 'Undersköterska, hemtjänst' }]);
        expect(await tx.positionsOf(b)).toEqual([{ code: 'usk', label: 'Undersköterska, hemtjänst' }]);
        expect(await tx.positionLabels(elsewhere, ['usk'])).toEqual({ usk: 'Annans' });
        // A replacement is the whole set, and an empty one holds nothing.
        await tx.replacePositions(a, org, ['usk']);
        expect((await tx.positionsOf(a)).map(x => x.code)).toEqual(['usk']);
        await tx.replacePositions(b, org, []);
        expect(await tx.positionsOf(b)).toEqual([]);
        await tx.replacePositions(b, org, ['ssk']);
        // A removed code takes its holds with it, in its own organisation only.
        await tx.removePositions(org, ['usk']);
        await tx.removePositions(org, []);
        expect(await tx.positionsOf(a)).toEqual([]);
        expect(await tx.positionsOf(b)).toEqual([ssk]);
        expect(await tx.positionLabels(org, ['usk', 'ssk'])).toEqual({ ssk: 'Sjuksköterska' });
        expect(await tx.positionLabels(elsewhere, ['usk', 'only-there'])).toEqual({
          usk: 'Annans',
          'only-there': 'Bara där',
        });
      });
      // A transaction that fails writes no position and no hold.
      await expect(
        store.transaction(async tx => {
          await tx.writePositions(org, [{ code: 'mf', label: 'Maskinförare' }]);
          await tx.replacePositions(a, org, ['mf']);
          throw new Error('source said no');
        }),
      ).rejects.toThrow('source said no');
      await store.transaction(async tx => {
        expect(await tx.positionLabels(org, ['mf'])).toEqual({});
        expect(await tx.positionsOf(a)).toEqual([]);
      });
    });
    test('a word and what it is looked for in are the same letters composed or decomposed, in the people list and the group picker (D100, D85, L12)', async () => {
      const h = await make(),
        p = h.prefix,
        org = p + '-org',
        [composed, decomposed] = [p + '-composed', p + '-decomposed'],
        [angen, oster] = ['S-' + p + '-ängen', ('S-' + p + '-öster').normalize('NFD')],
        nfd = (text: string) => text.normalize('NFD');
      await h.store.transaction(async tx => {
        await tx.insertUser(
          userRow(composed, org, {
            name: 'Åsa Öberg',
            userName: p + '.åsa',
            title: 'Förskollärare',
            employments: [{ unitId: p + '-u', title: 'Måltidsbiträde' }],
          }),
        );
        // Stored decomposed, as a value a source sent that way is kept, and as a user name written before they were
        // normalised may be.
        await tx.insertUser(
          userRow(decomposed, org, {
            name: nfd('Ärla Ödmark'),
            userName: nfd(p + '.ärla'),
            title: nfd('Kökschef'),
            employments: [{ unitId: p + '-u', title: nfd('Städansvarig') }],
          }),
        );
        await tx.insertGroup(groupRow(p + '-g1', org, { externalId: angen, label: 'Ängens förskola' }));
        await tx.insertGroup(groupRow(p + '-g2', org, { externalId: oster, label: nfd('Östra skolan') }));
      });
      await h.store.transaction(async tx => {
        const found = async (...words: string[]) =>
          (await tx.searchUsers(org, { words }, { startIndex: 1, count: 10 })).rows.map(r => r.id);
        const groups = async (...words: string[]) => (await tx.searchGroups(org, words, 10)).map(g => g.externalId);
        // A word pasted decomposed, as text copied from a file name arrives, finds what is stored composed: in the name,
        // the user name, the title and an employment's title, without regard to case.
        expect(await found(nfd('ÅSA'))).toEqual([composed]);
        expect(await found(nfd(p + '.åsa'))).toEqual([composed]);
        expect(await found(nfd('förskollärare'))).toEqual([composed]);
        expect(await found(nfd('MÅLTIDSBITRÄDE'))).toEqual([composed]);
        // And a word typed composed finds what is stored decomposed.
        expect(await found('ÖDMARK')).toEqual([decomposed]);
        expect(await found(p + '.ärla')).toEqual([decomposed]);
        expect(await found('kökschef')).toEqual([decomposed]);
        expect(await found('städansvarig', 'ÄRLA')).toEqual([decomposed]);
        // The group picker the same, in a group's name and its external id.
        expect(await groups(nfd('ÄNGENS'))).toEqual([angen]);
        expect(await groups('östra')).toEqual([oster]);
        expect(await groups('ÖSTER')).toEqual([oster]);
        expect(await groups(nfd('öster'), 'skolan')).toEqual([oster]);
      });
    });
    test('the directory of a unit is everyone active placed on it, with the role held there, whichever unit they act in (A4)', async () => {
      const { store, prefix: p } = await make();
      const org = p + '-org',
        [u1, u2, u3] = [p + '-u1', p + '-u2', p + '-u3'],
        [two, both, leads, here, gone] = [p + '-two', p + '-both', p + '-leads', p + '-here', p + '-gone'];
      // Each grant names the unit the person acts in (manager first, then the lowest unit id): only `here` acts in the
      // second unit, and the directory once listed by the grant.
      const people: Array<[id: string, name: string, placed: Assignment[], enabled: boolean]> = [
        [
          two,
          'Örjan Två',
          [
            { unitId: u1, role: 'employee' },
            { unitId: u2, role: 'employee' },
          ],
          true,
        ],
        [
          both,
          'Bodil Båda',
          [
            { unitId: u1, role: 'manager' },
            { unitId: u2, role: 'manager' },
          ],
          true,
        ],
        [
          leads,
          'Ali Leder',
          [
            { unitId: u2, role: 'employee' },
            { unitId: u3, role: 'manager' },
          ],
          true,
        ],
        [here, 'Cecilia Här', [{ unitId: u2, role: 'employee' }], true],
        [gone, 'Gun Slutat', [{ unitId: u2, role: 'employee' }], false],
      ];
      const units = [
        { id: u1, label: 'Enhet 1' },
        { id: u2, label: 'Enhet 2' },
        { id: u3, label: 'Enhet 3' },
      ];
      await store.transaction(async tx => {
        await tx.writeUnits(org, units);
        for (const [id, name, placed, enabled] of people) {
          await tx.insertUser(userRow(id, org, { name, enabled }));
          await tx.replaceAssignments(id, placed);
          const active = id === leads ? placed[1]! : placed[0]!,
            unitLabel = units.find(unit => unit.id === active.unitId)!.label;
          await tx.writeGrant(id, { unitId: active.unitId, unitLabel, role: active.role, capabilities: [] });
        }
      });
      const { directory } = directoryUsecases({ store });
      // By name in Swedish order, Ö after the rest; the deactivated person is left out.
      expect(await directory(u2)).toEqual([
        { id: leads, name: 'Ali Leder', role: 'employee' },
        { id: both, name: 'Bodil Båda', role: 'manager' },
        { id: here, name: 'Cecilia Här', role: 'employee' },
        { id: two, name: 'Örjan Två', role: 'employee' },
      ]);
      expect(await directory(u1)).toEqual([
        { id: both, name: 'Bodil Båda', role: 'manager' },
        { id: two, name: 'Örjan Två', role: 'employee' },
      ]);
      expect(await directory(u3)).toEqual([{ id: leads, name: 'Ali Leder', role: 'manager' }]);
      expect(await directory(p + '-nowhere')).toEqual([]);
    });
    test('a locked person, people held at once and a locked group read as they do unlocked', async () => {
      const { store, prefix: p } = await make();
      await store.transaction(async tx => {
        await tx.insertUser(userRow(p + '-a', p + '-org'));
        await tx.insertUser(userRow(p + '-z', p + '-org'));
        await tx.insertGroup(groupRow(p + '-g', p + '-org'));
      });
      await store.transaction(async tx => {
        // More people than one statement takes, most of them nobody and one of them twice; the person who sorts last
        // is in the second statement.
        await tx.lockPeople([
          p + '-z',
          ...Array.from({ length: 5200 }, (_, i) => p + '-nobody-' + i),
          p + '-a',
          p + '-z',
        ]);
        await tx.lockPeople([]);
        for (const id of [p + '-a', p + '-z'])
          expect(await tx.readUser(p + '-org', id)).toEqual(userRow(id, p + '-org'));
        expect(await tx.lockPerson(p + '-a')).toEqual({ id: p + '-a', organisationId: p + '-org' });
        expect(await tx.lockPerson(p + '-nobody')).toBeUndefined();
        expect((await tx.readGroup(p + '-org', p + '-g', true))?.id).toBe(p + '-g');
        expect(await tx.readGroup(p + '-elsewhere', p + '-g', true)).toBeUndefined();
        // A unit is held whether or not it has a row, and naming one twice is one lock.
        await tx.lockUnits([p + '-unit-without-a-row', p + '-u', p + '-u']);
      });
    });
    test('the leavers bound to the store are told on its transaction, and one that fails is reported and never fails the change (D108 item 14, D113)', async () => {
      const h = await make();
      const p = h.prefix,
        org = p + '-org',
        told: string[] = [],
        failed: string[] = [];
      let failing = false;
      const store = h.withLeavers(
        () => ({
          async deactivated(change) {
            told.push(`deactivated:${change.personId}:${change.organisationId}:${change.actor}:${change.at}`);
            if (failing) throw new Error('the domain failed');
          },
          async reactivated(change) {
            told.push('reactivated:' + change.personId);
          },
        }),
        (_error, change, kind) => failed.push(kind + ':' + change.personId),
      );
      const change = (personId: string) => ({ actor: 'provisioner:x', personId, organisationId: org, at: T });
      await store.transaction(async tx => {
        await tx.insertUser(userRow(p + '-a', org));
        await tx.leavers.deactivated(change(p + '-a'));
      });
      // The binding fails: the change it was told of commits all the same, and the failure is reported.
      failing = true;
      await store.transaction(async tx => {
        await tx.updateUser(p + '-a', { enabled: false, updatedAt: T });
        await tx.leavers.deactivated(change(p + '-a'));
        await tx.updateUser(p + '-a', { name: 'After the port', updatedAt: T });
      });
      expect(failed).toEqual(['deactivated:' + p + '-a']);
      await store.transaction(async tx => {
        expect(await tx.readUser(org, p + '-a')).toMatchObject({ enabled: false, name: 'After the port' });
      });
      // A rollback of the change takes it all back, whatever the binding did.
      failing = false;
      await expect(
        store.transaction(async tx => {
          await tx.leavers.reactivated(change(p + '-a'));
          throw new Error('after the port');
        }),
      ).rejects.toThrow('after the port');
      expect(told).toEqual([
        `deactivated:${p}-a:${org}:provisioner:x:${T}`,
        `deactivated:${p}-a:${org}:provisioner:x:${T}`,
        'reactivated:' + p + '-a',
      ]);
      // A store built without a binding tells nobody, and is no error.
      await h.store.transaction(tx => tx.leavers.deactivated(change(p + '-c')));
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
    test("a write that changes a person's name records when, which the group's members are read with, and the last such change among each group's current members is read for many groups at once (the mirror of S13)", async () => {
      const { store, prefix: p } = await make();
      const org = p + '-org',
        [a, b, c] = [p + '-a', p + '-b', p + '-c'],
        [g1, g2, g3, empty] = [p + '-g1', p + '-g2', p + '-g3', p + '-g4'],
        [t1, t2, t3] = ['2026-11-09T07:00:00.000Z', '2026-11-09T08:00:00.000Z', '2026-11-09T09:00:00.000Z'],
        changed = (ids: readonly string[]) => store.transaction(tx => tx.memberNamesChanged(ids)),
        members = (id: string) => store.transaction(tx => tx.groupMembers(id));
      await store.transaction(async tx => {
        for (const id of [a, b, c]) await tx.insertUser(userRow(id, org));
        for (const g of [g1, g2, g3, empty]) await tx.insertGroup(groupRow(g, org));
        await tx.setGroupMembers(g1, [a, b]);
        await tx.setGroupMembers(g2, [b]);
        await tx.setGroupMembers(g3, [c]);
      });
      // A name given when the person was created is no change: they were in no group then.
      expect(await changed([g1, g2, g3, empty])).toEqual(new Map());
      expect(await members(g1)).toEqual([
        { id: a, name: 'Name ' + a, nameChangedAt: null },
        { id: b, name: 'Name ' + b, nameChangedAt: null },
      ]);
      await store.transaction(async tx => {
        await tx.updateUser(a, { name: 'Anna', updatedAt: t1 });
        await tx.updateUser(b, { name: 'Bo', updatedAt: t2 });
        // The same name again is no change, nor is another field or a moved time of change (S13).
        await tx.updateUser(a, { name: 'Anna', email: 'anna@example.test', updatedAt: t3 });
        await tx.updateUser(c, { title: 'Lärare', updatedAt: t3 });
        await tx.touchUsers([a, b, c], t3);
      });
      // More ids than one statement takes, most of them no group's; a group nobody in it was renamed is absent.
      const nothing = Array.from({ length: 1200 }, (_, i) => p + '-nothing-' + i);
      expect(await changed([g1, ...nothing, g2, g3, empty])).toEqual(
        new Map([
          [g1, t2],
          [g2, t2],
        ]),
      );
      expect(await changed([])).toEqual(new Map());
      // Each member's own, in the rows that carry the member's name.
      expect(await members(g1)).toEqual([
        { id: a, name: 'Anna', nameChangedAt: t1 },
        { id: b, name: 'Bo', nameChangedAt: t2 },
      ]);
      expect(await members(g3)).toEqual([{ id: c, name: 'Name ' + c, nameChangedAt: null }]);
      // A member who has left counts no more.
      await store.transaction(tx => tx.setGroupMembers(g1, [a]));
      expect(await changed([g1, g2])).toEqual(
        new Map([
          [g1, t1],
          [g2, t2],
        ]),
      );
      // The time of a name is the store's own: the record reads as it did.
      expect(await store.transaction(tx => tx.readUser(org, a))).toEqual(
        userRow(a, org, { name: 'Anna', email: 'anna@example.test', updatedAt: t3 }),
      );
      // Gone with the transaction that made it.
      await expect(
        store.transaction(async tx => {
          await tx.updateUser(c, { name: 'Cecilia', updatedAt: t3 });
          expect(await tx.memberNamesChanged([g3])).toEqual(new Map([[g3, t3]]));
          expect(await tx.groupMembers(g3)).toEqual([{ id: c, name: 'Cecilia', nameChangedAt: t3 }]);
          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');
      expect(await changed([g3])).toEqual(new Map());
      expect(await members(g3)).toEqual([{ id: c, name: 'Name ' + c, nameChangedAt: null }]);
    });
    test('an erasure takes the person out of their groups, ends their bindings and sessions, and rewrites the audit rows and the claims it is given, in the transaction (D123)', async () => {
      const h = await make(),
        p = h.prefix,
        org = p + '-org',
        [a, b] = [p + '-a', p + '-b'],
        [g1, g2, g3] = [p + '-g1', p + '-g2', p + '-g3'],
        [issuerA, issuerB] = ['https://idp-a.test/' + p, 'https://idp-b.test/' + p],
        later = '2026-11-09T07:00:00.000Z',
        // Held with å and claimed with Å: ICU folds the one to the other, the locale C does not (L13).
        name = 'åsa.' + p,
        created = (id: string, userName: string) => ({
          actor: 'provisioner:' + p,
          action: 'scim.user.created',
          subject: 'person:' + id,
          details: { userName, externalId: 'ext:' + id },
        }),
        refused = {
          actor: 'person:' + b,
          action: 'identity.conflict',
          subject: 'person:' + b,
          details: {
            issuer: issuerA,
            claim: 'preferred_username',
            value: 'u:' + b,
            subject: 'sub-' + a,
            holder: 'person:' + a,
          },
        };
      await h.store.transaction(async tx => {
        await tx.insertUser(userRow(a, org, { userName: name }));
        await tx.insertUser(userRow(b, org));
        for (const g of [g1, g2, g3]) await tx.insertGroup(groupRow(g, org));
        await tx.setGroupMembers(g1, [a, b]);
        await tx.setGroupMembers(g2, [a]);
        await tx.setGroupMembers(g3, [b]);
        for (const row of [created(a, name), created(b, 'u:' + b), refused]) await tx.audit(row);
      });
      await h.bind(a, issuerA, 'sub-' + a);
      await h.bind(a, issuerB, 'sub-' + a);
      await h.bind(b, issuerA, 'sub-' + b);
      for (const [person, digest] of [
        [a, p + '-s1'],
        [a, p + '-s2'],
        [b, p + '-s3'],
      ] as const)
        await h.openSession(person, digest);
      // A claim is kept as the sign-in got it: in any case, and composed or not.
      const log = [
        await h.logSignIn('claim:' + name.toUpperCase(), 'identity-unmatched'),
        await h.logSignIn('claim:' + name.normalize('NFD'), 'identity-unmatched'),
        await h.logSignIn('claim:' + a + '@example.test', 'identity-unmatched'),
        await h.logSignIn('claim:u:' + b, 'identity-unmatched'),
        await h.logSignIn('person:' + a, 'login-denied'),
        await h.logSignIn(null, 'login-denied'),
      ];
      const done = await h.store.transaction(async tx => {
        await tx.lockGroupsOf(a);
        const about = await tx.auditRows(['scim.user.created', 'identity.conflict'], { subject: 'person:' + a }),
          asHolder = await tx.auditRows(['identity.conflict', 'identity.rebound'], {
            key: 'holder',
            value: 'person:' + a,
          });
        expect(about).toEqual([
          {
            id: expect.any(Number),
            action: 'scim.user.created',
            subject: 'person:' + a,
            details: created(a, name).details,
          },
        ]);
        expect(asHolder).toEqual([
          { id: expect.any(Number), action: 'identity.conflict', subject: 'person:' + b, details: refused.details },
        ]);
        // An action not asked for is not read, and no action is no row.
        expect(await tx.auditRows(['identity.rebound'], { subject: 'person:' + a })).toEqual([]);
        expect(await tx.auditRows([], { subject: 'person:' + a })).toEqual([]);
        const redactions = new Map([
          [about[0]!.id, ['userName', 'externalId']],
          [asHolder[0]!.id, ['subject']],
        ]);
        expect(await tx.redactAudit(redactions)).toBe(2);
        expect(await tx.redactAudit(redactions)).toBe(0);
        return {
          memberships: await tx.removeMemberships(a, later),
          bindings: await tx.removeBindings(a),
          sessions: await tx.removeSessions(a),
          // What names nobody, and what no claim can be, changes nothing.
          claims: await tx.eraseClaims([name, a + '@example.test', 'nobody-' + p, 'with\u0000nul', ''], '[erased]'),
        };
      });
      expect(done).toEqual({ memberships: 2, bindings: 2, sessions: 2, claims: 3 });
      const asErased = async () => {
        await h.store.transaction(async tx => {
          expect(await tx.userGroups(a)).toEqual([]);
          expect((await tx.userGroups(b)).map(g => g.id)).toEqual([g1, g3]);
          expect(await tx.groupMembers(g1)).toEqual([{ id: b, name: 'Name ' + b, nameChangedAt: null }]);
          // The groups the person left changed (S13), and the other did not.
          expect((await tx.readGroup(org, g1))?.updatedAt).toBe(later);
          expect((await tx.readGroup(org, g2))?.updatedAt).toBe(later);
          expect((await tx.readGroup(org, g3))?.updatedAt).toBe(T);
          expect([await tx.bound(a), await tx.bound(b)]).toEqual([false, true]);
          // The person's own row is the use case's to clear, not these ports'.
          expect(await tx.readUser(org, a)).toEqual(userRow(a, org, { userName: name }));
          expect((await tx.auditRows(['scim.user.created'], { subject: 'person:' + a }))[0]?.details).toEqual({
            userName: '[erased]',
            externalId: '[erased]',
          });
          expect((await tx.auditRows(['scim.user.created'], { subject: 'person:' + b }))[0]?.details).toEqual(
            created(b, 'u:' + b).details,
          );
          expect((await tx.auditRows(['identity.conflict'], { subject: 'person:' + b }))[0]?.details).toEqual({
            ...refused.details,
            subject: '[erased]',
          });
        });
        expect([await h.sessions(a), await h.sessions(b)]).toEqual([0, 1]);
        expect(await Promise.all(log.map(id => h.signInActor(id)))).toEqual([
          'claim:[erased]',
          'claim:[erased]',
          'claim:[erased]',
          'claim:u:' + b,
          'person:' + a,
          null,
        ]);
      };
      await asErased();
      // Once more, nothing is left, and a claim already erased is not counted again.
      expect(
        await h.store.transaction(async tx => [
          await tx.removeMemberships(a, later),
          await tx.removeBindings(a),
          await tx.removeSessions(a),
          await tx.eraseClaims([name, '[erased]'], '[erased]'),
        ]),
      ).toEqual([0, 0, 0, 0]);
      // Gone with the transaction that made it.
      await expect(
        h.store.transaction(async tx => {
          await tx.lockGroupsOf(b);
          expect(await tx.removeMemberships(b, '2026-11-09T08:00:00.000Z')).toBe(2);
          expect(await tx.removeBindings(b)).toBe(1);
          expect(await tx.removeSessions(b)).toBe(1);
          expect(await tx.eraseClaims(['U:' + b], '[erased]')).toBe(1);
          const [row] = await tx.auditRows(['scim.user.created'], { subject: 'person:' + b });
          expect(await tx.redactAudit(new Map([[row!.id, ['userName']]]))).toBe(1);
          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');
      await asErased();
    });
  });
}
