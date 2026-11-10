import { describe, expect, test } from 'bun:test';
import { themeFromAccent } from '@clew/contracts';
import {
  EMPTY_APPEARANCE,
  type AppearanceRecord,
  type AppearanceStore,
} from '../apps/server/src/modules/appearance/ports';

/**
 * The appearance store contract (D25, D97): one suite, two adapters. `tests/unit/appearance-store.test.ts` runs it
 * against the memory adapter, `tests/db/postgres-appearance-store.test.ts` against Postgres.
 */
export interface AppearanceStoreHarness {
  store: AppearanceStore;
  /** The audit rows this store's transactions wrote, oldest first. */
  audit(): Promise<Array<{ actor: string; action: string; subject: string; details: Record<string, unknown> }>>;
  /** The subject this run's audit rows carry, so the Postgres harness finds and removes its own. */
  subject: string;
}
const T = '2026-11-10T08:00:00.000Z';
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 255]);
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
const record = (revision: number, overrides: Partial<AppearanceRecord> = {}): AppearanceRecord => ({
  revision,
  theme: themeFromAccent('#005595', '#daeff1', 'Exempelkommunen'),
  logo: { alt: 'Exempelkommunen', light: { mediaType: 'image/png', bytes: png }, dark: null },
  updatedAt: T,
  updatedBy: 'Mikael Lund',
  ...overrides,
});

export function appearanceStoreContract(name: string, make: () => Promise<AppearanceStoreHarness>) {
  describe(`${name} appearance store`, () => {
    test('an installation nobody has configured reads as revision 0 with no theme and no logo', async () => {
      const { store } = await make();
      expect(await store.read()).toEqual(EMPTY_APPEARANCE);
      expect(await store.transaction(tx => tx.read())).toEqual(EMPTY_APPEARANCE);
    });

    test('a write is read back byte for byte, with its audit row, and the next write replaces it', async () => {
      const { store, audit, subject } = await make();
      await store.transaction(async tx => {
        await tx.write(record(1));
        await tx.audit({ actor: 'person:mikael', action: 'appearance.theme.set', subject, details: { revision: 1 } });
      });
      expect(await store.read()).toEqual(record(1));
      const next = record(2, {
        theme: null,
        logo: {
          alt: 'Annan kommun',
          light: { mediaType: 'image/svg+xml', bytes: svg },
          dark: { mediaType: 'image/png', bytes: png },
        },
      });
      await store.transaction(tx => tx.write(next));
      expect(await store.read()).toEqual(next);
      await store.transaction(tx => tx.write(record(3, { theme: null, logo: null })));
      expect(await store.read()).toEqual(record(3, { theme: null, logo: null }));
      expect((await audit()).map(a => [a.actor, a.action, a.details])).toEqual([
        ['person:mikael', 'appearance.theme.set', { revision: 1 }],
      ]);
    });

    test('a transaction that throws leaves neither the record nor its audit row', async () => {
      const { store, audit, subject } = await make();
      await store.transaction(tx => tx.write(record(1)));
      await expect(
        store.transaction(async tx => {
          await tx.write(record(2, { theme: null }));
          await tx.audit({ actor: 'person:mikael', action: 'appearance.theme.cleared', subject, details: {} });
          throw new Error('refused');
        }),
      ).rejects.toThrow('refused');
      expect(await store.read()).toEqual(record(1));
      expect(await audit()).toEqual([]);
    });

    test('two saves at once run one after the other, so a revision is never reused', async () => {
      const { store } = await make();
      const save = () =>
        store.transaction(async tx => {
          const current = await tx.read();
          await new Promise(resolve => setTimeout(resolve, 5));
          await tx.write(record(current.revision + 1));
          return current.revision + 1;
        });
      expect((await Promise.all([save(), save(), save()])).sort()).toEqual([1, 2, 3]);
      expect((await store.read()).revision).toBe(3);
    });
  });
}
