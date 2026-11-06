import { describe, expect, test } from 'bun:test';
import type { ModelStore, NewModel, NewProvider } from '../apps/server/src/assistant/ports';

/**
 * The model store contract (D24, D25): one suite, two adapters. `tests/unit/model-store.test.ts` runs it against the
 * memory adapter, `tests/db/postgres-model-store.test.ts` against Postgres.
 */
export interface ModelStoreHarness {
  store: ModelStore;
  /** An id prefix this run may use freely (the Postgres harness removes its rows afterwards). */
  fresh(): string;
  /** A person who may hold a pick (Postgres needs the row). */
  person(): Promise<string>;
}
const T0 = '2026-11-05T06:00:00.000Z',
  T1 = '2026-11-05T06:05:00.000Z';
export const providerRow = (id: string, overrides: Partial<NewProvider> = {}): NewProvider => ({
  id,
  title: 'Kommunens modeller',
  baseUrl: 'http://llm.test/v1',
  apiKey: 'sealed:' + id,
  health: { status: 'ok', at: T0 },
  createdBy: 'person:mikael',
  at: T0,
  ...overrides,
});
export const modelRow = (id: string, providerId: string, overrides: Partial<NewModel> = {}): NewModel => ({
  id,
  providerId,
  model: 'gpt-oss:20b',
  title: 'Snabb (lokal)',
  description: 'Korta frågor om dagen.',
  tools: true,
  createdBy: 'person:mikael',
  at: T0,
  ...overrides,
});

