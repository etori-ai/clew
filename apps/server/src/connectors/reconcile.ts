import { deniedGovernance, openGovernance, type Connector, type Registry } from '@clew/connectors';
import type { ConnectorManifest } from '@clew/connectors/protocol';
import { parseManifest } from '@clew/connectors/remote';
import { describeBundled } from './describe';
import type { ConnectorRecord, ConnectorStore, LiveRegistration, Secrets } from './model';
import { governanceOf } from './usecases/admin';
import { logPort } from '../logging';

/**
 * Keeps the live registry equal to the `connector` rows (D23). At boot: every bundled connector gets its row if it has
 * none, and every row's governance is applied. A watcher and protected reads reconcile the current rows, so an
 * administrator's change on another instance, or `scripts/connector-add.ts`, reaches this process without a restart.
 * Unchanged descriptors are reused; governance is always reapplied.
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
  /** Bundled connectors whose row is created disabled, for an administrator to switch on (D107 item 13). */
  offAtFirstBoot?: readonly string[];
  clock: () => Date;
  log?: (message: string) => void;
}
interface ReconcileState {
  descriptors: Map<string, { fingerprint: string; connector: Connector }>;
  running?: Promise<void>;
  queued?: Promise<void>;
}
const states = new WeakMap<ReconcileDeps, ReconcileState>();
function stateFor(deps: ReconcileDeps) {
  let state = states.get(deps);
  if (!state) states.set(deps, (state = { descriptors: new Map() }));
  return state;
}
const isManifest = (value: unknown): value is ConnectorManifest =>
  !!value && typeof value === 'object' && Array.isArray((value as ConnectorManifest).capabilities);

/** The same document whatever order its keys come back in from the store, so a jsonb round trip is not a change. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  );
/**
 * A row for every bundled connector: inserted when missing, enabled for everyone until an administrator says otherwise.
 * A bundled connector's description is its code, and the code moves with every build, so an existing row takes the
 * current description when it differs, the way a remote row takes a refetched manifest: no audit, no version bump,
 * and the administrator's governance of the row untouched.
 */
export async function syncBundledRows({
  registry,
  store,
  bundled,
  internal = [],
  offAtFirstBoot = [],
  clock,
}: ReconcileDeps) {
  const at = clock().toISOString();
  for (const id of bundled) {
    const connector = registry.connector(id);
    if (!connector || internal.includes(id)) continue;
    const manifest = describeBundled(connector);
    const inserted = await store.transaction(tx =>
      tx.insert({
        id,
        bundled: true,
        url: null,
        secret: null,
        state: offAtFirstBoot.includes(id) ? 'disabled' : 'enabled',
        manifest,
        health: { status: 'ok', at },
        createdBy: 'system:boot',
        at,
      }),
    );
    if (inserted) continue;
    const row = await store.read(id);
    if (row?.bundled && canonical(row.manifest) !== canonical(manifest))
      await store.recordHealth(id, row.health, manifest, at);
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
  const { registry, secrets, live, log = logPort('connectors') } = deps;
  if (deps.internal?.includes(row.id)) {
    applyInternal(deps, row.id, row);
    return;
  }
  if (!row.bundled) {
    if (row.state === 'draft') {
      live.unregister(row.id);
      stateFor(deps).descriptors.delete(row.id);
      return;
    }
    if (isManifest(row.manifest) && row.url && row.secret) {
      try {
        const cache = stateFor(deps).descriptors;
        // Health/manifest updates need not bump the governance version. Compare the descriptor itself.
        const fingerprint = canonical({ manifest: row.manifest, url: row.url, secret: row.secret });
        const previous = cache.get(row.id);
        if (previous?.fingerprint !== fingerprint || previous.connector !== registry.connector(row.id)) {
          const manifest = parseManifest(row.manifest, row.id);
          live.register({ id: row.id, url: row.url, secret: secrets.open(row.secret, row.id), manifest }, manifest);
          const connector = registry.connector(row.id);
          if (connector) cache.set(row.id, { fingerprint, connector });
        }
      } catch (error) {
        registry.govern(row.id, deniedGovernance());
        log(`Connector "${row.id}": stored manifest not usable: ${(error as Error).message}`);
        return;
      }
    } else {
      registry.govern(row.id, deniedGovernance());
      stateFor(deps).descriptors.delete(row.id);
      return;
    }
  }
  if (registry.connector(row.id)) registry.govern(row.id, governanceOf(row));
}
async function refreshRows(deps: ReconcileDeps) {
  const rows = await deps.store.list();
  const present = new Set(rows.map(row => row.id));
  const cache = stateFor(deps).descriptors;
  for (const id of cache.keys()) if (!present.has(id)) cache.delete(id);
  for (const connector of deps.registry.list())
    if (!present.has(connector.id)) {
      if (deps.internal?.includes(connector.id)) applyInternal(deps, connector.id);
      else if (deps.bundled.includes(connector.id)) deps.registry.govern(connector.id, deniedGovernance());
      else deps.live.unregister(connector.id);
    }
  for (const row of rows) applyRow(deps, row);
}
/**
 * Coalesce callers waiting for the same fresh read. A caller arriving after a read starts joins the NEXT batch,
 * so a post-source permission check never reuses a snapshot requested before that source answered.
 * Reads are serialized: an older snapshot cannot overwrite a newer one. Failures reject every caller in the batch.
 */
export function applyAllRows(deps: ReconcileDeps): Promise<void> {
  const state = stateFor(deps);
  if (state.queued) return state.queued;
  const previous = state.running?.catch(() => {});
  const queued = Promise.resolve(previous).then(async () => {
    state.queued = undefined;
    state.running = queued;
    try {
      await refreshRows(deps);
    } finally {
      if (state.running === queued) state.running = undefined;
    }
  });
  state.queued = queued;
  return queued;
}
/** The watcher and protected reads share one reconciliation path, including manifest changes without a version bump. */
export function watchConnectors(deps: ReconcileDeps, intervalMs = 5000) {
  const tick = async () => {
    try {
      await applyAllRows(deps);
    } catch (error) {
      (deps.log ?? logPort('connectors', 'error'))('connectors: watch failed: ' + (error as Error).message);
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
