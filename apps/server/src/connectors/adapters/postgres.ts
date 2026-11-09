import { and, eq, isNotNull } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import { nextConnectorOrdinal } from '@clew/db/connectors';
import type {
  ConnectorPatch,
  ConnectorRecord,
  ConnectorStore,
  ConnectorTx,
  Groups,
  NewConnector,
  Units,
} from '../model';

/** The connector store the server runs (D23, D25): the port over Drizzle and Postgres. Held to the memory adapter by `tests/connector-store-contract.ts`. */
const { connectors, threads, audit, units } = schema;
const iso = (d: Date | null) => (d ? d.toISOString() : null);
export const toRecord = (row: typeof connectors.$inferSelect): ConnectorRecord => ({
  id: row.id,
  bundled: row.bundled,
  url: row.url,
  secret: row.secret,
  secretChangedAt: row.bundled ? null : iso(row.secretChangedAt),
  state: row.state,
  audience: row.audience,
  scanEnabled: row.scanEnabled,
  toolsEnabled: row.toolsEnabled,
  capabilities: row.capabilities,
  areas: row.areas,
  manifest: row.manifest ?? null,
  manifestAt: iso(row.manifestAt),
  health: row.health,
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  version: row.version,
  ordinal: row.bundled ? null : row.ordinal,
});
const txOf = (tx: Transaction): ConnectorTx => ({
  async insert(r: NewConnector) {
    const inserted = await tx
      .insert(connectors)
      .values({
        id: r.id,
        bundled: r.bundled,
        url: r.url,
        secret: r.secret,
        state: r.state,
        manifest: r.manifest,
        manifestAt: r.manifest ? new Date(r.at) : null,
        health: r.health,
        createdBy: r.createdBy,
        updatedBy: r.createdBy,
        createdAt: new Date(r.at),
        updatedAt: new Date(r.at),
        secretChangedAt: new Date(r.at),
        ordinal: r.bundled ? null : await nextConnectorOrdinal(tx),
      })
      .onConflictDoNothing()
      .returning({ id: connectors.id });
    return inserted.length > 0;
  },
  async update(id, patch: ConnectorPatch, by, at) {
    const [row] = await tx.select({ version: connectors.version }).from(connectors).where(eq(connectors.id, id));
    if (!row) return false;
    const { secretChangedAt, manifestAt, ...rest } = patch;
    await tx
      .update(connectors)
      .set({
        ...rest,
        ...(secretChangedAt !== undefined ? { secretChangedAt: new Date(secretChangedAt!) } : {}),
        ...(manifestAt !== undefined ? { manifestAt: manifestAt ? new Date(manifestAt) : null } : {}),
        updatedBy: by,
        updatedAt: new Date(at),
        version: row.version + 1,
      })
      .where(eq(connectors.id, id));
    return true;
  },
  async remove(id) {
    await tx.delete(connectors).where(eq(connectors.id, id));
  },
  async dismissOpenThreadsOf(connectorId, at) {
    const rows = await tx
      .update(threads)
      .set({ state: 'dismissed', handledAt: new Date(at), updatedAt: new Date(at) })
      .where(and(eq(threads.connector, connectorId), eq(threads.state, 'open')))
      .returning({ id: threads.id });
    return rows.length;
  },
  async writeAudit(entry) {
    await tx.insert(audit).values({
      actor: entry.actor,
      action: entry.action,
      subject: entry.subject,
      details: entry.details ?? {},
      createdAt: new Date(entry.at),
    });
  },
});
export function postgresConnectorStore(): ConnectorStore {
  return {
    async list() {
      return (await database().select().from(connectors).orderBy(connectors.id)).map(toRecord);
    },
    async read(id) {
      const [row] = await database().select().from(connectors).where(eq(connectors.id, id));
      return row ? toRecord(row) : undefined;
    },
    async recordHealth(id, health, manifest, at) {
      await database()
        .update(connectors)
        .set({ health, ...(manifest !== undefined ? { manifest, manifestAt: new Date(at ?? health.at) } : {}) })
        .where(eq(connectors.id, id));
    },
    async history(id) {
      const rows = await database()
        .select()
        .from(audit)
        .where(eq(audit.subject, 'connector:' + id))
        .orderBy(audit.id);
      return rows.map(r => ({ at: r.createdAt.toISOString(), actor: r.actor, action: r.action, details: r.details }));
    },
    transaction: fn => database().transaction(tx => fn(txOf(tx))),
  };
}
/** The provisioned groups with an external id (`auth_group`, D68), by name; the external id is what the audience stores. */
export function postgresGroups(): Groups {
  return {
    async list() {
      const rows = await database()
        .select({ id: schema.groups.externalId, label: schema.groups.displayName })
        .from(schema.groups)
        .where(isNotNull(schema.groups.externalId))
        .orderBy(schema.groups.displayName, schema.groups.externalId);
      return rows.map(r => ({ id: r.id!, label: r.label }));
    },
  };
}
/** The organisation's units as provisioned (`auth_unit`, D68), labelled and sorted by label. */
export function postgresUnits(): Units {
  return {
    async list() {
      return database().select({ id: units.id, label: units.label }).from(units).orderBy(units.label, units.id);
    },
  };
}
