import type { memoryProvisionStore } from '../apps/server/src/modules/people/adapters/memory';
import { unitsHeld } from './held-units';

type State = ReturnType<typeof memoryProvisionStore>['state'];
const UNIT = 'unit:';

/**
 * Gives a hand-built directory the managers a real one names on each employment (D147), the way these fixtures have
 * always meant them: someone placed on a unit reports to the active people who lead it, or who lead the nearest unit
 * above that anybody leads; someone who leads a unit reports to those who lead the nearest led unit above it. Nobody
 * reports to themselves. That is the line D99 read from the tree, written down as the fact the directory would send, so
 * a fixture says who reports to whom without a test having to spell it out per person.
 *
 * An employment the fixture wrote on the unit gets the first manager; any further manager is an employment of its own
 * on that unit, which is how a directory says two managers. A fixture that means something else writes `managerId` on
 * its own employments and does not call this, or calls it first and changes what it wants after.
 */
export function nameManagers(state: State): void {
  const parents = new Map<string, string | null>();
  for (const group of state.groups.values())
    if (group.externalId?.startsWith(UNIT)) parents.set(group.externalId.slice(UNIT.length), group.parentUnitId);
  const leadersOf = (unitId: string, but: string) =>
    [...state.leads.entries()]
      .filter(([id, led]) => id !== but && state.users.get(id)?.enabled && led.includes(unitId))
      .map(([id]) => id)
      .sort();
  for (const personId of new Set([...state.assignments.keys(), ...state.leads.keys()])) {
    const person = state.users.get(personId),
      held = unitsHeld(state, personId);
    if (!person) continue;
    const employments = person.employments.map(job => ({ ...job }));
    for (const assignment of held) {
      const seen = new Set<string>();
      let managers: string[] = [];
      for (
        let at: string | null | undefined =
          assignment.role === 'manager' ? parents.get(assignment.unitId) : assignment.unitId;
        at && !seen.has(at) && !managers.length;
        at = parents.get(at)
      ) {
        seen.add(at);
        managers = leadersOf(at, personId).filter(id => state.users.get(id)?.organisationId === person.organisationId);
      }
      for (const managerId of managers) {
        if (employments.some(job => job.unitId === assignment.unitId && job.managerId === managerId)) continue;
        const open = employments.find(job => job.unitId === assignment.unitId && job.managerId === undefined);
        if (open) open.managerId = managerId;
        else employments.push({ unitId: assignment.unitId, managerId });
      }
    }
    state.users.set(personId, { ...person, employments });
  }
}
