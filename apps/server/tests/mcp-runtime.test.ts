import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connectMcp } from '../src/mcp/adapters/http';

test('official client discovers and calls an independent HTTP MCP provider, including its App resource', async () => {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../../../fixtures/mcp-pulse/server.mjs', import.meta.url))],
    {
      env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Mock failed to start')), 5000);
      child.stdout.on('data', chunk => {
        const found = String(chunk).match(/listening on (\d+)/);
        if (found) {
          clearTimeout(deadline);
          resolve(Number(found[1]));
        }
      });
      child.on('error', reject);
      child.on('exit', code => {
        if (code) reject(new Error('Mock exited: ' + code));
      });
    });
    const client = await connectMcp(`http://127.0.0.1:${port}/mcp`);
    try {
      assert.equal(client.title, 'Medarbetarpuls');
      const read = client.tools.find(t => t.name === 'get_pending_poll');
      assert.ok(read);
      const ui = read._meta?.ui as { resourceUri: string };
      assert.match(await client.resource(ui.resourceUri), /ui\/initialize/);
      const before = await client.call(read.name, {});
      assert.equal(before.structuredContent?.answered, false);
      const receipt = await client.call('submit_poll', { pollId: before.structuredContent?.pollId, score: 4 });
      assert.equal(receipt.structuredContent?.accepted, true);
      assert.equal((await client.call(read.name, {})).structuredContent?.answered, true);
      assert.equal((await fetch(`http://127.0.0.1:${port}/fixture/next-week`, { method: 'POST' })).status, 204);
      const next = await client.call(read.name, {});
      assert.notEqual(next.structuredContent?.pollId, before.structuredContent?.pollId);
      assert.equal(next.structuredContent?.answered, false);
    } finally {
      await client.close();
    }
  } finally {
    child.kill();
  }
});
