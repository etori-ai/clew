import { describe, expect, test } from 'bun:test';
import { judge, LANES, runScenario, scenarios } from '../assistant-scenarios';

/**
 * The golden set of the question box without a model (D8): every scenario in `tests/assistant-scenarios.ts`, answered
 * by the router alone and by the router standing in for a model that fails. These paths are deterministic, so they gate
 * here; `evals/run.ts` draws the same scenarios as a matrix.
 */
for (const lane of LANES)
  describe(`the assistant's flows, ${lane === 'router' ? 'without a model' : 'with a model that fails'}`, () => {
    for (const scenario of scenarios)
      test(`${scenario.id}: ${scenario.flow}`, async () => {
        expect(judge(scenario, await runScenario(scenario, lane))).toEqual([]);
      });
  });
