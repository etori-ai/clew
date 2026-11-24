/**
 * Registering a connector from a script (D23): what `connector-add.ts` does from the command line and `dev-connectors.ts`
 * does for the development chain, in one place. Fetches the manifest, runs the loader's validation, seals the secret and
 * writes the row and its audit rows in one transaction. The BFF registers enabled rows at boot and watches the rows every
 * few seconds, so a change here reaches it without a restart. Each change that happened is one audit row, with the same
 * action and details the administration page writes (`connectors/usecases/admin.ts`), and a change that did not happen
 * writes nothing (CB-11).
 */
import { eq } from 'drizzle-orm';
import { database, schema } from '@clew/db';
import { writeAudit } from '@clew/db/threads';
import {
  insertConnector,
  listConnectors as storedConnectors,
  readConnector,
  recordCheck,
  updateConnector,
} from '@clew/db/connectors';
import { fetchManifest, parseManifest } from '../packages/connectors/src/remote';
import { openSecret, sealSecret } from '../apps/server/src/auth-crypto';
import { secretPurpose } from '../apps/server/src/connectors/remote';
import { diffDetails, isManifest, manifestDiff, sameManifest } from '../apps/server/src/connectors/manifests';
import { internalIds } from '../apps/server/src/connectors/registry';
import { postgresConnectorStore } from '../apps/server/src/connectors/adapters/postgres';

const requireManaged = (id: string) => {
  if (internalIds.includes(id)) throw new Error('Users are part of Clew core, not a managed connector.');
};
export const listConnectors = async () => (await storedConnectors()).filter(row => !internalIds.includes(row.id));
const actor = 'bootstrap:connector';
const subject = (id: string) => 'connector:' + id;
/** Whether the sealed secret is this one; one that cannot be opened any more is not. */
const sameSecret = (sealed: string | null, secret: string, id: string) => {
  try {
    return sealed !== null && openSecret(sealed, secretPurpose(id)) === secret;
  } catch {
    return false;
  }
};

/**
 * Add a connector, or update its address, secret and manifest. `enable` makes it live; otherwise a new connector is a
 * draft and an existing one keeps its state, so moving or rekeying an enabled connector does not switch it off.
 * `changes` are the audit actions written: none when the address, the secret, the manifest and the state are as stored.
 */
