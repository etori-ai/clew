import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { collides, freeSlots, planWeek, withinOfficeHours, type Interval } from '../../packages/calendar/src/proposals';
import { displayDate, localInstant } from '../../packages/calendar/src/dates';

/**
 * Properties of the planner (D25): whatever the calendars look like, a plan never collides, never leaves office
 * hours, never looks back and never books a person twice. fast-check draws the calendars; one property replaces
 * the examples a person would think of and the ones they would not.
 */
const week = '2026-11-09';
const minutes = (day: number, m: number) =>
  localInstant(
    `2026-11-${String(9 + day).padStart(2, '0')}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
  );
const interval: fc.Arbitrary<Interval> = fc
  .record({
    day: fc.integer({ min: 0, max: 4 }),
    start: fc.integer({ min: 7 * 60, max: 17 * 60 }).map(m => m - (m % 15)),
    length: fc.integer({ min: 15, max: 240 }).map(m => m - (m % 15)),
  })
  .map(({ day, start, length }) => ({
    start: minutes(day, start),
    end: minutes(day, Math.min(start + length, 23 * 60)),
  }));
const calendar = fc.array(interval, { maxLength: 12 });
const candidates = fc
  .uniqueArray(fc.record({ email: fc.stringMatching(/^[a-z]{1,6}$/).map(s => s + '@x'), busy: calendar }), {
    minLength: 1,
    maxLength: 8,
    selector: c => c.email,
  })
  .map(list => list.map(c => ({ participant: { email: c.email, name: c.email }, busy: c.busy })));
const notBefore = fc
  .record({ day: fc.integer({ min: 0, max: 4 }), minute: fc.integer({ min: 0, max: 23 * 60 }) })
  .map(({ day, minute }) => minutes(day, minute));
const input = fc.record({ managerBusy: calendar, candidates, notBefore });

describe('planWeek', () => {
  test('never collides with the manager, the candidate or another slot, stays in office hours and never looks back', () => {
    fc.assert(
      fc.property(input, ({ managerBusy, candidates, notBefore }) => {
        const planned = planWeek({ week, managerBusy, candidates, notBefore });
        for (const slot of planned) {
          const own = candidates.find(c => c.participant.email === slot.participant.email)!;
          expect(withinOfficeHours(slot)).toBe(true);
          expect(Date.parse(slot.end) - Date.parse(slot.start)).toBe(60 * 60_000);
          expect(Date.parse(slot.start)).toBeGreaterThanOrEqual(Date.parse(notBefore));
          expect(collides(slot, managerBusy)).toBe(false);
          expect(collides(slot, own.busy)).toBe(false);
          expect(
            collides(
              slot,
              planned.filter(p => p !== slot),
            ),
          ).toBe(false);
          expect(displayDate(slot.start) >= week && displayDate(slot.start) <= '2026-11-13').toBe(true);
        }
        expect(new Set(planned.map(p => p.participant.email)).size).toBe(planned.length);
      }),
      { numRuns: 300 },
    );
  });
  test('is deterministic and only ever leaves a candidate out when no slot is free for them', () => {
    fc.assert(
      fc.property(input, ({ managerBusy, candidates, notBefore }) => {
        const planned = planWeek({ week, managerBusy, candidates, notBefore });
        expect(planWeek({ week, managerBusy, candidates, notBefore })).toEqual(planned);
        const left = candidates.filter(c => !planned.some(p => p.participant.email === c.participant.email));
        for (const c of left) {
          // Planning that candidate alone, around everything already planned, must find nothing either.
          const busy = [...managerBusy, ...planned];
          expect(planWeek({ week, managerBusy: busy, candidates: [c], notBefore })).toEqual([]);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('freeSlots', () => {
  test("a suggested time (D111) never collides with the person's own calendar, stays in office hours and the window, never looks back, and is no more than asked for", () => {
    fc.assert(
      fc.property(
        calendar,
        notBefore,
        fc.integer({ min: 15, max: 180 }),
        fc.integer({ min: 1, max: 5 }),
        (busy, notBefore, durationMinutes, count) => {
          const slots = freeSlots({ from: week, until: '2026-11-14', busy, notBefore, durationMinutes, count });
          expect(slots.length).toBeLessThanOrEqual(count);
          expect(freeSlots({ from: week, until: '2026-11-14', busy, notBefore, durationMinutes, count })).toEqual(
            slots,
          );
          for (const slot of slots) {
            expect(collides(slot, busy)).toBe(false);
            expect(withinOfficeHours(slot)).toBe(true);
            expect(Date.parse(slot.start)).toBeGreaterThanOrEqual(Date.parse(notBefore));
            expect(Date.parse(slot.end) - Date.parse(slot.start)).toBe(durationMinutes * 60_000);
            expect(displayDate(slot.start) >= week && displayDate(slot.start) < '2026-11-14').toBe(true);
          }
          // Spread before cluster: a day gets a second time only when every day with a free time has one.
          const days = slots.map(s => displayDate(s.start));
          if (new Set(days).size < days.length)
            for (const day of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'])
              if (!days.includes(day))
                expect(
                  freeSlots({
                    from: day,
                    until: day.slice(0, 8) + String(Number(day.slice(8)) + 1),
                    busy,
                    notBefore,
                    durationMinutes,
                  }),
                ).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
