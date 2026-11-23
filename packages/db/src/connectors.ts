import { and, eq, sql } from 'drizzle-orm';
import { database, type Transaction } from './index';
import { nextOrdinal } from '@clew/contracts';
import { connectors, type ConnectorAudience, type ConnectorHealth } from './schema';

/** Rows of registered connectors (D23). Secrets stay sealed here; the server opens them. */
export type ConnectorRow = typeof connectors.$inferSelect;
export type { ConnectorAudience, ConnectorHealth };
export const listConnectors = () => database().select().from(connectors).orderBy(connectors.id);
/** Remote rows the loader registers at boot; bundled connectors are already in the registry. */
export const enabledConnectors = () =>
  database()
    .select()
    .from(connectors)
    .where(and(eq(connectors.state, 'enabled'), eq(connectors.bundled, false)));
/** What the watcher polls: one small row per connector. */
export const listConnectorVersions = () =>
  database().select({ id: connectors.id, version: connectors.version }).from(connectors);
export async function readConnector(id: string) {
  const [row] = await database().select().from(connectors).where(eq(connectors.id, id));
  return row;
}
/** The ordinal a new remote row takes (D71), read inside the transaction that inserts it. */
export async function nextConnectorOrdinal(tx: Transaction) {
  const rows = await tx.select({ ordinal: connectors.ordinal }).from(connectors).where(eq(connectors.bundled, false));
  return nextOrdinal(rows.map(r => r.ordinal));
}
export async function insertConnector(
  tx: Transaction,
  row: {
    id: string;
    url: string;
    secret: string;
    createdBy: string;
    state?: 'draft' | 'enabled' | 'disabled';
    manifest?: unknown;
    health?: ConnectorHealth;
  },
) {
  await tx.insert(connectors).values({
    id: row.id,
    bundled: false,
    url: row.url,
    secret: row.secret,
    createdBy: row.createdBy,
    updatedBy: row.createdBy,
    state: row.state ?? 'draft',
    manifest: row.manifest ?? null,
    manifestAt: row.manifest ? new Date() : null,
    ...(row.health ? { health: row.health } : {}),
    ordinal: await nextConnectorOrdinal(tx),
  });
}
export async function updateConnector(
  tx: Transaction,
  id: string,
  by: string,
  patch: Partial<
    Pick<
      ConnectorRow,
      | 'url'
      | 'secret'
      | 'secretChangedAt'
      | 'state'
      | 'audience'
      | 'scanEnabled'
      | 'toolsEnabled'
      | 'capabilities'
      | 'manifest'
      | 'manifestAt'
      | 'offered'
      | 'offeredAt'
      | 'health'
    >
  >,
) {
  const [row] = await tx.select({ version: connectors.version }).from(connectors).where(eq(connectors.id, id));
  if (!row) return false;
  await tx
    .update(connectors)
    .set({ ...patch, updatedBy: by, updatedAt: new Date(), version: row.version + 1 })
    .where(eq(connectors.id, id));
  return true;
}
/**
 * A check's result is not administration: no actor, no version bump, no audit. It never touches the approved manifest
 * (D144): `offered` is what the service serves when it differs from it, `null` when it does not, and is left alone when
 * omitted. The same offer seen again keeps the instant it was first seen, so a review an administrator has open stays
 * bound to it.
 */
export async function recordHealth(id: string, health: ConnectorHealth, offered?: unknown, at: Date = new Date()) {
  await database()
    .update(connectors)
    .set({
      health,
      ...(offered === undefined
        ? {}
        : offered === null
          ? { offered: null, offeredAt: null }
          : {
              offered,
              offeredAt: sql`case when ${connectors.offered} is not distinct from ${JSON.stringify(offered)}::jsonb then ${connectors.offeredAt} else ${at.toISOString()}::timestamptz end`,
            }),
    })
    .where(eq(connectors.id, id));
}
/** A bundled connector's description is its code, reviewed with the code: it moves with the build (D144 item 1). */
export async function recordDescription(id: string, manifest: unknown, at: Date = new Date()) {
  await database()
    .update(connectors)
    .set({ manifest, manifestAt: at })
    .where(and(eq(connectors.id, id), eq(connectors.bundled, true)));
}
export const deleteConnector = (tx: Transaction, id: string) => tx.delete(connectors).where(eq(connectors.id, id));
