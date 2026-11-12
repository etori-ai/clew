import { and, eq, gt, inArray, isNotNull, isNull, like, not, or, sql, type SQL } from 'drizzle-orm';
import { database, schema, type Database, type Transaction } from '@clew/db';
import { writeAudit } from '@clew/db/threads';
import { UNIT_KEY } from '@clew/contracts/scim-group-key';
import { unitGroupOf, type GroupRecord, type UserRecord, type UserSearch } from '../domain';
import type { ProvisionStore, ProvisionTx, UserReads } from '../ports';

/**
 * Read the local user/grant tables; directory access is restricted to the actor's unit. `db` is the server's pool unless
 * a test names another database.
 */
export const postgresUserReads = (db: () => Database = database): UserReads => ({
  async capabilities(personId) {
    const [row] = await db()
      .select({ capabilities: schema.accessGrants.capabilities })
      .from(schema.accessGrants)
      .where(eq(schema.accessGrants.personId, personId));
    return row?.capabilities ?? [];
  },
  async directory(unitId) {
    return (
      db()
        .select({ id: schema.people.id, name: schema.people.name, role: schema.accessGrants.role })
        .from(schema.people)
        .innerJoin(schema.accessGrants, eq(schema.accessGrants.personId, schema.people.id))
        // A deactivated person keeps their grant row and is nobody's colleague to ask about.
        .where(and(eq(schema.accessGrants.unitId, unitId), eq(schema.people.enabled, true)))
    );
  },
  async userName(personId) {
    // A NUL is nobody's id, and PostgreSQL refuses to compare one.
    if (personId.includes('\u0000')) return null;
    const [row] = await db()
      .select({ userName: schema.people.userName })
      .from(schema.people)
      .where(eq(schema.people.id, personId));
    return row?.userName ?? null;
  },
  async holders(readerId, userNames) {
    // A NUL names nobody, and PostgreSQL refuses to compare one.
    const names = [...new Set(userNames)].filter(name => name && !name.includes('\u0000'));
    if (!names.length || readerId.includes('\u0000')) return new Map();
    // Each name as asked beside the people of the reader's organisation it names: the same expression on both sides, in
    // the composed form (NFC) and without regard to case under ICU's root collation, so that a decomposed å is å and Å
    // and å are one letter on a database created with the C locale too (L12, L13).
    const asked = sql.join(
      names.map(name => sql`(${name}::text)`),
      sql`, `,
    );
    const rows = await db().execute<{ asked: string; id: string }>(sql`
      select asked.name as asked, holder.id as id
      from (values ${asked}) as asked(name)
      join auth_person holder
        on lower(normalize(holder.user_name, NFC) collate "und-x-icu")
         = lower(normalize(asked.name, NFC) collate "und-x-icu")
      where holder.organisation_id = (select reader.organisation_id from auth_person reader where reader.id = ${readerId})`);
    const found = new Map<string, Set<string>>();
    for (const r of rows) found.set(r.asked, (found.get(r.asked) ?? new Set<string>()).add(r.id));
    // Two people the unique index let in with spellings that compare alike here (one stored decomposed, or Å and å on a
    // C-locale database) leave the name naming nobody rather than either of them.
    return new Map([...found].flatMap(([name, ids]) => (ids.size === 1 ? [[name, [...ids][0]!] as const] : [])));
  },
  async exists(personId) {
    if (personId.includes('\u0000')) return false;
    const [row] = await db().select({ id: schema.people.id }).from(schema.people).where(eq(schema.people.id, personId));
    return !!row;
  },
});
const userColumns = {
  id: schema.people.id,
  organisationId: schema.people.organisationId,
  externalId: schema.people.externalId,
  userName: schema.people.userName,
  name: schema.people.name,
  email: schema.people.email,
  phoneNumbers: schema.people.phoneNumbers,
  employments: schema.people.employments,
  title: schema.people.title,
  enabled: schema.people.enabled,
  createdAt: schema.people.createdAt,
  updatedAt: schema.people.updatedAt,
};
const groupColumns = {
  id: schema.groups.id,
  organisationId: schema.groups.organisationId,
  externalId: schema.groups.externalId,
  label: schema.groups.label,
  parentUnitId: schema.groups.parentUnitId,
  createdAt: schema.groups.createdAt,
  updatedAt: schema.groups.updatedAt,
};
/** D99: a node of the tree is a `unit:` group; the unit id is what follows the key (`unitGroupOf`). */
const isUnitGroup = like(schema.groups.externalId, UNIT_KEY + '%');
type UserRow = Omit<UserRecord, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type GroupRow = Omit<GroupRecord, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
const userRecord = (r: UserRow): UserRecord => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
const groupRecord = (r: GroupRow): GroupRecord => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
/** `userName` is compared without regard to case (RFC 7643: `caseExact: false`), `externalId` exactly; as the unique indexes do. */
const userMatch = (by: 'userName' | 'externalId', value: string) =>
  by === 'userName' ? sql`lower(${schema.people.userName}) = lower(${value})` : eq(schema.people.externalId, value);
