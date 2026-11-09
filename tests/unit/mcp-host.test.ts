import { expect, test } from 'bun:test';
import type { AuthenticatedContext, McpRegistration, McpDelivery, McpResult, McpTool } from '@clew/contracts';
import { mcpUsecases } from '../../apps/server/src/mcp/usecases';
import { mcpResolutionContract } from '../mcp-resolution-contract';
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
  const resolved = new Set<string>();
  const decisions = new Map<string, McpDecision>();
  const audits: string[] = [];
  const source = createPulseService('<html>vendor content</html>');
  let configured = true,
    writes = 0,
    unknown = false,
    connections = 0;
  let readResult = (result: McpResult): McpResult => result;
  const store: McpStore = {
    registrations: async personId => (!personId || personId === p.id ? [structuredClone(registration)] : []),
    deliveries: async (personId, ids) =>
      personId === p.id
        ? [...deliveryRows.values()].filter(d => ids.includes(d.connectionId) && !resolved.has(d.id))
        : [],
    delivery: async (personId, connectionId, id) => {
      const row = deliveryRows.get(id);
      return personId === p.id && row?.connectionId === connectionId ? row : undefined;
    },
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
        resolve: async (personId, connectionId, id) => {
          if (!(await store.delivery(personId, connectionId, id)) || resolved.has(id)) return false;
          resolved.add(id);
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
          const result = (await source.request('tools/call', { name, arguments: args })) as unknown as McpResult;
          return name === 'get_pending_poll' ? readResult(result) : result;
        },
      };
    },
  });
  return {
    host,
    store,
    p,
    readsWith: (transform: typeof readResult) => {
      readResult = transform;
    },
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

test('completion retires only that delivery immediately, retains its link, and allows next week to arrive', async () => {
  const x = setup();
  await x.host.observe('source');
  const first = (await x.host.inbox(x.p)).deliveries[0]!;
  await x.host.decide(x.p, 'source', 'answer', 'submit_poll', { pollId: 'pulse-2026-W46', score: 4 });
  expect((await x.host.inbox(x.p)).deliveries).toEqual([]);
  expect(x.deliveryRows.size).toBe(1);
  expect((await x.host.view(x.p, 'source', first.id)).result.structuredContent?.answered).toBe(true);
  await x.host.observe('source');
  expect(x.audits.filter(a => a === 'mcp.resolved')).toHaveLength(1);
  // A late stale read cannot resurrect the retired card.
  x.readsWith(result => ({ ...result, structuredContent: { ...result.structuredContent, answered: false } }));
  await x.host.observe('source');
  expect((await x.host.inbox(x.p)).deliveries).toEqual([]);
  x.readsWith(result => result);
  x.source.nextWeek();
  await x.host.observe('source');
  const next = (await x.host.inbox(x.p)).deliveries;
  expect(next).toHaveLength(1);
  expect(next[0]!.id).not.toBe(first.id);
});

for (const refresh of ['watch', 'open'] as const) {
  test(`an answer outside Clew is reconciled by ${refresh} even with unchanged source identity`, async () => {
    const x = setup();
    await x.host.observe('source');
    const key = x.registration.lastKey;
    const first = (await x.host.inbox(x.p)).deliveries[0]!;
    await x.source.request('tools/call', { name: 'submit_poll', arguments: { pollId: 'pulse-2026-W46', score: 4 } });
    if (refresh === 'watch') await x.host.observe('source');
    else await x.host.view(x.p, 'source', first.id);
    expect(x.registration.lastKey).toBe(key);
    expect((await x.host.inbox(x.p)).deliveries).toEqual([]);
    expect(x.writes()).toBe(0);
    expect(x.audits.filter(a => a === 'mcp.resolved')).toHaveLength(1);
  });
}

for (const fault of ['unavailable', 'error', 'missing-condition', 'missing-identity', 'still-pending'] as const) {
  test(`a follow-up read that is ${fault} after submission retains attention and the successful receipt`, async () => {
    const x = setup();
    await x.host.observe('source');
    x.readsWith(result => {
      if (fault === 'unavailable') throw new Error('Unavailable');
      if (fault === 'error') return { ...result, isError: true };
      if (fault === 'missing-condition') return { ...result, structuredContent: { pollId: 'pulse-2026-W46' } };
      if (fault === 'missing-identity') return { ...result, structuredContent: { answered: true } };
      return { ...result, structuredContent: { ...result.structuredContent, answered: false } };
    });
    const result = await x.host.decide(x.p, 'source', 'answer', 'submit_poll', { pollId: 'pulse-2026-W46', score: 4 });
    expect(result.structuredContent?.accepted).toBe(true);
    expect((await x.host.inbox(x.p)).deliveries).toHaveLength(1);
    expect(x.audits).not.toContain('mcp.resolved');
    if (fault !== 'still-pending') await expect(x.host.observe('source')).rejects.toThrow();
    expect((await x.host.inbox(x.p)).deliveries).toHaveLength(1);
    x.readsWith(result => result);
    await x.host.observe('source');
    expect((await x.host.inbox(x.p)).deliveries).toEqual([]);
    expect(x.writes()).toBe(1);
  });
}

test('the in-memory MCP store satisfies delivery resolution and lookup isolation', async () => {
  const x = setup();
  await mcpResolutionContract(x.store, x.p.id, x.registration.id, 'contract-delivery');
});

test('uncertain writes and watches without a completion condition retain their cards', async () => {
  const uncertain = setup();
  await uncertain.host.observe('source');
  uncertain.uncertain();
  await expect(
    uncertain.host.decide(uncertain.p, 'source', 'answer', 'submit_poll', { pollId: 'pulse-2026-W46', score: 4 }),
  ).rejects.toThrow('osäkert');
  expect((await uncertain.host.inbox(uncertain.p)).deliveries).toHaveLength(1);
  expect(uncertain.audits).not.toContain('mcp.resolved');
  const notice = setup();
  delete notice.registration.watch.condition;
  await notice.host.observe('source');
  await notice.host.decide(notice.p, 'source', 'answer', 'submit_poll', { pollId: 'pulse-2026-W46', score: 4 });
  expect((await notice.host.inbox(notice.p)).deliveries).toHaveLength(1);
  expect(notice.audits).not.toContain('mcp.resolved');
});
