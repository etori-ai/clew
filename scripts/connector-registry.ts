/**
 * Registering a connector from a script (D23): what `connector-add.ts` does from the command line and `dev-connectors.ts`
 * does for the development chain, in one place. Fetches the manifest, runs the loader's validation, seals the secret and
 * writes the row and its audit row in one transaction. The BFF registers enabled rows at boot and watches the rows every
 * few seconds, so a change here reaches it without a restart.
 */
import { database } from '@clew/db';
import { writeAudit } from '@clew/db/threads';
import { deleteConnector, insertConnector, listConnectors, readConnector, updateConnector } from '@clew/db/connectors';
import { fetchManifest, parseManifest } from '../packages/connectors/src/remote';
import { sealSecret } from '../apps/server/src/auth-crypto';
import { secretPurpose } from '../apps/server/src/connectors/remote';

export { listConnectors };
const actor = 'bootstrap:connector';

/** Add a connector or update its address and secret; `enable` makes it live, otherwise it is or stays a draft. */
export async function registerConnector(options: {
  id: string;
  url: string;
  secret: string;
  enable?: boolean;
  ifMissing?: boolean;
}) {
  const { id, secret } = options;
  const url = options.url.replace(/\/+$/, '');
  if (!/^[a-z][a-z0-9-]*$/.test(id))
    throw new Error(`Invalid connector id ${id}: lowercase letters, digits and hyphens.`);
  if (secret.length < 16) throw new Error('The transport secret must be 16 characters or more.');
  const existing = await readConnector(id);
  if (existing?.bundled)
    throw new Error('Connector ' + id + ' is still bundled. Complete the fixture cutover before registration.');
  if (existing && options.ifMissing) {
    if (!existing.manifest) throw new Error('Existing connector ' + id + ' has no manifest; refresh it explicitly.');
    return { manifest: parseManifest(existing.manifest, id), existing: true, state: existing.state };
  }
  const manifest = await fetchManifest(url, id);
  const sealed = sealSecret(secret, secretPurpose(id));
  const state = options.enable ? ('enabled' as const) : ('draft' as const);
  await database().transaction(async tx => {
    if (existing)
      await updateConnector(tx, id, actor, {
        url,
        secret: sealed,
        secretChangedAt: new Date(),
        state,
        manifest,
        manifestAt: new Date(),
        health: { status: 'ok', at: new Date().toISOString() },
      });
    else
      await insertConnector(tx, {
        id,
        url,
        secret: sealed,
        createdBy: actor,
        state,
        manifest,
        health: { status: 'ok', at: new Date().toISOString() },
      });
    await writeAudit(tx, {
      actor,
      action: existing ? 'connector.secret' : 'connector.added',
      subject: 'connector:' + id,
      details: { url, source: manifest.source, capabilities: manifest.capabilities.length },
    });
    if (state === 'enabled') await writeAudit(tx, { actor, action: 'connector.enabled', subject: 'connector:' + id });
  });
  return { manifest, existing: !!existing, state };
}

/** Enable or disable a registered connector. Answers false when there is no such row. */
export async function setConnectorState(id: string, state: 'enabled' | 'disabled') {
  return database().transaction(async tx => {
    const done = await updateConnector(tx, id, actor, { state });
    if (done) await writeAudit(tx, { actor, action: 'connector.' + state, subject: 'connector:' + id });
    return done;
  });
}

export async function removeConnector(id: string) {
  await database().transaction(async tx => {
    await deleteConnector(tx, id);
    await writeAudit(tx, { actor, action: 'connector.removed', subject: 'connector:' + id });
  });
}
