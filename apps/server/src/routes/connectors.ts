import { Hono } from 'hono';
import { registry } from '../connectors/registry';
import { signingAuthority } from '../connectors/signing';
import { refreshConnectors } from '../composition';
import { verifyAssertion } from '../connectors/remote';
import { systemContext } from '../system-context';
import { logger } from '../logging';
import { connectorCallback } from './connector-callback';

/**
 * What a remote connector reaches of Clew (D21): the installation's public signing keys, and the callback
 * (`connector-callback.ts`) over the live registry, with the person rebuilt from their current grant.
 */
export const connectorRoutes = new Hono();
connectorRoutes.get('/jwks', async c =>
  c.json((await signingAuthority()).jwks, 200, { 'Cache-Control': 'public, max-age=60' }),
);
connectorRoutes.route(
  '/',
  connectorCallback({
    verify: verifyAssertion,
    person: (id, connectorId) => systemContext(id, 'connector:' + connectorId),
    refresh: refreshConnectors,
    registry,
    failed: (error, connector) =>
      logger.error({ scope: 'connectors', ...(connector ? { connector } : {}), error }, 'connector callback failed'),
  }),
);
