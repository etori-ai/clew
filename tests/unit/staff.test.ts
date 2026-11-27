import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '@clew/contracts';
import { ForbiddenError } from '../../apps/server/src/context';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { staffUsecases } from '../../apps/server/src/modules/people/usecases';
import { nameManagers } from '../named-managers';
import { hold } from '../held-units';

/**
 * Personal (D94, D147): what a manager sees of the people who report to them, under the unit of the employment that
 * names them, and who is refused.
 */
const T = '2026-11-09T06:00:00.000Z';
function stack() {
  const store = memoryProvisionStore(),
    s = store.state;
  const person = (id: string, name: string, enabled = true) =>
    s.users.set(id, {
      id,
      organisationId: 'poc',
      externalId: 'dev:' + id,
      userName: id,
      name,
      email: id + '@clew.test',
      phoneNumbers: [],
      employments: [],
      title: null,
      enabled,
      createdAt: T,
      updatedAt: T,
    });
  person('hillevi', 'Hillevi Berg');
  person('anna', 'Anna Lindqvist');
  person('zara', 'Zara Lind');
  person('orjan', 'Örjan Dahl');
  person('bo', 'Bo Ärlig', false);
  person('petra', 'Petra Nyström');
  person('karin', 'Karin Åberg');
  person('nils', 'Nils Öberg');
  person('mikael', 'Mikael Lund');
  /** A unit as a push leaves it: its row and its `unit:` group, where a card for a unit the reader does not lead takes its name. */
  const unit = (id: string, label: string) => {
    s.units.set(id, { organisationId: 'poc', label });
    s.groups.set('group-' + id, {
      unitIdentifiers: [],
      id: 'group-' + id,
      organisationId: 'poc',
      externalId: 'unit:' + id,
      label,
      parentUnitId: null,
      createdAt: T,
      updatedAt: T,
    });
  };
  unit('unit-skola', 'Bergsåkers skola');
  unit('unit-ekonomi', 'Ekonomiavdelningen');
  unit('unit-hr', 'HR-avdelningen');
  unit('unit-it', 'IT och digitalisering');
  hold(s, 'hillevi', [{ unitId: 'unit-skola', role: 'manager' }]);
  hold(s, 'anna', [{ unitId: 'unit-skola', role: 'employee' }]);
  hold(s, 'zara', [{ unitId: 'unit-skola', role: 'employee' }]);
  hold(s, 'orjan', [{ unitId: 'unit-skola', role: 'employee' }]);
  hold(s, 'bo', [{ unitId: 'unit-skola', role: 'employee' }]);
  hold(s, 'petra', [
    { unitId: 'unit-ekonomi', role: 'manager' },
    { unitId: 'unit-hr', role: 'manager' },
  ]);
  hold(s, 'karin', [{ unitId: 'unit-ekonomi', role: 'manager' }]);
  hold(s, 'nils', [{ unitId: 'unit-hr', role: 'employee' }]);
  hold(s, 'mikael', [{ unitId: 'unit-it', role: 'employee' }]);
  // Who reports to whom is on the employments (D147): each person placed on a unit names the one who leads it. Petra
  // and Karin lead Ekonomiavdelningen side by side and neither names the other; nobody leads IT, so Mikael names nobody.
  nameManagers(s);
  const persona = (id: string, role: 'manager' | 'employee', unitId: string): AuthenticatedContext => ({
    id,
    name: s.users.get(id)!.name,
    unitId,
    unitLabel: s.units.get(unitId)!.label,
    role,
    organisationId: 'poc',
    principal: { id: 'person:' + id, kind: 'person' },
    capabilities: [],
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2026-11-09T18:00:00.000Z',
    authorize: async () => ({ version: 'v1' }),
  });
  /** The directory sends this employment as the person's only one. */
  const employ = (id: string, unitId: string, managerId: string) =>
    s.users.set(id, { ...s.users.get(id)!, employments: [{ unitId, managerId }] });
  return { staff: staffUsecases({ store }), persona, employ };
}
describe('Personal (D94, D147)', () => {
  test('a manager sees their reports under the unit they are employed on, in Swedish order, with role and a deactivated mark, never themselves', async () => {
    const { staff, persona } = stack();
    const view = await staff.overview(persona('hillevi', 'manager', 'unit-skola'));
    expect(view.units).toHaveLength(1);
    expect(view.units[0]).toMatchObject({ unitId: 'unit-skola', unitLabel: 'Bergsåkers skola' });
    // Z before Ö: the Swedish alphabet, not the English one where Ö sorts with O.
    expect(view.units[0]!.people.map(p => p.name)).toEqual(['Anna Lindqvist', 'Bo Ärlig', 'Zara Lind', 'Örjan Dahl']);
    expect(view.units[0]!.people.find(p => p.id === 'bo')).toEqual({
      id: 'bo',
      name: 'Bo Ärlig',
      userName: 'bo',
      email: 'bo@clew.test',
      role: 'employee',
      enabled: false,
    });
    expect(view.units[0]!.people.some(p => p.id === 'hillevi')).toBe(false);
  });
  test('a manager of two units sees both, by label in Swedish order; a co-manager is listed only when their employment names the reader', async () => {
    const { staff, persona, employ } = stack();
    const petra = persona('petra', 'manager', 'unit-ekonomi');
    // Karin leads Ekonomiavdelningen beside Petra and her employment names nobody. D94 listed everyone assigned to the
    // unit; D147 lists who reports to the reader, so the unit Petra leads has its card and nobody on it.
    expect((await staff.overview(petra)).units.map(u => [u.unitLabel, u.people.map(p => [p.name, p.role])])).toEqual([
      ['Ekonomiavdelningen', []],
      ['HR-avdelningen', [['Nils Öberg', 'employee']]],
    ]);
    // Once Karin's employment there names Petra she is a report, with the manager's role she has on the unit.
    employ('karin', 'unit-ekonomi', 'petra');
    expect((await staff.overview(petra)).units[0]!.people).toEqual([
      { id: 'karin', name: 'Karin Åberg', userName: 'karin', email: 'karin@clew.test', role: 'manager', enabled: true },
    ]);
  });
  test('someone who leads no unit and whom nobody reports to is refused by the server, whatever the browser shows', async () => {
    const { staff, persona, employ } = stack();
    await expect(staff.overview(persona('mikael', 'employee', 'unit-it'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staff.overview(persona('mikael', 'employee', 'unit-it'))).rejects.toMatchObject({
      message: 'Sidan Personal är för den som är chef.',
    });
    // The role in the context is not what decides it: the directory is.
    await expect(staff.overview(persona('anna', 'manager', 'unit-skola'))).rejects.toBeInstanceOf(ForbiddenError);
    // Leading a unit is not what decides it either (D147): once an employment names Mikael he has a report, listed
    // under the unit of that employment, which he does not lead.
    employ('nils', 'unit-hr', 'mikael');
    expect((await staff.overview(persona('mikael', 'employee', 'unit-it'))).units).toEqual([
      {
        unitId: 'unit-hr',
        unitLabel: 'HR-avdelningen',
        people: [
          {
            id: 'nils',
            name: 'Nils Öberg',
            userName: 'nils',
            email: 'nils@clew.test',
            role: 'employee',
            enabled: true,
          },
        ],
      },
    ]);
  });
});
