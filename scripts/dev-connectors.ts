/**
 * The development chain (D61): registers and enables the six fixture connectors that `.devcontainer/compose.yaml` runs
 * beside Clew, and binds their followers of `hr:absence` (D55), idempotently. Runs inside the app container, where the
 * services are reachable by name; `postCreateCommand` runs it after the migrations, and `bun run dev:connectors` runs it
 * again whenever a manifest changed. The transport secret is the one compose gives the services, CLEW_DEV_CONNECTOR_SECRET.
 *
 *   bun scripts/dev-connectors.ts [--within PT3M] [--host <name or address, default: the service names>]
 */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { registerConnector } from './connector-registry';
import { bindFixtureFollowers, describeBinding } from './job-bindings';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
export const FIXTURES: Array<[id: string, port: number]> = [
  ['hr', 4040],
  ['finance', 4041],
  ['incidents', 4042],
  ['communication', 4043],
  ['timesheet', 4044],
  ['payroll', 4045],
];
const secret = process.env.CLEW_DEV_CONNECTOR_SECRET;
if (!secret) {
  console.error(
    'CLEW_DEV_CONNECTOR_SECRET is not set: the development stack sets it on the app container and the fixture services.',
  );
  process.exit(2);
}
const host = option('host');
const urlOf = (id: string, port: number) => `http://${host ?? id}:${port}`;

/** A service may still be starting when this runs right after the stack came up. */
async function waitForManifest(url: string, seconds = 60) {
  const deadline = Date.now() + seconds * 1000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url + '/clew/manifest', { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
      last = `answered ${response.status}`;
    } catch (error) {
      last = (error as Error).message;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`${url} did not serve a manifest within ${seconds} s (${last}). Is the development stack up?`);
}

try {
  for (const [id, port] of FIXTURES) {
    const url = urlOf(id, port);
    await waitForManifest(url);
    const { manifest, existing, state } = await registerConnector({ id, url, secret, enable: true });
    console.log(
      `${id.padEnd(14)} ${existing ? 'updated' : 'added'} as ${state}: ${manifest.source}, ${manifest.capabilities.length} capabilities, ${manifest.areas.length} areas`,
    );
  }
  for (const result of await bindFixtureFollowers(option('within') ?? 'PT3M')) console.log(describeBinding(result));
} finally {
  await closeDatabase();
}
