import type { memoryProvisionStore } from '../apps/server/src/modules/people/adapters/memory';

type State = ReturnType<typeof memoryProvisionStore>['state'];
type Row = { unitId: string; role: 'manager' | 'employee' };

/**
 * Writes a person's units into a hand-built memory store the way these fixtures have always meant a row: the person is
 * of each unit, and leads the ones where the role is `manager`. The store keeps the two apart (D149), so a
 * fixture that means someone who leads a unit and belongs to another writes `state.leads` and `state.assignments`
 * itself.
 */
export function hold(state: State, personId: string, rows: readonly Row[]): void {
  state.assignments.set(personId, [...new Set(rows.map(row => row.unitId))]);
  state.leads.set(personId, [...new Set(rows.filter(row => row.role === 'manager').map(row => row.unitId))]);
}
/** A person's units as the store holds them, one a unit and by unit id: `manager` where they lead it. */
export function unitsHeld(state: State, personId: string): Row[] {
  const leads = state.leads.get(personId) ?? [];
  return [...new Set([...(state.assignments.get(personId) ?? []), ...leads])]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map(unitId => ({ unitId, role: leads.includes(unitId) ? 'manager' : 'employee' }));
}
