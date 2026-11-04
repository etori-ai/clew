import { describe, expect, test } from 'bun:test';
import { attentionLevel, attentionLevels, dayWord, isSnoozed, nextStockholmTime, parseSwedishTime, snoozeWhen, stockholmInstant, streamGroup, worstLevel } from '../../packages/contracts/src/index';
import { rhythmFor } from '../../apps/server/src/threads/domain';

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

describe('the stream\'s two groups (D28)', () => {
  test('nu is due today, overdue or reminded today; senare has a deadline ahead; notice has none', () => {
    expect(streamGroup({ deadline: '2026-11-04' }, '2026-11-04')).toBe('nu');
    expect(streamGroup({ deadline: '2026-11-01' }, '2026-11-04')).toBe('nu');
    expect(streamGroup({ deadline: '2026-12-24', remindedAt: '2026-11-04T09:00:00.000Z' }, '2026-11-04')).toBe('nu');
    expect(streamGroup({ deadline: '2026-11-05' }, '2026-11-04')).toBe('senare');
    expect(streamGroup({ deadline: null }, '2026-11-04')).toBe('notice');
  });
  test('the day word replaces the colour: i morgon, the weekday within six days, the date beyond', () => {
    expect(dayWord('2026-11-04', '2026-11-04')).toBe('i dag');
    expect(dayWord('2026-11-05', '2026-11-04')).toBe('i morgon');
    expect(dayWord('2026-11-06', '2026-11-04')).toBe('fre');
    expect(dayWord('2026-11-10', '2026-11-04')).toBe('tis');
    expect(dayWord('2026-11-11', '2026-11-04')).toBe('11 nov');
    expect(dayWord('2026-11-01', '2026-11-04')).toBe('i dag');
  });
  test('a snooze holds until its instant passes', () => {
    expect(isSnoozed({ snoozedUntil: '2026-11-05T05:00:00.000Z' }, '2026-11-04T07:00:00.000Z')).toBe(true);
    expect(isSnoozed({ snoozedUntil: '2026-11-05T05:00:00.000Z' }, '2026-11-05T05:00:00.000Z')).toBe(false);
    expect(isSnoozed({ snoozedUntil: null }, '2026-11-04T07:00:00.000Z')).toBe(false);
  });
});

describe('stockholm wall-clock times', () => {
  test('a wall-clock time on a date is the right instant in winter and in summer', () => {
    expect(stockholmInstant('2026-11-04', '06:00')).toBe('2026-11-04T05:00:00.000Z');
    expect(stockholmInstant('2026-07-04', '06:00')).toBe('2026-07-04T04:00:00.000Z');
  });
  test('the next occurrence is today while it is ahead, else tomorrow', () => {
    expect(nextStockholmTime('2026-11-04T04:59:00.000Z', '06:00')).toBe('2026-11-04T05:00:00.000Z');
    expect(nextStockholmTime('2026-11-04T05:00:00.000Z', '06:00')).toBe('2026-11-05T05:00:00.000Z');
    expect(nextStockholmTime('2026-11-04T07:00:00.000Z', '12:00')).toBe('2026-11-04T11:00:00.000Z');
  });
});

describe('the day as one track (D28)', () => {
  test('points are in time order with the interruptions in between, done up to now and one next', () => {
    const rhythm = rhythmFor('2026-11-04T08:12:00.000Z', [{ at: '2026-11-04T06:55:00.000Z', title: 'Tillbudet' }]);
    expect(rhythm).toEqual([
      { kind: 'review', at: '06:00', state: 'done' },
      { kind: 'interruption', at: '07:55', state: 'done', title: 'Tillbudet' },
      { kind: 'bundle', at: '12:00', state: 'next' },
      { kind: 'bundle', at: '16:00', state: 'later' },
      { kind: 'quiet', at: '17:00', state: 'later' },
    ]);
  });
  test('before the review nothing is done and the review is next', () => {
    expect(rhythmFor('2026-11-04T04:00:00.000Z', []).map(p => p.state)).toEqual(['next', 'later', 'later', 'later']);
  });
});

describe('the Swedish time grammar (D29)', () => {
  const now = '2026-11-04T07:00:00.000Z'; // Wednesday 08:00 in Stockholm
  const cases: Array<[string, string | null]> = [
    ['om 20 min', '2026-11-04T07:20:00.000Z'], ['om en timme', '2026-11-04T08:00:00.000Z'], ['om 2 timmar', '2026-11-04T09:00:00.000Z'], ['om tre dagar', '2026-11-07T07:00:00.000Z'],
    ['efter lunch', '2026-11-04T12:00:00.000Z'], ['i kväll', '2026-11-04T16:00:00.000Z'], ['nästa vecka', '2026-11-09T05:00:00.000Z'],
    ['i morgon', '2026-11-05T05:00:00.000Z'], ['imorgon kl 9', '2026-11-05T08:00:00.000Z'], ['i morgon kl 14.30', '2026-11-05T13:30:00.000Z'],
    ['fredag kl 9', '2026-11-06T08:00:00.000Z'], ['på måndag', '2026-11-09T05:00:00.000Z'], ['onsdag kl 10', '2026-11-04T09:00:00.000Z'], ['onsdag kl 7', '2026-11-11T06:00:00.000Z'],
    ['kl 14', '2026-11-04T13:00:00.000Z'], ['14:30', '2026-11-04T13:30:00.000Z'], ['kl 7', '2026-11-05T06:00:00.000Z'],
    ['när grisarna flyger', null], ['om noll min', null], ['kl 25', null], ['', null],
  ];
  for (const [text, expected] of cases) test(`"${text}" → ${expected ?? 'nothing'}`, () => { expect(parseSwedishTime(text, now)).toBe(expected); });
  test('the words for when a card comes back', () => {
    expect(snoozeWhen('2026-11-04T12:00:00.000Z', now)).toBe('kl 13:00');
    expect(snoozeWhen('2026-11-05T05:00:00.000Z', now)).toBe('i morgon 06:00');
    expect(snoozeWhen('2026-11-06T08:00:00.000Z', now)).toBe('fre 09:00');
    expect(snoozeWhen('2026-11-20T08:00:00.000Z', now)).toBe('20 nov 09:00');
  });
});
