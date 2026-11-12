import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '@clew/contracts';
import { ForbiddenError } from '../../apps/server/src/context';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { staffUsecases } from '../../apps/server/src/modules/people/usecases';

/** Personal (D94): what a manager sees of the people on the units they manage, and who is refused. */
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
  s.units.set('unit-skola', { organisationId: 'poc', label: 'Bergsåkers skola' });
  s.units.set('unit-ekonomi', { organisationId: 'poc', label: 'Ekonomiavdelningen' });
  s.units.set('unit-hr', { organisationId: 'poc', label: 'HR-avdelningen' });
  s.units.set('unit-it', { organisationId: 'poc', label: 'IT och digitalisering' });
  s.assignments.set('hillevi', [{ unitId: 'unit-skola', role: 'manager' }]);
  s.assignments.set('anna', [{ unitId: 'unit-skola', role: 'employee' }]);
  s.assignments.set('zara', [{ unitId: 'unit-skola', role: 'employee' }]);
  s.assignments.set('orjan', [{ unitId: 'unit-skola', role: 'employee' }]);
  s.assignments.set('bo', [{ unitId: 'unit-skola', role: 'employee' }]);
  s.assignments.set('petra', [
    { unitId: 'unit-ekonomi', role: 'manager' },
    { unitId: 'unit-hr', role: 'manager' },
  ]);
  s.assignments.set('karin', [{ unitId: 'unit-ekonomi', role: 'manager' }]);
  s.assignments.set('nils', [{ unitId: 'unit-hr', role: 'employee' }]);
  s.assignments.set('mikael', [{ unitId: 'unit-it', role: 'employee' }]);
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
  return { staff: staffUsecases({ store }), persona };
}
describe('Personal (D94)', () => {
  test('a manager sees the people on their unit in Swedish order, with role and a deactivated mark, never themselves', async () => {
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
  test('a manager of two units sees both, by label in Swedish order, and a co-manager with their role', async () => {
    const { staff, persona } = stack();
    const view = await staff.overview(persona('petra', 'manager', 'unit-ekonomi'));
    expect(view.units.map(u => u.unitLabel)).toEqual(['Ekonomiavdelningen', 'HR-avdelningen']);
    expect(view.units[0]!.people).toEqual([
      { id: 'karin', name: 'Karin Åberg', userName: 'karin', email: 'karin@clew.test', role: 'manager', enabled: true },
    ]);
    expect(view.units[1]!.people.map(p => [p.name, p.role])).toEqual([['Nils Öberg', 'employee']]);
  });
  test('someone who manages no unit is refused by the server, whatever the browser shows', async () => {
    const { staff, persona } = stack();
    await expect(staff.overview(persona('mikael', 'employee', 'unit-it'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staff.overview(persona('mikael', 'employee', 'unit-it'))).rejects.toMatchObject({
      message: 'Sidan Personal är för den som är chef för en enhet.',
    });
    // The role in the context is not what decides it: the assignments are.
    await expect(staff.overview(persona('anna', 'manager', 'unit-skola'))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
