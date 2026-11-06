import { describe, expect, test } from 'bun:test';
import { collides, freeGaps, planWeek, withinOfficeHours } from '../../packages/calendar/src/proposals';
import { localInstant, minutesOfDay, displayDate } from '../../packages/calendar/src/dates';

const week = '2026-11-09';
const at = (day: number, time: string) => localInstant(`2026-11-${String(9 + day).padStart(2, '0')}T${time}`);
const slot = (day: number, from: string, to: string) => ({ start: at(day, from), end: at(day, to) });

describe('planWeek', () => {
  test('draws one slot per candidate that collides with neither calendar', () => {
    const planned = planWeek({
      week,
      notBefore: at(0, '00:00'),
      managerBusy: [slot(0, '09:00', '11:00'), slot(1, '13:00', '14:00')],
      candidates: [
        { participant: { email: 'a@x', name: 'A' }, busy: [slot(0, '13:00', '15:00'), slot(1, '09:00', '12:00')] },
        { participant: { email: 'b@x', name: 'B' }, busy: [slot(1, '14:00', '16:00')] },
        { participant: { email: 'c@x', name: 'C' }, busy: [] },
        { participant: { email: 'd@x', name: 'D' }, busy: [] },
      ],
    });
    expect(planned).toHaveLength(4);
    for (const p of planned) {
      expect(withinOfficeHours(p)).toBe(true);
      expect(minutesOfDay(p.start)).toBeGreaterThanOrEqual(9 * 60);
      expect(minutesOfDay(p.end)).toBeLessThanOrEqual(16 * 60);
      expect(collides(p, [slot(0, '09:00', '11:00'), slot(1, '13:00', '14:00')])).toBe(false);
    }
    const a = planned.find(p => p.participant.email === 'a@x')!;
    expect(collides(a, [slot(0, '13:00', '15:00'), slot(1, '09:00', '12:00')])).toBe(false);
    for (const p of planned) for (const q of planned) if (p !== q) expect(collides(p, [q])).toBe(false);
    // Spread across days: four candidates, four different days.
    expect(new Set(planned.map(p => displayDate(p.start))).size).toBe(4);
  });
  test('never proposes a slot over lunch or in the past', () => {
    const planned = planWeek({
      week,
      notBefore: at(2, '12:00'),
      managerBusy: [],
      candidates: [{ participant: { email: 'a@x', name: 'A' }, busy: [] }],
    });
    expect(planned).toHaveLength(1);
    expect(Date.parse(planned[0]!.start)).toBeGreaterThanOrEqual(Date.parse(at(2, '12:00')));
    expect(minutesOfDay(planned[0]!.start)).toBeGreaterThanOrEqual(13 * 60);
  });
  test('leaves a candidate out when no slot is free', () => {
    const busy = [0, 1, 2, 3, 4].map(d => slot(d, '08:00', '17:00'));
    expect(
      planWeek({
        week,
        notBefore: at(0, '00:00'),
        managerBusy: [],
        candidates: [{ participant: { email: 'a@x', name: 'A' }, busy }],
      }),
    ).toHaveLength(0);
  });
});
describe('freeGaps', () => {
  test('marks gaps of at least 30 minutes between 08 and 17', () => {
    const gaps = freeGaps(week, [slot(0, '08:15', '08:45'), slot(0, '10:00', '11:00'), slot(0, '10:50', '11:10')]);
    expect(gaps.map(g => [minutesOfDay(g.start), minutesOfDay(g.end)])).toEqual([
      [8 * 60 + 45, 10 * 60],
      [11 * 60 + 10, 17 * 60],
    ]);
  });
  test('ignores an event that only touches the office day', () => {
    expect(freeGaps(week, [slot(0, '06:00', '07:00')])).toHaveLength(1);
  });
});
