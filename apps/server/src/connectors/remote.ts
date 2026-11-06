import type { Actor, Registry } from '@clew/connectors';
import type { ConnectorManifest } from '@clew/connectors/protocol';
import { ManifestError, fetchManifest, parseManifest, remoteConnector, type FetchLike } from '@clew/connectors/remote';
import { enabledConnectors, recordHealth, type ConnectorHealth, type ConnectorRow } from '@clew/db/connectors';
import { openSecret } from '../auth-crypto';
import { signingAuthority } from './signing';
import type { ConnectorAuthority } from './authority';
export { AssertionError } from './authority';

/**
 * Remote connectors (D21) as the database knows them (D23). A running Clew learns about a connector from its own
 * `connector` rows, never from the environment: an administrator adds it (the admin page, or `scripts/connector-add.ts`
 * until that page exists), and the loader registers every enabled row at boot. Clew signs a short-lived assertion per
 * call with its installation RSA key; the connector verifies public keys and uses a separate callback grant.
 */
export const secretPurpose = (connectorId: string) => 'connector:secret:' + connectorId;
/** The bearer token Clew sends to one connector for one call: who is acting, for that connector only, for two minutes. */
export const assertionFor =
  (connectorId: string, uses: string[] = []) =>
  async (actor: Actor, chain: string[] = []) =>
    (await signingAuthority()).assert(connectorId, actor, uses, chain);
export const verifyAssertion = async (token: string) => (await signingAuthority()).verify(token);

/** What the loader needs from a row: the secret already opened. The admin use cases and the CLI build the same shape. */
export interface ConnectorSource {
  id: string;
  url: string;
  secret: string;
  manifest: unknown;
}
export const sourceOf = (row: ConnectorRow): ConnectorSource => ({
  id: row.id,
  url: row.url ?? '',
  secret: row.secret ? openSecret(row.secret, secretPurpose(row.id)) : '',
  manifest: row.manifest,
});
export interface LoadOptions {
  rows?: () => Promise<ConnectorSource[]>;
  record?: (id: string, health: ConnectorHealth, manifest?: unknown) => Promise<void>;
  fetch?: FetchLike;
  attempts?: number;
  delayMs?: number;
  log?: (message: string) => void;
  authority?: ConnectorAuthority;
}
/** Put one connector in the live registry from a manifest, replacing an earlier registration with the same id. */
export function registerConnector(
  registry: Registry,
  source: ConnectorSource,
  manifest: ConnectorManifest,
  fetchImpl?: FetchLike,
  authority?: ConnectorAuthority,
) {
  if (registry.connector(source.id)?.kind === 'core')
    throw new Error('A remote connector cannot replace Clew core capabilities.');
  registry.replace(
    remoteConnector(manifest, {
      url: source.url,
      key: source.secret,
      assert: authority
        ? (actor, chain) => authority.assert(source.id, actor, manifest.uses, chain)
        : assertionFor(source.id, manifest.uses),
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    }),
  );
}
export function unregisterConnector(registry: Registry, id: string) {
  return registry.unregister(id);
}
/**
 * Boot: every enabled row goes into the registry. A row with a stored manifest is registered at once, so its areas show
 * (with the warning figure if the service is down, D8); then the manifest is refetched with retries, replaced if it
 * changed, and the health is recorded. A row without a stored manifest waits for the first successful fetch.
 */
export async function loadConnectors(registry: Registry, options: LoadOptions = {}) {
  const { attempts = 20, delayMs = 3000, log = console.log, record = recordHealth } = options;
  const rows = await (options.rows ?? (async () => (await enabledConnectors()).map(sourceOf)))();
  const loaded: string[] = [];
  await Promise.all(
    rows.map(async source => {
      let stored: ConnectorManifest | undefined;
      try {
        if (source.manifest) {
          stored = parseManifest(source.manifest, source.id);
          registerConnector(registry, source, stored, options.fetch, options.authority);
        }
      } catch (error) {
        log(`Connector "${source.id}": stored manifest ignored: ${(error as Error).message}`);
      }
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const manifest = await fetchManifest(source.url, source.id, options.fetch);
          if (JSON.stringify(manifest) !== JSON.stringify(stored))
            registerConnector(registry, source, manifest, options.fetch, options.authority);
          await record(source.id, { status: 'ok', at: new Date().toISOString() }, manifest);
          log(
            `Connector "${source.id}" (${manifest.source}) registered from ${source.url}: ${manifest.capabilities.length} capabilities, ${manifest.areas.length} areas${manifest.scan ? ', scan' : ''}.`,
          );
          loaded.push(source.id);
          return;
        } catch (error) {
          const message = (error as Error).message;
          if (error instanceof ManifestError && !/answered \d+/.test(message)) {
            await record(source.id, { status: 'manifest-invalid', at: new Date().toISOString(), detail: message });
            log(`Connector "${source.id}": ${message}`);
            return;
          }
          if (attempt === attempts) {
            await record(source.id, { status: 'unreachable', at: new Date().toISOString(), detail: message });
            log(
              `Connector "${source.id}": ${source.url} did not answer after ${attempts} attempts${stored ? '; serving the stored manifest' : ''}.`,
            );
            return;
          }
          await new Promise(r => setTimeout(r, delayMs));
        }
      }
    }),
  );
  return loaded;
}
