import { resolve } from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { authRoutes } from './routes/auth';
import { api } from './routes/api';
import { startScheduler } from './scheduler';
import { startAssistantProbe } from './assistant';
import { startWorker } from './temporal/worker';
import { failure } from './context';

// Local secrets written by `bun run auth:setup`. Never committed, never read by the browser bundle.
for (const file of ['.env.local']) { try { process.loadEnvFile(resolve(import.meta.dirname, '..', file)); } catch { /* absent in CI */ } }

const app = new Hono();
app.get('/api/health', c => c.json({ ok: true }));
app.route('/api/auth', authRoutes);
app.route('/api', api);
app.notFound(c => c.json({ error: 'Okänd adress.' }, 404));
// Hono hands handler errors to onError, not to the middleware chain: map auth, calendar and input errors here.
app.onError((error, c) => failure(c, error));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, info => {
  console.log(`Clew BFF listening on http://127.0.0.1:${info.port}`);
  startScheduler();
  startAssistantProbe();
  void startWorker();
});
