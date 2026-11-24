import type { Actor, Registry } from '@clew/connectors';
import type { ConnectorManifest } from '@clew/connectors/protocol';
import {
  fetchManifest,
  manifestFailure,
  parseManifest,
  remoteConnector,
  type AssertionBinding,
  type FetchLike,
} from '@clew/connectors/remote';
import { enabledConnectors, recordCheck, type ConnectorHealth, type ConnectorRow } from '@clew/db/connectors';
import { openSecret } from '../auth-crypto';
import { signingAuthority } from './signing';
import type { ConnectorAuthority } from './authority';
import { logPort } from '../logging';
import { sameManifest } from './manifests';
export { AssertionError } from './authority';

/**
 * Remote connectors (D21) as the database knows them (D23). A running Clew learns about a connector from its own
 * `connector` rows, never from the environment: an administrator adds it (the admin page, or `scripts/connector-add.ts`
 * until that page exists), and the loader registers every enabled row at boot. Clew signs a short-lived assertion per
 * call with its installation RSA key; the connector verifies public keys and uses a separate callback grant.
 */
export const secretPurpose = (connectorId: string) => 'connector:secret:' + connectorId;
/**
 * The bearer token Clew sends to one connector for one call: who is acting, for that connector only, for two minutes,
 * bound to the request it is sent with (D117).
 */
export const assertionFor =
  (connectorId: string, uses: string[] = []) =>
  async (actor: Actor, chain: string[] = [], binding?: AssertionBinding) =>
    (await signingAuthority()).assert(connectorId, actor, uses, chain, binding);
/** The installation's own assertion for one connector's read it makes itself (D119), bound to the request. */
export const installationAssertionFor = (connectorId: string) => async (binding: AssertionBinding) =>
  (await signingAuthority()).installation(connectorId, binding);
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
  /**
   * Records a check: the health, and the manifest the service serves, which the store keeps as offered while it differs
   * from the approved one (D144). Only on the row still at `url`, the address the service was read at; false when the
   * row has moved or gone meanwhile, and nothing was recorded.
   */
  record?: (id: string, seen: { url: string; health: ConnectorHealth; served?: unknown; at: Date }) => Promise<boolean>;
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
        ? (actor, chain, binding) => authority.assert(source.id, actor, manifest.uses, chain, binding)
        : assertionFor(source.id, manifest.uses),
      // Signed only for the reads the manifest declares under `installation` (D119); the registry calls nothing else so.
      ...(manifest.installation?.length
        ? {
            installation: authority
              ? binding => authority.installation(source.id, binding)
              : installationAssertionFor(source.id),
          }
        : {}),
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    }),
  );
}
export function unregisterConnector(registry: Registry, id: string) {
  return registry.unregister(id);
}
/**
 * Boot: every enabled row with an approved manifest goes into the registry at once, so its areas show (with the warning
 * figure if the service is down, D8). Then the service is asked with retries and the health recorded. A manifest it
 * serves that differs from the approved one is recorded as offered and never registered: only an administrator puts
 * it live (D144). A row without an approved manifest is not registered at all.
 */
export async function loadConnectors(registry: Registry, options: LoadOptions = {}) {
  const { attempts = 20, delayMs = 3000, log = logPort('connectors'), record = recordCheck } = options;
  const health = (h: Omit<ConnectorHealth, 'at'>) => {
    const at = new Date();
    return { health: { ...h, at: at.toISOString() } as ConnectorHealth, at };
  };
  /** An administrator moved the row while its old address answered: the watcher applies it as it now is. */
  const moved = (source: ConnectorSource) =>
    log(
      `Connector "${source.id}" moved from ${source.url} while it was read there; nothing of that answer was recorded.`,
    );
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
          if (!(await record(source.id, { url: source.url, ...health({ status: 'ok' }), served: manifest }))) {
            moved(source);
            return;
          }
          if (!sameManifest(source.manifest, manifest))
            log(
              `Connector "${source.id}" (${manifest.source}) at ${source.url} serves a changed manifest; it waits for an administrator${stored ? ', and the approved one is served meanwhile' : ''}.`,
            );
          else
            log(
              `Connector "${source.id}" (${manifest.source}) registered from ${source.url}: ${manifest.capabilities.length} capabilities, ${manifest.areas.length} areas${manifest.scan ? ', scan' : ''}.`,
            );
          loaded.push(source.id);
          return;
        } catch (error) {
          const message = (error as Error).message;
          if (manifestFailure(error) === 'manifest-invalid') {
            if (
              !(await record(source.id, {
                url: source.url,
                ...health({ status: 'manifest-invalid', detail: message }),
              }))
            )
              moved(source);
            else log(`Connector "${source.id}": ${message}`);
            return;
          }
          if (attempt === attempts) {
            if (
              !(await record(source.id, { url: source.url, ...health({ status: 'unreachable', detail: message }) }))
            ) {
              moved(source);
              return;
            }
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
