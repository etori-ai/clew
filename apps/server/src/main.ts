import { resolve } from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { authRoutes } from './routes/auth';
import { api } from './routes/api';
import { connectorRoutes } from './routes/connectors';
import { registry } from './connectors/registry';
import { loadConnectors } from './connectors/remote';
import { scheduler, startAssistantProbe } from './composition';
import { startWorker } from './temporal/worker';
import { failure } from './context';

// Local secrets written by `bun run auth:setup`. Never committed, never read by the browser bundle.
for (const file of ['.env.local']) { try { process.loadEnvFile(resolve(import.meta.dirname, '..', file)); } catch { /* absent in CI */ } }

const app = new Hono();
app.get('/api/health', c => c.json({ ok: true }));
app.route('/api/auth', authRoutes);
// Connector callbacks authenticate with Clew's own assertion, not a session, so they are mounted before the session guard.
app.route('/api/connectors', connectorRoutes);
app.route('/api', api);
app.notFound(c => c.json({ error: 'Okänd adress.' }, 404));
// Hono hands handler errors to onError, not to the middleware chain: map auth, calendar and input errors here.
app.onError((error, c) => failure(c, error));

const port = Number(process.env.PORT ?? 3000);
// Loopback by default (Vite proxies to it in dev); a container stack sets HOST=0.0.0.0 so connector services can call back.
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' }, info => {
  console.log(`Clew BFF listening on http://${info.address}:${info.port}`);
  scheduler.start();
  startAssistantProbe();
  void startWorker();
  void loadConnectors(registry).catch(error => console.error('connectors', error));
});
