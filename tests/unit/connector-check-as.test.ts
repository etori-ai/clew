import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import {
  AS_NEEDS_ID,
  AS_NEEDS_USER,
  CHECKED_AS,
  OPERATOR,
  asProblem,
  audienceProblem,
  checkAs,
  type CheckAsDeps,
  type Registration,
} from '../../scripts/connector-check-as';

/**
 * `connector-check --as` (review 2026-11-12, R2; Q13): signing as a real person needs the registered connector `--id`
 * names, a remote one at the address checked, and leaves one audit row before the first signed request. The database
 * side is the script's; here the rule runs on a memory stand-in, and the script itself is run to show it refuses
 * before anything is fetched or signed.
 */
const HR = 'http://hr:4040';
const anna: AuthenticatedContext = {
  id: 'person-anna',
  name: 'Anna Lindqvist',
  unitId: 'unit-skola',
  unitLabel: 'Bergsåkers skola',
  role: 'employee',
  userName: 'anna',
  organisationId: 'poc',
  principal: { id: 'person:person-anna', kind: 'person' },
  capabilities: [],
  groups: [],
  authorizationVersion: 'v1',
  sessionBinding: 'operator:connector-check',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
};
/**
 * The installation's connector rows by id: `hr` a remote service, `calendar` one of Clew's own, as the boot writes it.
 * `people` is one of Clew's own too, internal, and has no row at all.
 */
function memory(registered: Record<string, Registration>, people: Record<string, AuthenticatedContext>) {
  const steps: string[] = [];
  const rows: Parameters<CheckAsDeps['audit']>[0][] = [];
  const deps: CheckAsDeps = {
    own: ['people'],
    registration: async id => {
      steps.push('registered');
      return registered[id];
    },
    person: async userName => {
      steps.push('person');
      return people[userName.toLowerCase()];
    },
    audit: async entry => {
      steps.push('audit');
      rows.push(entry);
    },
  };
  return { deps, steps, rows };
}

describe('the options', () => {
  test('--as needs a user name and --id; without --as nothing is asked of the options', () => {
    expect(asProblem({})).toBeUndefined();
    expect(asProblem({ id: 'hr' })).toBeUndefined();
    expect(asProblem({ as: 'anna', id: 'hr' })).toBeUndefined();
    expect(asProblem({ as: 'anna' })).toBe(AS_NEEDS_ID);
    expect(asProblem({ as: 'anna', id: '--keys' })).toBe(AS_NEEDS_ID);
    expect(asProblem({ as: '', id: 'hr' })).toBe(AS_NEEDS_USER);
    expect(asProblem({ as: '--id', id: 'hr' })).toBe(AS_NEEDS_USER);
    expect(AS_NEEDS_ID).toContain('never a real colleague');
  });
});

