import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import { approveOffer, nextConnectorOrdinal, recordCheck, recordDescription } from '@clew/db/connectors';
import { forgetCompetenceSource } from '@clew/db/competence';
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
  header: row.headerHolder,
  capabilities: row.capabilities,
  areas: row.areas,
  manifest: row.manifest ?? null,
  manifestAt: iso(row.manifestAt),
  offered: row.offered ?? null,
  offeredAt: iso(row.offeredAt),
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
  async update(id, patch: ConnectorPatch, by, at, version) {
    const { secretChangedAt, offeredAt, header, ...rest } = patch;
    // One statement: the version the change was made on is compared where it is raised (DE-M5). A second holder of the
    // header is refused by `connector_header_holder_one`.
    const updated = await tx
      .update(connectors)
      .set({
        ...rest,
        ...(header !== undefined ? { headerHolder: header } : {}),
        ...(secretChangedAt !== undefined ? { secretChangedAt: new Date(secretChangedAt!) } : {}),
        ...(offeredAt !== undefined ? { offeredAt: null } : {}),
        updatedBy: by,
        updatedAt: new Date(at),
        version: sql`${connectors.version} + 1`,
      })
      .where(
        version === undefined ? eq(connectors.id, id) : and(eq(connectors.id, id), eq(connectors.version, version)),
      )
      .returning({ id: connectors.id });
    return updated.length > 0;
  },
  async lockedRows() {
    // Held to the end of the transaction; a second writer that spans rows waits for it and then reads what this committed.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'clew.connector-administration'}, 0))`);
    return (await tx.select().from(connectors).orderBy(connectors.id)).map(toRecord);
  },
  approveOffer: (id, offer, manifest, by, at) =>
    approveOffer(tx, id, { at: new Date(offer.at), manifest: offer.manifest }, manifest, by, new Date(at)),
  async remove(id) {
    // What the competence register copied from the connector goes with its row (D108 item 9), counted as it goes (DE-L4),
    // in the lock order an operator's forgetting of the source shares (`@clew/db/competence`); then the row, whose
    // cascade finds nothing of them left.
    const copied = await forgetCompetenceSource(tx, id);
    await tx.delete(connectors).where(eq(connectors.id, id));
    return copied;
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
    recordCheck: (id, { url, secret, health, served, at }) =>
      recordCheck(id, {
        url,
        ...(secret !== undefined ? { secret } : {}),
        ...(health ? { health } : {}),
        ...(served !== undefined ? { served } : {}),
        at: new Date(at),
      }),
    async recordDescription(id, manifest, at) {
      await recordDescription(id, manifest, new Date(at));
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
        .select({ id: schema.groups.externalId, label: schema.groups.label })
        .from(schema.groups)
        .where(isNotNull(schema.groups.externalId))
        .orderBy(schema.groups.label, schema.groups.externalId);
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
