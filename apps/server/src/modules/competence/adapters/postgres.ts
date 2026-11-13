import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { schema, type Transaction } from '@clew/db';
import { enqueueWorkflow, type DurableQueue } from '@clew/db/durable';
import {
  TypeNameTaken,
  type CompetenceCardsTx,
  type CompetenceTx,
  type HoldingRecord,
  type SourceMapping,
  type SourceReadCounts,
  type SourceRecord,
  type TypeRecord,
} from '../model';

const {
  competenceTypes: types,
  competenceHoldings: holdings,
  competenceSourceMappings: mappings,
  competenceSources: sources,
  people,
  audit,
} = schema;
type TypeRow = typeof types.$inferSelect;
type HoldingRow = typeof holdings.$inferSelect;
type MappingRow = typeof mappings.$inferSelect;
type SourceRow = typeof sources.$inferSelect;
const iso = (at: Date | null) => (at === null ? null : at.toISOString());
const date = (at: string | null) => (at === null ? null : new Date(at));
const sv = (a: string, b: string) => a.localeCompare(b, 'sv');
/** A statement's parameters stay well under Postgres's limit when a long list is written or matched in slices. */
const SLICE = 1000;
const slices = <T>(rows: readonly T[]) =>
  Array.from({ length: Math.ceil(rows.length / SLICE) }, (_, i) => rows.slice(i * SLICE, (i + 1) * SLICE));

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
const holdingOf = ({ connectorId, sourceId, sourceType, sourceLabel, readAt, ...r }: HoldingRow): HoldingRecord => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  revokedAt: iso(r.revokedAt),
  copy:
    connectorId && sourceId && sourceType && sourceLabel && readAt
      ? { connectorId, sourceId, sourceType, sourceLabel, readAt: readAt.toISOString() }
      : null,
});
/** A holding as its row: the copy's columns empty on one registered in Clew. */
const rowOf = ({ copy, ...h }: HoldingRecord): typeof holdings.$inferInsert => ({
  ...h,
  createdAt: new Date(h.createdAt),
  revokedAt: date(h.revokedAt),
  connectorId: copy?.connectorId ?? null,
  sourceId: copy?.sourceId ?? null,
  sourceType: copy?.sourceType ?? null,
  sourceLabel: copy?.sourceLabel ?? null,
  readAt: copy ? new Date(copy.readAt) : null,
});
const mappingOf = (r: MappingRow): SourceMapping => ({ ...r, mappedAt: r.mappedAt.toISOString() });
const sourceOf = (r: SourceRow): SourceRecord => ({
  ...r,
  claimedAt: iso(r.claimedAt),
  leaseUntil: iso(r.leaseUntil),
  startedAt: iso(r.startedAt),
  finishedAt: iso(r.finishedAt),
  counts: (r.counts as SourceReadCounts | null) ?? null,
});

/**
 * The competence tables (D108) on one Postgres transaction. Reads that a write follows take a row lock. The catalogue's
 * order is Swedish and is sorted here, since the database's collation is not Clew's to choose. `durable` names the
 * engine's application and queue, so a workflow start commits with the transaction that decides it (D86). `cards` is
 * the person's own cards on the same transaction, which composition shares with the thread store
 * (`composition/competence.ts`).
 */
