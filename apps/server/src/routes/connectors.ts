import { Hono } from 'hono';
import { registry } from '../connectors/registry';
import { signingAuthority } from '../connectors/signing';
import { refreshConnectors } from '../composition';
import { verifyAssertion } from '../connectors/remote';
import { systemContext } from '../system-context';
import { logger } from '../logging';
import { connectorCallback, starting } from './connector-callback';

/**
 * What a remote connector reaches of Clew (D21): the installation's public signing keys, and the callback
 * (`connector-callback.ts`) over the live registry, with the person rebuilt from their current grant. A connector reads
 * both in the protocol's shape, Clew starting included (`started`), so `main.ts` mounts them ahead of the startup gate
 * the rest of `/api` answers in its own words.
 */
export function connectorRoutes(started: () => boolean) {
  const routes = new Hono();
  routes.get('/jwks', async c =>
    started() ? c.json((await signingAuthority()).jwks, 200, { 'Cache-Control': 'public, max-age=60' }) : starting(),
  );
  routes.route(
    '/',
    connectorCallback({
      started,
      verify: verifyAssertion,
      person: (id, connectorId) => systemContext(id, 'connector:' + connectorId),
      refresh: refreshConnectors,
      registry,
      failed: (error, connector) =>
        logger.error({ scope: 'connectors', ...(connector ? { connector } : {}), error }, 'connector callback failed'),
    }),
  );
  return routes;
}
