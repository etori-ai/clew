import { describe, expect, test } from 'bun:test';
import type { ConnectorStore, NewConnector } from '../apps/server/src/connectors/model';

/**
 * The connector store contract (D23, D25): one suite, two adapters. `tests/unit/connector-store.test.ts` runs it against
 * the memory adapter, `tests/db/postgres-connector-store.test.ts` against Postgres.
 */
export interface ConnectorStoreHarness {
  store: ConnectorStore;
  /** An id this run may use freely (the Postgres harness removes it afterwards). */
  fresh(): string;
  /** Put an open card from this connector where `dismissOpenThreadsOf` will find it; returns its id. */
  openCardFrom(connectorId: string): Promise<string>;
  cardState(threadId: string): Promise<string | undefined>;
}
const T0 = '2026-11-04T06:00:00.000Z',
  T1 = '2026-11-04T06:05:00.000Z',
  T2 = '2026-11-04T06:10:00.000Z';
/** The same document with every object's keys in the reverse order, as a jsonb round trip may hand it back. */
const reversed = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(reversed)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([k, v]) => [k, reversed(v)]),
        )
      : value;
export const remoteRow = (id: string, overrides: Partial<NewConnector> = {}): NewConnector => ({
  id,
  bundled: false,
  url: 'http://hello:4010',
  secret: 'sealed:' + id,
  state: 'draft',
  manifest: { protocol: 1, id, kind: 'passthrough', source: 'Hello', areas: [], capabilities: [], scan: false },
  health: { status: 'ok', at: T0 },
  createdBy: 'person:mikael',
  at: T0,
  ...overrides,
});

