import { expect, test } from 'bun:test';
import { Registry, openGovernance, type Actor } from '../packages/connectors/src/index';
import { userCapabilities } from '../apps/server/src/modules/people/capabilities';
import type { Assignment } from '../apps/server/src/modules/people/domain';
import type { UserReads } from '../apps/server/src/modules/people/ports';

export const userReadActors = (prefix: string): [Actor, Actor] => [
  { id: prefix + '-a', name: 'User A', role: 'manager', unitId: prefix + '-one', unitLabel: 'One' },
  { id: prefix + '-b', name: 'User B', role: 'employee', unitId: prefix + '-two', unitLabel: 'Two' },
];
/**
 * A4: a third person placed on both actors' units, who leads the first and so acts there. Their grant names the first
 * unit, and the second unit's directory lists them too, as an employee.
 */
export const userReadColleague = (actors: [Actor, Actor]): { id: string; name: string; placed: Assignment[] } => ({
  id: actors[0].id + '-colleague',
  name: 'User C',
  placed: [
    { unitId: actors[0].unitId, role: 'manager' },
    { unitId: actors[1].unitId, role: 'employee' },
  ],
});
/** The user names the contract expects: the first actor has one, the second was provisioned without. */
export const userReadNames = (actors: [Actor, Actor]): Record<string, string | null> => ({
  [actors[0].id]: actors[0].id + '.login',
  [actors[1].id]: null,
});

/**
 * The same scoped read contract runs on a memory port and the real local-user tables. The directory is the shared read
 * over each adapter's provisioning store (`directoryUsecases`), seeded with the actors' placements and the colleague's.
 */
export function userReadsContract(label: string, prepare: () => Promise<{ reads: UserReads; actors: [Actor, Actor] }>) {
  test(label + ': internal reads use the authenticated person and unit; input cannot choose another', async () => {
    const { reads, actors } = await prepare();
    const colleague = userReadColleague(actors);
    const registry = new Registry().register(userCapabilities(reads)).govern('people', openGovernance());
    for (const actor of actors) {
      expect(await registry.run(actor, 'people.me', {})).toEqual({
        ...actor,
        capabilities: actor.role === 'manager' ? ['test.read'] : [],
      });
      // The colleague is on both units with the role held on each, though their grant names the first (A4).
      expect(await registry.run(actor, 'people.directory', {})).toEqual({
        rows: [
          { id: actor.id, name: actor.name, role: actor.role },
          { id: colleague.id, name: colleague.name, role: actor === actors[0] ? 'manager' : 'employee' },
        ],
      });
      const other = actors.find(a => a.id !== actor.id)!;
      await expect(registry.run(actor, 'people.me', { personId: other.id })).rejects.toThrow('Ogiltig förfrågan');
      await expect(registry.run(actor, 'people.directory', { unitId: other.unitId })).rejects.toThrow(
        'Ogiltig förfrågan',
      );
    }
    expect(await reads.capabilities('missing-' + actors[0].id)).toEqual([]);
    expect(await reads.directory('missing-' + actors[0].unitId)).toEqual([]);
  });
  test(label + ": a person's user name, null when they have none or are unknown (D96 item 8)", async () => {
    const { reads, actors } = await prepare();
    expect(await reads.userName(actors[0].id)).toBe(actors[0].id + '.login');
    expect(await reads.userName(actors[1].id)).toBeNull();
    expect(await reads.userName('missing-' + actors[0].id)).toBeNull();
  });
}
