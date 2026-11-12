import { and, asc, eq, inArray, isNotNull, isNull, like, ne, sql } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import { enqueueWorkflow, type DurableQueue } from '@clew/db/durable';
import { UNIT_KEY } from '@clew/contracts/scim-group-key';
import {
  PendingTaken,
  RequirementTaken,
  ShareTargetTaken,
  TypeNameTaken,
  type ApprovalWorkItemTx,
  type CompetenceStore,
  type CompetenceTx,
  type HoldingRecord,
  type Placed,
  type RequirementRecord,
  type ShareTargetRecord,
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
  competenceRequirements: requirements,
  competenceShareTargets: targets,
  positions,
  personPositions,
  groups,
  assignments,
  people,
  audit,
} = schema;
type TypeRow = typeof types.$inferSelect;
type HoldingRow = typeof holdings.$inferSelect;
type MappingRow = typeof mappings.$inferSelect;
type SourceRow = typeof sources.$inferSelect;
type RequirementRow = typeof requirements.$inferSelect;
type TargetRow = typeof targets.$inferSelect;
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
/** Which unique index refused a write, or undefined for another error; the driver may wrap the error once. */
function uniqueIndexOf(error: unknown): string | undefined {
  const e = error as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  return (e?.code ?? e?.cause?.code) === '23505' ? (e?.constraint_name ?? e?.cause?.constraint_name) : undefined;
}
/** Run a write, turning a refusal of one of these unique indexes into `taken`. */
async function once(write: () => Promise<unknown>, indexes: readonly string[], taken: () => Error) {
  try {
    await write();
  } catch (error) {
    const index = uniqueIndexOf(error);
    if (index && indexes.includes(index)) throw taken();
    throw error;
  }
}
const REQUIREMENT_INDEXES = [
  'competence_requirement_position',
  'competence_requirement_unit',
  'competence_requirement_person',
];
const TARGET_INDEXES = ['competence_share_target_unit', 'competence_share_target_organisation'];
const requirementOf = (r: RequirementRow): RequirementRecord => ({ ...r, createdAt: r.createdAt.toISOString() });
const targetOf = (r: TargetRow): ShareTargetRecord => ({ ...r, createdAt: r.createdAt.toISOString() });
const typeOf = (r: TypeRow): TypeRecord => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  archivedAt: iso(r.archivedAt),
});
const holdingOf = ({ connectorId, sourceId, sourceType, sourceLabel, readAt, ...r }: HoldingRow): HoldingRecord => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  revokedAt: iso(r.revokedAt),
  decidedAt: iso(r.decidedAt),
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
  decidedAt: date(h.decidedAt),
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
 * A store with no approval cards (D108 item 7), for a caller that registers nothing of a person's own: a scheduled read,
 * an operator's script, the store contract. Opening or closing a card is refused, since its approval would be lost; with
 * no card there is nothing to remove. Composition builds the server's store with the cards (`competenceStoreWithCards`).
 */
const noCards: ApprovalWorkItemTx = {
  async open() {
    throw new Error('This competence store has no approval cards: build it with competenceStoreWithCards.');
  },
  async close() {
    throw new Error('This competence store has no approval cards: build it with competenceStoreWithCards.');
  },
  async remove() {},
  async removeAbout() {},
  async removeOwned() {},
};
/**
 * The competence tables (D108) on one Postgres transaction. Reads that a write follows take a row lock. The catalogue's
 * order is Swedish and is sorted here, since the database's collation is not Clew's to choose. `durable` names the
 * engine's application and queue, so a workflow start commits with the transaction that decides it (D86). `workItems` is
 * the approvals' cards over the same transaction (D108 item 7).
 */
