import { describe, expect, test } from 'bun:test';
import {
  PlanTaken,
  type BoardingStore,
  type ItemRecord,
  type LayerItemRecord,
  type LayerRecord,
  type PersonRef,
  type PlanRecord,
} from '../apps/server/src/modules/boarding/model';

/**
 * The boarding store (D124): layers and their items, plans, items, the people the domain names, erasure and export.
 * One suite, two adapters: `tests/unit/boarding-store.test.ts` on memory, `tests/db/postgres-boarding-store.test.ts` on
 * Postgres. The harness supplies the store with a card port that writes the minimum a card needs, and the people.
 */
export interface BoardingStoreHarness {
  store: BoardingStore;
  /** Prefixes every id the suite writes, the organisation's included, so runs never meet. */
  prefix: string;
  /** A person as provisioning would have written them. */
  seedPerson(person: PersonRef): Promise<void>;
  /** The audit rows written about `subject`, oldest first. */
  auditFor(subject: string): Promise<Array<{ actor: string; action: string }>>;
  /** The title columns as stored, where the adapter seals a typed title (Postgres); absent for one that does not. */
  storedTitle?: (itemId: string) => Promise<{ title: string | null; sealed: string | null }>;
}
const T = '2026-11-13T08:00:00.000Z';
export const layerRow = (id: string, organisationId: string, extra: Partial<LayerRecord> = {}): LayerRecord => ({
  id,
  organisationId,
  event: 'introduction',
  name: 'Alla ' + id,
  condition: 'all',
  value: null,
  createdBy: 'operator:test',
  createdAt: T,
  updatedAt: T,
  ...extra,
});
export const layerItemRow = (
  id: string,
  layerId: string,
  position: number,
  extra: Partial<LayerItemRecord> = {},
): LayerItemRecord => ({
  id,
  layerId,
  position,
  title: 'Uppgift ' + id,
  kind: 'todo',
  ownerRole: 'manager',
  offsetDays: position - 1,
  tiedTo: null,
  ...extra,
});
export const planRow = (
  id: string,
  organisationId: string,
  personId: string,
  extra: Partial<PlanRecord> = {},
): PlanRecord => ({
  id,
  organisationId,
  personId,
  event: 'introduction',
  anchorOn: '2026-12-01',
  buddyId: null,
  startedBy: null,
  startedAt: T,
  closedAt: null,
  heldAt: null,
  heldBy: [],
  ...extra,
});
export const itemRow = (id: string, planId: string, position: number, extra: Partial<ItemRecord> = {}): ItemRecord => ({
  id,
  planId,
  position,
  title: 'Beställ dator',
  added: false,
  kind: 'order',
  ownerRole: 'manager',
  ownerId: null,
  dueOn: '2026-11-20',
  doneAt: null,
  doneBy: null,
  threadId: null,
  sourceLayerId: null,
  tiedTo: null,
  createdAt: T,
  ...extra,
});
const person = (id: string, organisationId: string, enabled = true): PersonRef => ({
  id,
  organisationId,
  name: 'Name ' + id,
  userName: 'u-' + id,
  enabled,
});

