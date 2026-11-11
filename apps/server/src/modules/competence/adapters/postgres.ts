import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import { TypeNameTaken, type CompetenceStore, type CompetenceTx, type HoldingRecord, type TypeRecord } from '../model';

const { competenceTypes: types, competenceHoldings: holdings, people, audit } = schema;
type TypeRow = typeof types.$inferSelect;
type HoldingRow = typeof holdings.$inferSelect;
const iso = (at: Date | null) => (at === null ? null : at.toISOString());
const date = (at: string | null) => (at === null ? null : new Date(at));
const sv = (a: string, b: string) => a.localeCompare(b, 'sv');

/** The unique index `competence_type_name` fired; the driver may wrap the error once. */
function nameTaken(error: unknown) {
  const e = error as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  return (
    (e?.code ?? e?.cause?.code) === '23505' &&
    (e?.constraint_name ?? e?.cause?.constraint_name) === 'competence_type_name'
  );
}
/** Run a write of the catalogue, turning the name index's refusal into the port's `TypeNameTaken`. */
async function named(write: () => Promise<unknown>) {
  try {
    await write();
  } catch (error) {
    if (nameTaken(error)) throw new TypeNameTaken();
    throw error;
  }
}
const typeOf = (r: TypeRow): TypeRecord => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  archivedAt: iso(r.archivedAt),
});
const holdingOf = (r: HoldingRow): HoldingRecord => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  revokedAt: iso(r.revokedAt),
});

/**
 * The competence tables (D101) on one Postgres transaction. Reads that a write follows take a row lock. The catalogue's
 * order is Swedish and is sorted here, since the database's collation is not Clew's to choose.
 */
export function competenceTx(tx: Transaction): CompetenceTx {
  return {
    async types(organisationId, options = {}) {
      const rows = await tx
        .select()
        .from(types)
        .where(and(eq(types.organisationId, organisationId), options.archived ? undefined : isNull(types.archivedAt)));
      return rows.map(typeOf).sort((a, b) => sv(a.area, b.area) || sv(a.name, b.name) || a.id.localeCompare(b.id));
    },
    async type(id) {
      const [r] = await tx.select().from(types).where(eq(types.id, id)).for('update');
      return r ? typeOf(r) : undefined;
    },
    async typesById(ids) {
      if (!ids.length) return [];
      const rows = await tx
        .select()
        .from(types)
        .where(inArray(types.id, [...ids]));
      return rows.map(typeOf);
    },
    async insertType(t) {
      await named(() =>
        tx.insert(types).values({ ...t, createdAt: new Date(t.createdAt), archivedAt: date(t.archivedAt) }),
      );
    },
    async updateType(id, patch) {
      const set: Partial<typeof types.$inferInsert> = {};
      if ('name' in patch && patch.name !== undefined) set.name = patch.name;
      if ('area' in patch && patch.area !== undefined) set.area = patch.area;
      if ('kind' in patch && patch.kind !== undefined) set.kind = patch.kind;
      if ('validityMonths' in patch) set.validityMonths = patch.validityMonths ?? null;
      if ('archivedAt' in patch) set.archivedAt = date(patch.archivedAt ?? null);
      if (!Object.keys(set).length) return;
      await named(() => tx.update(types).set(set).where(eq(types.id, id)));
    },
    async holdingsOf(personIds) {
      if (!personIds.length) return [];
      const rows = await tx
        .select()
        .from(holdings)
        .where(inArray(holdings.personId, [...personIds]))
        .orderBy(asc(holdings.createdAt), asc(holdings.id));
      return rows.map(holdingOf);
    },
    async holdingsOfType(typeId) {
      const rows = await tx
        .select()
        .from(holdings)
        .where(eq(holdings.typeId, typeId))
        .orderBy(asc(holdings.createdAt), asc(holdings.id));
      return rows.map(holdingOf);
    },
    async holding(id) {
      const [r] = await tx.select().from(holdings).where(eq(holdings.id, id)).for('update');
      return r ? holdingOf(r) : undefined;
    },
    async insertHolding(h) {
      await tx.insert(holdings).values({ ...h, createdAt: new Date(h.createdAt), revokedAt: date(h.revokedAt) });
    },
    async updateHolding(id, patch) {
      const set: Partial<typeof holdings.$inferInsert> = {};
      if ('state' in patch && patch.state !== undefined) set.state = patch.state;
      if ('revokedAt' in patch) set.revokedAt = date(patch.revokedAt ?? null);
      if ('revokedBy' in patch) set.revokedBy = patch.revokedBy ?? null;
      if (!Object.keys(set).length) return;
      await tx.update(holdings).set(set).where(eq(holdings.id, id));
    },
    async persons(ids) {
      if (!ids.length) return [];
      return tx
        .select({ id: people.id, organisationId: people.organisationId, name: people.name, userName: people.userName })
        .from(people)
        .where(inArray(people.id, [...ids]));
    },
    async erasePerson(personId) {
      const removed = await tx.delete(holdings).where(eq(holdings.personId, personId)).returning({ id: holdings.id });
      const cleared = new Set<string>();
      for (const column of ['registeredBy', 'revokedBy'] as const)
        for (const r of await tx
          .update(holdings)
          .set({ [column]: null })
          .where(eq(holdings[column], personId))
          .returning({ id: holdings.id }))
          cleared.add(r.id);
      return { holdings: removed.length, cleared: cleared.size };
    },
    async exportOrganisation(organisationId) {
      const typeRows = await tx
        .select()
        .from(types)
        .where(eq(types.organisationId, organisationId))
        .orderBy(asc(types.createdAt), asc(types.id));
      const ids = typeRows.map(r => r.id);
      if (!ids.length) return { types: [], holdings: [] };
      const holdingRows = await tx
        .select()
        .from(holdings)
        .where(inArray(holdings.typeId, ids))
        .orderBy(asc(holdings.createdAt), asc(holdings.id));
      return { types: typeRows.map(typeOf), holdings: holdingRows.map(holdingOf) };
    },
    async audit(e) {
      await tx.insert(audit).values({
        actor: e.actor,
        action: e.action,
        subject: e.subject,
        createdAt: new Date(e.at),
        details: e.details ?? {},
      });
    },
  };
}
export function postgresCompetenceStore(): CompetenceStore {
  return { transaction: fn => database().transaction(tx => fn(competenceTx(tx))) };
}
