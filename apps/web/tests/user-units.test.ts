import { describe, expect, test } from 'bun:test';
import type { SessionUser, Thread } from '@clew/contracts';
import { heldUnits, unitsLine, unitsList, workUnit } from '../src/user-units';

const one: SessionUser = { id: 'p', name: 'Sara', unitId: 'u-e', unitLabel: 'Ekonomi', role: 'manager' };
const two: SessionUser = {
  ...one,
  assignments: [
    { unitId: 'u-a', unitLabel: 'Arkivet', role: 'employee' },
    { unitId: 'u-e', unitLabel: 'Ekonomi', role: 'manager' },
  ],
};
const three: SessionUser = {
  ...two,
  assignments: [...two.assignments!, { unitId: 'u-h', unitLabel: 'HR', role: 'manager' }],
};
const about = (...keys: string[]): Pick<Thread, 'subjects'> => ({
  subjects: keys.map(key => ({ entity: 'unit' as const, key })),
});

describe('the units of a person with several assignments (D135)', () => {
  test('one unit is named as before, two both, more the primary one and how many', () => {
    expect(heldUnits(one)).toBeUndefined();
    expect(heldUnits({ ...one, assignments: [two.assignments![1]!] })).toBeUndefined();
    expect(heldUnits(two)?.map(a => a.unitId)).toEqual(['u-e', 'u-a']);
    expect(unitsLine(one)).toBe('Ekonomi');
    expect(unitsLine(two)).toBe('Ekonomi och Arkivet');
    expect(unitsLine(three)).toBe('Ekonomi och 2 enheter till');
    expect(unitsList(one)).toBe('Ekonomi');
    expect(unitsList(two)).toBe('Ekonomi och Arkivet');
    expect(unitsList(three)).toBe('Ekonomi, Arkivet och HR');
  });
  test("a work item names its unit by the session's name, only when it names one of the reader's units and the reader has several", () => {
    expect(workUnit(two, about('u-a'))).toBe('Arkivet');
    expect(workUnit(one, about('u-e'))).toBeUndefined();
    expect(workUnit(two, about('u-x'))).toBeUndefined();
    expect(workUnit(two, about('u-a', 'u-e'))).toBeUndefined();
    expect(workUnit(two, {})).toBeUndefined();
    expect(workUnit(two, { subjects: [{ entity: 'person', key: 'p' }] })).toBeUndefined();
  });
});
