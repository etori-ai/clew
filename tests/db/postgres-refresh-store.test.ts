import { afterAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresRefreshStore } from '../../apps/server/src/threads/adapters/refresh-postgres';
import { openSecret, sealSecret } from '../../apps/server/src/auth-crypto';
import { refreshStoreContract, requestRecord } from '../refresh-store-contract';
import { testDurable } from './durable';

process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
const sealer = { seal: sealSecret, open: openSecret };
const people: string[] = [];
const make = async () => {
  const personId = 'refresh-store-test-' + randomUUID();
  people.push(personId);
  await database()
    .insert(schema.people)
    .values({ id: personId, organisationId: 'test', name: 'Synthetic refresh store test' });
  return {
    store: postgresRefreshStore({ durable: testDurable, sealer }, personId),
    personId,
    requested: async (id: string) =>
      (
        await database()
          .select()
          .from(schema.audit)
          .where(and(eq(schema.audit.subject, 'refresh:' + id), eq(schema.audit.action, 'refresh.requested')))
          .orderBy(schema.audit.id)
      ).map(a => a.details as Record<string, unknown>),
  };
};
refreshStoreContract('postgres', make);
test('the binding a request keeps is sealed to its own request and survives a new adapter instance (D26)', async () => {
  const w = await make(),
    r = requestRecord(w.personId, 'synthetic-digest-1', '2099-11-05T09:00:00.000Z');
  await w.store.request(r);
  const [raw] = await database().select().from(schema.refreshRequests).where(eq(schema.refreshRequests.id, r.id));
  expect(raw!.session).not.toContain('synthetic-digest');
  expect(await postgresRefreshStore({ durable: testDurable, sealer }).statuses(w.personId)).toEqual([r]);
  // A binding that does not open here (moved from another request, or sealed under another key) names no session, and
  // the request can still be claimed.
  await database()
    .update(schema.refreshRequests)
    .set({ session: sealSecret('synthetic-digest-1', 'refresh:session:another-request') })
    .where(eq(schema.refreshRequests.id, r.id));
  expect(await w.store.claim('2099-11-05T09:00:00.000Z', '2099-11-05T09:00:30.000Z')).toMatchObject({
    id: r.id,
    state: 'running',
    session: null,
  });
});
afterAll(async () => {
  const requests = await database()
    .select({ id: schema.refreshRequests.id })
    .from(schema.refreshRequests)
    .where(inArray(schema.refreshRequests.personId, people));
  if (requests.length)
    await database()
      .delete(schema.audit)
      .where(
        inArray(
          schema.audit.subject,
          requests.map(r => 'refresh:' + r.id),
        ),
      );
  await database().delete(schema.people).where(inArray(schema.people.id, people));
});
