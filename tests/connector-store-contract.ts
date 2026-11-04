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
const T0 = '2026-11-04T06:00:00.000Z', T1 = '2026-11-04T06:05:00.000Z';
export const remoteRow = (id: string, overrides: Partial<NewConnector> = {}): NewConnector =>
  ({ id, bundled: false, url: 'http://hello:4010', secret: 'sealed:' + id, state: 'draft', manifest: { protocol: 1, id, kind: 'passthrough', source: 'Hello', areas: [], capabilities: [], scan: false }, health: { status: 'ok', at: T0 }, createdBy: 'person:mikael', at: T0, ...overrides });

export function connectorStoreContract(name: string, make: () => Promise<ConnectorStoreHarness>) {
  describe(`${name} connector store`, () => {
    test('a row is read back as inserted, with the defaults of a new connector; a second insert of the id is refused', async () => {
      const { store, fresh } = await make();
      const id = fresh();
      expect(await store.transaction(tx => tx.insert(remoteRow(id)))).toBe(true);
      expect(await store.transaction(tx => tx.insert(remoteRow(id)))).toBe(false);
      const row = (await store.read(id))!;
      expect(row).toMatchObject({ id, bundled: false, url: 'http://hello:4010', secret: 'sealed:' + id, secretChangedAt: T0, state: 'draft', audience: { mode: 'all' }, scanEnabled: true, toolsEnabled: true, capabilities: {},
        manifestAt: T0, health: { status: 'ok', at: T0 }, createdBy: 'person:mikael', updatedBy: 'person:mikael', createdAt: T0, updatedAt: T0, version: 1 });
      expect((row.manifest as { source: string }).source).toBe('Hello');
      expect((await store.list()).some(r => r.id === id)).toBe(true);
    });
    test('a bundled row has no address and no secret', async () => {
      const { store, fresh } = await make();
      const id = fresh();
      await store.transaction(tx => tx.insert(remoteRow(id, { bundled: true, url: null, secret: null, state: 'enabled' })));
      expect(await store.read(id)).toMatchObject({ bundled: true, url: null, secret: null, secretChangedAt: null, state: 'enabled' });
    });
    test('an update bumps the version and records who and when; an unknown id is false', async () => {
      const { store, fresh } = await make();
      const id = fresh();
      await store.transaction(tx => tx.insert(remoteRow(id)));
      expect(await store.transaction(tx => tx.update(id, { state: 'enabled', audience: { mode: 'selected', roles: ['manager'] }, capabilities: { 'hello.x': { enabled: false } } }, 'person:mikael', T1))).toBe(true);
      expect(await store.read(id)).toMatchObject({ state: 'enabled', audience: { mode: 'selected', roles: ['manager'] }, capabilities: { 'hello.x': { enabled: false } }, updatedBy: 'person:mikael', updatedAt: T1, version: 2 });
      expect(await store.transaction(tx => tx.update('nope-' + id, { state: 'enabled' }, 'x', T1))).toBe(false);
    });
    test('recordHealth changes health and the manifest without a version bump', async () => {
      const { store, fresh } = await make();
      const id = fresh();
      await store.transaction(tx => tx.insert(remoteRow(id)));
      await store.recordHealth(id, { status: 'unreachable', at: T1, detail: 'ECONNREFUSED' });
      expect(await store.read(id)).toMatchObject({ health: { status: 'unreachable', at: T1, detail: 'ECONNREFUSED' }, version: 1, manifestAt: T0 });
      await store.recordHealth(id, { status: 'ok', at: T1 }, { protocol: 1, id, kind: 'passthrough', source: 'Hello 2', areas: [], capabilities: [], scan: true }, T1);
      expect(await store.read(id)).toMatchObject({ manifestAt: T1, version: 1 });
      expect(((await store.read(id))!.manifest as { source: string }).source).toBe('Hello 2');
    });
    test('the audit row is written through the transaction and read back as history; a throw rolls everything back', async () => {
      const { store, fresh } = await make();
      const id = fresh();
      await store.transaction(async tx => { await tx.insert(remoteRow(id)); await tx.writeAudit({ actor: 'person:mikael', action: 'connector.added', subject: 'connector:' + id, at: T0, details: { url: 'http://hello:4010' } }); });
      expect(await store.history(id)).toEqual([{ at: T0, actor: 'person:mikael', action: 'connector.added', details: { url: 'http://hello:4010' } }]);
      await expect(store.transaction(async tx => { await tx.update(id, { state: 'enabled' }, 'person:mikael', T1); await tx.writeAudit({ actor: 'person:mikael', action: 'connector.enabled', subject: 'connector:' + id, at: T1 }); throw new Error('boom'); })).rejects.toThrow('boom');
      expect(await store.read(id)).toMatchObject({ state: 'draft', version: 1 });
      expect((await store.history(id)).length).toBe(1);
    });
    test('remove deletes the row; dismissOpenThreadsOf closes the open cards the connector pushed, and counts them', async () => {
      const { store, fresh, openCardFrom, cardState } = await make();
      const id = fresh();
      await store.transaction(tx => tx.insert(remoteRow(id, { state: 'enabled' })));
      const card = await openCardFrom(id);
      const closed = await store.transaction(async tx => { const n = await tx.dismissOpenThreadsOf(id, T1); await tx.remove(id); return n; });
      expect(closed).toBe(1);
      expect(await cardState(card)).toBe('dismissed');
      expect(await store.read(id)).toBeUndefined();
    });
  });
}
