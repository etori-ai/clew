import { createHash } from 'node:crypto';
import { mcpUsecases } from '../mcp/usecases';
import { connectMcp } from '../mcp/adapters/http';
import { postgresMcpStore } from '../mcp/adapters/postgres';
import { sealSecret, openSecret, authorizationVersion } from '../auth-crypto';
import { systemContext } from '../system-context';
import { models } from './index';
import { clock } from './ambient';
import { temporalClient, TASK_QUEUE } from '../temporal/client';

const enabled = process.env.CLEW_POC === 'true' && process.env.NODE_ENV !== 'production';
const store = postgresMcpStore({
  seal: (value, id) => sealSecret(value, 'mcp:result:' + id),
  open: (value, id) => openSecret(value, 'mcp:result:' + id),
});
export const mcp = mcpUsecases({
  store,
  connect: connectMcp,
  configured: async p => (await models.statusFor(p)).configured,
  current: id => systemContext(id, 'system:mcp-watch'),
  clock,
  digest: value => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  // A plain hash of a five-point poll answer would be reversible by guessing. Keep the fingerprint keyed.
  fingerprint: value => authorizationVersion({ purpose: 'mcp:decision', value }),
  enabled,
});
/** Reconcile registered watches with durable Temporal workflows. Configuration and source data stay in Postgres. */
export function startMcpWatches() {
  if (!enabled) return;
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const client = await temporalClient();
      for (const r of await store.registrations()) {
        if (!r.enabled) continue;
        await client.workflow.start('mcpWatch', {
          workflowId: 'mcp-watch:' + r.id,
          taskQueue: TASK_QUEUE,
          args: [r.id],
          workflowIdConflictPolicy: 'USE_EXISTING',
          workflowIdReusePolicy: 'ALLOW_DUPLICATE',
        });
      }
    } catch {
      console.error('MCP watch reconciliation unavailable');
    } finally {
      busy = false;
    }
  }
  void tick();
  const timer = setInterval(() => void tick(), 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
