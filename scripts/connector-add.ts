/**
 * Register a connector in the database (D23) from the command line, until the admin page exists. Runs inside the app
 * container with the server's local settings (MASTER_KEY, DATABASE_URL). Fetches the manifest, runs the same validation
 * the loader does, seals the secret and writes the row and its audit row in one transaction. The BFF registers enabled
 * rows at boot; restart it (or wait for the admin page) after enabling.
 *
 *   bun scripts/connector-add.ts <id> <url> --secret <shared secret> [--enable]      add or update
 *   bun scripts/connector-add.ts <id> --enable | --disable | --remove                 change state
 *   bun scripts/connector-add.ts --list
 */
import { resolve } from 'node:path';
import { database, closeDatabase } from '@clew/db';
import { writeAudit } from '@clew/db/threads';
import { deleteConnector, insertConnector, listConnectors, readConnector, updateConnector } from '@clew/db/connectors';
import { fetchManifest } from '../packages/connectors/src/remote';
import { sealSecret } from '../apps/server/src/auth-crypto';
import { secretPurpose } from '../apps/server/src/connectors/remote';

try { process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local')); } catch { /* settings may come from the environment */ }
const args = process.argv.slice(2);
const flag = (name: string) => args.includes('--' + name);
const option = (name: string) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--secret'));
const [id, url] = positional;
const actor = 'bootstrap:connector';
try {
  if (flag('list')) {
    for (const row of await listConnectors()) console.log(`${row.id.padEnd(16)} ${row.state.padEnd(9)} ${row.health.status.padEnd(17)} ${row.url}`);
  } else if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
    console.error('Usage: bun scripts/connector-add.ts <id> <url> --secret <secret> [--enable] | <id> --enable|--disable|--remove | --list'); process.exit(2);
  } else if (flag('remove')) {
    await database().transaction(async tx => { await deleteConnector(tx, id); await writeAudit(tx, { actor, action: 'connector.removed', subject: 'connector:' + id }); });
    console.log(`Connector "${id}" removed.`);
  } else if (url) {
    const secret = option('secret');
    if (!secret || secret.length < 16) { console.error('--secret must be 16 characters or more.'); process.exit(2); }
    const manifest = await fetchManifest(url.replace(/\/+$/, ''), id);
    const sealed = sealSecret(secret, secretPurpose(id));
    const state = flag('enable') ? 'enabled' as const : 'draft' as const;
    const existing = await readConnector(id);
    await database().transaction(async tx => {
      if (existing) await updateConnector(tx, id, actor, { url: url.replace(/\/+$/, ''), secret: sealed, secretChangedAt: new Date(), state, manifest, manifestAt: new Date(), health: { status: 'ok', at: new Date().toISOString() } });
      else await insertConnector(tx, { id, url: url.replace(/\/+$/, ''), secret: sealed, createdBy: actor, state, manifest, health: { status: 'ok', at: new Date().toISOString() } });
      await writeAudit(tx, { actor, action: existing ? 'connector.secret' : 'connector.added', subject: 'connector:' + id, details: { url, source: manifest.source, capabilities: manifest.capabilities.length } });
      if (state === 'enabled') await writeAudit(tx, { actor, action: 'connector.enabled', subject: 'connector:' + id });
    });
    console.log(`Connector "${id}" (${manifest.source}) ${existing ? 'updated' : 'added'} as ${state}: ${manifest.capabilities.length} capabilities, ${manifest.areas.length} areas.`);
  } else if (flag('enable') || flag('disable')) {
    const state = flag('enable') ? 'enabled' as const : 'disabled' as const;
    const ok = await database().transaction(async tx => { const done = await updateConnector(tx, id, actor, { state }); if (done) await writeAudit(tx, { actor, action: 'connector.' + state, subject: 'connector:' + id }); return done; });
    console.log(ok ? `Connector "${id}" ${state}.` : `Connector "${id}" does not exist.`);
  } else { console.error('Nothing to do: give a url with --secret, or --enable, --disable, --remove.'); process.exit(2); }
} finally { await closeDatabase(); }
