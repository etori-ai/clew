import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, inArray, like, sql } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresProvisionStore } from '../../apps/server/src/modules/people/adapters/postgres';
import { provisioningContract, type ProvisioningHarness } from '../provisioning-store-contract';

/** The provisioning contract on Postgres (D68, D85). Run with `bun run test:db` inside the devcontainer. */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const prefixes: string[] = [],
  createdGroups: string[] = [];
afterAll(async () => {
  const db = database();
  for (const p of prefixes) {
    const people = (
      await db
        .select({ id: schema.people.id })
        .from(schema.people)
        .where(like(schema.people.id, p + '%'))
    ).map(r => r.id);
    await db.delete(schema.groupCapabilities).where(like(schema.groupCapabilities.groupExternalId, '%' + p + '%'));
    if (people.length) {
      await db.delete(schema.identityBindings).where(inArray(schema.identityBindings.personId, people));
      await db.delete(schema.audit).where(
        inArray(
          schema.audit.subject,
          people.map(id => 'person:' + id),
        ),
      );
      await db.delete(schema.groupMembers).where(inArray(schema.groupMembers.personId, people));
      await db.delete(schema.assignments).where(inArray(schema.assignments.personId, people));
      await db.delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, people));
    }
    await db.delete(schema.groups).where(like(schema.groups.id, '%' + p + '%'));
    await db.delete(schema.provisioners).where(like(schema.provisioners.id, p + '%'));
    await db.delete(schema.units).where(like(schema.units.id, p + '%'));
    if (people.length) await db.delete(schema.people).where(inArray(schema.people.id, people));
  }
  // Capability groups the harness created because the development stack had not; one that existed is left as found.
  if (createdGroups.length) {
    await db.delete(schema.groupMembers).where(inArray(schema.groupMembers.groupId, createdGroups));
    await db.delete(schema.groups).where(inArray(schema.groups.id, createdGroups));
  }
});
provisioningContract('postgres', async (): Promise<ProvisioningHarness> => {
  const prefix = 'test-prov-' + randomUUID().slice(0, 8);
  prefixes.push(prefix);
  const db = database();
  // Capability groups have fixed external ids that the development stack's provisioner also writes: the harness reuses a
  // group that exists, creates one that does not and removes only what it created. Members are keyed by the group's id.
  const groupIds = new Map<string, string>();
  const resolve = async (externalId: string) => {
    const known = groupIds.get(externalId);
    if (known) return known;
    const [row] = await db
      .select({ id: schema.groups.id })
      .from(schema.groups)
      .where(eq(schema.groups.externalId, externalId));
    if (!row) throw new Error('No group ' + externalId);
    groupIds.set(externalId, row.id);
    return row.id;
  };
  return {
    store: postgresProvisionStore(),
    prefix,
    async seed(seed) {
      await db.transaction(async tx => {
        await tx.insert(schema.people).values(seed.people.map(p => ({ ...p, name: p.id })));
        for (const g of seed.groups) {
          const created = await tx
            .insert(schema.groups)
            .values({ id: prefix + ':' + g.externalId, organisationId: 'org', ...g })
            .onConflictDoNothing()
            .returning({ id: schema.groups.id });
          if (created[0]) createdGroups.push(created[0].id);
        }
        if (seed.groupCapabilities?.length)
          await tx
            .insert(schema.groupCapabilities)
            .values(seed.groupCapabilities.map(row => ({ organisationId: 'org', ...row })));
        if (seed.units?.length) await tx.insert(schema.units).values(seed.units);
      });
      const members: Array<{ groupId: string; personId: string }> = [];
      for (const m of seed.members) members.push({ groupId: await resolve(m.group), personId: m.person });
      if (members.length) await db.insert(schema.groupMembers).values(members);
    },
    async setMembers(members) {
      const rows: Array<{ groupId: string; personId: string }> = [];
      for (const m of members) rows.push({ groupId: await resolve(m.group), personId: m.person });
      await db.transaction(async tx => {
        await tx.delete(schema.groupMembers).where(like(schema.groupMembers.personId, prefix + '%'));
        if (rows.length) await tx.insert(schema.groupMembers).values(rows);
      });
    },
    async setGroupCapabilities(rows) {
      await db.transaction(async tx => {
        await tx
          .delete(schema.groupCapabilities)
          .where(like(schema.groupCapabilities.groupExternalId, '%' + prefix + '%'));
        if (rows.length)
          await tx.insert(schema.groupCapabilities).values(rows.map(row => ({ organisationId: 'org', ...row })));
      });
    },
    async legacyGrant(id, grant) {
      await db.insert(schema.accessGrants).values({ personId: id, ...grant });
    },
    async grant(id) {
      const [row] = await db
        .select({
          unitId: schema.accessGrants.unitId,
          unitLabel: schema.accessGrants.unitLabel,
          role: schema.accessGrants.role,
          capabilities: schema.accessGrants.capabilities,
        })
        .from(schema.accessGrants)
        .where(eq(schema.accessGrants.personId, id));
      return row;
    },
    async assignments(id) {
      return db
        .select({ unitId: schema.assignments.unitId, role: schema.assignments.role })
        .from(schema.assignments)
        .where(eq(schema.assignments.personId, id))
        .orderBy(schema.assignments.unitId);
    },
    async unitLabel(id) {
      const [row] = await db.select({ label: schema.units.label }).from(schema.units).where(eq(schema.units.id, id));
      return row?.label;
    },
    async audit(id) {
      return db
        .select({ actor: schema.audit.actor, action: schema.audit.action, details: schema.audit.details })
        .from(schema.audit)
        .where(eq(schema.audit.subject, 'person:' + id))
        .orderBy(schema.audit.id);
    },
  };
});
import { scimStoreContract } from '../scim-store-contract';
scimStoreContract('postgres', async () => {
  const prefix = 'test-scim-' + randomUUID().slice(0, 8);
  prefixes.push(prefix);
  return {
    store: postgresProvisionStore(),
    prefix,
    async seedProvisioner(p, digest, revoked, previous) {
      await database()
        .insert(schema.provisioners)
        .values({
          ...p,
          tokenDigest: digest,
          createdBy: 'test',
          revokedAt: revoked ? new Date() : null,
          previousTokenDigest: previous?.digest ?? null,
          previousValidUntil: previous ? new Date(previous.until) : null,
        });
    },
    async bind(personId) {
      await database()
        .insert(schema.identityBindings)
        .values({ issuer: 'https://idp.test/' + prefix, subject: personId, personId });
    },
  };
});
/**
 * What the store's comparisons and locks rely on, pinned on any database: a database created with the locale C is a
 * supported one (D100), and only there does a plain `lower` leave å, ä and ö as they are, so the contract's case with
 * them passes elsewhere whatever the index says.
 */
test('auth_person holds a source key unique where one is set, and a user name unique as ICU folds it whatever the database collates (S4, L13)', async () => {
  const rows = await database().execute<{ indexname: string; indexdef: string }>(
    sql`select indexname, indexdef from pg_indexes where tablename = 'auth_person' and indexname in ('auth_person_external_id', 'auth_person_user_name')`,
  );
  const defined = Object.fromEntries([...rows].map(row => [row.indexname, row.indexdef]));
  // Partial, so that the column is no key to PostgreSQL's row locks: a new key is written beside a membership insert.
  expect(defined.auth_person_external_id).toContain('UNIQUE INDEX auth_person_external_id');
  expect(defined.auth_person_external_id).toEndWith('(external_id) WHERE (external_id IS NOT NULL)');
  expect(defined.auth_person_user_name).toContain('UNIQUE INDEX auth_person_user_name');
  expect(defined.auth_person_user_name).toEndWith('(lower((user_name COLLATE "und-x-icu")))');
});
