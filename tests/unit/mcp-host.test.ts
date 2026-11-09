import { expect, test } from 'bun:test';
import type { AuthenticatedContext, McpRegistration, McpDelivery, McpResult, McpTool } from '@clew/contracts';
import { mcpUsecases } from '../../apps/server/src/mcp/usecases';
import type { McpDecision, McpStore } from '../../apps/server/src/mcp/ports';
import { createPulseService } from '../../fixtures/mcp-pulse/service.mjs';

function setup() {
  const p: AuthenticatedContext = {
    id: 'target',
    name: 'Test',
    unitId: 'unit',
    unitLabel: 'Unit',
    role: 'employee',
    organisationId: 'org',
    principal: { kind: 'person', id: 'person:target' },
    capabilities: [],
    authorizationVersion: '1',
    sessionBinding: 'test',
    expiresAt: '2099-01-01T00:00:00Z',
    authorize: async () => ({ version: '1' }),
  };
  const registration: McpRegistration = {
    id: 'source',
    personId: p.id,
    url: 'https://vendor.test/mcp',
    enabled: true,
    readTools: ['get_pending_poll'],
    writeTools: ['submit_poll'],
    lastKey: null,
    watch: {
      tool: 'get_pending_poll',
      arguments: {},
      intervalSeconds: 604800,
      identity: ['/pollId'],
      condition: { pointer: '/answered', equals: false },
      deliverInitial: true,
    },
  };
  const deliveryRows = new Map<string, McpDelivery>();
  const decisions = new Map<string, McpDecision>();
  const audits: string[] = [];
  const source = createPulseService('<html>vendor content</html>');
  let configured = true,
    writes = 0,
    unknown = false,
    connections = 0;
  const store: McpStore = {
    registrations: async personId => (!personId || personId === p.id ? [structuredClone(registration)] : []),
    deliveries: async (personId, ids) =>
      personId === p.id ? [...deliveryRows.values()].filter(d => ids.includes(d.connectionId)) : [],
    decision: async (personId, id) => decisions.get(personId + id),
    transaction: async run =>
      run({
        observe: async (_id, key) => {
          registration.lastKey = key;
        },
        deliver: async (_p, row) => {
          if (deliveryRows.has(row.id)) return false;
          deliveryRows.set(row.id, row);
          return true;
        },
        claim: async row => {
          const key = row.personId + row.id;
          if (decisions.has(key)) return false;
          decisions.set(key, row);
          return true;
        },
        finish: async row => {
          decisions.set(row.personId + row.id, row);
        },
        audit: async (_actor, action) => {
          audits.push(action);
        },
      }),
  };
  const host = mcpUsecases({
    store,
    enabled: true,
    clock: () => new Date('2026-11-08T10:00:00Z'),
    digest: JSON.stringify,
    fingerprint: JSON.stringify,
    configured: async () => configured,
    current: async id => (id === p.id ? p : undefined),
    connect: async () => {
      connections++;
      return {
        title: 'Provider title',
        tools: (await source.request('tools/list')).tools as McpTool[],
        resource: async () => '<html>vendor content</html>',
        close: async () => {},
        call: async (name, args) => {
          if (name === 'submit_poll') {
            writes++;
            if (unknown) throw new Error('Connection lost');
          }
          return (await source.request('tools/call', { name, arguments: args })) as unknown as McpResult;
        },
      };
    },
  });
  return {
    host,
    p,
    registration,
    source,
    audits,
    deliveryRows,
    decisions,
    off: () => {
      configured = false;
    },
    uncertain: () => {
      unknown = true;
    },
    writes: () => writes,
    connections: () => connections,
  };
}
test('registered person sees source-discovered UI; other people and AI-off cannot reach the provider', async () => {
  const x = setup();
  expect((await x.host.view(x.p, 'source')).html).toContain('vendor content');
  expect((await x.host.inbox({ ...x.p, id: 'someone-else' })).services).toEqual([]);
  await expect(x.host.view({ ...x.p, id: 'someone-else' }, 'source')).rejects.toThrow();
  x.off();
  const connections = x.connections();
  expect(await x.host.inbox(x.p)).toEqual({ services: [], deliveries: [] });
  await expect(x.host.view(x.p, 'source')).rejects.toThrow();
  await x.host.observe('source');
  expect(x.connections()).toBe(connections);
});
test('scheduled observations deduplicate by source identity and audit delivery without answer content', async () => {
  const x = setup();
  await x.host.observe('source');
  await x.host.observe('source');
  expect(x.deliveryRows.size).toBe(1);
  expect(x.audits.filter(a => a === 'mcp.delivered')).toHaveLength(1);
  x.source.nextWeek();
  await x.host.observe('source');
  expect(x.deliveryRows.size).toBe(2);
  x.registration.enabled = false;
  expect(await x.host.observe('source')).toBeNull();
  expect((await x.host.inbox(x.p)).deliveries).toEqual([]);
});
test('human-approved writes validate, audit and replay receipts without repeating source writes', async () => {
  const x = setup(),
    args = { pollId: 'pulse-2026-W46', score: 4 };
  await expect(x.host.decide(x.p, 'source', 'bad', 'submit_poll', { ...args, score: 7 })).rejects.toThrow();
  await expect(x.host.decide(x.p, 'source', 'bad', 'arbitrary_tool', args)).rejects.toThrow();
  expect(x.writes()).toBe(0);
  const receipt = await x.host.decide(x.p, 'source', 'decision', 'submit_poll', args);
  expect(await x.host.decide(x.p, 'source', 'decision', 'submit_poll', args)).toEqual(receipt);
  expect(x.writes()).toBe(1);
  expect(x.audits).toEqual(['mcp.approved', 'mcp.succeeded']);
  expect(JSON.stringify(receipt)).not.toContain('score');
  await expect(x.host.decide(x.p, 'source', 'decision', 'submit_poll', { ...args, score: 2 })).rejects.toThrow();
});
test('lost source responses remain uncertain and are never automatically retried', async () => {
  const x = setup();
  x.uncertain();
  const act = () => x.host.decide(x.p, 'source', 'decision', 'submit_poll', { pollId: 'pulse-2026-W46', score: 4 });
  await expect(act()).rejects.toThrow('osäkert');
  await expect(act()).rejects.toThrow('osäkert');
  expect(x.writes()).toBe(1);
  expect(x.audits).toEqual(['mcp.approved']);
});

test('a delivery opens its own source item; an older card cannot load the next poll App', async () => {
  const x = setup();
  await x.host.observe('source');
  const first = [...x.deliveryRows.values()][0]!;
  expect((await x.host.view(x.p, 'source', first.id)).html).toContain('vendor content');
  x.source.nextWeek();
  await x.host.observe('source');
  const older = await x.host.view(x.p, 'source', first.id);
  expect(older.isCurrent).toBe(false);
  expect(older).not.toHaveProperty('html');
  expect(older.result.content).toEqual([{ type: 'text', text: first.text }]);
  const second = [...x.deliveryRows.values()][1]!;
  expect((await x.host.view(x.p, 'source', second.id)).isCurrent).toBe(true);
  await expect(x.host.view(x.p, 'source', 'unrelated-delivery')).rejects.toThrow('Kortet');
  await expect(x.host.view({ ...x.p, id: 'someone-else' }, 'source', first.id)).rejects.toThrow();
});
