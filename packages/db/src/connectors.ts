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
 * What a check or "Läs in igen" saw (D144). It is not administration: no actor, no version bump, no audit, and the
 * approved manifest is never touched. `health`, when given, is recorded. `served`, when given, is the manifest the
 * service serves, compared with the approved one in this same statement, so an approval made meanwhile is seen: the
 * approved one clears the offer and any other is the offer. The same offer seen again keeps the instant it was first
 * seen, so a review an administrator has open stays bound to it. jsonb compares by content, whatever the key order.
 *
 * Written only on the row as it was checked: still at `url`, the address the service was read at, and, given `secret`,
 * still with that sealed secret, the one the check signed with. A row moved or rekeyed while the service answered keeps
 * nothing of an answer from the old address or about the old secret, so an offer from one address is never approved at
 * another. True when it wrote; false when the row is gone, has changed in either, or nothing was given to record.
 */
export async function recordCheck(
  id: string,
  seen: { url: string; secret?: string; health?: ConnectorHealth; served?: unknown; at: Date },
) {
  const served = seen.served === undefined ? undefined : JSON.stringify(seen.served);
  if (!seen.health && served === undefined) return false;
  const approved = sql`${connectors.manifest} = ${served}::jsonb`;
  const written = await database()
    .update(connectors)
    .set({
      ...(seen.health ? { health: seen.health } : {}),
      ...(served === undefined
        ? {}
        : {
            offered: sql`case when ${approved} then null else ${served}::jsonb end`,
            offeredAt: sql`case when ${approved} then null when ${connectors.offered} is not distinct from ${served}::jsonb then ${connectors.offeredAt} else ${seen.at.toISOString()}::timestamptz end`,
          }),
    })
    .where(
      and(
        eq(connectors.id, id),
        sql`${connectors.url} is not distinct from ${seen.url}`,
        ...(seen.secret === undefined ? [] : [sql`${connectors.secret} is not distinct from ${seen.secret}`]),
      ),
    )
    .returning({ id: connectors.id });
  return written.length > 0;
}
/**
 * The offer an administrator reviewed becomes the approved manifest (D144), with the offer cleared and the version
 * bumped, only while it is still the stored offer: the same instant it was first seen and the same content. False when
 * another took its place or it was cleared, so nothing but what was reviewed goes live.
 */
export async function approveOffer(
  tx: Transaction,
  id: string,
  offer: { at: Date; manifest: unknown; version: number; draftOnly?: boolean },
  manifest: unknown,
  by: string,
  at: Date,
) {
  const rows = await tx
    .update(connectors)
    .set({
      manifest,
      manifestAt: at,
      offered: null,
      offeredAt: null,
      updatedBy: by,
      updatedAt: at,
      version: sql`${connectors.version} + 1`,
    })
    .where(
      and(
        eq(connectors.id, id),
        eq(connectors.version, offer.version),
        offer.draftOnly ? eq(connectors.state, 'draft') : undefined,
        eq(connectors.offeredAt, offer.at),
        sql`${connectors.offered} = ${JSON.stringify(offer.manifest)}::jsonb`,
      ),
    )
    .returning({ id: connectors.id });
  return rows.length > 0;
}
/** A bundled connector's description is its code, reviewed with the code: it moves with the build (D144 item 1). */
export async function recordDescription(id: string, manifest: unknown, at: Date = new Date()) {
  await database()
    .update(connectors)
    .set({ manifest, manifestAt: at })
    .where(and(eq(connectors.id, id), eq(connectors.bundled, true)));
}
export const deleteConnector = (tx: Transaction, id: string) => tx.delete(connectors).where(eq(connectors.id, id));
