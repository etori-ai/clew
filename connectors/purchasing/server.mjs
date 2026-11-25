// Serves connector.mjs over HTTP with the SQLite store. Environment: PORT (4057), CLEW_CONNECTOR_SECRET, CLEW_URL,
// PURCHASING_RESOURCE (the system's own address as Clew and a browser reach it, which the manifest names),
// PURCHASING_ISSUER (the authorization server whose tokens the system takes), PURCHASING_SCOPES (space separated,
// optional), FIXTURE_DB (the SQLite file), FIXTURE_TODAY (a fixed day, YYYY-MM-DD), FIXTURE_RESEED, FIXTURE_FAULT,
// nothing else.
import { createServer } from 'node:http';
import { listener } from './http.mjs';
import { createConnector } from './connector.mjs';
import { sqliteState } from './state.mjs';

const env = process.env;
const port = Number(env.PORT ?? 4057);
if (!env.PURCHASING_ISSUER) throw new Error('PURCHASING_ISSUER is required: the authorization server of the system');
const state = await sqliteState(env.FIXTURE_DB ?? './purchasing.sqlite');
const connector = createConnector({
  secret: env.CLEW_CONNECTOR_SECRET,
  clewUrl: env.CLEW_URL,
  state,
  clock: env.FIXTURE_TODAY ? () => new Date(env.FIXTURE_TODAY + 'T08:00:00+01:00') : () => new Date(),
  fault: env.FIXTURE_FAULT ?? '',
  fresh: env.FIXTURE_RESEED === 'true',
  resource: env.PURCHASING_RESOURCE ?? `http://purchasing:${port}`,
  issuer: env.PURCHASING_ISSUER,
  scopes: (env.PURCHASING_SCOPES ?? '').split(' ').filter(Boolean),
});
const server = createServer(listener(connector.handle));
server.listen(port, '0.0.0.0', () =>
  console.log(
    `purchasing connector listening on :${server.address().port}${env.FIXTURE_FAULT ? ` (fault: ${env.FIXTURE_FAULT})` : ''}`,
  ),
);
process.on('SIGTERM', () =>
  server.close(() => {
    connector.close();
    process.exit(0);
  }),
);