export async function registerConnector(options: {
  id: string;
  url: string;
  secret: string;
  enable?: boolean;
  ifMissing?: boolean;
}) {
  const { id, secret } = options;
  requireManaged(id);
  const url = options.url.replace(/\/+$/, '');
  if (!/^[a-z][a-z0-9-]*$/.test(id))
    throw new Error(`Invalid connector id ${id}: lowercase letters, digits and hyphens.`);
  if (secret.length < 16) throw new Error('The transport secret must be 16 characters or more.');
  const existing = await readConnector(id);
  if (existing?.bundled)
    throw new Error('Connector ' + id + ' is still bundled. Complete the fixture cutover before registration.');
  if (existing && options.ifMissing) {
    if (!existing.manifest) throw new Error('Existing connector ' + id + ' has no manifest; refresh it explicitly.');
    return { manifest: parseManifest(existing.manifest, id), existing: true, state: existing.state, changes: [] };
  }
  const manifest = await fetchManifest(url, id);
  const at = new Date();
  const health = { status: 'ok' as const, at: at.toISOString() };
  const written = await database().transaction(async tx => {
    // The row as it stands now, held until this commits: the changes are decided on it, not on the read above.
    const [row] = await tx.select().from(schema.connectors).where(eq(schema.connectors.id, id)).for('update');
    if (row?.bundled)
      throw new Error('Connector ' + id + ' is still bundled. Complete the fixture cutover before registration.');
    const state = options.enable ? ('enabled' as const) : (row?.state ?? ('draft' as const));
    const audit = (action: string, details?: Record<string, unknown>) =>
      writeAudit(tx, { actor, action, subject: subject(id), ...(details ? { details } : {}) });
    if (!row) {
      await insertConnector(tx, {
        id,
        url,
        secret: sealSecret(secret, secretPurpose(id)),
        createdBy: actor,
        state,
        manifest,
        health,
      });
      // What is approved is in the history (D144): what the connector reads back as the person and whose token it gets.
      await audit('connector.added', {
        url,
        source: manifest.source,
        capabilities: manifest.capabilities.length,
        uses: manifest.uses ?? [],
        delegation: manifest.delegation?.audience ?? null,
      });
      if (state === 'enabled') await audit('connector.enabled');
      return { state, changes: ['connector.added', ...(state === 'enabled' ? ['connector.enabled'] : [])] };
    }
    const changes: Array<{ action: string; details?: Record<string, unknown> }> = [];
    if (row.url !== url) changes.push({ action: 'connector.url', details: { from: row.url, to: url } });
    const rekeyed = !sameSecret(row.secret, secret, id);
    if (rekeyed) changes.push({ action: 'connector.secret' });
    // The operator who runs this approves what the service serves now (D144): the row the administration page writes
    // when an offer is approved, the whole diff from what was approved, without the offer's instant.
    const approved = !sameManifest(row.manifest, manifest);
    if (approved)
      changes.push({
        action: 'connector.manifest',
        details: diffDetails(manifestDiff(isManifest(row.manifest) ? row.manifest : undefined, manifest)),
      });
    if (state !== row.state) changes.push({ action: 'connector.' + state, details: { from: row.state } });
    if (!changes.length) return { state, changes: [] as string[] };
    await updateConnector(tx, id, actor, {
      ...(row.url !== url ? { url } : {}),
      ...(rekeyed ? { secret: sealSecret(secret, secretPurpose(id)), secretChangedAt: at } : {}),
      ...(approved ? { manifest, manifestAt: at } : {}),
      ...(state !== row.state ? { state } : {}),
      // An offer is settled with what the operator approved now.
      offered: null,
      offeredAt: null,
      health,
    });
    for (const c of changes) await audit(c.action, c.details);
    return { state, changes: changes.map(c => c.action) };
  });
  // Nothing to administer: what the service serves is what is approved, so it is recorded as a check records it, after
  // the row's lock is let go.
  if (existing && !written.changes.length) await recordCheck(id, { health, served: manifest, at });
  return { manifest, existing: !!existing, ...written };
}

/**
 * Enable or disable a registered connector, as its switch on the administration page does: one audit row with the
 * state it came from, and none when it is already in that state. A remote row is enabled only with an approved manifest
 * (D144), as on the page.
 */
export async function setConnectorState(
  id: string,
  state: 'enabled' | 'disabled',
): Promise<'missing' | 'unchanged' | 'changed'> {
  requireManaged(id);
  const store = postgresConnectorStore();
  const row = await store.read(id);
  if (!row) return 'missing';
  if (state === 'enabled' && !row.bundled && !row.manifest)
    throw new Error(
      `Connector ${id} has no approved manifest. Register it with its url and --secret, which fetches and approves what the service serves, or read it in and approve it on Administration › Anslutna system.`,
    );
  if (row.state === state) return 'unchanged';
  const at = new Date().toISOString();
  await store.transaction(async tx => {
    // Written only on the row read above (DE-M5); one changed meanwhile is left as it is.
    if (!(await tx.update(id, { state }, actor, at, row.version)))
      throw new Error(`Connector ${id} was changed while this ran; run it again.`);
    await tx.writeAudit({
      actor,
      action: 'connector.' + state,
      subject: subject(id),
      at,
      details: { from: row.state },
    });
  });
  return 'changed';
}

/**
 * Remove a remote connector, as the administration page does: its open cards close, the row goes and one audit row
 * says how many cards closed, in one transaction. An id with no row removes and writes nothing; one of Clew's own
 * connectors is refused, since it can be switched off but not removed.
 */
export async function removeConnector(
  id: string,
): Promise<{ removed: false } | { removed: true; closedCards: number }> {
  requireManaged(id);
  const store = postgresConnectorStore();
  const row = await store.read(id);
  if (!row) return { removed: false };
  if (row.bundled) throw new Error(`Connector ${id} is one of Clew's own: it can be disabled, not removed.`);
  const at = new Date().toISOString();
  const closedCards = await store.transaction(async tx => {
    const closed = await tx.dismissOpenThreadsOf(id, at);
    await tx.remove(id);
    await tx.writeAudit({
      actor,
      action: 'connector.removed',
      subject: subject(id),
      at,
      details: { closedCards: closed },
    });
    return closed;
  });
  return { removed: true, closedCards };
}
