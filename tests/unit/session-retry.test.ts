import { describe, expect, test } from 'bun:test';
import { retryDelay } from '../../packages/ui/src/session';

/**
 * How long the browser waits before asking Clew again after it could not be reached (M1 and M2 of the web review of
 * 2026-11-23, D46: a transient failure allows reconnection): two seconds, doubling to half a minute, each spread by a
 * quarter either way so the tabs of a whole organisation do not all ask in the same second after a restart.
 */
describe('the wait before asking Clew again', () => {
  test('doubles from two seconds to half a minute and stays there', () => {
    const middle = () => 0.5;
    expect([0, 1, 2, 3, 4, 5, 9].map(n => retryDelay(n, middle))).toEqual([
      2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });
  test('is spread by a quarter either way', () => {
    expect(retryDelay(0, () => 0)).toBe(1_500);
    expect(retryDelay(0, () => 0.999_999)).toBe(2_500);
    expect(retryDelay(9, () => 0)).toBe(22_500);
    expect(retryDelay(-1, () => 0.5)).toBe(2_000);
  });
});
