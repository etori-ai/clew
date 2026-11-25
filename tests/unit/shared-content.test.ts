import { expect, test } from 'bun:test';
import { changeSignals, sharedCounterOf } from '../../packages/db/src/schema';
import { CAPABILITIES } from '../../packages/contracts/src/index';
import { SHARED_CONTENT, SHARED_COUNTERS, counterSequence } from '../../apps/server/src/shared-content';

/**
 * The installation-wide counters the change signals move (`changeSignals`, D46) are the counters the change stream folds
 * into a revision (`SHARED_CONTENT`), and no other: a counter named in a trigger and folded in by nobody, or the other
 * way round, is a change nobody hears of. `tests/db/postgres-changes.test.ts` holds the database to both.
 */
test('the counters the change signals move are the counters the stream folds in, each once, under a capability Clew has', () => {
  const moved = new Set(changeSignals.flatMap(s => sharedCounterOf(s) ?? []));
  expect([...moved].sort()).toEqual([...SHARED_COUNTERS].sort());
  expect(new Set(SHARED_COUNTERS).size).toBe(SHARED_COUNTERS.length);
  for (const c of SHARED_CONTENT)
    if ('capability' in c) expect(CAPABILITIES as readonly string[]).toContain(c.capability);
  // Each has a sequence of its own, named as the trigger function names it.
  expect(new Set(SHARED_COUNTERS.map(counterSequence)).size).toBe(SHARED_COUNTERS.length);
  expect(counterSequence('competence-catalogue')).toBe('content_change_competence_catalogue');
});
