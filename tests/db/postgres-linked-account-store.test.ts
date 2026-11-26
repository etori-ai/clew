import { afterAll, expect, test } from 'bun:test';
import { asc, eq, like } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import { postgresLinkStore } from '../../apps/server/src/modules/linked-accounts/adapters/postgres';
import { linkStoreContract } from '../linked-account-store-contract';

/**
 * The link store contract against Postgres (D25, D147). `bun run test:db` inside the devcontainer. Each case gets
 * connectors of its own, so a developer's links are never touched, and they are removed afterwards with everything that
 * hangs on them. The sealer here is a stand-in that binds a value to its purpose as the server's does, so a value opened
 * for another person or connector fails.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const run = `test-${Math.random().toString(36).slice(2, 8)}-`;
const sealer = {
  seal: (value: string, purpose: string) => JSON.stringify([purpose, Buffer.from(value).toString('base64')]),
  open: (value: string, purpose: string) => {
    const [sealedFor, data] = JSON.parse(value) as [string, string];
    if (sealedFor !== purpose) throw new Error('Sealed for another purpose');
    return Buffer.from(data, 'base64').toString();
  },
};
afterAll(async () => {
  await database()
    .delete(schema.audit)
    .where(like(schema.audit.subject, `linked-account:${run}%`));
  await database()
    .delete(schema.connectors)
    .where(like(schema.connectors.id, `${run}%`));
  await closeDatabase();
});
let n = 0;
async function harness() {
  const prefix = `${run}${++n}-`;
  await database()
    .insert(schema.connectors)
    .values(['hr', 'ledger'].map(id => ({ id: prefix + id, bundled: true, createdBy: 'test', updatedBy: 'test' })));
  return {
    store: postgresLinkStore(sealer),
    prefix,
    audit: async () =>
      (
        await database()
          .select()
          .from(schema.audit)
          .where(like(schema.audit.subject, `linked-account:${prefix}%`))
          .orderBy(asc(schema.audit.id))
      ).map(row => ({ actor: row.actor, action: row.action, subject: row.subject, details: row.details })),
  };
}
linkStoreContract('postgres', harness);

test('no token, verifier or client secret is stored as it is, and a connector takes its rows with it', async () => {
  const { store, prefix } = await harness();
  const connectorId = prefix + 'hr';
  await store.transaction(async tx => {
    await tx.save({
      personId: prefix + 'anna',
      connectorId,
      issuer: 'https://id.vendor.test',
      resource: 'https://hr.vendor.test',
      scopes: [],
      state: 'linked',
      accessToken: 'plain-access-token',
      refreshToken: 'plain-refresh-token',
      expiresAt: null,
      lastError: null,
      lostAt: null,
      linkedAt: '2026-11-25T08:00:00.000Z',
    });
    await tx.pend({
      state: prefix + 'state',
      verifier: 'plain-verifier',
      personId: prefix + 'anna',
      connectorId,
      issuer: 'https://id.vendor.test',
      returnTo: '/',
      expiresAt: '2026-11-25T08:10:00.000Z',
    });
    await tx.saveClient(connectorId, 'https://id.vendor.test', {
      id: 'client-1',
      secret: 'plain-client-secret',
      source: 'registered',
    });
  });
  const stored = JSON.stringify([
    await database().select().from(schema.linkedAccounts).where(eq(schema.linkedAccounts.connectorId, connectorId)),
    await database()
      .select()
      .from(schema.linkedAccountPending)
      .where(eq(schema.linkedAccountPending.connectorId, connectorId)),
    await database()
      .select()
      .from(schema.linkedAccountClients)
      .where(eq(schema.linkedAccountClients.connectorId, connectorId)),
  ]);
  for (const secret of ['plain-access-token', 'plain-refresh-token', 'plain-verifier', 'plain-client-secret'])
    expect(stored).not.toContain(secret);
  // The envelope is bound to the person and the connector: moved to another person's row, it does not open.
  await database()
    .update(schema.linkedAccounts)
    .set({ personId: prefix + 'bo' })
    .where(eq(schema.linkedAccounts.connectorId, connectorId));
  await expect(store.linksOf(prefix + 'bo')).rejects.toThrow('Sealed for another purpose');

  await database().delete(schema.connectors).where(eq(schema.connectors.id, connectorId));
  expect(await store.transaction(tx => tx.linksTo(connectorId))).toEqual([]);
  expect(await store.transaction(tx => tx.take(prefix + 'state'))).toBeNull();
  expect(await store.transaction(tx => tx.client(connectorId, 'https://id.vendor.test'))).toBeNull();
});
