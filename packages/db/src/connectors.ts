import { and, eq } from 'drizzle-orm';
import { database, type Transaction } from './index';
import { connectors, type ConnectorAudience, type ConnectorHealth } from './schema';

/** Rows of registered connectors (D23). Secrets stay sealed here; the server opens them. */
export type ConnectorRow = typeof connectors.$inferSelect;
export type { ConnectorAudience, ConnectorHealth };
export const listConnectors = () => database().select().from(connectors).orderBy(connectors.id);
/** Remote rows the loader registers at boot; bundled connectors are already in the registry. */
export const enabledConnectors = () => database().select().from(connectors).where(and(eq(connectors.state, 'enabled'), eq(connectors.bundled, false)));
/** What the watcher polls: one small row per connector. */
export const listConnectorVersions = () => database().select({ id: connectors.id, version: connectors.version }).from(connectors);
export async function readConnector(id: string) { const [row] = await database().select().from(connectors).where(eq(connectors.id, id)); return row; }
export async function insertConnector(tx: Transaction, row: { id: string; url: string; secret: string; createdBy: string; state?: 'draft' | 'enabled' | 'disabled'; manifest?: unknown; health?: ConnectorHealth }) {
  await tx.insert(connectors).values({ id: row.id, bundled: false, url: row.url, secret: row.secret, createdBy: row.createdBy, updatedBy: row.createdBy, state: row.state ?? 'draft',
    manifest: row.manifest ?? null, manifestAt: row.manifest ? new Date() : null, ...(row.health ? { health: row.health } : {}) });
}
export async function updateConnector(tx: Transaction, id: string, by: string, patch: Partial<Pick<ConnectorRow, 'url' | 'secret' | 'secretChangedAt' | 'state' | 'audience' | 'scanEnabled' | 'toolsEnabled' | 'menuEnabled' | 'capabilities' | 'manifest' | 'manifestAt' | 'health'>>) {
  const [row] = await tx.select({ version: connectors.version }).from(connectors).where(eq(connectors.id, id));
  if (!row) return false;
  await tx.update(connectors).set({ ...patch, updatedBy: by, updatedAt: new Date(), version: row.version + 1 }).where(eq(connectors.id, id));
  return true;
}
/** Health and manifest refreshes are not administration: no actor, no version bump, no audit. */
export async function recordHealth(id: string, health: ConnectorHealth, manifest?: unknown) {
  await database().update(connectors).set({ health, ...(manifest !== undefined ? { manifest, manifestAt: new Date() } : {}) }).where(eq(connectors.id, id));
}
export const deleteConnector = (tx: Transaction, id: string) => tx.delete(connectors).where(eq(connectors.id, id));