export function boardingStoreContract(name: string, make: () => Promise<BoardingStoreHarness>) {
  describe(`${name} boarding store`, () => {
    /** An organisation with a manager, a new hire and a buddy. */
    async function world() {
      const h = await make();
      const p = h.prefix,
        org = p + '-org',
        [boss, anna, bo] = [p + '-boss', p + '-anna', p + '-bo'];
      for (const id of [boss, anna, bo]) await h.seedPerson(person(id, org));
      return { ...h, p, org, boss, anna, bo };
    }
    /** Opens the item's card, then inserts the item that refers to it, as the use case does. */
    const addWithCard = async (h: BoardingStoreHarness, plan: PlanRecord, item: ItemRecord, threadId: string) =>
      h.store.transaction(async tx => {
        await tx.workItems.open({
          threadId,
          personId: item.ownerId!,
          itemId: item.id,
          planId: plan.id,
          event: plan.event,
          title: item.added ? null : item.title,
          dueOn: item.dueOn,
          at: item.createdAt,
        });
        await tx.insertItem({ ...item, threadId });
      });

    test('layers: one name per organisation and event without regard to (ASCII) case, read by event and name, items replaced in order', async () => {
      const w = await world();
      const a = layerRow(w.p + '-la', w.org, { name: 'Vard' }),
        b = layerRow(w.p + '-lb', w.org, { name: 'Alla' }),
        c = layerRow(w.p + '-lc', w.org, { name: 'Alla', event: 'leaving' });
      await w.store.transaction(async tx => {
        await tx.lockLayers(w.org);
        for (const l of [a, b, c]) await tx.insertLayer(l);
      });
      await expect(
        w.store.transaction(tx => tx.insertLayer(layerRow(w.p + '-ld', w.org, { name: 'VARD' }))),
      ).rejects.toThrow();
      // Another organisation may use the name.
      await w.store.transaction(tx => tx.insertLayer(layerRow(w.p + '-le', w.org + '-2', { name: 'Vard' })));
      expect((await w.store.transaction(tx => tx.layers(w.org))).map(l => l.id)).toEqual([b.id, a.id, c.id]);
      expect((await w.store.transaction(tx => tx.layers(w.org, 'leaving'))).map(l => l.id)).toEqual([c.id]);
      await w.store.transaction(tx =>
        tx.replaceLayerItems(a.id, [layerItemRow(w.p + '-i1', a.id, 0), layerItemRow(w.p + '-i2', a.id, 1)]),
      );
      await w.store.transaction(tx => tx.replaceLayerItems(b.id, [layerItemRow(w.p + '-i3', b.id, 0)]));
      expect((await w.store.transaction(tx => tx.layerItems([a.id, b.id]))).map(i => i.id)).toEqual([
        w.p + '-i1',
        w.p + '-i2',
        w.p + '-i3',
      ]);
      await w.store.transaction(async tx => {
        await tx.updateLayer(a.id, { name: 'vard', condition: 'unit', value: 'unit-omsorg', updatedAt: T });
        await tx.replaceLayerItems(a.id, [
          layerItemRow(w.p + '-i4', a.id, 0, { kind: 'course', ownerRole: 'person', offsetDays: 30, tiedTo: 'HLR' }),
        ]);
      });
      const [read] = (await w.store.transaction(tx => tx.layers(w.org, 'introduction'))).filter(l => l.id === a.id);
      expect(read).toMatchObject({ name: 'vard', condition: 'unit', value: 'unit-omsorg' });
      expect(await w.store.transaction(tx => tx.layerItems([a.id]))).toEqual([
        layerItemRow(w.p + '-i4', a.id, 0, { kind: 'course', ownerRole: 'person', offsetDays: 30, tiedTo: 'HLR' }),
      ]);
    });

    test('one open plan per person and event: a second is refused with PlanTaken until the first is closed', async () => {
      const w = await world();
      const first = planRow(w.p + '-p1', w.org, w.anna, { startedBy: w.boss, buddyId: w.bo });
      await w.store.transaction(tx => tx.insertPlan(first));
      expect(await w.store.transaction(tx => tx.plan(first.id))).toEqual(first);
      expect(await w.store.transaction(tx => tx.plan(first.id, true))).toEqual(first);
      expect(await w.store.transaction(tx => tx.plan(w.p + '-missing'))).toBeUndefined();
      const error = await w.store
        .transaction(tx => tx.insertPlan(planRow(w.p + '-p2', w.org, w.anna)))
        .then(() => undefined)
        .catch(e => e);
      expect(error).toBeInstanceOf(PlanTaken);
      // A leaving beside the introduction is another event.
      const leaving = planRow(w.p + '-p3', w.org, w.anna, {
        event: 'leaving',
        startedAt: '2026-11-13T09:00:00.000Z',
        startedBy: w.boss,
      });
      await w.store.transaction(tx => tx.insertPlan(leaving));
      await w.store.transaction(tx => tx.closePlan(first.id, '2026-11-14T08:00:00.000Z'));
      const again = planRow(w.p + '-p4', w.org, w.anna, { startedAt: '2026-11-15T08:00:00.000Z' });
      await w.store.transaction(tx => tx.insertPlan(again));
      expect((await w.store.transaction(tx => tx.plansAbout([w.anna]))).map(p => [p.id, p.closedAt])).toEqual([
        [again.id, null],
        [leaving.id, null],
        [first.id, '2026-11-14T08:00:00.000Z'],
      ]);
      expect((await w.store.transaction(tx => tx.openPlansOf(w.boss))).map(p => p.id)).toEqual([leaving.id]);
      expect(await w.store.transaction(tx => tx.plansAbout([]))).toEqual([]);
    });

    test('a plan is held by the people recorded for it, read with it, listed as theirs while open, and released again', async () => {
      const w = await world();
      const plan = planRow(w.p + '-p1', w.org, w.anna, { startedBy: w.boss });
      await w.store.transaction(tx => tx.insertPlan(plan));
      expect((await w.store.transaction(tx => tx.openPlansOf(w.bo))).map(p => p.id)).toEqual([]);
      const at = '2026-11-20T08:00:00.000Z';
      await w.store.transaction(tx => tx.holdPlan(plan.id, [w.bo, w.boss, w.bo], at));
      const held = { ...plan, heldAt: at, heldBy: [w.bo, w.boss].sort() };
      expect(await w.store.transaction(tx => tx.plan(plan.id))).toEqual(held);
      expect(await w.store.transaction(tx => tx.plansAbout([w.anna]))).toEqual([held]);
      expect((await w.store.transaction(tx => tx.openPlansOf(w.bo))).map(p => p.id)).toEqual([plan.id]);
      // Holding again replaces who holds it; nobody may hold it too.
      await w.store.transaction(tx => tx.holdPlan(plan.id, [w.bo], at));
      expect((await w.store.transaction(tx => tx.plan(plan.id)))?.heldBy).toEqual([w.bo]);
      await w.store.transaction(tx => tx.holdPlan(plan.id, [], at));
      expect(await w.store.transaction(tx => tx.plan(plan.id))).toEqual({ ...plan, heldAt: at, heldBy: [] });
      await w.store.transaction(tx => tx.holdPlan(plan.id, [w.bo], at));
      await w.store.transaction(tx => tx.releasePlan(plan.id));
      expect(await w.store.transaction(tx => tx.plan(plan.id))).toEqual(plan);
      expect((await w.store.transaction(tx => tx.openPlansOf(w.bo))).map(p => p.id)).toEqual([]);
      // A closed plan is listed for nobody.
      await w.store.transaction(tx => tx.holdPlan(plan.id, [w.bo], at));
      await w.store.transaction(tx => tx.closePlan(plan.id, at));
      expect(await w.store.transaction(tx => tx.openPlansOf(w.bo))).toEqual([]);
    });

    test('items: a card first, then the item; read by plan and place, by id and by card; done and open again', async () => {
      const w = await world();
      const plan = planRow(w.p + '-p1', w.org, w.anna, { startedBy: w.boss });
      await w.store.transaction(tx => tx.insertPlan(plan));
      const first = itemRow(w.p + '-a', plan.id, 1, { ownerId: w.boss }),
        second = itemRow(w.p + '-b', plan.id, 0, { ownerId: w.anna, ownerRole: 'person', kind: 'acknowledge' });
      await addWithCard(w, plan, first, w.p + '-t1');
      await addWithCard(w, plan, second, w.p + '-t2');
      expect((await w.store.transaction(tx => tx.items([plan.id]))).map(i => i.id)).toEqual([second.id, first.id]);
      expect(await w.store.transaction(tx => tx.item(first.id))).toEqual({ ...first, threadId: w.p + '-t1' });
      expect(await w.store.transaction(tx => tx.item(first.id, true))).toEqual({ ...first, threadId: w.p + '-t1' });
      expect((await w.store.transaction(tx => tx.itemByThread(w.p + '-t2')))?.id).toBe(second.id);
      expect((await w.store.transaction(tx => tx.itemByThread(w.p + '-t2', true)))?.id).toBe(second.id);
      expect(await w.store.transaction(tx => tx.itemByThread(w.p + '-none'))).toBeUndefined();
      await w.store.transaction(tx => tx.updateItem(first.id, { doneAt: '2026-11-14T10:00:00.000Z', doneBy: w.boss }));
      expect(await w.store.transaction(tx => tx.item(first.id))).toMatchObject({
        doneAt: '2026-11-14T10:00:00.000Z',
        doneBy: w.boss,
      });
      await w.store.transaction(tx => tx.updateItem(first.id, { doneAt: null, doneBy: null }));
      expect(await w.store.transaction(tx => tx.item(first.id))).toMatchObject({ doneAt: null, doneBy: null });
    });

    test('a title a manager typed is read back as typed and, where the adapter seals, never stored plain; a template title is', async () => {
      const w = await world();
      const plan = planRow(w.p + '-p1', w.org, w.anna);
      await w.store.transaction(tx => tx.insertPlan(plan));
      const typed = 'Visa Anna hur journalen fungerar';
      const added = itemRow(w.p + '-x', plan.id, 0, { title: typed, added: true, ownerId: w.bo, ownerRole: 'buddy' }),
        template = itemRow(w.p + '-y', plan.id, 1, { ownerId: w.boss, sourceLayerId: null });
      await addWithCard(w, plan, added, w.p + '-t1');
      await addWithCard(w, plan, template, w.p + '-t2');
      const read = await w.store.transaction(tx => tx.items([plan.id]));
      expect(read.map(i => [i.title, i.added])).toEqual([
        [typed, true],
        ['Beställ dator', false],
      ]);
      if (w.storedTitle) {
        const stored = await w.storedTitle(added.id);
        expect(stored.title).toBeNull();
        expect(stored.sealed).not.toContain('journalen');
        expect(await w.storedTitle(template.id)).toEqual({ title: 'Beställ dator', sealed: null });
      }
    });

    test('a throw rolls back the plan, its items and the audit row', async () => {
      const w = await world();
      const plan = planRow(w.p + '-p1', w.org, w.anna);
      await expect(
        w.store.transaction(async tx => {
          await tx.insertPlan(plan);
          await tx.workItems.open({
            threadId: w.p + '-t1',
            personId: w.boss,
            itemId: w.p + '-a',
            planId: plan.id,
            event: 'introduction',
            title: 'Beställ dator',
            dueOn: '2026-11-20',
            at: T,
          });
          await tx.insertItem(itemRow(w.p + '-a', plan.id, 0, { ownerId: w.boss, threadId: w.p + '-t1' }));
          await tx.audit({ actor: 'person:x', action: 'boarding.plan_started', subject: 'plan:' + plan.id, at: T });
          throw new Error('after the writes');
        }),
      ).rejects.toThrow('after the writes');
      expect(await w.store.transaction(tx => tx.plan(plan.id))).toBeUndefined();
      expect(await w.store.transaction(tx => tx.items([plan.id]))).toEqual([]);
      expect(await w.auditFor('plan:' + plan.id)).toEqual([]);
      await w.store.transaction(tx =>
        tx.audit({ actor: 'person:x', action: 'boarding.plan_closed', subject: 'plan:' + plan.id, at: T }),
      );
      expect(await w.auditFor('plan:' + plan.id)).toEqual([{ actor: 'person:x', action: 'boarding.plan_closed' }]);
    });

    test('persons are named with whether they are active; an unknown id is absent', async () => {
      const w = await world();
      const gone = w.p + '-gone';
      await w.seedPerson(person(gone, w.org, false));
      const found = await w.store.transaction(tx => tx.persons([w.anna, gone, w.p + '-nobody', w.anna]));
      expect(found.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
        [person(w.anna, w.org), person(gone, w.org, false)].sort((a, b) => a.id.localeCompare(b.id)),
      );
      expect(await w.store.transaction(tx => tx.persons([]))).toEqual([]);
    });

    test('erasing a person removes their plans with every item and card, and removes them from the rest', async () => {
      const w = await world();
      const hers = planRow(w.p + '-p1', w.org, w.anna, { startedBy: w.boss, buddyId: w.bo });
      const his = planRow(w.p + '-p2', w.org, w.bo, { startedBy: w.anna, buddyId: w.anna });
      for (const p of [hers, his]) await w.store.transaction(tx => tx.insertPlan(p));
      await addWithCard(w, hers, itemRow(w.p + '-a', hers.id, 0, { ownerId: w.boss }), w.p + '-t1');
      await addWithCard(w, hers, itemRow(w.p + '-b', hers.id, 1, { ownerId: w.anna }), w.p + '-t2');
      await addWithCard(w, his, itemRow(w.p + '-c', his.id, 0, { ownerId: w.anna }), w.p + '-t3');
      await addWithCard(w, his, itemRow(w.p + '-d', his.id, 1, { ownerId: w.boss }), w.p + '-t4');
      await w.store.transaction(tx => tx.updateItem(w.p + '-d', { doneAt: T, doneBy: w.anna }));
      // The boss's own plan, which Anna and Bo hold.
      const third = planRow(w.p + '-p3', w.org, w.boss);
      await w.store.transaction(async tx => {
        await tx.insertPlan(third);
        await tx.holdPlan(third.id, [w.anna, w.bo], T);
      });
      const erased = await w.store.transaction(tx => tx.erasePerson(w.anna));
      expect(erased).toEqual({
        plans: 1,
        items: 2,
        // Bo's plan (started by and buddied by her), the boss's (held by her), the item she owned and the one she ticked.
        cleared: 4,
        threadIds: [w.p + '-t1', w.p + '-t2', w.p + '-t3'].sort(),
      });
      expect(await w.store.transaction(tx => tx.plan(hers.id))).toBeUndefined();
      expect(await w.store.transaction(tx => tx.items([hers.id]))).toEqual([]);
      expect(await w.store.transaction(tx => tx.plan(his.id))).toMatchObject({ startedBy: null, buddyId: null });
      expect(await w.store.transaction(tx => tx.plan(third.id))).toMatchObject({ heldAt: T, heldBy: [w.bo] });
      expect(
        (await w.store.transaction(tx => tx.items([his.id]))).map(i => [i.id, i.ownerId, i.threadId, i.doneBy]),
      ).toEqual([
        [w.p + '-c', null, null, null],
        [w.p + '-d', w.boss, w.p + '-t4', null],
      ]);
    });

    test('the export is the organisation’s layers with their items, its plans and their items, titles opened', async () => {
      const w = await world();
      const layer = layerRow(w.p + '-l1', w.org);
      await w.store.transaction(async tx => {
        await tx.insertLayer(layer);
        await tx.replaceLayerItems(layer.id, [layerItemRow(w.p + '-li', layer.id, 0)]);
        await tx.insertLayer(layerRow(w.p + '-l2', w.org + '-other'));
      });
      const plan = planRow(w.p + '-p1', w.org, w.anna, { startedBy: w.boss });
      await w.store.transaction(tx => tx.insertPlan(plan));
      await addWithCard(
        w,
        plan,
        itemRow(w.p + '-a', plan.id, 0, { ownerId: w.boss, title: 'Ring Anna', added: true }),
        w.p + '-t1',
      );
      const data = await w.store.transaction(tx => tx.exportOrganisation(w.org));
      expect(data.layers.map(l => [l.id, l.items.map(i => i.id)])).toEqual([[layer.id, [w.p + '-li']]]);
      expect(data.plans.map(p => p.id)).toEqual([plan.id]);
      expect(data.items.map(i => [i.id, i.title, i.added])).toEqual([[w.p + '-a', 'Ring Anna', true]]);
      expect(await w.store.transaction(tx => tx.exportOrganisation(w.org + '-empty'))).toEqual({
        layers: [],
        plans: [],
        items: [],
      });
    });
  });
}