export function competenceTx(
  tx: Transaction,
  durable: DurableQueue,
  workItems: ApprovalWorkItemTx = noCards,
): CompetenceTx {
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
      await once(
        () => tx.insert(holdings).values(rowOf(h)),
        ['competence_holding_pending'],
        () => new PendingTaken(),
      );
    },
    async updateHolding(id, patch) {
      const set: Partial<typeof holdings.$inferInsert> = {};
      if ('state' in patch && patch.state !== undefined) set.state = patch.state;
      if ('revokedAt' in patch) set.revokedAt = date(patch.revokedAt ?? null);
      if ('revokedBy' in patch) set.revokedBy = patch.revokedBy ?? null;
      if ('decidedAt' in patch) set.decidedAt = date(patch.decidedAt ?? null);
      if ('decidedBy' in patch) set.decidedBy = patch.decidedBy ?? null;
      if (!Object.keys(set).length) return;
      await once(
        () => tx.update(holdings).set(set).where(eq(holdings.id, id)),
        ['competence_holding_pending'],
        () => new PendingTaken(),
      );
    },
    async deleteHolding(id) {
      await tx.delete(holdings).where(and(eq(holdings.id, id), isNull(holdings.connectorId)));
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
        .select({ id: people.id, organisationId: people.organisationId, name: people.name, userName: people.userName })
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
    async positions(organisationId) {
      const rows = await tx.select().from(positions).where(eq(positions.organisationId, organisationId));
      return rows.sort((a, b) => sv(a.label, b.label) || a.code.localeCompare(b.code));
    },
    async units(organisationId) {
      // The tree as pushed (D99), as the people module's `unitTree` reads it: every `unit:` group of the organisation.
      const rows = await tx
        .select({ externalId: groups.externalId, label: groups.label, parentId: groups.parentUnitId })
        .from(groups)
        .where(and(eq(groups.organisationId, organisationId), like(groups.externalId, UNIT_KEY + '%')));
      return rows
        .map(r => ({ id: r.externalId!.slice(UNIT_KEY.length), organisationId, label: r.label, parentId: r.parentId }))
        .sort((a, b) => sv(a.label, b.label) || a.id.localeCompare(b.id));
    },
    async placedOn(organisationId, unitIds) {
      const found = new Set<string>();
      for (const slice of slices([...new Set(unitIds)]))
        for (const r of await tx
          .selectDistinct({ id: assignments.personId })
          .from(assignments)
          .innerJoin(people, eq(people.id, assignments.personId))
          .where(
            and(
              inArray(assignments.unitId, slice),
              eq(people.enabled, true),
              eq(people.organisationId, organisationId),
            ),
          ))
          found.add(r.id);
      return [...found].sort();
    },
    async placesOf(organisationId, personIds) {
      const places = new Map<string, Placed>();
      for (const slice of slices([...new Set(personIds)])) {
        for (const r of await tx
          .select({ id: people.id })
          .from(people)
          .where(and(inArray(people.id, slice), eq(people.organisationId, organisationId))))
          places.set(r.id, { personId: r.id, unitIds: [], positionCodes: [] });
        const known = [...places.keys()].filter(id => slice.includes(id));
        if (!known.length) continue;
        for (const r of await tx
          .select({ personId: assignments.personId, unitId: assignments.unitId })
          .from(assignments)
          .where(inArray(assignments.personId, known)))
          places.get(r.personId)?.unitIds.push(r.unitId);
        for (const r of await tx
          .select({ personId: personPositions.personId, code: positions.code })
          .from(personPositions)
          .innerJoin(positions, eq(positions.id, personPositions.positionId))
          .where(and(inArray(personPositions.personId, known), eq(positions.organisationId, organisationId))))
          places.get(r.personId)?.positionCodes.push(r.code);
      }
      return [...places.values()].map(p => ({
        ...p,
        unitIds: p.unitIds.sort(),
        positionCodes: p.positionCodes.sort(),
      }));
    },
    async positionHolders(organisationId, codes) {
      if (!codes.length) return [];
      const rows = await tx
        .select({ personId: personPositions.personId, code: positions.code })
        .from(personPositions)
        .innerJoin(positions, eq(positions.id, personPositions.positionId))
        .innerJoin(people, eq(people.id, personPositions.personId))
        .where(
          and(
            eq(positions.organisationId, organisationId),
            inArray(positions.code, [...new Set(codes)]),
            eq(people.organisationId, organisationId),
            eq(people.enabled, true),
          ),
        );
      return rows.sort((a, b) => a.personId.localeCompare(b.personId) || a.code.localeCompare(b.code));
    },
    async requirements(organisationId) {
      const rows = await tx
        .select()
        .from(requirements)
        .where(eq(requirements.organisationId, organisationId))
        .orderBy(asc(requirements.createdAt), asc(requirements.id));
      return rows.map(requirementOf);
    },
    async requirement(id) {
      const [r] = await tx.select().from(requirements).where(eq(requirements.id, id)).for('update');
      return r ? requirementOf(r) : undefined;
    },
    async insertRequirement(r) {
      await once(
        () => tx.insert(requirements).values({ ...r, createdAt: new Date(r.createdAt) }),
        REQUIREMENT_INDEXES,
        () => new RequirementTaken(),
      );
    },
    async removeRequirement(id) {
      const removed = await tx.delete(requirements).where(eq(requirements.id, id)).returning({ id: requirements.id });
      return removed.length > 0;
    },
    async shareTargets(organisationId) {
      const rows = await tx
        .select()
        .from(targets)
        .where(eq(targets.organisationId, organisationId))
        .orderBy(asc(targets.createdAt), asc(targets.id));
      return rows.map(targetOf);
    },
    async shareTarget(id) {
      const [r] = await tx.select().from(targets).where(eq(targets.id, id)).for('update');
      return r ? targetOf(r) : undefined;
    },
    async insertShareTarget(t) {
      await once(
        () => tx.insert(targets).values({ ...t, createdAt: new Date(t.createdAt) }),
        TARGET_INDEXES,
        () => new ShareTargetTaken(),
      );
    },
    async removeShareTarget(id) {
      const removed = await tx.delete(targets).where(eq(targets.id, id)).returning({ id: targets.id });
      return removed.length > 0;
    },
    async erasePerson(personId) {
      // The row of every source the person has copied rows from, first and in one order, as the copy's write takes it:
      // a read that is writing finishes before the person's rows go, and never puts them back afterwards.
      const from = await tx
        .selectDistinct({ connectorId: holdings.connectorId })
        .from(holdings)
        .where(and(eq(holdings.personId, personId), isNotNull(holdings.connectorId)));
      const ids = from.map(r => r.connectorId!).sort();
      if (ids.length)
        await tx
          .select({ id: sources.connectorId })
          .from(sources)
          .where(inArray(sources.connectorId, ids))
          .orderBy(asc(sources.connectorId))
          .for('update');
      const removed = await tx
        .delete(holdings)
        .where(eq(holdings.personId, personId))
        .returning({ id: holdings.id, threadId: holdings.threadId });
      const required = await tx
        .delete(requirements)
        .where(eq(requirements.personId, personId))
        .returning({ id: requirements.id });
      const cleared = new Set<string>();
      for (const column of ['registeredBy', 'revokedBy', 'decidedBy'] as const)
        for (const r of await tx
          .update(holdings)
          .set({ [column]: null })
          .where(eq(holdings[column], personId))
          .returning({ id: holdings.id }))
          cleared.add(r.id);
      // The requirements and share targets the person set keep standing, without their author.
      const actor = 'person:' + personId;
      const authored =
        (
          await tx
            .update(requirements)
            .set({ createdBy: null })
            .where(eq(requirements.createdBy, actor))
            .returning({ id: requirements.id })
        ).length +
        (
          await tx
            .update(targets)
            .set({ createdBy: null })
            .where(eq(targets.createdBy, actor))
            .returning({ id: targets.id })
        ).length;
      return {
        holdings: removed.length,
        cleared: cleared.size + authored,
        requirements: required.length,
        threadIds: [...new Set(removed.flatMap(r => (r.threadId ? [r.threadId] : [])))].sort(),
      };
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
      const requirementRows = await tx
        .select()
        .from(requirements)
        .where(eq(requirements.organisationId, organisationId))
        .orderBy(asc(requirements.createdAt), asc(requirements.id));
      const targetRows = await tx
        .select()
        .from(targets)
        .where(eq(targets.organisationId, organisationId))
        .orderBy(asc(targets.createdAt), asc(targets.id));
      return {
        types: typeRows.map(typeOf),
        holdings: holdingRows.map(r => holdingOf(r.holding)),
        mappings: mappingRows.map(mappingOf),
        requirements: requirementRows.map(requirementOf),
        shareTargets: targetRows.map(targetOf),
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
    workItems,
  };
}
/**
 * The competence store over its own `database().transaction`, with no approval cards: for a caller that registers nothing
 * of a person's own. The server's store shares the transaction with the thread store (`competenceStoreWithCards`).
 */
export function postgresCompetenceStore(durable: DurableQueue): CompetenceStore {
  return { transaction: fn => database().transaction(tx => fn(competenceTx(tx, durable))) };
}
