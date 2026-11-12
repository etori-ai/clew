import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import {
  AS_NEEDS_ID,
  AS_NEEDS_USER,
  CHECKED_AS,
  OPERATOR,
  asProblem,
  checkAs,
  type CheckAsDeps,
} from '../../scripts/connector-check-as';

/**
 * `connector-check --as` (review 2026-11-12, R2; Q13): signing as a real person needs the registered connector `--id`
 * names, and leaves one audit row before the first signed request. The database side is the script's; here the rule
 * runs on a memory stand-in, and the script itself is run to show it refuses before anything is fetched or signed.
 */
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
function memory(registered: string[], people: Record<string, AuthenticatedContext>) {
  const steps: string[] = [];
  const rows: Parameters<CheckAsDeps['audit']>[0][] = [];
  const deps: CheckAsDeps = {
    registered: async id => {
      steps.push('registered');
      return registered.includes(id);
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

describe('before the first signed request', () => {
  test('one audit row about the person, by the operator, with counts only, and then the person', async () => {
    const m = memory(['hr'], { anna });
    expect(await checkAs({ id: 'hr', userName: 'Anna', keys: 3, reads: 2 }, m.deps)).toBe(anna);
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
    const unregistered = memory([], { anna });
    await expect(checkAs({ id: 'hr', userName: 'anna', keys: 0, reads: 1 }, unregistered.deps)).rejects.toThrow(
      '--id hr: no connector with that id is registered in this installation; register it first (bun scripts/connector-add.ts).',
    );
    expect(unregistered.steps).toEqual(['registered']);
    const nobody = memory(['hr'], { anna });
    await expect(checkAs({ id: 'hr', userName: 'nils', keys: 0, reads: 1 }, nobody.deps)).rejects.toThrow(
      '--as nils: no person with that user name and a grant in this installation.',
    );
    expect(nobody.rows).toEqual([]);
  });
  test('a failed audit row refuses the check: nothing is signed without the trace', async () => {
    const m = memory(['hr'], { anna });
    m.deps.audit = async () => {
      throw new Error('database unavailable');
    };
    await expect(checkAs({ id: 'hr', userName: 'anna', keys: 1, reads: 1 }, m.deps)).rejects.toThrow(
      'database unavailable',
    );
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
