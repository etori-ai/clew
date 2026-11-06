/**
 * Register a connector in the database (D23) from the command line, as an alternative to administration. Runs inside the app
 * container with the server's local settings (MASTER_KEY, DATABASE_URL). The work is `connector-registry.ts`, shared with
 * the development chain's `dev-connectors.ts`.
 *
 *   bun scripts/connector-add.ts <id> <url> --secret <shared secret> [--enable]      add or update
 *   bun scripts/connector-add.ts <id> --enable | --disable | --remove                 change state
 *   bun scripts/connector-add.ts --list
 */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { listConnectors, registerConnector, removeConnector, setConnectorState } from './connector-registry';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const args = process.argv.slice(2);
const flag = (name: string) => args.includes('--' + name);
const option = (name: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--secret'));
const [id, url] = positional;
try {
  if (flag('list')) {
    for (const row of await listConnectors())
      console.log(
        `${row.id.padEnd(16)} ${row.state.padEnd(9)} ${row.health.status.padEnd(17)} ${row.bundled ? '(inbyggd)' : row.url}`,
      );
  } else if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
    console.error(
      'Usage: bun scripts/connector-add.ts <id> <url> --secret <secret> [--enable] | <id> --enable|--disable|--remove | --list',
    );
    process.exit(2);
  } else if (flag('remove')) {
    await removeConnector(id);
    console.log(`Connector "${id}" removed.`);
  } else if (url) {
    const secret = option('secret');
    if (!secret || secret.length < 16) {
      console.error('--secret must be 16 characters or more.');
      process.exit(2);
    }
    const { manifest, existing, state } = await registerConnector({ id, url, secret, enable: flag('enable') });
    console.log(
      `Connector "${id}" (${manifest.source}) ${existing ? 'updated' : 'added'} as ${state}: ${manifest.capabilities.length} capabilities, ${manifest.areas.length} areas.`,
    );
  } else if (flag('enable') || flag('disable')) {
    const state = flag('enable') ? ('enabled' as const) : ('disabled' as const);
    const ok = await setConnectorState(id, state);
    console.log(ok ? `Connector "${id}" ${state}.` : `Connector "${id}" does not exist.`);
  } else {
    console.error('Nothing to do: give a url with --secret, or --enable, --disable, --remove.');
    process.exit(2);
  }
} finally {
  await closeDatabase();
}
