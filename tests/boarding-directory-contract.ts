import { describe, expect, test } from 'bun:test';
import type { MemoryDirectoryPerson } from '../apps/server/src/modules/boarding/adapters/memory';
import type { BoardingDirectory, UnitNode } from '../apps/server/src/modules/boarding/model';

/**
 * The directory as boarding reads it (D124): what the layers match on, the tree, the units' names (item 11 of the
 * review, a layer on a unit says which) and whom a person reports to now (item 7: who holds a leaver's plans; D147: the
 * managers their employments name). One suite, two adapters: `tests/unit/boarding-directory.test.ts` on memory,
 * `tests/db/postgres-boarding-directory.test.ts` on Clew's directory tables.
 */

/**
 * A person as the suite seeds them: what the memory directory holds, a name, and on each employment the manager it
 * names (D147), which is where a directory says it. Two managers are two employments. Each adapter's harness writes
 * that the way its directory holds it.
 */
export type SeedPerson = Omit<MemoryDirectoryPerson, 'employments' | 'managerIds'> & {
  name: string;
  employments: Array<MemoryDirectoryPerson['employments'][number] & { managerId?: string }>;
};
export interface BoardingDirectoryHarness {
  directory: BoardingDirectory;
  /** Prefixes every id the suite writes, the organisation's included, so runs never meet. */
  prefix: string;
  seedUnit(unit: UnitNode & { organisationId: string; label: string }): Promise<void>;
  /**
   * The suite seeds a manager before anyone whose employment names them, since a database holds the manager as a
   * reference to a person. One person's employment names the person themselves: a harness whose directory refuses such
   * a row writes that employment without a manager.
   */
  seedPerson(person: SeedPerson): Promise<void>;
}

