import { and, asc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import { lineUpwards } from '../domain';
import {
  PlanTaken,
  type BoardingDirectory,
  type BoardingStore,
  type BoardingTx,
  type ItemRecord,
  type LayerItemRecord,
  type LayerRecord,
  type PlanRecord,
  type Report,
  type Sealer,
  type UnitNode,
  type WorkItemTx,
} from '../model';

const {
  boardingLayers: layers,
  boardingLayerItems: layerItems,
  boardingPlans: plans,
  boardingPlanHolders: holders,
  boardingItems: items,
  people,
  audit,
  assignments,
  personPositions,
  positions,
  groups,
} = schema;
type LayerRow = typeof layers.$inferSelect;
type PlanRow = typeof plans.$inferSelect;
type ItemRow = typeof items.$inferSelect;
const iso = (at: Date | null) => (at === null ? null : at.toISOString());
const date = (at: string | null) => (at === null ? null : new Date(at));
const sv = (a: string, b: string) => a.localeCompare(b, 'sv');
/** The purpose a title a manager typed is sealed under: bound to the item's id, so a sealed text cannot be moved. */
const purpose = (id: string) => 'boarding:item:' + id;
/** The key of a `unit:` group, the organisation tree's nodes (D99). */
const UNIT_KEY = 'unit:';
/** A statement's parameters stay well under Postgres's limit when a long list is matched in slices. */
const SLICE = 1000;
const slices = <T>(rows: readonly T[]) =>
  Array.from({ length: Math.ceil(rows.length / SLICE) }, (_, i) => rows.slice(i * SLICE, (i + 1) * SLICE));

const layerOf = (r: LayerRow): LayerRecord => ({
  id: r.id,
  organisationId: r.organisationId,
  event: r.event,
  name: r.name,
  condition: r.conditionKind,
  value: r.conditionValue,
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
const planOf = (r: PlanRow, heldBy: readonly string[] = []): PlanRecord => ({
  ...r,
  startedAt: r.startedAt.toISOString(),
  closedAt: iso(r.closedAt),
  heldAt: iso(r.heldAt),
  heldBy: [...heldBy].sort(),
});
/** The unique index `boarding_plan_open` fired; the driver may wrap the error once. */
function planTaken(error: unknown) {
  const e = error as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  return (
    (e?.code ?? e?.cause?.code) === '23505' &&
    (e?.constraint_name ?? e?.cause?.constraint_name) === 'boarding_plan_open'
  );
}

/**
 * The boarding tables (D124) on one Postgres transaction. Composition opens the transaction itself, with the thread
 * store's `withThreadTx`, and passes the `WorkItemTx` it builds over the same transaction, so an item and its owner's
 * card commit or roll back as one. A title a manager typed is sealed with `sealer` and opened only where a read returns
 * it; template titles are plain. Reads that a write follows take a row lock.
 */
export function boardingTx(tx: Transaction, options: { sealer: Sealer; workItems?: WorkItemTx }): BoardingTx {
  const { sealer } = options;
  /** The plans with who holds each (D124 item 7), read in one more statement. */
  const withHolders = async (rows: readonly PlanRow[]): Promise<PlanRecord[]> => {
    const byPlan = new Map<string, string[]>();
    for (const slice of slices(rows.map(r => r.id)))
      for (const h of await tx.select().from(holders).where(inArray(holders.planId, slice)))
        byPlan.set(h.planId, [...(byPlan.get(h.planId) ?? []), h.personId]);
    return rows.map(r => planOf(r, byPlan.get(r.id)));
  };
  const itemOf = (r: ItemRow): ItemRecord => ({
    id: r.id,
    planId: r.planId,
    position: r.position,
    title: r.textSealed !== null ? sealer.open(r.textSealed, purpose(r.id)) : (r.title ?? ''),
    added: r.textSealed !== null,
    kind: r.kind,
    ownerRole: r.ownerRole,
    ownerId: r.ownerId,
    dueOn: r.dueOn,
    doneAt: iso(r.doneAt),
    doneBy: r.doneBy,
    threadId: r.threadId,
    sourceLayerId: r.sourceLayerId,
    tiedTo: r.tiedTo,
    createdAt: r.createdAt.toISOString(),
  });
  const byLayers = async (layerIds: readonly string[]) => {
    const found: LayerItemRecord[] = [];
    for (const slice of slices([...new Set(layerIds)]))
      found.push(...(await tx.select().from(layerItems).where(inArray(layerItems.layerId, slice))));
    return found.sort((a, b) => layerIds.indexOf(a.layerId) - layerIds.indexOf(b.layerId) || a.position - b.position);
  };
  return {
    async lockLayers(organisationId) {
      // A lock of the transaction on the organisation's layers: two imports of one organisation follow each other.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'boarding-layers:' + organisationId}, 0))`);
    },
    async layers(organisationId, event) {
      const rows = await tx
        .select()
        .from(layers)
        .where(
          event === undefined
            ? eq(layers.organisationId, organisationId)
            : and(eq(layers.organisationId, organisationId), eq(layers.event, event)),
        );
      return rows
        .map(layerOf)
        .sort((a, b) => a.event.localeCompare(b.event) || sv(a.name, b.name) || a.id.localeCompare(b.id));
    },
    layerItems: byLayers,
    async insertLayer(layer) {
      await tx.insert(layers).values({
        id: layer.id,
        organisationId: layer.organisationId,
        event: layer.event,
        name: layer.name,
        conditionKind: layer.condition,
        conditionValue: layer.value,
        createdBy: layer.createdBy,
        createdAt: new Date(layer.createdAt),
        updatedAt: new Date(layer.updatedAt),
      });
    },
    async updateLayer(id, patch) {
      await tx
        .update(layers)
        .set({
          name: patch.name,
          conditionKind: patch.condition,
          conditionValue: patch.value,
          updatedAt: new Date(patch.updatedAt),
        })
        .where(eq(layers.id, id));
    },
    async replaceLayerItems(layerId, rows) {
      await tx.delete(layerItems).where(eq(layerItems.layerId, layerId));
      if (rows.length) await tx.insert(layerItems).values(rows.map(r => ({ ...r, layerId })));
    },
    async plan(id, lock = false) {
      const query = tx.select().from(plans).where(eq(plans.id, id));
      const [r] = lock ? await query.for('update') : await query;
      return r ? (await withHolders([r]))[0] : undefined;
    },
    async plansAbout(personIds) {
      const found: PlanRow[] = [];
      for (const slice of slices([...new Set(personIds)]))
        found.push(...(await tx.select().from(plans).where(inArray(plans.personId, slice))));
      return (await withHolders(found)).sort(
        (a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id),
      );
    },
    async openPlansOf(personId) {
      const held = tx.select({ id: holders.planId }).from(holders).where(eq(holders.personId, personId));
      const rows = await tx
        .select()
        .from(plans)
        .where(and(isNull(plans.closedAt), or(eq(plans.startedBy, personId), inArray(plans.id, held))));
      return (await withHolders(rows)).sort(
        (a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id),
      );
    },
    async holdPlan(id, people, at) {
      await tx
        .update(plans)
        .set({ heldAt: new Date(at) })
        .where(eq(plans.id, id));
      await tx.delete(holders).where(eq(holders.planId, id));
      const ids = [...new Set(people)].sort();
      if (ids.length) await tx.insert(holders).values(ids.map(personId => ({ planId: id, personId })));
    },
    async releasePlan(id) {
      await tx.update(plans).set({ heldAt: null }).where(eq(plans.id, id));
      await tx.delete(holders).where(eq(holders.planId, id));
    },
    async insertPlan(plan) {
      try {
        // A plan is held by nobody when it starts: its person is active.
        const { heldBy: _heldBy, ...row } = plan;
        await tx.insert(plans).values({
          ...row,
          startedAt: new Date(plan.startedAt),
          closedAt: date(plan.closedAt),
          heldAt: null,
        });
      } catch (error) {
        if (planTaken(error)) throw new PlanTaken();
        throw error;
      }
    },
    async closePlan(id, at) {
      await tx
        .update(plans)
        .set({ closedAt: new Date(at) })
        .where(eq(plans.id, id));
    },
    async items(planIds) {
      const found: ItemRecord[] = [];
      for (const slice of slices([...new Set(planIds)]))
        found.push(
          ...(
            await tx
              .select()
              .from(items)
              .where(inArray(items.planId, slice))
              .orderBy(asc(items.planId), asc(items.position))
          ).map(itemOf),
        );
      return found.sort((a, b) => a.planId.localeCompare(b.planId) || a.position - b.position);
    },
    async item(id, lock = false) {
      const query = tx.select().from(items).where(eq(items.id, id));
      const [r] = lock ? await query.for('update') : await query;
      return r ? itemOf(r) : undefined;
    },
    async itemByThread(threadId, lock = false) {
      const query = tx.select().from(items).where(eq(items.threadId, threadId));
      const [r] = lock ? await query.for('update') : await query;
      return r ? itemOf(r) : undefined;
    },
    async insertItem(i) {
      await tx.insert(items).values({
        id: i.id,
        planId: i.planId,
        position: i.position,
        title: i.added ? null : i.title,
        textSealed: i.added ? sealer.seal(i.title, purpose(i.id)) : null,
        kind: i.kind,
        ownerRole: i.ownerRole,
        ownerId: i.ownerId,
        dueOn: i.dueOn,
        doneAt: date(i.doneAt),
        doneBy: i.doneBy,
        threadId: i.threadId,
        sourceLayerId: i.sourceLayerId,
        tiedTo: i.tiedTo,
        createdAt: new Date(i.createdAt),
      });
    },
    async updateItem(id, patch) {
      const set: Partial<typeof items.$inferInsert> = {};
      if ('doneAt' in patch) set.doneAt = date(patch.doneAt ?? null);
      if ('doneBy' in patch) set.doneBy = patch.doneBy ?? null;
      if (!Object.keys(set).length) return;
      await tx.update(items).set(set).where(eq(items.id, id));
    },
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
        .where(inArray(people.id, [...new Set(ids)]));
    },
    async erasePerson(personId) {
      const threadIds = new Set<string>(),
        cleared = new Set<string>();
      // Every plan this touches is locked first, in id order (the module's lock order: a plan before its items): the
      // plans about the person, the ones they started, buddy or hold, and the ones with an item they own or ticked off.
      const touched = new Set<string>();
      for (const r of await tx
        .select({ id: plans.id })
        .from(plans)
        .where(or(eq(plans.personId, personId), eq(plans.buddyId, personId), eq(plans.startedBy, personId))))
        touched.add(r.id);
      for (const r of await tx
        .selectDistinct({ id: items.planId })
        .from(items)
        .where(or(eq(items.ownerId, personId), eq(items.doneBy, personId))))
        touched.add(r.id);
      for (const r of await tx.select({ id: holders.planId }).from(holders).where(eq(holders.personId, personId)))
        touched.add(r.id);
      for (const slice of slices([...touched].sort()))
        await tx
          .select({ id: plans.id })
          .from(plans)
          .where(inArray(plans.id, slice))
          .orderBy(asc(plans.id))
          .for('update');
      const own = await tx.select({ id: plans.id }).from(plans).where(eq(plans.personId, personId));
      const ownIds = own.map(p => p.id);
      let removedItems = 0;
      if (ownIds.length) {
        const removed = await tx
          .delete(items)
          .where(inArray(items.planId, ownIds))
          .returning({ id: items.id, threadId: items.threadId });
        removedItems = removed.length;
        for (const r of removed) if (r.threadId) threadIds.add(r.threadId);
        await tx.delete(plans).where(inArray(plans.id, ownIds));
      }
      for (const column of ['buddyId', 'startedBy'] as const)
        for (const r of await tx
          .update(plans)
          .set({ [column]: null })
          .where(eq(plans[column], personId))
          .returning({ id: plans.id }))
          cleared.add('plan:' + r.id);
      for (const r of await tx.delete(holders).where(eq(holders.personId, personId)).returning({ id: holders.planId }))
        cleared.add('plan:' + r.id);
      // The cards of the items they owned go too; read before the pointer is nulled.
      const owned = await tx
        .select({ id: items.id, threadId: items.threadId })
        .from(items)
        .where(eq(items.ownerId, personId))
        .for('update');
      for (const r of owned) if (r.threadId) threadIds.add(r.threadId);
      for (const r of await tx
        .update(items)
        .set({ ownerId: null, threadId: null })
        .where(eq(items.ownerId, personId))
        .returning({ id: items.id }))
        cleared.add('item:' + r.id);
      for (const r of await tx
        .update(items)
        .set({ doneBy: null })
        .where(eq(items.doneBy, personId))
        .returning({ id: items.id }))
        cleared.add('item:' + r.id);
      return { plans: ownIds.length, items: removedItems, cleared: cleared.size, threadIds: [...threadIds].sort() };
    },
    async exportOrganisation(organisationId) {
      const layerRows = (await tx.select().from(layers).where(eq(layers.organisationId, organisationId)))
        .map(layerOf)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const held = await byLayers(layerRows.map(l => l.id));
      const planRows = (
        await withHolders(await tx.select().from(plans).where(eq(plans.organisationId, organisationId)))
      ).sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
      const itemRows: ItemRecord[] = [];
      for (const slice of slices(planRows.map(p => p.id)))
        itemRows.push(...(await tx.select().from(items).where(inArray(items.planId, slice))).map(itemOf));
      return {
        layers: layerRows.map(l => ({ ...l, items: held.filter(i => i.layerId === l.id) })),
        plans: planRows,
        items: itemRows.sort((a, b) => a.planId.localeCompare(b.planId) || a.position - b.position),
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
    get workItems(): WorkItemTx {
      if (!options.workItems)
        throw new Error('This boarding transaction has no card port: it may not open or close cards.');
      return options.workItems;
    },
  };
}
/**
 * The boarding store over its own `database().transaction`, for a caller that does not share the transaction with the
 * thread store: `workItems` builds the card port over the same transaction.
 */
export function postgresBoardingStore(options: {
  sealer: Sealer;
  workItems: (tx: Transaction) => WorkItemTx;
}): BoardingStore {
  return {
    transaction: fn =>
      database().transaction(tx => fn(boardingTx(tx, { sealer: options.sealer, workItems: options.workItems(tx) }))),
  };
}

/** What runs a statement: the database, or a transaction the caller holds (the leavers port's savepoint). */
type Db = Transaction | ReturnType<typeof database>;
/**
 * The directory as boarding reads it (D124), from the directory's tables as provisioned (D68, D99, D108 item 5): what the
 * layers match a person on, the tree, the units' names, and whom a person reports to now. On `db` when given, so the
 * leavers port reads in the transaction that deactivates the person; on its own connection otherwise. Nothing here
 * decides who is whose report for a manager's reach: that is the people module's, paired in composition.
 */
export function postgresBoardingDirectory(given?: Db): BoardingDirectory {
  const db = () => given ?? database();
  async function tree(organisationId: string): Promise<UnitNode[]> {
    const rows = await db()
      .select({ externalId: groups.externalId, parentId: groups.parentUnitId })
      .from(groups)
      .where(and(eq(groups.organisationId, organisationId), like(groups.externalId, UNIT_KEY + '%')));
    return rows.map(r => ({ id: r.externalId!.slice(UNIT_KEY.length), parentId: r.parentId }));
  }
  return {
    tree,
    async facts(organisationId, personIds) {
      const found = new Map<string, Pick<Report, 'unitIds' | 'positionCodes' | 'employments'>>();
      for (const slice of slices([...new Set(personIds)])) {
        for (const r of await db()
          .select({ id: people.id, employments: people.employments })
          .from(people)
          .where(and(inArray(people.id, slice), eq(people.organisationId, organisationId))))
          found.set(r.id, {
            unitIds: [],
            positionCodes: [],
            employments: r.employments.map(e => ({
              ...(e.employmentType !== undefined ? { employmentType: e.employmentType } : {}),
              ...(e.startDate !== undefined ? { startDate: e.startDate } : {}),
            })),
          });
        const known = slice.filter(id => found.has(id));
        if (!known.length) continue;
        for (const r of await db()
          .select({ personId: assignments.personId, unitId: assignments.unitId })
          .from(assignments)
          .where(inArray(assignments.personId, known)))
          found.get(r.personId)?.unitIds.push(r.unitId);
        for (const r of await db()
          .select({ personId: personPositions.personId, code: positions.code })
          .from(personPositions)
          .innerJoin(positions, eq(positions.id, personPositions.positionId))
          .where(and(inArray(personPositions.personId, known), eq(positions.organisationId, organisationId))))
          found.get(r.personId)?.positionCodes.push(r.code);
      }
      for (const f of found.values()) {
        f.unitIds.sort();
        f.positionCodes.sort();
      }
      return found;
    },
    async unitLabels(organisationId, unitIds) {
      const labels = new Map<string, string>();
      for (const slice of slices([...new Set(unitIds)]))
        for (const r of await db()
          .select({ externalId: groups.externalId, label: groups.label })
          .from(groups)
          .where(
            and(
              eq(groups.organisationId, organisationId),
              inArray(
                groups.externalId,
                slice.map(id => UNIT_KEY + id),
              ),
            ),
          ))
          labels.set(r.externalId!.slice(UNIT_KEY.length), r.label);
      return labels;
    },
    async lineManagers(organisationId, personId) {
      const [person] = await db()
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.id, personId), eq(people.organisationId, organisationId)));
      if (!person) return [];
      const own = await db()
        .select({ unitId: assignments.unitId, role: assignments.role })
        .from(assignments)
        .where(eq(assignments.personId, personId));
      if (!own.length) return [];
      const parents = new Map((await tree(organisationId)).map(u => [u.id, u.parentId]));
      // Every active leader of the organisation's units, read once; the walk upwards stops at the first unit led.
      const leaders = new Map<string, string[]>();
      for (const r of await db()
        .select({ unitId: assignments.unitId, personId: assignments.personId })
        .from(assignments)
        .innerJoin(people, eq(people.id, assignments.personId))
        .where(
          and(eq(assignments.role, 'manager'), eq(people.enabled, true), eq(people.organisationId, organisationId)),
        ))
        if (r.personId !== personId) leaders.set(r.unitId, [...(leaders.get(r.unitId) ?? []), r.personId]);
      return lineUpwards(own, parents, unitId => leaders.get(unitId) ?? []);
    },
  };
}
