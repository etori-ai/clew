// Telemetry first (D91): the undici instrumentation patches `fetch` at load, before any module that calls it.
import { shutdownTelemetry, telemetry } from './telemetry';
import { logger, logPort } from './logging';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { httpInstrumentationMiddleware } from '@hono/otel';
import { authRoutes } from './routes/auth';
import { api } from './routes/api';
import { adminRoutes } from './routes/admin';
import { headerRoutes } from './routes/header';
import { appearanceRoutes } from './routes/appearance';
import { appearance } from './composition/appearance';
import { competenceWritable, connectorReconcile, talksWritable } from './composition';
import { applyAllRows, syncBundledRows, watchConnectors } from './connectors/reconcile';
import { connectorRoutes } from './routes/connectors';
import { protocolRoutes } from './routes/protocol';
import { registry } from './connectors/registry';
import { loadConnectors } from './connectors/remote';
import { startAssistantProbe } from './composition';
import { startDurableRuntime } from './dbos/runtime';
import { bindLiveActivities } from './dbos/activities';
import { failure } from './context';
import { signingAuthority } from './connectors/signing';
import { startupReadiness } from './startup';
import { startRefresh } from './composition/refresh';
import { startJobs } from './composition/jobs';
import { scimRoutes } from './routes/scim';
import { SCIM_CONTENT_TYPE, ScimError } from './modules/people/contracts';
import { staffRoutes } from './routes/staff';
import { entityRoutes } from './routes/entities';
import { entities, entityActions } from './composition/entities';
import { scim } from './composition/people';
import { talkRoutes } from './routes/talks';
import { talks } from './composition/talks';
import { competenceRoutes } from './routes/competence';
import { competence } from './composition/competence';

// Local secrets written by `bun run auth:setup`. Never committed, never read by the browser bundle.
for (const file of ['.env.local']) {
  try {
    process.loadEnvFile(resolve(import.meta.dirname, '..', file));
  } catch {
    /* absent in CI */
  }
}

const app = new Hono();
// One server span per request when export is on (D91). The URL on the span is the path alone: the sign-in callback's
// query carries the authorization code, and a view's input may name a person.
if (telemetry.enabled) app.use(httpInstrumentationMiddleware({ getUrlFull: c => new URL(c.req.url).pathname }));
const startup = startupReadiness({
  initialize: async () => {
    await signingAuthority();
    await syncBundledRows(connectorReconcile);
    await applyAllRows(connectorReconcile);
  },
  onReady: () => {
    bindLiveActivities();
    startDurableRuntime();
    watchConnectors(connectorReconcile);
    startJobs();
    startAssistantProbe();
    startRefresh();
    void loadConnectors(registry)
      .then(() => applyAllRows(connectorReconcile))
      .catch(error => logger.error({ scope: 'connectors', error }, 'loading connectors failed'));
  },
  onError: error =>
    logger.error({ scope: 'startup', error }, 'startup initialization failed; retrying in five seconds'),
  retry: run => {
    setTimeout(run, 5000).unref();
  },
});
app.get('/api/health', c => c.json({ ok: true }));
app.get('/api/ready', c => c.json({ ready: startup.ready() }, startup.ready() ? 200 : 503));
// Signing in does not expose connector data and must not depend on connector startup.
app.route('/api/auth', authRoutes);
// The installation's theme and logo (D98): public and needed by the sign-in page, so it waits for nothing but the database.
app.route('/api/appearance', appearanceRoutes(appearance));
// The protocol is a contract, not data: public, and generated from code, so it needs nothing to have started (D60).
app.route('/api/protocol', protocolRoutes);
app.use('/api/*', async (c, next) => {
  if (!startup.ready()) return c.json({ error: 'Tjänsten startar. Försök igen om en stund.' }, 503);
  await next();
});
// Connector callbacks authenticate with Clew's own assertion, not a session, so they are mounted before the session guard.
app.route('/api/connectors', connectorRoutes);
// SCIM (D68) authenticates with a provisioner's token, not a session; a machine reads its answers, so they are English.
app.use('/scim/*', async (c, next) => {
  if (!startup.ready())
    return c.body(JSON.stringify(new ScimError(503, 'The service is starting. Retry shortly.').body()), 503, {
      'Content-Type': SCIM_CONTENT_TYPE,
      'Retry-After': '5',
    });
  await next();
});
app.route('/scim/v2', scimRoutes(scim, logPort('scim', 'error')));
app.route('/api/admin', adminRoutes);
// Personal (D94): a manager's people, scoped by the use case.
app.route('/api/staff', staffRoutes);
// Entities (D97): a person or a unit and what the sources about it say, behind the core rule of who may be asked about,
// and an action from its menu, which becomes a card (D8).
app.route('/api/entities', entityRoutes({ entities, actions: entityActions }));
// The talks module's writes (D96), only while Clew's own module answers the talks profile for the person.
app.route('/api/talks', talkRoutes({ talks, writable: talksWritable }));
// The competence module's catalogue and registrations (D107), only while the built-in module is switched on for the person.
app.route('/api/competence', competenceRoutes({ competence, writable: competenceWritable }));
// The shared header (D88): what the person's header connector lists for them.
app.route('/api/header', headerRoutes);
app.route('/api', api);
app.notFound(c => c.json({ error: 'Okänd adress.' }, 404));
// Hono hands handler errors to onError, not to the middleware chain: map auth, calendar and input errors here.
app.onError((error, c) => failure(c, error));

const port = Number(process.env.PORT ?? 3000);
// Loopback by default (Vite proxies to it in dev); a container stack sets HOST=0.0.0.0 so connector services can call back.
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' }, info => {
  logger.info(
    { scope: 'server', address: info.address, port: info.port },
    `Clew BFF listening on http://${info.address}:${info.port}`,
  );
  void startup.start();
});
// A rejection nobody caught is a bug worth a record, not a silent exit; an exception out of the loop ends the process
// after the telemetry buffer is flushed, and the container runtime restarts it.
process.on('unhandledRejection', reason => logger.error({ scope: 'process', error: reason }, 'unhandled rejection'));
process.on('uncaughtException', error => {
  logger.fatal({ scope: 'process', error }, 'uncaught exception');
  void shutdownTelemetry().finally(() => process.exit(1));
});
process.once('SIGTERM', () => void shutdownTelemetry().finally(() => process.exit(0)));
