/**
 * The development chain (D61): registers the fixture connectors that `.devcontainer/compose.yaml` runs beside Clew,
 * enabling each except the ones `FIXTURES` marks `enable: false` (added as drafts), binds their followers of `hr:absence` (D55), and opens the
 * development organisation's round of talks when it has none (D96, `talk-round.ts`), seeds its competence catalogue and holdings where they are missing (D108, `competence-seed.ts`) and loads the follow-up dialogue's example areas when it has none (D118, `dialogue-areas.ts`), idempotently. Runs inside the app container, where the
 * services are reachable by name, after `bun run auth:setup`: that creates the key the secrets are sealed with and the
 * people the holdings are for. `bun run dev:connectors` again fills missing registrations. Existing configuration is preserved; refresh manifests explicitly in administration. The transport secret is the one compose gives the services, CLEW_DEV_CONNECTOR_SECRET.
 * Last it makes the administrator's choice for Personal (D97) that the canvas draws, while nobody has chosen any:
 * `ENTITY_CHOICE`, through the same use case as Administration › Anslutna system. When it first adds the Qlik connector it
 * switches off the figures that connector replaces on Hem (`FIGURES_OFF`), by the same use case.
 *
 *   bun scripts/dev-connectors.ts [--within PT3M] [--host <name or address, default: the service names>]
 */
import { requireFixtureDevelopment } from './fixture-development';
import { assertFixtureCutover } from './fixture-maintenance';
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import type { AuthenticatedContext } from '@clew/contracts';
import { registerConnector, listConnectors } from './connector-registry';
import { bindFixtureFollowers, describeBinding } from './job-bindings';
import { DEVELOPMENT_ROUND, openTalkRound } from './talk-round';
import { bundledIds, internalIds, offAtFirstBoot, registry } from '../apps/server/src/connectors/registry';
import { postgresConnectorStore, postgresGroups, postgresUnits } from '../apps/server/src/connectors/adapters/postgres';
import { connectorUsecases } from '../apps/server/src/connectors/usecases/admin';
import { syncBundledRows } from '../apps/server/src/connectors/reconcile';
import { secretPurpose } from '../apps/server/src/connectors/remote';
import { openSecret, sealSecret } from '../apps/server/src/auth-crypto';
import { fetchManifest } from '../packages/connectors/src/remote';
import { seedCompetence } from './competence-seed';
import { EXAMPLE_AREAS, loadDialogueAreas } from './dialogue-areas';

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
  // The Qlik connector on its made-up statistics (D82): sick leave, economy and HME per unit for every manager, the key
  // figures of the follow-up dialogue (docs/reviews/2026-11-12-absorbing-big-boss-board-into-clew.md).
  ['qlik', 4048],
  // The intranet (D88): the connector that gives Clew its shared header.
  ['intranet', 4049],
  // The appraisal system (D96 item 9): Clew's built-in talks module answers while it is enabled, so this one is
  // registered for an administrator to switch to on Anslutna system, never enabled here.
  ['appraisals', 4051, { enable: false }],
];
/**
 * When the Qlik connector is first added, the figures it replaces on Hem are switched off, as an administrator would with
 * "Visa nyckeltalet" (D54 item 4): the HR fixture's sick leave and the finance fixture's spent frame. Their areas, views
 * and cards stay. Made once, so a later choice on Anslutna system is kept.
 */
export const FIGURES_OFF: Array<{ connector: string; area: string }> = [
  { connector: 'hr', area: 'employees' },
  { connector: 'finance', area: 'budget' },
];
/**
 * Personal as the canvas draws it (D97, artboard A2): absence and the round of talks under "Visa", and their presence
 * and next talk as the two columns on "Alla", in this order. An administrator's choice, made here for the development
 * stack only while no lens or column is chosen anywhere, so a later choice on Anslutna system is kept.
 */
