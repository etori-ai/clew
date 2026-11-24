import { describe, expect, test } from 'bun:test';
import type { FollowBinding } from '../apps/server/src/modules/jobs/contracts';
import type { FollowBindingStore } from '../apps/server/src/modules/jobs/model';

/**
 * The follow bindings' store (D55, D77): an administrator's decision that a follower runs for a fact kind, which gates
 * what a job may contain. One suite, two adapters: `tests/unit/follow-binding-store.test.ts` on memory,
 * `tests/db/postgres-follow-binding-store.test.ts` on Postgres (DE-M7). Every id and fact kind carries the harness's
 * prefix, since the Postgres table is the installation's.
 */
export interface FollowBindingStoreHarness {
  store: FollowBindingStore;
  /** Prefixes every id and fact kind the suite writes, so runs never meet. */
  prefix: string;
  /** The audit rows written about `subject`, oldest first. */
  auditFor(subject: string): Promise<Array<{ actor: string; action: string; details: Record<string, unknown> }>>;
}
const T = (minutes: number) => new Date(Date.parse('2099-11-05T09:00:00.000Z') + minutes * 60_000).toISOString();
export const bindingRow = (id: string, kind: string, extra: Partial<FollowBinding> = {}): FollowBinding => ({
  id,
  kind,
  capability: 'reference.follow',
  audience: { mode: 'all' },
  enabled: true,
  createdAt: T(0),
  updatedAt: T(0),
  ...extra,
});
export function followBindingStoreContract(name: string, make: () => Promise<FollowBindingStoreHarness>) {
  describe(`${name} follow binding store`, () => {
    test('a binding is read back as written, a window only when it has one; a kind lists its bindings oldest first, then by id', async () => {
      const { store, prefix: p } = await make();
      const kind = 'reference:' + p,
        other = 'reference:' + p + '-other';
      const later = bindingRow(p + '-a', kind, { createdAt: T(2), updatedAt: T(2), within: 'P1D' }),
        first = bindingRow(p + '-c', kind, {
          capability: 'timesheet.follow',
          audience: { mode: 'selected', roles: ['manager'], units: [p + '-unit'] },
        }),
        tied = bindingRow(p + '-b', kind),
        elsewhere = bindingRow(p + '-d', other, { enabled: false });
      await store.transaction(async tx => {
        for (const b of [later, first, tied, elsewhere]) await tx.upsert(b);
      });
      expect(await store.read(later.id)).toEqual(later);
      expect(await store.read(first.id)).toEqual(first);
      expect(Object.keys((await store.read(first.id))!)).not.toContain('within');
      expect(await store.read(p + '-nobody')).toBeUndefined();
      expect(await store.list(kind)).toEqual([tied, first, later]);
      expect(await store.list(other)).toEqual([elsewhere]);
      expect(await store.list(kind + '-none')).toEqual([]);
      // Without a kind, every binding in the same order: these four among whatever else the table holds.
      expect((await store.list()).filter(b => b.id.startsWith(p))).toEqual([tied, first, elsewhere, later]);
    });
    test('an upsert changes the binding and keeps when it was made; a removal takes it away; the audit row commits with them', async () => {
      const { store, prefix: p, auditFor } = await make();
      const kind = 'reference:' + p,
        made = bindingRow(p + '-a', kind, { within: 'PT4H' });
      await store.transaction(async tx => {
        await tx.upsert(made);
        await tx.audit({ actor: 'person:admin', action: 'job.binding_added', subject: 'binding:' + made.id, at: T(0) });
      });
      const changed = {
        ...made,
        capability: 'payroll.follow',
        audience: { mode: 'selected' as const, roles: ['employee' as const] },
        enabled: false,
        createdAt: T(30),
        updatedAt: T(30),
      };
      const { within: _, ...withoutWindow } = changed;
      await store.transaction(async tx => {
        await tx.upsert(withoutWindow);
        await tx.audit({
          actor: 'person:admin',
          action: 'job.binding_changed',
          subject: 'binding:' + made.id,
          at: T(30),
          details: { enabled: false },
        });
      });
      expect(await store.read(made.id)).toEqual({ ...withoutWindow, createdAt: made.createdAt });
      expect(await store.list(kind)).toEqual([{ ...withoutWindow, createdAt: made.createdAt }]);
      await store.transaction(async tx => {
        await tx.remove(made.id);
        await tx.remove(p + '-nobody');
        await tx.audit({
          actor: 'person:admin',
          action: 'job.binding_removed',
          subject: 'binding:' + made.id,
          at: T(31),
        });
      });
      expect(await store.read(made.id)).toBeUndefined();
      expect(await store.list(kind)).toEqual([]);
      expect(await auditFor('binding:' + made.id)).toEqual([
        { actor: 'person:admin', action: 'job.binding_added', details: {} },
        { actor: 'person:admin', action: 'job.binding_changed', details: { enabled: false } },
        { actor: 'person:admin', action: 'job.binding_removed', details: {} },
      ]);
    });
    test('a throw rolls back the bindings written and removed and the audit row', async () => {
      const { store, prefix: p, auditFor } = await make();
      const kind = 'reference:' + p,
        kept = bindingRow(p + '-a', kind);
      await store.transaction(tx => tx.upsert(kept));
      await expect(
        store.transaction(async tx => {
          await tx.upsert(bindingRow(p + '-b', kind));
          await tx.upsert({ ...kept, enabled: false, updatedAt: T(5) });
          await tx.remove(kept.id);
          await tx.audit({
            actor: 'person:admin',
            action: 'job.binding_added',
            subject: 'binding:' + p + '-b',
            at: T(5),
          });
          throw new Error('after the writes');
        }),
      ).rejects.toThrow('after the writes');
      expect(await store.list(kind)).toEqual([kept]);
      expect(await store.read(p + '-b')).toBeUndefined();
      expect(await auditFor('binding:' + p + '-b')).toEqual([]);
    });
  });
}
