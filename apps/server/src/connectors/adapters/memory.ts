import { nextOrdinal } from '@clew/contracts';
import type { AuditEntry, ConnectorRecord, ConnectorStore, ConnectorTx } from '../model';

/**
 * The connector store in memory: the unit tests' adapter (D25). Same contract as Postgres, held to it by
 * `tests/connector-store-contract.ts`. A transaction is a snapshot: a throw rolls back every write, the audit row included.
 * `threads` is a tiny stand-in for the open cards a connector pushed, so `dismissOpenThreadsOf` can be observed.
 */
export interface MemoryConnectorStore extends ConnectorStore {
  audit: AuditEntry[];
  threads: Array<{ id: string; connector: string; state: 'open' | 'handled' | 'dismissed'; handledAt: string | null }>;
}
export function memoryConnectorStore(): MemoryConnectorStore {
  let rows = new Map<string, ConnectorRecord>();
  let audit: AuditEntry[] = [];
  const self: MemoryConnectorStore = {
    audit,
    threads: [],
    async list() {
      return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)).map(r => structuredClone(r));
    },
    async read(id) {
      const r = rows.get(id);
      return r ? structuredClone(r) : undefined;
    },
    async recordHealth(id, health, manifest, at) {
      const r = rows.get(id);
      if (!r) return;
      r.health = structuredClone(health);
      if (manifest !== undefined) {
        r.manifest = structuredClone(manifest);
        r.manifestAt = at ?? health.at;
      }
    },
    async history(id) {
      return self.audit
        .filter(a => a.subject === 'connector:' + id)
        .map(a => ({ at: a.at, actor: a.actor, action: a.action, details: a.details ?? {} }));
    },
    async transaction(fn) {
      const snapshotRows = structuredClone(rows),
        snapshotAudit = [...self.audit],
        snapshotThreads = structuredClone(self.threads);
      const tx: ConnectorTx = {
        async insert(r) {
          if (rows.has(r.id)) return false;
          rows.set(r.id, {
            id: r.id,
            bundled: r.bundled,
            url: r.url,
            secret: r.secret,
            secretChangedAt: r.bundled ? null : r.at,
            state: r.state,
            audience: { mode: 'all' },
            scanEnabled: true,
            toolsEnabled: true,
            capabilities: {},
            manifest: structuredClone(r.manifest),
            manifestAt: r.manifest ? r.at : null,
            health: structuredClone(r.health),
            createdBy: r.createdBy,
            updatedBy: r.createdBy,
            createdAt: r.at,
            updatedAt: r.at,
            version: 1,
            ordinal: r.bundled ? null : nextOrdinal([...rows.values()].filter(x => !x.bundled).map(x => x.ordinal)),
          });
          return true;
        },
        async update(id, patch, by, at) {
          const r = rows.get(id);
          if (!r) return false;
          Object.assign(r, structuredClone(patch), { updatedBy: by, updatedAt: at, version: r.version + 1 });
          return true;
        },
        async remove(id) {
          rows.delete(id);
        },
        async dismissOpenThreadsOf(connectorId, at) {
          let n = 0;
          for (const t of self.threads)
            if (t.connector === connectorId && t.state === 'open') {
              t.state = 'dismissed';
              t.handledAt = at;
              n++;
            }
          return n;
        },
        async writeAudit(entry) {
          self.audit.push(structuredClone(entry));
        },
      };
      try {
        return await fn(tx);
      } catch (error) {
        rows = snapshotRows;
        self.audit.length = 0;
        self.audit.push(...snapshotAudit);
        self.threads.length = 0;
        self.threads.push(...snapshotThreads);
        throw error;
      }
    },
  };
  audit = self.audit;
  return self;
}
