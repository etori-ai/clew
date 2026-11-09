import { describe, expect, test } from 'bun:test';
import { createPulseService, appUri, mimeType } from '../../fixtures/mcp-pulse/service.mjs';
import { createStatusFixture, statusChangeKey } from '../../fixtures/mcp-status/service.mjs';

describe('synthetic standard MCP services', () => {
  test('discovery links a model-visible read to a standard UI resource and keeps submission app-only', async () => {
    const server = createPulseService('<html>synthetic app</html>');
    const init = await server.request('initialize');
    expect(init.capabilities).toMatchObject({ extensions: { 'io.modelcontextprotocol/ui': {} } });
    const { tools } = (await server.request('tools/list')) as { tools: { name: string; _meta: unknown }[] };
    expect(tools.find(t => t.name === 'get_pending_poll')?._meta).toEqual({
      ui: { resourceUri: appUri, visibility: ['model', 'app'] },
    });
    expect(tools.find(t => t.name === 'submit_poll')?._meta).toEqual({ ui: { visibility: ['app'] } });
    const resource = await server.request('resources/read', { uri: appUri });
    expect(resource).toMatchObject({ contents: [{ mimeType, text: '<html>synthetic app</html>' }] });
  });
  test('answers are validated, deduplicated and absent from receipts and subsequent reads', async () => {
    const server = createPulseService('');
    const call = (score: number, pollId = 'pulse-2026-W46') =>
      server.request('tools/call', { name: 'submit_poll', arguments: { pollId, score } });
    await expect(call(9)).rejects.toThrow();
    await expect(call(4, 'another-persons-poll')).rejects.toThrow();
    const receipt = await call(4);
    expect(await call(4)).toEqual(receipt);
    expect(await call(2)).toHaveProperty('isError', true);
    expect(JSON.stringify(receipt)).not.toContain('score');
    expect(await server.request('tools/call', { name: 'get_pending_poll' })).toMatchObject({
      structuredContent: { answered: true },
    });
  });
  test('a new period has a new source identity and an unanswered poll', async () => {
    const server = createPulseService('');
    await server.request('tools/call', { name: 'submit_poll', arguments: { pollId: 'pulse-2026-W46', score: 3 } });
    server.nextWeek();
    expect(await server.request('tools/call', { name: 'get_pending_poll' })).toMatchObject({
      structuredContent: { pollId: 'pulse-2026-W47', answered: false },
    });
  });
  test('tool-only service has stable evidence until an outage or recovery, with a new identity for another outage', async () => {
    const server = createStatusFixture();
    const read = async () => statusChangeKey((await server.request('tools/call')).structuredContent!);
    const healthy = await read();
    expect(await read()).toBe(healthy);
    server.setDown(true);
    const outage = await read();
    expect(outage).not.toBe(healthy);
    expect(await read()).toBe(outage);
    server.setDown(false);
    expect(await read()).not.toBe(outage);
    server.setDown(true);
    expect(await read()).not.toBe(outage);
    expect((await server.request('tools/list')).tools?.[0]).not.toHaveProperty('_meta');
  });
});