export const ENTITY_CHOICE: Array<{ connector: string; capability: string; column: string }> = [
  { connector: 'hr', capability: 'hr.person', column: 'presence' },
  { connector: 'talks', capability: 'talks.person', column: 'next' },
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

/**
 * Make `ENTITY_CHOICE` with the connector administration's own use case (`connectorUsecases.update`), as the bootstrap
 * operator: the same checks (an about read with a table or list view, the field in it, at most three columns), one audit
 * row per change. The live registry here is this process's; the BFF picks the rows up as it watches them.
 */
/** The connector administration's own use cases (`connectorUsecases`), as the bootstrap operator. */
function administration() {
  const store = postgresConnectorStore();
  const secrets = {
    seal: (value: string, id: string) => sealSecret(value, secretPurpose(id)),
    open: (sealed: string, id: string) => openSecret(sealed, secretPurpose(id)),
  };
  const live = { register: () => undefined, unregister: () => undefined };
  const clock = () => new Date();
  const admin = connectorUsecases({
    internal: internalIds,
    store,
    registry,
    secrets,
    live,
    units: postgresUnits(),
    groups: postgresGroups(),
    clock,
    transport: {
      fetchManifest: (url, id) => fetchManifest(url, id),
      check: () => Promise.reject(new Error('The development choice runs no connection check.')),
    },
  });
  const operator: AuthenticatedContext = {
    id: 'bootstrap',
    name: 'Utvecklingsmiljön',
    unitId: '',
    unitLabel: '',
    role: 'employee',
    organisationId: DEVELOPMENT_ROUND.organisationId,
    principal: { id: 'bootstrap:connector', kind: 'person' },
    capabilities: ['admin.connectors'],
    authorizationVersion: 'bootstrap',
    sessionBinding: 'bootstrap:connector',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    authorize: async () => ({ version: 'bootstrap' }),
  };
  return { store, secrets, live, clock, admin, operator };
}

async function chooseForPersonal() {
  const { store, secrets, live, clock, admin, operator } = administration();
  // The built-in talks connector's row and its described capabilities, as the BFF writes them at boot.
  await syncBundledRows({
    registry,
    store,
    secrets,
    live,
    bundled: bundledIds,
    internal: internalIds,
    offAtFirstBoot,
    clock,
  });
  const rows = await store.list();
  if (rows.some(r => Object.values(r.capabilities).some(c => c.lens || c.column))) {
    console.log('entities       kept the lenses and columns an administrator chose');
    return;
  }
  const stale = ENTITY_CHOICE.filter(c => {
    const manifest = rows.find(r => r.id === c.connector)?.manifest as { capabilities?: Array<{ name: string }> };
    return !manifest?.capabilities?.some(x => x.name === c.capability);
  });
  if (stale.length) {
    console.log(
      `entities       not chosen: ${stale.map(c => c.capability).join(', ')} not in the stored manifest; refresh it on Anslutna system and run this again`,
    );
    return;
  }
  for (const c of ENTITY_CHOICE)
    await admin.update(operator, c.connector, {
      lens: { [c.capability]: true },
      column: { [c.capability]: c.column },
    });
  console.log(
    `entities       chose for Personal: lenses ${ENTITY_CHOICE.map(c => c.capability).join(', ')}; columns ${ENTITY_CHOICE.map(c => `${c.capability} ${c.column}`).join(', ')}`,
  );
}

/** `FIGURES_OFF`, through the same use case as the switch "Visa nyckeltalet": one audit row per area. */
async function switchOffReplacedFigures() {
  const { admin, operator } = administration();
  const known = new Set((await listConnectors()).map(row => row.id));
  const off = FIGURES_OFF.filter(f => known.has(f.connector));
  for (const f of off) await admin.update(operator, f.connector, { figures: { [f.area]: false } });
  console.log(`figures        switched off on Hem: ${off.map(f => `${f.connector} ${f.area}`).join(', ') || 'none'}`);
}

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
  let qlikAdded = false;
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
    if (id === 'qlik' && !existing) qlikAdded = true;
  }
  if (qlikAdded) await switchOffReplacedFigures();
  for (const result of await bindFixtureFollowers(option('within') ?? 'PT3M', true))
    console.log(describeBinding(result));
  // The built-in talks module's round (D96 item 1), opened only when the development organisation has none.
  const round = await openTalkRound(DEVELOPMENT_ROUND, { ifNone: true });
  console.log(
    round.kept
      ? `talks          kept the open round ${round.kept} of organisation "${DEVELOPMENT_ROUND.organisationId}"`
      : `talks          opened round ${round.opened} for organisation "${DEVELOPMENT_ROUND.organisationId}" (${DEVELOPMENT_ROUND.opensOn} to ${DEVELOPMENT_ROUND.dueOn})`,
  );
  // The competence module's catalogue, holdings and requirements (D108): the types the development organisation lacks,
  // holdings for the people who have none, and the requirements and share target it does not have yet. The module
  // itself stays off until an administrator switches it on (item 13).
  const seeded = await seedCompetence(DEVELOPMENT_ROUND.organisationId);
  console.log(
    `competence     seeded ${seeded.types} new types, ${seeded.holdings} holdings for ${seeded.people} people, ${seeded.requirements} requirements and ${seeded.targets} share targets of organisation "${DEVELOPMENT_ROUND.organisationId}"${seeded.registrar ? ', registrar group mapped' : ''}`,
  );
  // The follow-up dialogue's areas and questions (D118 item 3): the example file, only when the organisation has none.
  const areas = await loadDialogueAreas(EXAMPLE_AREAS, DEVELOPMENT_ROUND.organisationId, { ifNone: true });
  console.log(
    areas.kept
      ? `dialogue       kept the dialogue areas of organisation "${DEVELOPMENT_ROUND.organisationId}"`
      : `dialogue       loaded ${areas.areas} areas and ${areas.questions} questions for organisation "${DEVELOPMENT_ROUND.organisationId}"`,
  );
  await chooseForPersonal();
} finally {
  await closeDatabase();
}