export function connectorStoreContract(name: string, make: () => Promise<ConnectorStoreHarness>) {
  describe(`${name} connector store`, () => {
    test('a remote row takes the lowest free ordinal, a removed one frees it and the others keep theirs; a bundled row has none (D71)', async () => {
      const { store, fresh } = await make();
      const [a, b, c, d] = [fresh(), fresh(), fresh(), fresh()];
      await store.transaction(async tx => {
        await tx.insert(remoteRow(a));
        await tx.insert(remoteRow(b));
        await tx.insert({ ...remoteRow(d), bundled: true, url: null, secret: null });
      });
      const first = (await store.read(a))!.ordinal!,
        second = (await store.read(b))!.ordinal!;
      expect(second).toBe(first + 1);
      expect((await store.read(d))!.ordinal).toBeNull();
      await store.transaction(tx => tx.remove(a));
      await store.transaction(tx => tx.insert(remoteRow(c)));
      expect((await store.read(c))!.ordinal).toBe(first);
      expect((await store.read(b))!.ordinal).toBe(second);
    });
    test('a row is read back as inserted, with the defaults of a new connector; a second insert of the id is refused', async () => {
      const { store, fresh } = await make();
      const id = fresh();
      expect(await store.transaction(tx => tx.insert(remoteRow(id)))).toBe(true);
      expect(await store.transaction(tx => tx.insert(remoteRow(id)))).toBe(false);
      const row = (await store.read(id))!;
      expect(row).toMatchObject({
        id,
        bundled: false,
        url: 'http://hello:4010',
        secret: 'sealed:' + id,
        secretChangedAt: T0,
        state: 'draft',
        audience: { mode: 'all' },
        scanEnabled: true,
        toolsEnabled: true,
        capabilities: {},
        areas: {},
        manifestAt: T0,
        health: { status: 'ok', at: T0 },
        createdBy: 'person:mikael',
        updatedBy: 'person:mikael',
        createdAt: T0,
        updatedAt: T0,
        version: 1,
      });
      expect((row.manifest as { source: string }).source).toBe('Hello');
      expect((await store.list()).some(r => r.id === id)).toBe(true);
    });
    test('a bundled row has no address and no secret', async () => {
      const { store, fresh } = await make();
      const id = fresh();
      await store.transaction(tx =>
        tx.insert(remoteRow(id, { bundled: true, url: null, secret: null, state: 'enabled' })),
      );
      expect(await store.read(id)).toMatchObject({
        bundled: true,
        url: null,
        secret: null,
        secretChangedAt: null,
        state: 'enabled',
      });
    });
    test('an update bumps the version and records who and when; an unknown id is false', async () => {
      const { store, fresh } = await make();
      const id = fresh();
      await store.transaction(tx => tx.insert(remoteRow(id)));
      expect(
        await store.transaction(tx =>
          tx.update(
            id,
            {
              state: 'enabled',
              audience: { mode: 'selected', roles: ['manager'] },
              capabilities: { 'hello.x': { enabled: false }, 'hello.list': { model: false, menu: true } },
              header: true,
            },
            'person:mikael',
            T1,
          ),
        ),
      ).toBe(true);
      expect(await store.read(id)).toMatchObject({
        state: 'enabled',
        audience: { mode: 'selected', roles: ['manager'] },
        capabilities: { 'hello.x': { enabled: false }, 'hello.list': { model: false, menu: true } },
        header: true,
        updatedBy: 'person:mikael',
        updatedAt: T1,
        version: 2,
      });
      expect(await store.transaction(tx => tx.update('nope-' + id, { state: 'enabled' }, 'x', T1))).toBe(false);
    });
    test("an area's figure switch is stored per area, read back, and kept by an update of something else (D54)", async () => {
      const { store, fresh } = await make();
      const id = fresh();
      await store.transaction(tx => tx.insert(remoteRow(id)));
      await store.transaction(tx => tx.update(id, { areas: { work: { figure: false } } }, 'person:mikael', T1));
      expect(await store.read(id)).toMatchObject({ areas: { work: { figure: false } }, version: 2 });
      await store.transaction(tx => tx.update(id, { scanEnabled: false }, 'person:mikael', T1));
      expect(await store.read(id)).toMatchObject({ areas: { work: { figure: false } }, scanEnabled: false });
      await store.transaction(tx => tx.update(id, { areas: {} }, 'person:mikael', T1));
      expect((await store.read(id))!.areas).toEqual({});
    });
    test('recordCheck records the health and what the service serves, never the approved manifest, without a version bump (D144)', async () => {
      const { store, fresh } = await make();
      const id = fresh();
      await store.transaction(tx => tx.insert(remoteRow(id)));
      const approved = (await store.read(id))!.manifest;
      await store.recordCheck(id, { health: { status: 'unreachable', at: T1, detail: 'ECONNREFUSED' }, at: T1 });
      expect(await store.read(id)).toMatchObject({
        health: { status: 'unreachable', at: T1, detail: 'ECONNREFUSED' },
        version: 1,
        manifestAt: T0,
        offered: null,
        offeredAt: null,
      });
      const served = { ...(approved as object), source: 'Hello 2', scan: true };
      // A manifest without a check keeps the health as it was.
      await store.recordCheck(id, { served, at: T1 });
      let row = (await store.read(id))!;
      expect(row).toMatchObject({ manifest: approved, manifestAt: T0, offeredAt: T1, version: 1 });
      expect(row.health.status).toBe('unreachable');
      expect((row.offered as { source: string }).source).toBe('Hello 2');
      // The same offer seen again, its keys in the reverse order, keeps the instant it was first seen.
      await store.recordCheck(id, { health: { status: 'ok', at: T2 }, served: reversed(served), at: T2 });
      expect((await store.read(id))!.offeredAt).toBe(T1);
      await store.recordCheck(id, { served: { ...served, source: 'Hello 3' }, at: T2 });
      expect((await store.read(id))!.offeredAt).toBe(T2);
      // The service serves the approved manifest again, its keys in another order: the offer goes in the same write.
      await store.recordCheck(id, { health: { status: 'ok', at: T2 }, served: reversed(approved), at: T2 });
      row = (await store.read(id))!;
      expect(row).toMatchObject({ offered: null, offeredAt: null, manifest: approved, version: 1 });
      // A draft with nothing approved yet: whatever the service serves is the offer.
      const draft = fresh();
      await store.transaction(tx => tx.insert(remoteRow(draft, { manifest: null })));
      await store.recordCheck(draft, { served, at: T1 });
      expect(await store.read(draft)).toMatchObject({ manifest: null, offeredAt: T1 });
    });
    test('approveOffer puts the reviewed offer live only while it is still the stored one, and bumps the version (D144)', async () => {
      const { store, fresh } = await make();
      const id = fresh();
      await store.transaction(tx => tx.insert(remoteRow(id)));
      const approved = (await store.read(id))!.manifest as object;
      const first = { ...approved, source: 'Hello 2' };
      await store.recordCheck(id, { served: first, at: T1 });
      // Another offer took its place after the review: the review's offer is no longer the stored one.
      const second = { ...approved, source: 'Hello 3' };
      await store.recordCheck(id, { served: second, at: T2 });
      expect(
        await store.transaction(tx => tx.approveOffer(id, { at: T1, manifest: first }, first, 'person:mikael', T2)),
      ).toBe(false);
      // Same instant, other content: refused too.
      expect(
        await store.transaction(tx => tx.approveOffer(id, { at: T2, manifest: first }, first, 'person:mikael', T2)),
      ).toBe(false);
      expect(await store.read(id)).toMatchObject({ manifest: approved, version: 1 });
      // The stored offer, named by its instant and its content (keys in any order), goes live.
      expect(
        await store.transaction(tx =>
          tx.approveOffer(id, { at: T2, manifest: reversed(second) }, second, 'person:mikael', T2),
        ),
      ).toBe(true);
      const row = (await store.read(id))!;
      expect(row).toMatchObject({
        manifestAt: T2,
        offered: null,
        offeredAt: null,
        updatedBy: 'person:mikael',
        version: 2,
      });
      expect((row.manifest as { source: string }).source).toBe('Hello 3');
      // Once applied there is no offer left to apply again.
      expect(
        await store.transaction(tx => tx.approveOffer(id, { at: T2, manifest: second }, second, 'person:mikael', T2)),
      ).toBe(false);
    });
    test("recordDescription moves a bundled row's description and never a remote row's manifest", async () => {
      const { store, fresh } = await make();
      const id = fresh();
      await store.transaction(tx => tx.insert(remoteRow(id)));
      const approved = (await store.read(id))!.manifest;
      await store.recordDescription(id, { source: 'Somebody else' }, T1);
      expect(await store.read(id)).toMatchObject({ manifest: approved, manifestAt: T0 });
      const bundled = fresh();
      await store.transaction(tx => tx.insert(remoteRow(bundled, { bundled: true, url: null, secret: null })));
      await store.recordDescription(bundled, { source: 'The new build' }, T1);
      expect(await store.read(bundled)).toMatchObject({
        manifest: { source: 'The new build' },
        manifestAt: T1,
        version: 1,
      });
    });
    test('the audit row is written through the transaction and read back as history; a throw rolls everything back', async () => {
      const { store, fresh } = await make();
      const id = fresh();
      await store.transaction(async tx => {
        await tx.insert(remoteRow(id));
        await tx.writeAudit({
          actor: 'person:mikael',
          action: 'connector.added',
          subject: 'connector:' + id,
          at: T0,
          details: { url: 'http://hello:4010' },
        });
      });
      expect(await store.history(id)).toEqual([
        { at: T0, actor: 'person:mikael', action: 'connector.added', details: { url: 'http://hello:4010' } },
      ]);
      await expect(
        store.transaction(async tx => {
          await tx.update(id, { state: 'enabled' }, 'person:mikael', T1);
          await tx.writeAudit({
            actor: 'person:mikael',
            action: 'connector.enabled',
            subject: 'connector:' + id,
            at: T1,
          });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await store.read(id)).toMatchObject({ state: 'draft', version: 1 });
      expect((await store.history(id)).length).toBe(1);
    });
    test('remove deletes the row; dismissOpenThreadsOf closes the open cards the connector pushed, and counts them', async () => {
      const { store, fresh, openCardFrom, cardState } = await make();
      const id = fresh();
      await store.transaction(tx => tx.insert(remoteRow(id, { state: 'enabled' })));
      const card = await openCardFrom(id);
      const closed = await store.transaction(async tx => {
        const n = await tx.dismissOpenThreadsOf(id, T1);
        await tx.remove(id);
        return n;
      });
      expect(closed).toBe(1);
      expect(await cardState(card)).toBe('dismissed');
      expect(await store.read(id)).toBeUndefined();
    });
  });
}