const installation: Record<string, Registration> = {
  hr: { bundled: false, url: HR },
  calendar: { bundled: true, url: null },
};
describe('before the first signed request', () => {
  test('one audit row about the person, by the operator, with counts only, and then the person', async () => {
    const m = memory(installation, { anna });
    // The address as registered, with or without a trailing slash.
    expect(await checkAs({ id: 'hr', url: HR + '/', userName: 'Anna', keys: 3, reads: 2 }, m.deps)).toBe(anna);
    expect(m.steps).toEqual(['registered', 'person', 'audit']);
    expect(m.rows).toEqual([
      {
        actor: OPERATOR,
        action: CHECKED_AS,
        subject: 'person:person-anna',
        details: { connector: 'hr', keys: 3, reads: 2 },
      },
    ]);
    expect(OPERATOR).toBe('operator:cli');
    expect(CHECKED_AS).toBe('connector.checked_as');
  });
  test('a connector this installation has not registered, or a user name with no person, is refused and nothing is written', async () => {
    const unregistered = memory({}, { anna });
    await expect(
      checkAs({ id: 'hr', url: HR, userName: 'anna', keys: 0, reads: 1 }, unregistered.deps),
    ).rejects.toThrow(
      '--id hr: no connector with that id is registered in this installation; register it first (bun scripts/connector-add.ts).',
    );
    expect(unregistered.steps).toEqual(['registered']);
    const nobody = memory(installation, { anna });
    await expect(checkAs({ id: 'hr', url: HR, userName: 'nils', keys: 0, reads: 1 }, nobody.deps)).rejects.toThrow(
      '--as nils: no person with that user name and a grant in this installation.',
    );
    expect(nobody.rows).toEqual([]);
  });
  test("one of Clew's own connectors, or a registered id at another address, is refused before the person is asked for", async () => {
    // A service that calls itself `calendar` would get a callback grant for a connector whose reach has no bound.
    const own = memory(installation, { anna });
    await expect(
      checkAs({ id: 'calendar', url: 'http://calendar-impostor:4099', userName: 'anna', keys: 1, reads: 1 }, own.deps),
    ).rejects.toThrow(
      "--id calendar is one of Clew's own connectors, not a registered service; pass the id the service was registered under (bun scripts/connector-add.ts).",
    );
    expect(own.steps).toEqual(['registered']);
    // A service that names a registered id at another address is not the connector registered under it.
    const elsewhere = memory(installation, { anna });
    await expect(
      checkAs({ id: 'hr', url: 'http://hr-impostor:4040', userName: 'anna', keys: 1, reads: 1 }, elsewhere.deps),
    ).rejects.toThrow(
      '--id hr is registered at http://hr:4040, not at http://hr-impostor:4040; --as checks a connector only at the address it is registered at.',
    );
    expect(elsewhere.steps).toEqual(['registered']);
    expect([...own.rows, ...elsewhere.rows]).toEqual([]);
  });
  test("one of Clew's own connectors that has no row, as `people` never has, is refused before anything is asked", async () => {
    const internal = memory(installation, { anna });
    await expect(
      checkAs({ id: 'people', url: 'http://people-impostor:4099', userName: 'anna', keys: 1, reads: 1 }, internal.deps),
    ).rejects.toThrow(
      "--id people is one of Clew's own connectors, not a registered service; pass the id the service was registered under (bun scripts/connector-add.ts).",
    );
    expect(internal.steps).toEqual([]);
    expect(internal.rows).toEqual([]);
  });
  test('a failed audit row refuses the check: nothing is signed without the trace', async () => {
    const m = memory(installation, { anna });
    m.deps.audit = async () => {
      throw new Error('database unavailable');
    };
    await expect(checkAs({ id: 'hr', url: HR, userName: 'anna', keys: 1, reads: 1 }, m.deps)).rejects.toThrow(
      'database unavailable',
    );
  });
});

describe('the audience a service names, without --as (CB-13)', () => {
  const installed = memory(installation, {}).deps;
  test('an id this installation has not registered, or a registered one at its own address, may be signed for', async () => {
    expect(await audienceProblem({ id: 'new-service', url: 'http://new:4000' }, installed)).toBeUndefined();
    expect(await audienceProblem({ id: 'hr', url: HR + '/' }, installed)).toBeUndefined();
  });
  test("a registered id at another address, or one of Clew's own, is refused", async () => {
    expect(await audienceProblem({ id: 'hr', url: 'http://hr-impostor:4040' }, installed)).toBe(
      'The service at http://hr-impostor:4040 names the id hr, which is registered at http://hr:4040; the check signs for a registered connector only at the address it is registered at.',
    );
    expect(await audienceProblem({ id: 'calendar', url: 'http://calendar-impostor:4099' }, installed)).toBe(
      "The service at http://calendar-impostor:4099 names the id calendar, one of Clew's own connectors; the check signs nothing for it.",
    );
  });
  test("one of Clew's own connectors without a row, as `people` has none, is refused as well", async () => {
    const { deps, steps } = memory(installation, {});
    expect(await audienceProblem({ id: 'people', url: 'http://people-impostor:4099' }, deps)).toBe(
      "The service at http://people-impostor:4099 names the id people, one of Clew's own connectors; the check signs nothing for it.",
    );
    expect(steps).toEqual([]);
  });
});

describe('the script', () => {
  const run = (...args: string[]) =>
    Bun.spawnSync(['bun', 'scripts/connector-check.ts', ...args], {
      cwd: new URL('../..', import.meta.url).pathname,
      stdout: 'pipe',
      stderr: 'pipe',
    });
  test('refuses --as without --id, and --as without a name, before it fetches or signs anything', () => {
    // Port 9 answers nothing: a fetch would fail with "FAIL manifest" on stdout instead of this refusal.
    const withoutId = run('http://127.0.0.1:9', '--secret', 'check-secret-check-secret', '--as', 'anna');
    expect(withoutId.exitCode).toBe(2);
    expect(withoutId.stderr.toString().trim()).toBe(AS_NEEDS_ID);
    expect(withoutId.stdout.toString()).toBe('');
    const withoutName = run('http://127.0.0.1:9', '--secret', 'check-secret-check-secret', '--id', 'hr', '--as');
    expect(withoutName.exitCode).toBe(2);
    expect(withoutName.stderr.toString().trim()).toBe(AS_NEEDS_USER);
  });
});
