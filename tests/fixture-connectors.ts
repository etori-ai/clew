import type { Connector } from '../packages/connectors/src/index';
import { parseManifest, remoteConnector, type FetchLike } from '../packages/connectors/src/remote';
import { assertionFor, testJwks } from './connector-authority';
import { createConnector as createHr, manifest as hrManifest } from '../connectors/hr/connector.mjs';
import { memoryState as hrState } from '../connectors/hr/state.mjs';
import { createConnector as createFinance, manifest as financeManifest } from '../connectors/finance/connector.mjs';
import { memoryState as financeState } from '../connectors/finance/state.mjs';
import {
  createConnector as createIncidents,
  manifest as incidentsManifest,
} from '../connectors/incidents/connector.mjs';
import { memoryState as incidentsState } from '../connectors/incidents/state.mjs';
import {
  createConnector as createCommunication,
  manifest as communicationManifest,
} from '../connectors/communication/connector.mjs';
import { memoryState as communicationState } from '../connectors/communication/state.mjs';
import {
  createConnector as createTimesheet,
  manifest as timesheetManifest,
} from '../connectors/timesheet/connector.mjs';
import { memoryState as timesheetState } from '../connectors/timesheet/state.mjs';
import {
  createConnector as createPayroll,
  httpFeed,
  manifest as payrollManifest,
} from '../connectors/payroll/connector.mjs';
import type { FixtureState } from '../connectors/hr/state.mjs';

/**
 * The six fixture connectors of the development stack (D61), run in-process over the protocol for the unit suites: each
 * service on its memory store behind an ephemeral RS256 authority, reached through `remoteConnector` exactly as the BFF
 * reaches the containers. What the suites use as the HR, economy, deviation, communication, time and payroll systems of
 * their scenarios is what ships in `connectors/`; nothing here is a copy of them.
 */
export const FIXTURE_SECRET = 'test-secret-test-secret';
export const FIXTURE_IDS = ['hr', 'finance', 'incidents', 'communication', 'timesheet', 'payroll'] as const;
export type FixtureId = (typeof FIXTURE_IDS)[number];
type Service = { manifest: unknown; handle(request: Request): Promise<Response> };
export interface FixtureOptions {
  /** The connectors to build; all six by default. */
  only?: readonly FixtureId[];
  /** The sources' clock: the records are seeded relative to its first reading. */
  clock?: () => Date;
  /** A fault switch per connector, as FIXTURE_FAULT sets it on a service. */
  fault?: Partial<Record<FixtureId, string>>;
  unitMap?: Record<string, string>;
  personMap?: Record<string, string>;
}
export interface Fixtures {
  connectors: Connector[];
  services: Partial<Record<FixtureId, Service>>;
  states: Partial<Record<FixtureId, FixtureState>>;
  fetches: Partial<Record<FixtureId, FetchLike>>;
}

export function fixtureConnectors(options: FixtureOptions = {}): Fixtures {
  const wanted = new Set<FixtureId>(options.only ?? FIXTURE_IDS);
  const clock = options.clock ?? (() => new Date());
  const common = (id: FixtureId) => ({
    jwks: testJwks,
    secret: FIXTURE_SECRET,
    clock,
    fault: options.fault?.[id] ?? '',
    unitMap: options.unitMap ?? {},
    personMap: options.personMap ?? {},
  });
  const states: Fixtures['states'] = {};
  const services: Fixtures['services'] = {};
  const fetches: Fixtures['fetches'] = {};
  const connectors: Connector[] = [];
  const add = (id: FixtureId, service: Service, manifest: unknown) => {
    const fetch: FetchLike = (input, init) => service.handle(new Request(input, init));
    services[id] = service;
    fetches[id] = fetch;
    connectors.push(
      remoteConnector(parseManifest(manifest, id), {
        url: 'http://' + id,
        key: FIXTURE_SECRET,
        assert: assertionFor(id, FIXTURE_SECRET),
        fetch,
      }),
    );
  };
  // Payroll imports from the HR fixture's feed, so hr is built whenever payroll is, feed key and all.
  const feedKey = 'test-feed-key';
  if (wanted.has('hr') || wanted.has('payroll')) {
    const state = hrState();
    states.hr = state;
    const service = createHr({ ...common('hr'), state, feedKey });
    if (wanted.has('hr')) add('hr', service, hrManifest);
    else services.hr = service;
  }
  if (wanted.has('finance')) {
    const state = financeState();
    states.finance = state;
    add('finance', createFinance({ ...common('finance'), state }), financeManifest);
  }
  if (wanted.has('incidents')) {
    const state = incidentsState();
    states.incidents = state;
    add('incidents', createIncidents({ ...common('incidents'), state }), incidentsManifest);
  }
  if (wanted.has('communication')) {
    const state = communicationState();
    states.communication = state;
    add('communication', createCommunication({ ...common('communication'), state }), communicationManifest);
  }
  if (wanted.has('timesheet')) {
    const state = timesheetState();
    states.timesheet = state;
    add('timesheet', createTimesheet({ ...common('timesheet'), state }), timesheetManifest);
  }
  if (wanted.has('payroll')) {
    const hr = services.hr!;
    const feed = httpFeed({
      url: 'http://hr/fixture/absences',
      key: feedKey,
      fetch: (input, init) => hr.handle(new Request(input, init)),
    });
    const { unitMap, ...rest } = common('payroll');
    add('payroll', createPayroll({ ...rest, unitMap, feed }), payrollManifest);
  }
  return { connectors, services, states, fetches };
}
