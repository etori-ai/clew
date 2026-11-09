import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { database, closeDatabase, schema } from '@clew/db';
import { postgresMcpStore } from '../../apps/server/src/mcp/adapters/postgres';
import { mcpResolutionContract } from '../mcp-resolution-contract';
import { sealSecret, openSecret } from '../../apps/server/src/auth-crypto';

if (!process.env.DATABASE_URL) throw new Error('Run this test in the development container.');
const prefix = 'test-mcp-' + crypto.randomUUID();
const personId = prefix + '-person',
  connectionId = prefix + '-connection',
  decisionId = prefix + '-decision';
const previousKey = process.env.MASTER_KEY;
const store = postgresMcpStore({ seal: sealSecret, open: openSecret });
beforeAll(async () => {
  process.env.MASTER_KEY = Buffer.alloc(32, 9).toString('base64');
  await database().transaction(async tx => {
    await tx.insert(schema.people).values({ id: personId, organisationId: 'test', name: 'Synthetic MCP store test' });
    await tx.insert(schema.mcpConnections).values({
      id: connectionId,
      personId,
      url: 'https://example.test/mcp',
      enabled: true,
      readTools: ['read'],
      writeTools: ['write'],
      watch: { tool: 'read', arguments: {}, intervalSeconds: 30, identity: ['/id'], deliverInitial: true },
    });
    await tx.insert(schema.audit).values({ actor: personId, action: 'mcp.registered', subject: connectionId });
  });
});
afterAll(async () => {
  await database().transaction(async tx => {
    await tx.delete(schema.mcpDeliveries).where(eq(schema.mcpDeliveries.personId, personId));
    await tx.delete(schema.mcpDecisions).where(eq(schema.mcpDecisions.personId, personId));
    await tx.delete(schema.mcpConnections).where(eq(schema.mcpConnections.id, connectionId));
    await tx
      .delete(schema.audit)
      .where(inArray(schema.audit.subject, [connectionId, decisionId, prefix + '-resolved', prefix + '-rollback']));
    await tx.delete(schema.people).where(eq(schema.people.id, personId));
  });
  if (previousKey === undefined) delete process.env.MASTER_KEY;
  else process.env.MASTER_KEY = previousKey;
  await closeDatabase();
});
test('MCP observations, delivery uniqueness, actor filtering and audit roll back together', async () => {
  const delivery = {
    id: prefix + '-delivery',
    connectionId,
    title: 'Provider',
    text: 'Source invitation',
    createdAt: '2026-11-08T10:00:00Z',
  };
  await expect(
    store.transaction(async tx => {
      await tx.observe(connectionId, 'uncommitted');
      await tx.deliver(personId, delivery);
      await tx.audit(personId, 'mcp.delivered', connectionId);
      throw new Error('Rollback');
    }),
  ).rejects.toThrow('Rollback');
  expect((await store.registrations(personId))[0]?.lastKey).toBeNull();
  expect(await store.deliveries(personId, [connectionId])).toEqual([]);
  const insert = () =>
    store.transaction(async tx => {
      const inserted = await tx.deliver(personId, delivery);
      if (inserted) await tx.audit(personId, 'mcp.delivered', connectionId);
      return inserted;
    });
  expect((await Promise.all([insert(), insert()])).sort()).toEqual([false, true]);
  expect(await store.deliveries('another-person', [connectionId])).toEqual([]);
  expect(await store.deliveries(personId, ['another-connection'])).toEqual([]);
  expect(await store.registrations('another-person')).toEqual([]);
  const audit = await database().select().from(schema.audit).where(eq(schema.audit.subject, connectionId));
  expect(audit.map(r => r.action).sort()).toEqual(['mcp.delivered', 'mcp.registered']);
});
test('MCP decisions claim once, preserve an unknown outcome and encrypt provider receipts', async () => {
  const decision = {
    id: decisionId,
    personId,
    connectionId,
    digest: 'keyed-fingerprint',
    state: 'unknown' as const,
    result: null,
  };
  const claim = () =>
    store.transaction(async tx => {
      const claimed = await tx.claim(decision);
      if (claimed) await tx.audit(personId, 'mcp.approved', decisionId);
      return claimed;
    });
  expect((await Promise.all([claim(), claim()])).sort()).toEqual([false, true]);
  expect((await store.decision(personId, decisionId))?.state).toBe('unknown');
  const result = { content: [{ type: 'text', text: 'Private provider receipt' }] };
  await store.transaction(async tx => {
    await tx.finish({ ...decision, state: 'succeeded', result });
    await tx.audit(personId, 'mcp.succeeded', decisionId);
  });
  expect((await store.decision(personId, decisionId))?.result).toEqual(result);
  expect(await store.decision('another-person', decisionId)).toBeUndefined();
  const [stored] = await database().select().from(schema.mcpDecisions).where(eq(schema.mcpDecisions.id, decisionId));
  expect(stored?.result).not.toContain('Private provider receipt');
  const audit = await database().select().from(schema.audit).where(eq(schema.audit.subject, decisionId));
  expect(audit.map(r => r.action).sort()).toEqual(['mcp.approved', 'mcp.succeeded']);
});

test('MCP resolution is transactional, scoped and retains deduplication and historical links', async () => {
  const id = prefix + '-resolved';
  await mcpResolutionContract(store, personId, connectionId, id);
  const audit = await database().select().from(schema.audit).where(eq(schema.audit.subject, id));
  expect(audit.map(r => r.action).sort()).toEqual(['mcp.delivered', 'mcp.resolved']);
  const active = {
    id: prefix + '-rollback',
    connectionId,
    title: 'Provider',
    text: 'Pending',
    createdAt: '2026-11-09T10:00:00.000Z',
  };
  await store.transaction(async tx => {
    await tx.deliver(personId, active);
    await tx.audit(personId, 'mcp.delivered', active.id);
  });
  await expect(
    store.transaction(async tx => {
      await tx.resolve(personId, connectionId, active.id, '2026-11-09T10:01:00Z');
      await tx.audit(personId, 'mcp.resolved', connectionId);
      throw new Error('Rollback');
    }),
  ).rejects.toThrow('Rollback');
  expect((await store.deliveries(personId, [connectionId])).some(d => d.id === active.id)).toBe(true);
  expect(
    (await database().select().from(schema.audit).where(eq(schema.audit.subject, connectionId))).some(
      r => r.action === 'mcp.resolved',
    ),
  ).toBe(false);
});
