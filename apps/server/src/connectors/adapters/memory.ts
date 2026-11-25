import { nextOrdinal } from '@clew/contracts';
import type { AuditEntry, ConnectorRecord, ConnectorStore, ConnectorTx } from '../model';
import { sameManifest } from '../manifests';

/**
 * The connector store in memory: the unit tests' adapter (D25). Same contract as Postgres, held to it by
 * `tests/connector-store-contract.ts`. It has no row locks, so its writes take turns: a transaction, and each
 * single-write `recordCheck` and `recordDescription`, runs only after the one before it has ended. A transaction thus
 * holds every row it writes until it ends, as Postgres holds them, and `lockedRows` reads what every earlier one
 * committed. A throw rolls back every write of its transaction, the audit row included, and only those: nothing else
 * wrote meanwhile, so what another committed stays, as in Postgres. Unlike Postgres, `read` and `list` see a
 * transaction's writes before it ends. `threads` is a tiny stand-in for the open cards a connector pushed, so
 * `dismissOpenThreadsOf` can be observed.
 */
export interface MemoryConnectorStore extends ConnectorStore {
  audit: AuditEntry[];
  threads: Array<{ id: string; connector: string; state: 'open' | 'handled' | 'dismissed'; handledAt: string | null }>;
}
export function memoryConnectorStore(): MemoryConnectorStore {
  const rows = new Map<string, ConnectorRecord>();
  let audit: AuditEntry[] = [];
  /** The end of the write whose turn came last: the next one waits for it, whether it committed or threw. */
  let last: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(write: () => Promise<T>): Promise<T> => {
    const turn = last.then(write);
    last = turn.catch(() => undefined);
    return turn;
  };
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
    recordCheck: (id, { url, secret, health, served, at }) =>
      inTurn(async () => {
        const r = rows.get(id);
        // As the Postgres write's condition: only the row still at the address read, with the secret signed with.
        if (!r || r.url !== url || (secret !== undefined && r.secret !== secret)) return false;
        if (!health && served === undefined) return false;
        if (health) r.health = structuredClone(health);
        if (served === undefined) return true;
        if (r.manifest !== null && sameManifest(r.manifest, served)) {
          r.offered = null;
          r.offeredAt = null;
        } else if (!(r.offered !== null && sameManifest(r.offered, served))) {
          r.offered = structuredClone(served);
          r.offeredAt = at;
        }
        return true;
      }),
    recordDescription: (id, manifest, at) =>
      inTurn(async () => {
        const r = rows.get(id);
        if (!r?.bundled) return;
        r.manifest = structuredClone(manifest);
        r.manifestAt = at;
      }),
    async history(id) {
      return self.audit
        .filter(a => a.subject === 'connector:' + id)
        .map(a => ({ at: a.at, actor: a.actor, action: a.action, details: a.details ?? {} }));
    },
    transaction: fn =>
      inTurn(async () => {
        // What this transaction changed, as it was before: the rows by id, its own audit rows, the cards it closed.
        const rowsBefore = new Map<string, ConnectorRecord | undefined>(),
          written: AuditEntry[] = [],
          threadsBefore = new Map<
            MemoryConnectorStore['threads'][number],
            { state: 'open'; handledAt: string | null }
          >();
        const keep = (id: string) => {
          if (!rowsBefore.has(id)) rowsBefore.set(id, structuredClone(rows.get(id)));
        };
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
            // The transaction already holds its turn, so every earlier one has ended: what they committed is here.
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
        }
      }),
  };
  audit = self.audit;
  return self;
}
