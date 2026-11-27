import { describe, expect, test } from 'bun:test';
import { lageUnit, unitsLine } from '../../apps/web/src/user-units';

describe('the unit Läget is said of (D54, D149)', () => {
  const kansli = { unitId: 'kansli', unitLabel: 'Kansliet' },
    skola = { unitId: 'skola', unitLabel: 'Skolan' },
    kok = { unitId: 'kok', unitLabel: 'Köket' };
  test('a manager who leads the unit they are employed on, and an employee, have that unit', () => {
    expect(lageUnit({ ...kansli, role: 'manager' })).toEqual(kansli);
    expect(lageUnit({ ...kansli, role: 'employee' })).toEqual(kansli);
  });
  test('a manager who leads another unit than the one they are employed on has the one they lead', () => {
    const user = {
      ...kansli,
      role: 'manager' as const,
      assignments: [
        { ...kansli, role: 'employee' as const },
        { ...kok, role: 'manager' as const },
        { ...skola, role: 'manager' as const },
      ],
    };
    // The first of those they lead, as the session orders them; the header names every unit of theirs.
    expect(lageUnit(user)).toEqual(kok);
    expect(unitsLine(user)).toBe('Kansliet och 2 enheter till');
    // Leading the unit they are employed on as well, that one comes first.
    expect(lageUnit({ ...user, assignments: [{ ...kansli, role: 'manager' }, ...user.assignments.slice(1)] })).toEqual(
      kansli,
    );
  });
  test('somebody people report to who leads no unit has the unit they are employed on', () => {
    expect(lageUnit({ ...kansli, role: 'manager', assignments: [{ ...kansli, role: 'employee' }] })).toEqual(kansli);
  });
});
