import { CapabilityError, audiencedActorOf } from '@clew/connectors';
import { readConnector } from '@clew/db/connectors';
import { openSecret, sealSecret } from '../auth-crypto';
import { useLinkedAccounts } from '../connectors/remote';
import { registry } from '../connectors/registry';
import { logPort } from '../logging';
import { oauthAdapter } from '../modules/linked-accounts/adapters/oauth';
import { postgresLinkStore } from '../modules/linked-accounts/adapters/postgres';
import { LinkRequiredError, LinkUnavailableError } from '../modules/linked-accounts/contracts';
import { linkedAccountUsecases } from '../modules/linked-accounts/usecases';
import { clock } from './ambient';

/**
 * Linked accounts (D147): a person's account at a system that issues its own credential. The links, the pending
 * authorizations, the registered clients and the approvals are in Postgres with every secret sealed under the
 * installation's key; what a connector declares is its approved manifest's `linkedAccount`, read from the registry;
 * and the registry's own rule says whom a connector reaches.
 */
/** Where a system returns a person after its authorization page; what an administrator registers at the system. */
export const LINK_REDIRECT_PATH = '/api/linked-accounts/callback';
/**
 * The two settings are read when they are used, never when this module is loaded: the server reads its local settings
 * file in `main.ts` after every import has run, so a value read here at load is not there yet. Read at load, the redirect
 * address had no host and every plain-http system of the local stack was refused, in the running server alone.
 */
const settings = {
  get redirectUri() {
    return (process.env.PUBLIC_URL ?? '').replace(/\/$/, '') + LINK_REDIRECT_PATH;
  },
  // Plain http to a system only on a local stack, as for the identity provider (`authSettings`).
  get insecure() {
    return process.env.AUTH_LOCAL_HTTP === 'true';
  },
};
export const linkedAccounts = linkedAccountUsecases({
  store: postgresLinkStore({ seal: sealSecret, open: openSecret }),
  connectors: {
    // The manifest an administrator approved (D144), from the connector's row: the same answer in the server and in
    // the operator's script, whether or not the connector is enabled yet.
    async declared(connectorId) {
      const manifest = (await readConnector(connectorId))?.manifest as
        { linkedAccount?: { resource: string; scopes?: string[] } } | null | undefined;
      const declared = manifest?.linkedAccount;
      return declared ? { resource: declared.resource, scopes: declared.scopes ?? [] } : null;
    },
    async reaches(persona, connectorId) {
      await registry.refreshGovernance();
      return registry.visible(audiencedActorOf(persona), connectorId);
    },
  },
  oauth: oauthAdapter({
    clientName: 'Clew',
    get insecure() {
      return settings.insecure;
    },
  }),
  clock,
  get redirectUri() {
    return settings.redirectUri;
  },
  // Clew serves no client metadata document yet (D147, not built).
  clientDocumentUrl: null,
  log: logPort('linked-accounts', 'warn'),
});

/**
 * The token of a call to a connector that declares `linkedAccount`, for whoever the call's actor is, with or without a
 * session: the caller has checked the person's grant and that they reach the connector. No link the system accepts is
 * the protocol's `authorization-required`, which a scan and the ledger read as "the person links their account"; an
 * authorization server that cannot be asked is `unavailable`. The words are Clew's own.
 */
useLinkedAccounts(connectorId => ({
  async token(actor) {
    try {
      return await linkedAccounts.tokenFor(actor.id, connectorId);
    } catch (error) {
      if (error instanceof LinkRequiredError) throw new CapabilityError(error.message, 'authorization-required');
      if (error instanceof LinkUnavailableError) throw new CapabilityError(error.message, 'unavailable');
      throw error;
    }
  },
  refused: (actor, token) => linkedAccounts.refused(actor.id, connectorId, token),
}));