/**
 * The lock a derivation takes on a person and a write takes on a group. `NO KEY UPDATE`, not `UPDATE`: a membership or
 * assignment row inserted by another transaction holds a key-share lock on the person through its foreign key, and
 * `FOR UPDATE` would wait for it while that transaction waits for this one. Two holders of this lock still exclude
 * each other, which is all the serialisation needs (`tests/db/postgres-scim-concurrency.test.ts`).
 */
const ROW_LOCK = 'no key update' as const;
const groupColumn = { externalId: schema.groups.externalId, label: schema.groups.label } as const;
/** How many membership rows one statement writes or removes. */
const MEMBER_BATCH = 5000;
/**
 * D100: the people list's search as conditions on `auth_person`. A word is matched as written, so `%` and `_` in it
 * are escaped. `ilike` folds case by the collation of what it reads, and a database created with the locale C folds
 * only a to z there, so each column is read under the ICU collation the order already asks for: å, ä and ö fold the
 * same in every installation, however its database was created.
 */
const folded = (column: SQL, pattern: string) => sql`${column} collate "sv-x-icu" ilike ${pattern}`;
const personHas = (table: SQL, ...conditions: Array<SQL | undefined>) =>
  sql`exists (select 1 from ${table} where ${and(...conditions)})`;
function userSearchConditions(search: UserSearch): Array<SQL | undefined> {
  const granted = personHas(sql`${schema.accessGrants}`, eq(schema.accessGrants.personId, schema.people.id)),
    bound = personHas(sql`${schema.identityBindings}`, eq(schema.identityBindings.personId, schema.people.id));
  return [
    ...(search.words ?? []).map(word => {
      const pattern = '%' + word.replace(/[\\%_]/g, '\\$&') + '%';
      return or(
        folded(sql`${schema.people.name}`, pattern),
        folded(sql`${schema.people.userName}`, pattern),
        folded(sql`${schema.people.email}`, pattern),
        folded(sql`${schema.people.title}`, pattern),
        // D114: the titles of the person's employments, which the list shows before the core title.
        sql`exists (select 1 from jsonb_array_elements(${schema.people.employments}) as job where ${folded(sql`job->>'title'`, pattern)})`,
      );
    }),
    search.unitIds || search.role
      ? personHas(
          sql`${schema.assignments}`,
          eq(schema.assignments.personId, schema.people.id),
          search.unitIds ? inArray(schema.assignments.unitId, [...search.unitIds]) : undefined,
          search.role ? eq(schema.assignments.role, search.role) : undefined,
        )
      : undefined,
    search.status === 'disabled'
      ? eq(schema.people.enabled, false)
      : search.status === 'no-access'
        ? and(eq(schema.people.enabled, true), not(granted))
        : search.status === 'signed-in'
          ? and(eq(schema.people.enabled, true), granted, bound)
          : search.status === 'not-signed-in'
            ? and(eq(schema.people.enabled, true), granted, not(bound))
            : undefined,
    search.capability === undefined
      ? undefined
      : personHas(
          sql`${schema.accessGrants}`,
          eq(schema.accessGrants.personId, schema.people.id),
          sql`${schema.accessGrants.capabilities} @> ${JSON.stringify([search.capability])}::jsonb`,
        ),
  ];
}
const provisionerColumns = {
  id: schema.provisioners.id,
  organisationId: schema.provisioners.organisationId,
  label: schema.provisioners.label,
  lastSeenAt: schema.provisioners.lastSeenAt,
};
const previousColumns = {
  previousTokenDigest: schema.provisioners.previousTokenDigest,
  previousValidUntil: schema.provisioners.previousValidUntil,
};
/** Until when a rotated-out token answers, as stored: null when there is none. Whether that is still ahead is the use case's to say. */
const previousUntil = (digest: string | null, until: Date | null) =>
  digest !== null && until !== null ? until.toISOString() : null;
