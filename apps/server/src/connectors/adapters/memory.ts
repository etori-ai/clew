import { nextOrdinal } from '@clew/contracts';
import type { AuditEntry, ConnectorRecord, ConnectorStore, ConnectorTx } from '../model';
import { sameManifest } from '../manifests';

/**
 * The connector store in memory: the unit tests' adapter (D25). Same contract as Postgres, held to it by
 * `tests/connector-store-contract.ts`. A throw rolls back every write of its transaction, the audit row included, and
 * only those: what another transaction committed meanwhile stays, as in Postgres. `threads` is a tiny stand-in for the
 * open cards a connector pushed, so `dismissOpenThreadsOf` can be observed.
 */
export interface MemoryConnectorStore extends ConnectorStore {
  audit: AuditEntry[];
  threads: Array<{ id: string; connector: string; state: 'open' | 'handled' | 'dismissed'; handledAt: string | null }>;
}
export function memoryConnectorStore(): MemoryConnectorStore {
  const rows = new Map<string, ConnectorRecord>();
  let audit: AuditEntry[] = [];
  /** The lock `lockedRows` takes, as the Postgres advisory lock: the end of the transaction that holds it last. */
  let spanning: Promise<void> = Promise.resolve();
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
    async recordCheck(id, { health, served, at }) {
      const r = rows.get(id);
      if (!r) return;
      if (health) r.health = structuredClone(health);
      if (served === undefined) return;
      if (r.manifest !== null && sameManifest(r.manifest, served)) {
        r.offered = null;
        r.offeredAt = null;
      } else if (!(r.offered !== null && sameManifest(r.offered, served))) {
        r.offered = structuredClone(served);
        r.offeredAt = at;
      }
    },
    async recordDescription(id, manifest, at) {
      const r = rows.get(id);
      if (!r?.bundled) return;
      r.manifest = structuredClone(manifest);
      r.manifestAt = at;
    },
    async history(id) {
      return self.audit
        .filter(a => a.subject === 'connector:' + id)
        .map(a => ({ at: a.at, actor: a.actor, action: a.action, details: a.details ?? {} }));
    },
    async transaction(fn) {
      // What this transaction changed, as it was before: the rows by id, its own audit rows, the cards it closed.
      const rowsBefore = new Map<string, ConnectorRecord | undefined>(),
        written: AuditEntry[] = [],
        threadsBefore = new Map<MemoryConnectorStore['threads'][number], { state: 'open'; handledAt: string | null }>();
      const keep = (id: string) => {
        if (!rowsBefore.has(id)) rowsBefore.set(id, structuredClone(rows.get(id)));
      };
      let release: (() => void) | undefined;
      const tx: ConnectorTx = {
        async insert(r) {
          if (rows.has(r.id)) return false;
          keep(r.id);
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
            header: false,
            capabilities: {},
            areas: {},
            manifest: structuredClone(r.manifest),
            manifestAt: r.manifest ? r.at : null,
            offered: null,
            offeredAt: null,
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
        async update(id, patch, by, at, version) {
          const r = rows.get(id);
          if (!r || (version !== undefined && r.version !== version)) return false;
          // As the partial unique index refuses it in Postgres.
          if (patch.header === true && [...rows.values()].some(x => x.header && x.id !== id))
            throw new Error('duplicate key value violates unique constraint "connector_header_holder_one"');
          keep(id);
          Object.assign(r, structuredClone(patch), { updatedBy: by, updatedAt: at, version: r.version + 1 });
          return true;
        },
        async lockedRows() {
          if (!release) {
            const before = spanning;
            spanning = new Promise<void>(resolve => (release = resolve));
            await before;
          }
          return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)).map(r => structuredClone(r));
        },
        async approveOffer(id, offer, manifest, by, at) {
          const r = rows.get(id);
          if (!r || r.offered === null || r.offeredAt !== offer.at || !sameManifest(r.offered, offer.manifest))
            return false;
          keep(id);
          Object.assign(r, {
            manifest: structuredClone(manifest),
            manifestAt: at,
            offered: null,
            offeredAt: null,
            updatedBy: by,
            updatedAt: at,
            version: r.version + 1,
          });
          return true;
        },
        async remove(id) {
          keep(id);
          rows.delete(id);
        },
        async dismissOpenThreadsOf(connectorId, at) {
          let n = 0;
          for (const t of self.threads)
            if (t.connector === connectorId && t.state === 'open') {
              if (!threadsBefore.has(t)) threadsBefore.set(t, { state: t.state, handledAt: t.handledAt });
              t.state = 'dismissed';
              t.handledAt = at;
              n++;
            }
          return n;
        },
        async writeAudit(entry) {
          const row = structuredClone(entry);
          written.push(row);
          self.audit.push(row);
        },
      };
      try {
        return await fn(tx);
      } catch (error) {
        for (const [id, row] of rowsBefore)
          if (row) rows.set(id, row);
          else rows.delete(id);
        for (const row of written) self.audit.splice(self.audit.indexOf(row), 1);
        for (const [t, was] of threadsBefore) Object.assign(t, was);
        throw error;
      } finally {
        release?.();
      }
    },
  };
  audit = self.audit;
  return self;
}
