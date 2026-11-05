import { resolve } from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { authRoutes } from './routes/auth';
import { api } from './routes/api';
import { adminRoutes } from './routes/admin';
import { connectorReconcile } from './composition';
import { applyAllRows, syncBundledRows, watchConnectors } from './connectors/reconcile';
import { connectorRoutes } from './routes/connectors';
import { registry } from './connectors/registry';
import { loadConnectors } from './connectors/remote';
import { startAssistantProbe, startTimerDispatch } from './composition';
import { startWorker } from './temporal/worker';
import { failure } from './context';
import { signingAuthority } from './connectors/signing';
import { startupReadiness } from './startup';
import { startExecutionDispatch } from './composition/executions';
import { startRefresh } from './composition/refresh';
import { startJobs } from './composition/jobs';

// Local secrets written by `bun run auth:setup`. Never committed, never read by the browser bundle.
for (const file of ['.env.local']) { try { process.loadEnvFile(resolve(import.meta.dirname, '..', file)); } catch { /* absent in CI */ } }

const app = new Hono();
const startup = startupReadiness({
  initialize: async () => { await signingAuthority(); await syncBundledRows(connectorReconcile); await applyAllRows(connectorReconcile); },
  onReady: () => {
    watchConnectors(connectorReconcile);
    startJobs(); startAssistantProbe(); startExecutionDispatch(); startTimerDispatch(); startRefresh(); void startWorker();
    void loadConnectors(registry).then(() => applyAllRows(connectorReconcile)).catch(error => console.error('connectors', error));
  },
  onError: error => console.error('startup initialization failed; retrying in five seconds', error instanceof Error ? error.message : 'Unknown failure'),
  retry: run => { setTimeout(run, 5000).unref(); },
});
app.get('/api/health', c => c.json({ ok: true }));
app.get('/api/ready', c => c.json({ ready: startup.ready() }, startup.ready() ? 200 : 503));
// Signing in does not expose connector data and must not depend on connector startup.
app.route('/api/auth', authRoutes);
app.use('/api/*', async (c, next) => { if (!startup.ready()) return c.json({ error: 'Tjänsten startar. Försök igen om en stund.' }, 503); await next(); });
// Connector callbacks authenticate with Clew's own assertion, not a session, so they are mounted before the session guard.
app.route('/api/connectors', connectorRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api', api);
app.notFound(c => c.json({ error: 'Okänd adress.' }, 404));
// Hono hands handler errors to onError, not to the middleware chain: map auth, calendar and input errors here.
app.onError((error, c) => failure(c, error));

const port = Number(process.env.PORT ?? 3000);
// Loopback by default (Vite proxies to it in dev); a container stack sets HOST=0.0.0.0 so connector services can call back.
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' }, info => {
  console.log(`Clew BFF listening on http://${info.address}:${info.port}`);
  void startup.start();
});
