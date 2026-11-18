import { describe, expect, test } from 'bun:test';
import { runScenario, scenarios, type Trajectory } from '../assistant-scenarios';
import { tally, type KeptRun } from '../../scripts/model-matrix-report';
import { verdict, type PublishedFlow, type PublishedModel } from '../../scripts/model-results';

/**
 * What the model matrix (`scripts/model-matrix.ts`) works out from the runs it keeps: the cells are tallied from kept
 * trajectories by today's `judge`, so a kept run can be judged again without a model, and a flow that holds with no
 * model at all is not counted for one.
 */
const budget = scenarios.find(s => s.id === 'figure-budget')!;
const kept = async (): Promise<KeptRun> => ({
  column: 'clew:router',
  scenario: budget.id,
  ms: 40,
  // As it is read back from the file: nothing of a trajectory is lost in JSON.
  trajectory: JSON.parse(JSON.stringify(await runScenario(budget, 'router'))) as Trajectory,
});

describe('the cells of the model matrix', () => {
  test('a kept run is judged from its trajectory, as it would be when it ran', async () => {
    const cell = tally([await kept(), await kept()], scenarios).get('figure-budget|clew:router')!;
    expect({ runs: cell.runs, passed: cell.passed, slow: cell.slow, ms: cell.ms }).toEqual({
      runs: 2,
      passed: 2,
      slow: 0,
      ms: 80,
    });
    expect([...cell.dimensions]).toEqual([
      ['path', 2],
      ['outcome', 2],
      ['reads', 2],
      ['safety', 2],
      ['audit', 2],
    ]);
    expect(cell.failures.size).toBe(0);
  });

  test('a changed expectation re-scores the kept run without running it again', async () => {
    const run = await kept();
    const stricter = scenarios.map(s =>
      s.id === budget.id ? { ...s, turns: s.turns.map(t => ({ ...t, expect: { ...t.expect, body: /^Budget:/ } })) } : s,
    );
    const cell = tally([run], stricter).get('figure-budget|clew:router')!;
    expect(cell.passed).toBe(0);
    expect(cell.dimensions.get('outcome')).toBeUndefined();
    expect(cell.dimensions.get('audit')).toBe(1);
    expect([...cell.failures.values()].map(f => f.dimension)).toEqual(['outcome']);
  });

  test('a run that threw holds nothing and says why; a run of a flow that is gone is left out', async () => {
    const cells = tally(
      [
        { column: 'model:0:m', scenario: budget.id, ms: 5, error: 'connect ECONNREFUSED' },
        { column: 'model:0:m', scenario: 'a-flow-removed-since', ms: 5, error: 'x' },
      ],
      scenarios,
    );
    expect([...cells.keys()]).toEqual(['figure-budget|model:0:m']);
    const cell = cells.get('figure-budget|model:0:m')!;
    expect({ runs: cell.runs, passed: cell.passed, held: cell.dimensions.size }).toEqual({
      runs: 1,
      passed: 0,
      held: 0,
    });
    expect([...cell.failures.values()]).toEqual([{ dimension: 'run', message: 'connect ECONNREFUSED', runs: 1 }]);
  });

  test('a turn the router took because the model ran out of time is counted as slow', async () => {
    const run = await kept();
    const turn = run.trajectory!.turns[0]!;
    turn.assistant = 'unavailable';
    turn.audit = { ...turn.audit!, assistant: 'unavailable', fallbackReason: 'The operation timed out.' };
    run.trajectory!.lane = 'model';
    const cell = tally([run], scenarios).get('figure-budget|clew:router')!;
    expect({ passed: cell.passed, slow: cell.slow }).toEqual({ passed: 0, slow: 1 });
    expect([...cell.failures.values()][0]).toMatchObject({ dimension: 'path' });
  });
});

describe('the verdict on a published model', () => {
  const flows: PublishedFlow[] = ['a', 'b', 'c'].map(id => ({
    id,
    flow: id,
    who: 'x',
    says: [],
    holdsWhen: '',
    judged: id !== 'c',
  }));
  const model = (over: Partial<PublishedModel>): PublishedModel => ({
    model: 'm',
    tools: true,
    reasoning: 'provider-default',
    ranOn: '2026-11-18',
    repeat: 3,
    msPerRun: 1,
    dimensions: {},
    flows: {
      a: { passed: 0, runs: 3, failures: [] },
      b: { passed: 3, runs: 3, failures: [] },
      c: { passed: 3, runs: 3, failures: [] },
    },
    ...over,
  });

  test('a flow that held with no model is not counted for the model', () => {
    // Only `b` held, and the control held it too: nothing the model was judged on held.
    expect(verdict(model({ heldWithoutModel: ['b'] }), flows)).toBe('falls short');
    // `a` fails for the model and held without one, so the model is judged on `b` alone.
    expect(verdict(model({ heldWithoutModel: ['a'] }), flows)).toBe('holds every flow');
    expect(verdict(model({}), flows)).toBe('falls short');
  });
});