const provisionerRecord = (r: { id: string; organisationId: string; label: string; lastSeenAt: Date | null }) => ({
  ...r,
  lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
});
/** The provisioning tables and the grant projection (D68, D85) inside one Postgres transaction. */
export function postgresProvisionStore(): ProvisionStore {
  const txOf = (tx: Transaction): ProvisionTx => ({
    async lockPerson(id) {
      const [row] = await tx
        .select({ id: schema.people.id, organisationId: schema.people.organisationId })
        .from(schema.people)
        .where(eq(schema.people.id, id))
        .for(ROW_LOCK);
      return row;
    },
    async lockUnits(unitIds) {
      // An advisory lock, since a new unit has no row to lock yet; in id order, as people are locked.
      for (const id of [...new Set(unitIds)].sort())
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'clew.unit:' + id}, 0))`);
    },
    async lockTree(organisationId) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'clew.unit-tree:' + organisationId}, 0))`);
    },
    async memberships(personId) {
      const rows = await tx
        .select({ externalId: schema.groups.externalId, label: schema.groups.label })
        .from(schema.groupMembers)
        .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMembers.groupId))
        .where(and(eq(schema.groupMembers.personId, personId), isNotNull(schema.groups.externalId)))
        .orderBy(schema.groups.externalId);
      return rows.map(r => ({ externalId: r.externalId!, label: r.label }));
    },
    async members(groupExternalId) {
      const rows = await tx
        .select({ personId: schema.groupMembers.personId })
        .from(schema.groupMembers)
        .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMembers.groupId))
        .where(eq(schema.groups.externalId, groupExternalId))
        .orderBy(schema.groupMembers.personId);
      return rows.map(r => r.personId);
    },
    async groupCapabilities(organisationId) {
      return tx
        .select({
          groupExternalId: schema.groupCapabilities.groupExternalId,
          capability: schema.groupCapabilities.capability,
        })
        .from(schema.groupCapabilities)
        .where(eq(schema.groupCapabilities.organisationId, organisationId));
    },
    async unitLabels(ids, organisationId) {
      if (!ids.length) return {};
      const rows = await tx
        .select({ id: schema.units.id, label: schema.units.label })
        .from(schema.units)
        .where(and(inArray(schema.units.id, [...ids]), eq(schema.units.organisationId, organisationId)));
      return Object.fromEntries(rows.map(r => [r.id, r.label]));
    },
    async writeUnits(organisationId, units) {
      for (const u of units)
        await tx
          .insert(schema.units)
          .values({ id: u.id, organisationId, label: u.label })
          // The organisation too: a row left by another organisation's unit that is gone is taken over whole (D101).
          .onConflictDoUpdate({ target: schema.units.id, set: { label: u.label, organisationId } });
    },
    async replaceAssignments(personId, assignments) {
      await tx.delete(schema.assignments).where(eq(schema.assignments.personId, personId));
      if (assignments.length)
        await tx
          .insert(schema.assignments)
          .values(assignments.map(a => ({ personId, unitId: a.unitId, role: a.role })));
    },
    async grant(personId) {
      const [row] = await tx
        .select({
          unitId: schema.accessGrants.unitId,
          unitLabel: schema.accessGrants.unitLabel,
          role: schema.accessGrants.role,
          capabilities: schema.accessGrants.capabilities,
        })
        .from(schema.accessGrants)
        .where(eq(schema.accessGrants.personId, personId));
      return row;
    },
    async writeGrant(personId, grant) {
      if (!grant) {
        await tx.delete(schema.accessGrants).where(eq(schema.accessGrants.personId, personId));
        return;
      }
      const values = {
        unitId: grant.unitId,
        unitLabel: grant.unitLabel,
        role: grant.role,
        capabilities: [...grant.capabilities],
      };
      await tx
        .insert(schema.accessGrants)
        .values({ personId, ...values })
        .onConflictDoUpdate({ target: schema.accessGrants.personId, set: values });
    },
    audit: entry => writeAudit(tx, entry),
    async provisioner(tokenDigest, at) {
      const [row] = await tx
        .select(provisionerColumns)
        .from(schema.provisioners)
        .where(
          and(
            isNull(schema.provisioners.revokedAt),
            or(
              eq(schema.provisioners.tokenDigest, tokenDigest),
              and(
                eq(schema.provisioners.previousTokenDigest, tokenDigest),
                gt(schema.provisioners.previousValidUntil, new Date(at)),
              ),
            ),
          ),
        );
      return row && provisionerRecord(row);
    },
    async touchProvisioner(id, at, seenBefore) {
      // A second request waits for the first one's row and then finds the time already moved.
      const moved = await tx
        .update(schema.provisioners)
        .set({ lastSeenAt: new Date(at) })
        .where(
          and(
            eq(schema.provisioners.id, id),
            seenBefore === null
              ? isNull(schema.provisioners.lastSeenAt)
              : eq(schema.provisioners.lastSeenAt, new Date(seenBefore)),
          ),
        )
        .returning({ id: schema.provisioners.id });
      return moved.length > 0;
    },
    async provisioners(organisationId) {
      const rows = await tx
        .select({ ...provisionerColumns, ...previousColumns })
        .from(schema.provisioners)
        .where(and(eq(schema.provisioners.organisationId, organisationId), isNull(schema.provisioners.revokedAt)))
        .orderBy(schema.provisioners.id);
      return rows.map(({ previousTokenDigest, previousValidUntil, ...row }) => ({
        ...provisionerRecord(row),
        previousValidUntil: previousUntil(previousTokenDigest, previousValidUntil),
      }));
    },
    async provisionerById(id) {
      const [row] = await tx
        .select({
          id: schema.provisioners.id,
          organisationId: schema.provisioners.organisationId,
          label: schema.provisioners.label,
          revokedAt: schema.provisioners.revokedAt,
          ...previousColumns,
        })
        .from(schema.provisioners)
        .where(eq(schema.provisioners.id, id))
        .for('update');
      return (
        row && {
          id: row.id,
          organisationId: row.organisationId,
          label: row.label,
          revoked: row.revokedAt !== null,
          previousValidUntil: previousUntil(row.previousTokenDigest, row.previousValidUntil),
        }
      );
    },
    async issueProvisioner({ id, createdAt, ...record }) {
      const fresh = {
        ...record,
        createdAt: new Date(createdAt),
        revokedAt: null,
        lastSeenAt: null,
        previousTokenDigest: null,
        previousValidUntil: null,
      };
      // A new row, or else the organisation's own revoked row. The insert waits for another transaction that is
      // writing the same id and then does nothing, so of two issues at once one is taken and the other is not.
      const inserted = await tx
        .insert(schema.provisioners)
        .values({ id, ...fresh })
        .onConflictDoNothing({ target: schema.provisioners.id })
        .returning({ id: schema.provisioners.id });
      if (inserted.length) return true;
      const reissued = await tx
        .update(schema.provisioners)
        .set(fresh)
        .where(
          and(
            eq(schema.provisioners.id, id),
            isNotNull(schema.provisioners.revokedAt),
            eq(schema.provisioners.organisationId, record.organisationId),
          ),
        )
        .returning({ id: schema.provisioners.id });
      return reissued.length > 0;
    },
    async rotateProvisioner(id, tokenDigest, previousValidUntil) {
      await tx
        .update(schema.provisioners)
        .set({
          tokenDigest,
          // The column on the right is the row as it was: the digest this write replaces.
          previousTokenDigest: previousValidUntil === null ? null : sql`${schema.provisioners.tokenDigest}`,
          previousValidUntil: previousValidUntil === null ? null : new Date(previousValidUntil),
        })
        .where(eq(schema.provisioners.id, id));
    },
    async revokeProvisioner(id, at) {
      await tx
        .update(schema.provisioners)
        .set({ revokedAt: new Date(at), previousTokenDigest: null, previousValidUntil: null })
        .where(eq(schema.provisioners.id, id));
    },
    async usersAmong(organisationId, ids) {
      const found: string[] = [];
      // In pieces a statement takes: a group of ten thousand members is ten reads, not ten thousand.
      for (let at = 0; at < ids.length; at += 1000) {
        const rows = await tx
          .select({ id: schema.people.id })
          .from(schema.people)
          .where(
            and(eq(schema.people.organisationId, organisationId), inArray(schema.people.id, ids.slice(at, at + 1000))),
          );
        found.push(...rows.map(row => row.id));
      }
      return found;
    },
    async readUser(organisationId, id, lock) {
      const query = tx
        .select(userColumns)
        .from(schema.people)
        .where(and(eq(schema.people.id, id), eq(schema.people.organisationId, organisationId)));
      const [row] = await (lock ? query.for(ROW_LOCK) : query);
      return row && userRecord(row);
    },
    async findUser(by, value) {
      const [row] = await tx.select(userColumns).from(schema.people).where(userMatch(by, value));
      return row && userRecord(row);
    },
    async listUsers(organisationId, page, filter) {
      const where = filter
        ? and(eq(schema.people.organisationId, organisationId), userMatch(filter.attribute, filter.value))
        : eq(schema.people.organisationId, organisationId);
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.people)
        .where(where);
      const rows = page.count
        ? await tx
            .select(userColumns)
            .from(schema.people)
            .where(where)
            .orderBy(schema.people.id)
            .limit(page.count)
            .offset(page.startIndex - 1)
        : [];
      return { total: counted?.total ?? 0, rows: rows.map(userRecord) };
    },
    async insertUser(record) {
      await tx.insert(schema.people).values({
        ...record,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
      });
    },
    async updateUser(id, { updatedAt, ...fields }) {
      await tx
        .update(schema.people)
        .set({ ...fields, updatedAt: new Date(updatedAt) })
        .where(eq(schema.people.id, id));
    },
    async userGroups(personId) {
      return tx
        .select({ id: schema.groups.id, externalId: schema.groups.externalId, label: schema.groups.label })
        .from(schema.groupMembers)
        .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMembers.groupId))
        .where(eq(schema.groupMembers.personId, personId))
        .orderBy(schema.groups.id);
    },
    async readGroup(organisationId, id, lock) {
      const query = tx
        .select(groupColumns)
        .from(schema.groups)
        .where(and(eq(schema.groups.id, id), eq(schema.groups.organisationId, organisationId)));
      const [row] = await (lock ? query.for(ROW_LOCK) : query);
      return row && groupRecord(row);
    },
    async findGroup(by, value) {
      const [row] = await tx.select(groupColumns).from(schema.groups).where(eq(groupColumn[by], value));
      return row && groupRecord(row);
    },
    async listGroups(organisationId, page, filter) {
      // `displayName` without regard to case, as the served schema says (`caseExact: false`); `externalId` exactly.
      const where = filter
        ? and(
            eq(schema.groups.organisationId, organisationId),
            filter.attribute === 'label'
              ? sql`lower(${schema.groups.label}) = lower(${filter.value})`
              : eq(groupColumn[filter.attribute], filter.value),
          )
        : eq(schema.groups.organisationId, organisationId);
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.groups)
        .where(where);
      const rows = page.count
        ? await tx
            .select(groupColumns)
            .from(schema.groups)
            .where(where)
            .orderBy(schema.groups.id)
            .limit(page.count)
            .offset(page.startIndex - 1)
        : [];
      return { total: counted?.total ?? 0, rows: rows.map(groupRecord) };
    },
    async insertGroup(record) {
      await tx.insert(schema.groups).values({
        ...record,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
      });
    },
    async updateGroup(id, { updatedAt, ...fields }) {
      await tx
        .update(schema.groups)
        .set({ ...fields, updatedAt: new Date(updatedAt) })
        .where(eq(schema.groups.id, id));
    },
    async deleteGroup(id) {
      await tx.delete(schema.groups).where(eq(schema.groups.id, id));
    },
    async groupMembers(groupId) {
      return tx
        .select({ id: schema.people.id, name: schema.people.name })
        .from(schema.groupMembers)
        .innerJoin(schema.people, eq(schema.people.id, schema.groupMembers.personId))
        .where(eq(schema.groupMembers.groupId, groupId))
        .orderBy(schema.people.id);
    },
    async setGroupMembers(groupId, personIds) {
      // Only who came and who went is written, a few thousand rows a statement: a group of ten thousand that gains one
      // member is one row, and a group of any size stays under the driver's limit on parameters.
      const wanted = new Set(personIds),
        held = new Set(
          (
            await tx
              .select({ personId: schema.groupMembers.personId })
              .from(schema.groupMembers)
              .where(eq(schema.groupMembers.groupId, groupId))
          ).map(r => r.personId),
        ),
        gone = [...held].filter(id => !wanted.has(id)),
        come = [...wanted].filter(id => !held.has(id));
      for (let i = 0; i < gone.length; i += MEMBER_BATCH)
        await tx
          .delete(schema.groupMembers)
          .where(
            and(
              eq(schema.groupMembers.groupId, groupId),
              inArray(schema.groupMembers.personId, gone.slice(i, i + MEMBER_BATCH)),
            ),
          );
      for (let i = 0; i < come.length; i += MEMBER_BATCH)
        await tx
          .insert(schema.groupMembers)
          .values(come.slice(i, i + MEMBER_BATCH).map(personId => ({ groupId, personId })));
    },
    async searchUsers(organisationId, search, page) {
      const where = and(eq(schema.people.organisationId, organisationId), ...userSearchConditions(search));
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.people)
        .where(where);
      // Swedish order (å, ä and ö after z) from the ICU collation, which every build of PostgreSQL with ICU carries.
      const rows = page.count
        ? await tx
            .select(userColumns)
            .from(schema.people)
            .where(where)
            .orderBy(sql`${schema.people.name} collate "sv-x-icu"`, schema.people.id)
            .limit(page.count)
            .offset(page.startIndex - 1)
        : [];
      return { total: counted?.total ?? 0, rows: rows.map(userRecord) };
    },
    async assignmentsOf(personId) {
      return tx
        .select({ unitId: schema.assignments.unitId, unitLabel: schema.units.label, role: schema.assignments.role })
        .from(schema.assignments)
        .innerJoin(schema.units, eq(schema.units.id, schema.assignments.unitId))
        .where(eq(schema.assignments.personId, personId))
        .orderBy(schema.assignments.unitId);
    },
    async unitPeople(unitIds, organisationId) {
      if (!unitIds.length) return {};
      const rows = await tx
        .select({
          unitId: schema.assignments.unitId,
          id: schema.people.id,
          name: schema.people.name,
          userName: schema.people.userName,
          email: schema.people.email,
          role: schema.assignments.role,
          enabled: schema.people.enabled,
        })
        .from(schema.assignments)
        .innerJoin(schema.people, eq(schema.people.id, schema.assignments.personId))
        .where(
          and(
            inArray(schema.assignments.unitId, [...unitIds]),
            organisationId === undefined ? undefined : eq(schema.people.organisationId, organisationId),
          ),
        )
        .orderBy(schema.people.id);
      const byUnit: Awaited<ReturnType<ProvisionTx['unitPeople']>> = {};
      for (const { unitId, ...person } of rows) (byUnit[unitId] ??= []).push(person);
      return byUnit;
    },
    async childUnits(unitId) {
      const rows = await tx
        .select({ externalId: schema.groups.externalId, label: schema.groups.label })
        .from(schema.groups)
        .where(and(eq(schema.groups.parentUnitId, unitId), isUnitGroup))
        .orderBy(schema.groups.externalId);
      return rows.map(r => ({ id: unitGroupOf(r.externalId)!, label: r.label }));
    },
    async unitTree(organisationId, ids) {
      const rows = await tx
        .select({
          externalId: schema.groups.externalId,
          label: schema.groups.label,
          parentUnitId: schema.groups.parentUnitId,
        })
        .from(schema.groups)
        .where(
          and(
            eq(schema.groups.organisationId, organisationId),
            ids
              ? inArray(
                  schema.groups.externalId,
                  ids.map(id => UNIT_KEY + id),
                )
              : isUnitGroup,
          ),
        )
        .orderBy(schema.groups.externalId);
      return rows.map(r => ({ id: unitGroupOf(r.externalId)!, label: r.label, parentId: r.parentUnitId }));
    },
    async placements(organisationId) {
      return tx
        .select({
          personId: schema.people.id,
          name: schema.people.name,
          enabled: schema.people.enabled,
          unitId: schema.assignments.unitId,
          role: schema.assignments.role,
        })
        .from(schema.people)
        .leftJoin(schema.assignments, eq(schema.assignments.personId, schema.people.id))
        .where(eq(schema.people.organisationId, organisationId))
        .orderBy(schema.people.id, schema.assignments.unitId);
    },
    async bound(personId) {
      const [row] = await tx
        .select({ personId: schema.identityBindings.personId })
        .from(schema.identityBindings)
        .where(eq(schema.identityBindings.personId, personId))
        .limit(1);
      return !!row;
    },
    async setGroupCapability(organisationId, groupExternalId, capability, present) {
      if (present) {
        const inserted = await tx
          .insert(schema.groupCapabilities)
          .values({ organisationId, groupExternalId, capability })
          .onConflictDoNothing()
          .returning({ capability: schema.groupCapabilities.capability });
        return inserted.length > 0;
      }
      const removed = await tx
        .delete(schema.groupCapabilities)
        .where(
          and(
            eq(schema.groupCapabilities.organisationId, organisationId),
            eq(schema.groupCapabilities.groupExternalId, groupExternalId),
            eq(schema.groupCapabilities.capability, capability),
          ),
        )
        .returning({ capability: schema.groupCapabilities.capability });
      return removed.length > 0;
    },
  });
  return { transaction: fn => database().transaction(tx => fn(txOf(tx))) };
}
