import { describe, expect, test } from 'bun:test';
import { attentionLevel, attentionLevels, worstLevel } from '../../packages/contracts/src/index';

describe('attention level', () => {
  test('a reminder today sorts first, a reminder yesterday does not count', () => {
    expect(attentionLevel({ deadline: '2026-12-24', remindedAt: '2026-11-04T09:00:00.000Z' }, '2026-11-04')).toBe('now');
    expect(attentionLevel({ deadline: null, remindedAt: '2026-11-03T22:59:00.000Z' }, '2026-11-04')).toBe('notice');
    expect(attentionLevel({ deadline: '2026-11-05', remindedAt: null }, '2026-11-04')).toBe('urgent');
  });
  test('stockholm midnight decides the day', () => {
    expect(attentionLevel({ deadline: null, remindedAt: '2026-11-03T23:30:00.000Z' }, '2026-11-04')).toBe('now');
  });
  test('now is the worst level', () => {
    expect(attentionLevels[0]).toBe('now');
    expect(worstLevel(['notice', 'now', 'urgent'])).toBe('now');
  });
});