export function modelStoreContract(name: string, make: () => Promise<ModelStoreHarness>) {
  describe(`${name} model store`, () => {
    test('a provider is read back as inserted, its key dated; one without a key has no date; a second insert of the id is refused', async () => {
      const { store, fresh } = await make();
      const id = fresh(),
        bare = fresh();
      expect(await store.transaction(tx => tx.insertProvider(providerRow(id)))).toBe(true);
      expect(await store.transaction(tx => tx.insertProvider(providerRow(id)))).toBe(false);
      await store.transaction(tx => tx.insertProvider(providerRow(bare, { apiKey: null })));
      expect(await store.readProvider(id)).toMatchObject({
        id,
        title: 'Kommunens modeller',
        baseUrl: 'http://llm.test/v1',
        apiKey: 'sealed:' + id,
        keyChangedAt: T0,
        health: { status: 'ok', at: T0 },
        createdBy: 'person:mikael',
        updatedBy: 'person:mikael',
        createdAt: T0,
        updatedAt: T0,
        version: 1,
      });
      expect(await store.readProvider(bare)).toMatchObject({ apiKey: null, keyChangedAt: null });
      expect((await store.listProviders()).map(p => p.id)).toEqual(expect.arrayContaining([id, bare]));
    });
    test('a model starts switched off, for everyone, not the default; the list keeps the order they were added', async () => {
      const { store, fresh } = await make();
      const p = fresh(),
        first = fresh(),
        second = fresh();
      await store.transaction(async tx => {
        await tx.insertProvider(providerRow(p));
        await tx.insertModel(modelRow(second, p, { at: T1 }));
        await tx.insertModel(modelRow(first, p));
      });
      expect(await store.readModel(first)).toMatchObject({
        id: first,
        providerId: p,
        model: 'gpt-oss:20b',
        title: 'Snabb (lokal)',
        description: 'Korta frågor om dagen.',
        state: 'disabled',
        audience: { mode: 'all' },
        isDefault: false,
        tools: true,
        createdAt: T0,
        version: 1,
      });
      const order = (await store.listModels()).map(m => m.id).filter(m => m === first || m === second);
      expect(order).toEqual([first, second]);
      expect(await store.transaction(tx => tx.insertModel(modelRow(first, p)))).toBe(false);
    });
    test('updates bump the version and record who and when; an unknown id is false', async () => {
      const { store, fresh } = await make();
      const p = fresh(),
        m = fresh();
      await store.transaction(async tx => {
        await tx.insertProvider(providerRow(p));
        await tx.insertModel(modelRow(m, p));
      });
      expect(
        await store.transaction(tx =>
          tx.updateModel(
            m,
            { state: 'enabled', audience: { mode: 'selected', roles: ['manager'] }, title: 'Kapabel', tools: false },
            'person:mikael',
            T1,
          ),
        ),
      ).toBe(true);
      expect(await store.readModel(m)).toMatchObject({
        state: 'enabled',
        audience: { mode: 'selected', roles: ['manager'] },
        title: 'Kapabel',
        tools: false,
        updatedAt: T1,
        version: 2,
      });
      expect(
        await store.transaction(tx =>
          tx.updateProvider(p, { apiKey: null, keyChangedAt: T1, title: 'Ny titel' }, 'person:mikael', T1),
        ),
      ).toBe(true);
      expect(await store.readProvider(p)).toMatchObject({
        apiKey: null,
        keyChangedAt: T1,
        title: 'Ny titel',
        version: 2,
      });
      expect(await store.transaction(tx => tx.updateModel('nope-' + m, { title: 'x' }, 'x', T1))).toBe(false);
      expect(await store.transaction(tx => tx.updateProvider('nope-' + p, { title: 'x' }, 'x', T1))).toBe(false);
    });
    test('there is at most one default: two flags in one transaction are refused and nothing of it stays', async () => {
      // Only this test's rows are touched: a shared database may hold a real default, and then the first flag is refused already.
      const { store, fresh } = await make();
      const p = fresh(),
        a = fresh(),
        b = fresh();
      await store.transaction(async tx => {
        await tx.insertProvider(providerRow(p));
        await tx.insertModel(modelRow(a, p));
        await tx.insertModel(modelRow(b, p));
      });
      await expect(
        store.transaction(async tx => {
          await tx.updateModel(a, { isDefault: true }, 'x', T1);
          await tx.updateModel(b, { isDefault: true, title: 'Två' }, 'x', T1);
        }),
      ).rejects.toThrow();
      expect(await store.readModel(a)).toMatchObject({ isDefault: false, version: 1 });
      expect(await store.readModel(b)).toMatchObject({ isDefault: false, title: 'Snabb (lokal)', version: 1 });
    });
    test("a person's pick is set, replaced and cleared; removing the model takes every pick of it along", async () => {
      const { store, fresh, person } = await make();
      const p = fresh(),
        a = fresh(),
        b = fresh(),
        who = await person();
      await store.transaction(async tx => {
        await tx.insertProvider(providerRow(p));
        await tx.insertModel(modelRow(a, p));
        await tx.insertModel(modelRow(b, p));
      });
      expect(await store.readChoice(who)).toBeUndefined();
      await store.transaction(tx => tx.setChoice(who, a, T0));
      await store.transaction(tx => tx.setChoice(who, b, T1));
      expect(await store.readChoice(who)).toBe(b);
      await store.transaction(tx => tx.setChoice(who, null, T1));
      expect(await store.readChoice(who)).toBeUndefined();
      await store.transaction(tx => tx.setChoice(who, a, T1));
      await store.transaction(tx => tx.removeModel(a));
      expect(await store.readModel(a)).toBeUndefined();
      expect(await store.readChoice(who)).toBeUndefined();
    });
    test('a provider with models cannot be removed; without them it can', async () => {
      const { store, fresh } = await make();
      const p = fresh(),
        m = fresh();
      await store.transaction(async tx => {
        await tx.insertProvider(providerRow(p));
        await tx.insertModel(modelRow(m, p));
      });
      await expect(store.transaction(tx => tx.removeProvider(p))).rejects.toThrow();
      expect(await store.readProvider(p)).toBeDefined();
      await store.transaction(async tx => {
        await tx.removeModel(m);
        await tx.removeProvider(p);
      });
      expect(await store.readProvider(p)).toBeUndefined();
    });
    test('recordHealth changes health without a version bump; the audit rows are written in the transaction and read back by subject; a throw rolls everything back', async () => {
      const { store, fresh } = await make();
      const p = fresh();
      await store.transaction(async tx => {
        await tx.insertProvider(providerRow(p));
        await tx.writeAudit({
          actor: 'person:mikael',
          action: 'provider.added',
          subject: 'provider:' + p,
          at: T0,
          details: { key: true },
        });
      });
      await store.recordHealth(p, { status: 'unreachable', at: T1, detail: 'ECONNREFUSED' });
      expect(await store.readProvider(p)).toMatchObject({
        health: { status: 'unreachable', at: T1, detail: 'ECONNREFUSED' },
        version: 1,
      });
      expect(await store.history('provider:' + p)).toEqual([
        { at: T0, actor: 'person:mikael', action: 'provider.added', details: { key: true } },
      ]);
      await expect(
        store.transaction(async tx => {
          await tx.updateProvider(p, { title: 'x' }, 'person:mikael', T1);
          await tx.writeAudit({ actor: 'person:mikael', action: 'provider.title', subject: 'provider:' + p, at: T1 });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await store.readProvider(p)).toMatchObject({ title: 'Kommunens modeller', version: 1 });
      expect(await store.history('provider:' + p)).toHaveLength(1);
    });
  });
}
