import { expect, test } from 'bun:test';
import { Registry, openGovernance, type Actor } from '../packages/connectors/src/index';
import { userCapabilities } from '../apps/server/src/modules/people/capabilities';
import type { UserReads } from '../apps/server/src/modules/people/ports';

export const userReadActors = (prefix: string): [Actor, Actor] => [
  { id: prefix + '-a', name: 'User A', role: 'manager', unitId: prefix + '-one', unitLabel: 'One' },
  { id: prefix + '-b', name: 'User B', role: 'employee', unitId: prefix + '-two', unitLabel: 'Two' },
];

/** The same scoped read contract runs on a memory port and the real local-user tables. */
export function userReadsContract(label: string, prepare: () => Promise<{ reads: UserReads; actors: [Actor, Actor] }>) {
  test(label + ': internal reads use the authenticated person and unit; input cannot choose another', async () => {
    const { reads, actors } = await prepare();
    const registry = new Registry().register(userCapabilities(reads)).govern('people', openGovernance());
    for (const actor of actors) {
      expect(await registry.run(actor, 'people.me', {})).toEqual({
        ...actor,
        capabilities: actor.role === 'manager' ? ['test.read'] : [],
      });
      expect(await registry.run(actor, 'people.directory', {})).toEqual({
        rows: [{ id: actor.id, name: actor.name, role: actor.role }],
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
}