export function boardingDirectoryContract(name: string, make: () => Promise<BoardingDirectoryHarness>) {
  describe(`${name} boarding directory`, () => {
    /**
     * An organisation: the municipality (led by Rut), a department under it (led by Ada), a team under the department
     * nobody leads, and a home-care unit under the department led by Ulf and Una, with Otto, a manager there who has been
     * deactivated. Another organisation has a unit of its own. Who reports to whom is said by the employments (D147) and
     * by nothing else: Sam is placed on home care with an employment that names nobody, Ego's names Ego, and Xen's names
     * the other organisation's manager.
     */
    async function world() {
      const h = await make();
      const p = h.prefix,
        org = p + '-org',
        other = p + '-other';
      const u = (id: string) => p + '-' + id;
      const units = [
        { id: u('root'), organisationId: org, label: 'Kommunen', parentId: null },
        { id: u('dept'), organisationId: org, label: 'Vård och omsorg', parentId: u('root') },
        { id: u('team'), organisationId: org, label: 'Teamet', parentId: u('dept') },
        { id: u('care'), organisationId: org, label: 'Hemtjänsten', parentId: u('dept') },
        { id: u('far'), organisationId: other, label: 'Annan enhet', parentId: null },
      ];
      for (const unit of units) await h.seedUnit(unit);
      /** A person of the organisation by a short id; the managers their employments name are short ids too. */
      const person = (
        id: string,
        assignments: SeedPerson['assignments'],
        extra: Partial<Pick<SeedPerson, 'enabled' | 'positionCodes' | 'employments'>> = {},
      ): SeedPerson => ({
        id: u(id),
        name: 'Name ' + id,
        organisationId: org,
        enabled: true,
        assignments: assignments.map(a => ({ ...a, unitId: u(a.unitId) })),
        positionCodes: [],
        ...extra,
        employments: (extra.employments ?? []).map(({ managerId, ...job }) => ({
          ...job,
          ...(managerId ? { managerId: u(managerId) } : {}),
        })),
      });
      /** An employment for each manager named, in that order. */
      const reportingTo = (...managers: string[]) => ({ employments: managers.map(managerId => ({ managerId })) });
      // Every manager stands before whoever names them (`seedPerson`).
      const people = [
        person('rut', [{ unitId: 'root', role: 'manager' }]),
        person('ada', [{ unitId: 'dept', role: 'manager' }], reportingTo('rut')),
        person('ulf', [{ unitId: 'care', role: 'manager' }], reportingTo('ada')),
        person('una', [{ unitId: 'care', role: 'manager' }], reportingTo('ada')),
        person('otto', [{ unitId: 'care', role: 'manager' }], { enabled: false, ...reportingTo('ada') }),
        { ...person('farboss', [{ unitId: 'far', role: 'manager' }]), organisationId: other },
        { ...person('far', [{ unitId: 'far', role: 'employee' }], reportingTo('farboss')), organisationId: other },
        person('tea', [{ unitId: 'team', role: 'employee' }], {
          positionCodes: [p + '-larare'],
          employments: [
            { employmentType: 'Tillsvidare', startDate: '2026-12-04', managerId: 'ada' },
            { employmentType: 'Vikariat' },
          ],
        }),
        person('cid', [{ unitId: 'care', role: 'employee' }], reportingTo('una', 'otto', 'ulf')),
        person(
          'two',
          [
            { unitId: 'care', role: 'employee' },
            { unitId: 'root', role: 'employee' },
          ],
          reportingTo('una', 'rut', 'una'),
        ),
        person('sam', [{ unitId: 'care', role: 'employee' }], { employments: [{ employmentType: 'Tillsvidare' }] }),
        person('ego', [{ unitId: 'care', role: 'employee' }], reportingTo('ego', 'ada')),
        person('xen', [{ unitId: 'team', role: 'employee' }], reportingTo('farboss', 'rut')),
        person('none', []),
      ];
      for (const one of people) await h.seedPerson(one);
      return { ...h, p, org, other, u };
    }

    test('what the layers match on: units, position codes and employments, of the organisation’s people only', async () => {
      const w = await world();
      const facts = await w.directory.facts(w.org, [w.u('tea'), w.u('two'), w.u('far'), w.u('nobody')]);
      expect([...facts.keys()].sort()).toEqual([w.u('tea'), w.u('two')].sort());
      expect(facts.get(w.u('tea'))).toEqual({
        unitIds: [w.u('team')],
        positionCodes: [w.p + '-larare'],
        employments: [{ employmentType: 'Tillsvidare', startDate: '2026-12-04' }, { employmentType: 'Vikariat' }],
      });
      expect(facts.get(w.u('two'))?.unitIds).toEqual([w.u('care'), w.u('root')].sort());
      expect(await w.directory.facts(w.org, [])).toEqual(new Map());
    });

    test('the tree is the organisation’s units with the unit above each', async () => {
      const w = await world();
      const tree = (await w.directory.tree(w.org))
        .filter(n => n.id.startsWith(w.p))
        .sort((a, b) => a.id.localeCompare(b.id));
      expect(tree).toEqual(
        [
          { id: w.u('care'), parentId: w.u('dept') },
          { id: w.u('dept'), parentId: w.u('root') },
          { id: w.u('root'), parentId: null },
          { id: w.u('team'), parentId: w.u('dept') },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      );
    });

    test('a unit’s name is read for the organisation’s own units; another organisation’s or an unknown one is absent', async () => {
      const w = await world();
      expect(await w.directory.unitLabels(w.org, [w.u('care'), w.u('far'), w.u('nowhere'), w.u('care')])).toEqual(
        new Map([[w.u('care'), 'Hemtjänsten']]),
      );
      expect(await w.directory.unitLabels(w.org, [])).toEqual(new Map());
    });

    test('whom a person reports to: the active managers of the organisation their employments name, each once and by id, never themselves, and nobody from the tree (D147)', async () => {
      const w = await world();
      const line = (id: string, org = w.org) => w.directory.lineManagers(org, w.u(id));
      // The employment that names a manager gives her; the one beside it names nobody and gives nobody. The team she is
      // placed on is led by nobody, and no walk up the tree is what finds the department's manager.
      expect(await line('tea')).toEqual([w.u('ada')]);
      // Two managers are two employments, returned by id whatever the employments' order; the deactivated one is nobody's
      // manager, though the directory still names him.
      expect(await line('cid')).toEqual([w.u('ulf'), w.u('una')].sort());
      // One who leads a unit reports to whom their own employment names, and a co-leader is not their manager.
      expect(await line('ulf')).toEqual([w.u('ada')]);
      expect(await line('ada')).toEqual([w.u('rut')]);
      expect(await line('rut')).toEqual([]);
      // Named by two employments, a manager is returned once.
      expect(await line('two')).toEqual([w.u('rut'), w.u('una')].sort());
      // Nothing is read from the tree: placed on a unit two people lead, with an employment that names nobody, a person
      // reports to nobody. So does someone with no employment at all.
      expect(await line('sam')).toEqual([]);
      expect(await line('none')).toEqual([]);
      // Never the person themselves, where an employment names them.
      expect(await line('ego')).toEqual([w.u('ada')]);
      // A manager in another organisation is not returned.
      expect(await line('xen')).toEqual([w.u('rut')]);
      // Asked about in the wrong organisation, a person reports to nobody.
      expect(await line('far')).toEqual([]);
      expect(await line('far', w.other)).toEqual([w.u('farboss')]);
    });
  });
}
