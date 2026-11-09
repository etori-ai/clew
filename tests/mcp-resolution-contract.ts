import { expect } from 'bun:test';
import type { McpStore } from '../apps/server/src/mcp/ports';

/** Shared by the memory scenarios and the real Postgres adapter. */
export async function mcpResolutionContract(store: McpStore, personId: string, connectionId: string, id: string) {
  const delivery = {
    id,
    connectionId,
    title: 'Provider',
    text: 'Needs attention',
    createdAt: '2026-11-09T10:00:00.000Z',
  };
  await store.transaction(async tx => {
    if (await tx.deliver(personId, delivery)) await tx.audit(personId, 'mcp.delivered', id);
  });
  expect((await store.deliveries(personId, [connectionId])).some(d => d.id === id)).toBe(true);
  expect(await store.delivery('other-person', connectionId, id)).toBeUndefined();
  expect(await store.delivery(personId, 'other-connection', id)).toBeUndefined();
  const resolve = (person = personId, connection = connectionId) =>
    store.transaction(async tx => {
      const changed = await tx.resolve(person, connection, id, '2026-11-09T10:01:00Z');
      if (changed) await tx.audit(personId, 'mcp.resolved', id);
      return changed;
    });
  expect(await resolve('other-person')).toBe(false);
  expect(await resolve(personId, 'other-connection')).toBe(false);
  expect(await resolve()).toBe(true);
  expect(await resolve()).toBe(false);
  expect((await store.deliveries(personId, [connectionId])).some(d => d.id === id)).toBe(false);
  expect(await store.delivery(personId, connectionId, id)).toMatchObject(delivery);
  expect(await store.transaction(tx => tx.deliver(personId, delivery))).toBe(false);
  expect((await store.deliveries(personId, [connectionId])).some(d => d.id === id)).toBe(false);
}
