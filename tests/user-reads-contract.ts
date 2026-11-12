import { expect, test } from 'bun:test';
import { Registry, openGovernance, type Actor } from '../packages/connectors/src/index';
import { userCapabilities } from '../apps/server/src/modules/people/capabilities';
import type { UserReads } from '../apps/server/src/modules/people/ports';

/** The organisation the two actors belong to. */
export const USER_READ_ORGANISATION = 'test';
export const userReadActors = (prefix: string): [Actor, Actor] => [
  { id: prefix + '-a', name: 'User A', role: 'manager', unitId: prefix + '-one', unitLabel: 'One' },
  { id: prefix + '-b', name: 'User B', role: 'employee', unitId: prefix + '-two', unitLabel: 'Two' },
];
/** The user names the contract expects: the first actor has one, the second was provisioned without. */
export const userReadNames = (actors: [Actor, Actor]): Record<string, string | null> => ({
  [actors[0].id]: actors[0].id + '.login',
  [actors[1].id]: null,
});
/** A person the people table holds beside the actors, with no grant. */
export interface UserReadPerson {
  id: string;
  organisationId: string;
  name: string;
  userName: string;
  enabled: boolean;
}
/**
 * The people the contract expects beside the actors (D116): a person of another organisation; a deactivated person of
 * the actors' organisation whose user name has letters outside A to Z; and two people of that organisation whose user
 * names differ only in how they are composed, one stored decomposed (NFD), as a row written before user names were
 * normalised may be, which the unique index lets in since it compares bytes.
 */
export const userReadOthers = (prefix: string): [UserReadPerson, UserReadPerson, UserReadPerson, UserReadPerson] => [
  {
    id: prefix + '-outsider',
    organisationId: USER_READ_ORGANISATION + '-other',
    name: 'Outsider',
    userName: prefix + '-outsider.login',
    enabled: true,
  },
  {
    id: prefix + '-leaver',
    organisationId: USER_READ_ORGANISATION,
    name: 'Åsa Öberg',
    userName: prefix + '-Åsa.Öberg',
    enabled: false,
  },
  {
    id: prefix + '-twin-composed',
    organisationId: USER_READ_ORGANISATION,
    name: 'Örjan Ek',
    userName: prefix + '-Örjan.Ek',
    enabled: true,
  },
  {
    id: prefix + '-twin-decomposed',
    organisationId: USER_READ_ORGANISATION,
    name: 'Örjan Ek',
    userName: (prefix + '-Örjan.Ek').normalize('NFD'),
    enabled: true,
  },
];

/** The same scoped read contract runs on a memory port and the real local-user tables. */
export function userReadsContract(
  label: string,
  prepare: () => Promise<{ reads: UserReads; actors: [Actor, Actor]; others: ReturnType<typeof userReadOthers> }>,
) {
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
  test(label + ": a person's user name, null when they have none or are unknown (D96 item 8)", async () => {
    const { reads, actors } = await prepare();
    expect(await reads.userName(actors[0].id)).toBe(actors[0].id + '.login');
    expect(await reads.userName(actors[1].id)).toBeNull();
    expect(await reads.userName('missing-' + actors[0].id)).toBeNull();
    expect(await reads.userName(actors[0].id + '\u0000')).toBeNull();
  });
  test(
    label +
      ": who holds a user name in the reader's organisation, active or not, by the name as asked, without regard to case or composition (D116)",
    async () => {
      const { reads, actors, others } = await prepare();
      const [outsider, leaver, twin] = others;
      const name = actors[0].id + '.login';
      const asked = name.toUpperCase();
      // The deactivated person's name as a source may send it: in other letters' case, and decomposed (NFD).
      const leaverLower = leaver.userName.toLowerCase(),
        leaverDecomposed = leaver.userName.toUpperCase().normalize('NFD');
      expect(leaverDecomposed).not.toBe(leaver.userName.toUpperCase());
      // Any reader of the organisation, the holder themself included. A name nobody holds and a NUL name nobody, and a
      // name only someone of another organisation holds names nobody either; a deactivated holder is still whom it names.
      // A name two people of the organisation hold in spellings that compare alike names neither, however it is asked.
      for (const reader of actors) {
        const held = await reads.holders(reader.id, [
          asked,
          'nobody-' + name,
          name + '\u0000',
          outsider.userName,
          leaverLower,
          leaverDecomposed,
          twin.userName,
          twin.userName.toLowerCase().normalize('NFD'),
        ]);
        expect(Object.fromEntries(held)).toEqual({
          [asked]: actors[0].id,
          [leaverLower]: leaver.id,
          [leaverDecomposed]: leaver.id,
        });
      }
      // The other organisation's own reader reaches its own holder, and nobody of the first organisation.
      expect(Object.fromEntries(await reads.holders(outsider.id, [outsider.userName.toUpperCase(), name]))).toEqual({
        [outsider.userName.toUpperCase()]: outsider.id,
      });
      // A reader the people table does not hold reaches nobody, and an empty question reads nothing.
      expect((await reads.holders('missing-' + actors[0].id, [name])).size).toBe(0);
      expect((await reads.holders(actors[0].id, [])).size).toBe(0);
    },
  );
  test(
    label + ': whether the people table holds a person, with or without a user name, active or not (D116)',
    async () => {
      const { reads, actors, others } = await prepare();
      expect(await reads.exists(actors[0].id)).toBe(true);
      expect(await reads.exists(actors[1].id)).toBe(true);
      for (const other of others) expect(await reads.exists(other.id)).toBe(true);
      expect(await reads.exists('missing-' + actors[0].id)).toBe(false);
      expect(await reads.exists(actors[0].id + '\u0000')).toBe(false);
      // A user name is not an id.
      expect(await reads.exists(actors[0].id + '.login')).toBe(false);
    },
  );
}
