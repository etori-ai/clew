import { deniedGovernance, openGovernance, type Registry } from '@clew/connectors';
import type { ConnectorManifest } from '@clew/connectors/protocol';
import { parseManifest } from '@clew/connectors/remote';
import { listConnectorVersions } from '@clew/db/connectors';
import { describeBundled } from './describe';
import type { ConnectorRecord, ConnectorStore, LiveRegistration, Secrets } from './model';
import { governanceOf } from './usecases/admin';

/**
 * Keeps the live registry equal to the `connector` rows (D23). At boot: every bundled connector gets its row if it has
 * none, and every row's governance is applied. Then a watcher polls the rows' versions and applies what changed, so an
 * administrator's change on another instance, or `scripts/connector-add.ts`, reaches this process without a restart.
 * Platform code beside the loader in `remote.ts`: it may read the store directly.
 */
export interface ReconcileDeps {
  registry: Registry;
  store: ConnectorStore;
  secrets: Secrets;
  live: LiveRegistration;
  bundled: string[];
  /** Internal capability providers have no connector lifecycle (D62). */
  internal?: readonly string[];
  clock: () => Date;
  log?: (message: string) => void;
}
const isManifest = (value: unknown): value is ConnectorManifest =>
  !!value && typeof value === 'object' && Array.isArray((value as ConnectorManifest).capabilities);

/** A row for every bundled connector, inserted only when missing: enabled for everyone until an administrator says otherwise. */
export async function syncBundledRows({ registry, store, bundled, internal = [], clock }: ReconcileDeps) {
  const at = clock().toISOString();
  for (const id of bundled) {
    const connector = registry.connector(id);
    if (!connector || internal.includes(id)) continue;
    await store.transaction(tx =>
      tx.insert({
        id,
        bundled: true,
        url: null,
        secret: null,
        state: 'enabled',
        manifest: describeBundled(connector),
        health: { status: 'ok', at },
        createdBy: 'system:boot',
        at,
      }),
    );
  }
}
/**
 * Internal user reads have no on/off lifecycle. Preserve old audience, capability and assistant restrictions
 * without letting a legacy row disable core availability. A previously disabled row never re-enables model tools.
 * The legacy row is retained as read policy only; new installs do not create one (D62).
 */
function applyInternal(deps: ReconcileDeps, id: string, row?: ConnectorRecord) {
  const policy = row ? governanceOf(row) : openGovernance();
  deps.registry.govern(id, {
    ...policy,
    state: 'enabled',
    toolsEnabled: policy.state === 'enabled' && policy.toolsEnabled,
  });
}
/** Apply one row to the live registry: register or unregister a remote connector, then its governance. */
export function applyRow(deps: ReconcileDeps, row: ConnectorRecord) {
  const { registry, secrets, live, log = console.log } = deps;
  if (deps.internal?.includes(row.id)) {
    applyInternal(deps, row.id, row);
    return;
  }
  if (!row.bundled) {
    if (row.state === 'draft') {
      live.unregister(row.id);
      return;
    }
    if (isManifest(row.manifest) && row.url && row.secret) {
      try {
        const manifest = parseManifest(row.manifest, row.id);
        live.register({ id: row.id, url: row.url, secret: secrets.open(row.secret, row.id), manifest }, manifest);
      } catch (error) {
        registry.govern(row.id, deniedGovernance());
        log(`Connector "${row.id}": stored manifest not usable: ${(error as Error).message}`);
        return;
      }
    }
  }
  if (registry.connector(row.id)) registry.govern(row.id, governanceOf(row));
}
export async function applyAllRows(deps: ReconcileDeps) {
  const rows = await deps.store.list();
  const present = new Set(rows.map(row => row.id));
  for (const connector of deps.registry.list())
    if (!present.has(connector.id)) {
      if (deps.internal?.includes(connector.id)) applyInternal(deps, connector.id);
      else deps.registry.govern(connector.id, deniedGovernance());
    }
  for (const row of rows) applyRow(deps, row);
}
/** Poll the rows' versions; apply changed rows, forget deleted ones. Returns a stop function. */
export function watchConnectors(deps: ReconcileDeps, intervalMs = 5000) {
  const seen = new Map<string, number>();
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const versions = await listConnectorVersions();
      const present = new Set(versions.map(v => v.id));
      for (const id of seen.keys())
        if (!present.has(id)) {
          seen.delete(id);
          if (deps.internal?.includes(id)) applyInternal(deps, id);
          else deps.live.unregister(id);
        }
      for (const v of versions) {
        if (seen.get(v.id) === v.version) continue;
        const row = await deps.store.read(v.id);
        if (row) applyRow(deps, row);
        seen.set(v.id, v.version);
      }
    } catch (error) {
      (deps.log ?? console.log)('connectors: watch failed: ' + (error as Error).message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
