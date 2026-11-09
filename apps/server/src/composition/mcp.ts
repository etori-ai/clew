import { createHash } from 'node:crypto';
import { mcpUsecases } from '../mcp/usecases';
import { connectMcp } from '../mcp/adapters/http';
import { postgresMcpStore } from '../mcp/adapters/postgres';
import { sealSecret, openSecret, authorizationVersion } from '../auth-crypto';
import { systemContext } from '../system-context';
import { models } from './index';
import { clock } from './ambient';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { startDurable } from '../dbos/start';
import { mcpWatch } from '../dbos/workflows';
import { logger } from '../logging';

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
/**
 * Reconcile registered watches with durable workflows. Configuration and source data stay in Postgres. A watch runs
 * as rounds of at most a hundred reads (`mcpWatch`); when a registration has no running round, the next one starts
 * under the round's number, so two instances reconciling at once meet the same id.
 */
export function startMcpWatches() {
  if (!enabled) return;
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      for (const r of await store.registrations()) {
        if (!r.enabled) continue;
        const rounds = await DBOS.listWorkflows({ workflow_id_prefix: `mcp-watch:${r.id}:`, limit: 10_000 });
        if (rounds.some(w => w.status === 'PENDING' || w.status === 'ENQUEUED')) continue;
        await startDurable(mcpWatch, `mcp-watch:${r.id}:${rounds.length + 1}`, r.id);
      }
    } catch (error) {
      logger.error({ scope: 'mcp', error }, 'MCP watch reconciliation unavailable');
    } finally {
      busy = false;
    }
  }
  void tick();
  const timer = setInterval(() => void tick(), 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