export function competenceTx(tx: Transaction, durable: DurableQueue, cards: CompetenceCardsTx): CompetenceTx {
  return {
    cards,
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
      await tx.insert(holdings).values(rowOf(h));
    },
    async updateHolding(id, patch) {
      const set: Partial<typeof holdings.$inferInsert> = {};
      if ('state' in patch && patch.state !== undefined) set.state = patch.state;
      if ('revokedAt' in patch) set.revokedAt = date(patch.revokedAt ?? null);
      if ('revokedBy' in patch) set.revokedBy = patch.revokedBy ?? null;
      if (!Object.keys(set).length) return;
      await tx.update(holdings).set(set).where(eq(holdings.id, id));
    },
    async copiedFrom(connectorId) {
      const rows = await tx
        .select()
        .from(holdings)
        .where(eq(holdings.connectorId, connectorId))
        .orderBy(asc(holdings.createdAt), asc(holdings.id));
      return rows.map(holdingOf);
    },
    async copiedPeople(connectorId) {
      const rows = await tx
        .selectDistinct({ personId: holdings.personId })
        .from(holdings)
        .where(eq(holdings.connectorId, connectorId));
      return rows.map(r => r.personId);
    },
    async removeCopied(connectorId, holdingIds) {
      let n = 0;
      for (const slice of slices(holdingIds))
        n += (
          await tx
            .delete(holdings)
            .where(and(eq(holdings.connectorId, connectorId), inArray(holdings.id, slice)))
            .returning({ id: holdings.id })
        ).length;
      return n;
    },
    async putCopied(rows) {
      for (const slice of slices(rows)) {
        if (slice.some(r => !r.copy)) throw new Error('A copied row carries its source.');
        await tx
          .insert(holdings)
          .values(slice.map(rowOf))
          .onConflictDoUpdate({
            target: holdings.id,
            set: {
              personId: sql`excluded.person_id`,
              typeId: sql`excluded.type_id`,
              issuedOn: sql`excluded.issued_on`,
              expiresOn: sql`excluded.expires_on`,
              state: sql`excluded.state`,
              revokedAt: sql`excluded.revoked_at`,
              revokedBy: sql`excluded.revoked_by`,
              sourceType: sql`excluded.source_type`,
              sourceLabel: sql`excluded.source_label`,
              readAt: sql`excluded.read_at`,
            },
          });
      }
    },
    async touchCopied(connectorId, sourceIds, at) {
      for (const slice of slices(sourceIds))
        await tx
          .update(holdings)
          .set({ readAt: new Date(at) })
          .where(and(eq(holdings.connectorId, connectorId), inArray(holdings.sourceId, slice)));
    },
    async retypeCopied(connectorId, organisationId, sourceType, typeId) {
      const rows = await tx
        .update(holdings)
        .set({ typeId })
        .where(
          and(
            eq(holdings.connectorId, connectorId),
            eq(holdings.sourceType, sourceType),
            inArray(
              holdings.personId,
              tx.select({ id: people.id }).from(people).where(eq(people.organisationId, organisationId)),
            ),
          ),
        )
        .returning({ id: holdings.id });
      return rows.length;
    },
    async sourceTypes(organisationId) {
      const rows = await tx
        .select({
          connectorId: holdings.connectorId,
          sourceType: holdings.sourceType,
          // The label read last, as the source names the type now; on a tie the greatest.
          label: sql<string>`(array_agg(${holdings.sourceLabel} ORDER BY ${holdings.readAt} DESC, ${holdings.sourceLabel} DESC))[1]`,
          holdings: sql<number>`count(*)::int`,
        })
        .from(holdings)
        .innerJoin(people, eq(people.id, holdings.personId))
        .where(
          and(
            isNotNull(holdings.connectorId),
            ne(holdings.state, 'revoked'),
            eq(people.organisationId, organisationId),
            eq(people.enabled, true),
          ),
        )
        .groupBy(holdings.connectorId, holdings.sourceType)
        .orderBy(asc(holdings.connectorId), asc(holdings.sourceType));
      return rows.map(r => ({
        connectorId: r.connectorId!,
        sourceType: r.sourceType!,
        label: r.label,
        holdings: Number(r.holdings),
      }));
    },
    async mappings(organisationId, connectorId) {
      const rows = await tx
        .select()
        .from(mappings)
        .where(
          and(
            eq(mappings.organisationId, organisationId),
            connectorId === undefined ? undefined : eq(mappings.connectorId, connectorId),
          ),
        );
      return rows.map(mappingOf);
    },
    async mappingsOf(connectorId) {
      return (await tx.select().from(mappings).where(eq(mappings.connectorId, connectorId))).map(mappingOf);
    },
    async putMapping(m) {
      await tx
        .insert(mappings)
        .values({ ...m, mappedAt: new Date(m.mappedAt) })
        .onConflictDoUpdate({
          target: [mappings.connectorId, mappings.organisationId, mappings.sourceType],
          set: { typeId: m.typeId, mappedBy: m.mappedBy, mappedAt: new Date(m.mappedAt) },
        });
    },
    async removeMapping(connectorId, organisationId, sourceType) {
      const removed = await tx
        .delete(mappings)
        .where(
          and(
            eq(mappings.connectorId, connectorId),
            eq(mappings.organisationId, organisationId),
            eq(mappings.sourceType, sourceType),
          ),
        )
        .returning({ id: mappings.sourceType });
      return removed.length > 0;
    },
    async sources() {
      return (await tx.select().from(sources).orderBy(asc(sources.connectorId))).map(sourceOf);
    },
    async source(connectorId) {
      const [r] = await tx.select().from(sources).where(eq(sources.connectorId, connectorId)).for('update');
      return r ? sourceOf(r) : undefined;
    },
    async openSource(blank) {
      // The insert waits for another transaction that is inserting the same source, and then does nothing; the read
      // after it sees what that transaction committed and takes the row's lock.
      await tx
        .insert(sources)
        .values({
          connectorId: blank.connectorId,
          source: blank.source,
          run: blank.run,
          claimedAt: date(blank.claimedAt),
          leaseUntil: date(blank.leaseUntil),
          startedAt: date(blank.startedAt),
          finishedAt: date(blank.finishedAt),
          outcome: blank.outcome,
          counts: blank.counts as unknown as Record<string, number> | null,
        })
        .onConflictDoNothing({ target: sources.connectorId });
      const [r] = await tx.select().from(sources).where(eq(sources.connectorId, blank.connectorId)).for('update');
      if (!r) throw new Error('A source that was just opened has no record.');
      return sourceOf(r);
    },
    async putSource(s) {
      const set = {
        source: s.source,
        run: s.run,
        claimedAt: date(s.claimedAt),
        leaseUntil: date(s.leaseUntil),
        startedAt: date(s.startedAt),
        finishedAt: date(s.finishedAt),
        outcome: s.outcome,
        counts: s.counts as unknown as Record<string, number> | null,
      };
      await tx
        .insert(sources)
        .values({ connectorId: s.connectorId, ...set })
        .onConflictDoUpdate({ target: sources.connectorId, set });
    },
    async forgetSource(connectorId) {
      // The source's row first, as the copy's write and a mapping take it: the two wait for each other, never deadlock.
      await tx
        .select({ id: sources.connectorId })
        .from(sources)
        .where(eq(sources.connectorId, connectorId))
        .for('update');
      const removed = await tx
        .delete(holdings)
        .where(eq(holdings.connectorId, connectorId))
        .returning({ id: holdings.id });
      const unmapped = await tx
        .delete(mappings)
        .where(eq(mappings.connectorId, connectorId))
        .returning({ id: mappings.sourceType });
      await tx.delete(sources).where(eq(sources.connectorId, connectorId));
      return { holdings: removed.length, mappings: unmapped.length };
    },
    enqueue: start => enqueueWorkflow(tx, durable, start),
    async persons(ids) {
      if (!ids.length) return [];
      return tx
        .select({
          id: people.id,
          organisationId: people.organisationId,
          name: people.name,
          userName: people.userName,
          enabled: people.enabled,
        })
        .from(people)
        .where(inArray(people.id, [...ids]));
    },
    async activeByUserName(userNames) {
      const found = [];
      for (const slice of slices([...new Set(userNames.map(n => n.toLowerCase()))]))
        found.push(
          ...(await tx
            .select({
              id: people.id,
              organisationId: people.organisationId,
              name: people.name,
              userName: people.userName,
              enabled: people.enabled,
            })
            .from(people)
            .where(and(eq(people.enabled, true), inArray(sql`lower(${people.userName})`, slice)))),
        );
      return found;
    },
    async activeIds(personIds) {
      const found = new Set<string>();
      for (const slice of slices([...new Set(personIds)]))
        for (const r of await tx
          .select({ id: people.id })
          .from(people)
          .where(and(inArray(people.id, slice), eq(people.enabled, true))))
          found.add(r.id);
      return found;
    },
    async erasePerson(personId) {
      // The row of every source, first and in one order, as the copy's write takes its own before it asks who is
      // active: a read that is writing finishes before the person's rows go, and never puts them back afterwards. Every
      // source and not only those the person has rows from: the write of a person's very first copied row has nothing
      // of theirs to be found by, and a source has its row from the moment a run claims it.
      await tx.select({ id: sources.connectorId }).from(sources).orderBy(asc(sources.connectorId)).for('update');
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
      const holdingRows = await tx
        .select({ holding: holdings })
        .from(holdings)
        .innerJoin(people, eq(people.id, holdings.personId))
        .where(eq(people.organisationId, organisationId))
        .orderBy(asc(holdings.createdAt), asc(holdings.id));
      const mappingRows = await tx
        .select()
        .from(mappings)
        .where(eq(mappings.organisationId, organisationId))
        .orderBy(asc(mappings.connectorId), asc(mappings.sourceType), asc(mappings.mappedAt));
      return {
        types: typeRows.map(typeOf),
        holdings: holdingRows.map(r => holdingOf(r.holding)),
        mappings: mappingRows.map(mappingOf),
      };
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
