/**
 * The development chain (D61): registers the fixture connectors that `.devcontainer/compose.yaml` runs beside Clew,
 * enabling each except the ones `FIXTURES` marks `enable: false` (added as drafts), binds their followers of `hr:absence` (D55), and opens the
 * development organisation's round of talks when it has none (D96, `talk-round.ts`), idempotently. Runs inside the app container, where the
 * services are reachable by name; `postCreateCommand` runs it after the migrations, and `bun run dev:connectors` runs it
 * again to fill missing registrations. Existing configuration is preserved; refresh manifests explicitly in administration. The transport secret is the one compose gives the services, CLEW_DEV_CONNECTOR_SECRET.
 *
 *   bun scripts/dev-connectors.ts [--within PT3M] [--host <name or address, default: the service names>]
 */
import { requireFixtureDevelopment } from './fixture-development';
import { assertFixtureCutover } from './fixture-maintenance';
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { registerConnector, listConnectors } from './connector-registry';
import { bindFixtureFollowers, describeBinding } from './job-bindings';
import { DEVELOPMENT_ROUND, openTalkRound } from './talk-round';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
requireFixtureDevelopment();
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
/** A fixture is enabled when it is added, unless it says `{ enable: false }`: then it is added as a draft. */
export const FIXTURES: Array<[id: string, port: number, options?: { enable: boolean }]> = [
  ['hr', 4040],
  ['finance', 4041],
  ['incidents', 4042],
  ['communication', 4043],
  ['timesheet', 4044],
  ['payroll', 4046],
  // The intranet (D88): the connector that gives Clew its shared header.
  ['intranet', 4049],
  // The appraisal system (D96 item 9): Clew's built-in talks module answers while it is enabled, so this one is
  // registered for an administrator to switch to on Anslutna system, never enabled here.
  ['appraisals', 4051, { enable: false }],
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
  await assertFixtureCutover();
  const existingIds = new Set((await listConnectors()).map(row => row.id));
  for (const [id, port, options] of FIXTURES) {
    const url = urlOf(id, port);
    if (!existingIds.has(id)) await waitForManifest(url);
    const { manifest, existing, state } = await registerConnector({
      id,
      url,
      secret,
      enable: options?.enable ?? true,
      ifMissing: true,
    });
    console.log(
      `${id.padEnd(14)} ${existing ? 'kept' : 'added'} as ${state}: ${manifest.source}, ${manifest.capabilities.length} capabilities, ${manifest.areas.length} areas`,
    );
  }
  for (const result of await bindFixtureFollowers(option('within') ?? 'PT3M', true))
    console.log(describeBinding(result));
  // The built-in talks module's round (D96 item 1), opened only when the development organisation has none.
  const round = await openTalkRound(DEVELOPMENT_ROUND, { ifNone: true });
  console.log(
    round.kept
      ? `talks          kept the open round ${round.kept} of organisation "${DEVELOPMENT_ROUND.organisationId}"`
      : `talks          opened round ${round.opened} for organisation "${DEVELOPMENT_ROUND.organisationId}" (${DEVELOPMENT_ROUND.opensOn} to ${DEVELOPMENT_ROUND.dueOn})`,
  );
} finally {
  await closeDatabase();
}
