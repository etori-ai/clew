import { describe, expect, test } from 'bun:test';
import type { MemoryDirectoryPerson } from '../apps/server/src/modules/boarding/adapters/memory';
import type { BoardingDirectory, UnitNode } from '../apps/server/src/modules/boarding/model';

/**
 * The directory as boarding reads it (D124): what the layers match on, the tree, the units' names (item 11 of the
 * review, a layer on a unit says which) and whom a person reports to now (item 7: who holds a leaver's plans). One
 * suite, two adapters: `tests/unit/boarding-directory.test.ts` on memory, `tests/db/postgres-boarding-directory.test.ts`
 * on Clew's directory tables.
 */
export interface BoardingDirectoryHarness {
  directory: BoardingDirectory;
  /** Prefixes every id the suite writes, the organisation's included, so runs never meet. */
  prefix: string;
  seedUnit(unit: UnitNode & { organisationId: string; label: string }): Promise<void>;
  seedPerson(person: MemoryDirectoryPerson & { name: string }): Promise<void>;
}

export function boardingDirectoryContract(name: string, make: () => Promise<BoardingDirectoryHarness>) {
  describe(`${name} boarding directory`, () => {
    /**
     * An organisation: the municipality (led by Rut), a department under it (led by Ada), a team under the department
     * nobody leads, and a home-care unit under the department led by Ulf and Una, with Otto, a manager there who has been
     * deactivated. Another organisation has a unit of its own.
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
      const person = (
        id: string,
        assignments: MemoryDirectoryPerson['assignments'],
        extra: Partial<MemoryDirectoryPerson> = {},
      ): MemoryDirectoryPerson & { name: string } => ({
        id: u(id),
        name: 'Name ' + id,
        organisationId: org,
        enabled: true,
        assignments: assignments.map(a => ({ ...a, unitId: u(a.unitId) })),
        positionCodes: [],
        employments: [],
        ...extra,
      });
      const people = [
        person('rut', [{ unitId: 'root', role: 'manager' }]),
        person('ada', [{ unitId: 'dept', role: 'manager' }]),
        person('ulf', [{ unitId: 'care', role: 'manager' }]),
        person('una', [{ unitId: 'care', role: 'manager' }]),
        person('otto', [{ unitId: 'care', role: 'manager' }], { enabled: false }),
        person('tea', [{ unitId: 'team', role: 'employee' }], {
          positionCodes: [p + '-larare'],
          employments: [{ employmentType: 'Tillsvidare', startDate: '2026-12-04' }, { employmentType: 'Vikariat' }],
        }),
        person('cid', [{ unitId: 'care', role: 'employee' }]),
        person('two', [
          { unitId: 'care', role: 'employee' },
          { unitId: 'root', role: 'employee' },
        ]),
        person('none', []),
        { ...person('far', [{ unitId: 'far', role: 'employee' }]), organisationId: other },
        { ...person('farboss', [{ unitId: 'far', role: 'manager' }]), organisationId: other },
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

    test('whom a person reports to: up from each unit to the nearest one an active person leads, never themselves', async () => {
      const w = await world();
      const line = (id: string, org = w.org) => w.directory.lineManagers(org, w.u(id));
      // The team nobody leads passes the line to the department above it.
      expect(await line('tea')).toEqual([w.u('ada')]);
      // Two leaders of one unit are both the line; the deactivated one is not.
      expect(await line('cid')).toEqual([w.u('ulf'), w.u('una')].sort());
      // One who leads a unit reports to the unit above it, and a co-leader is not their manager.
      expect(await line('ulf')).toEqual([w.u('ada')]);
      expect(await line('ada')).toEqual([w.u('rut')]);
      expect(await line('rut')).toEqual([]);
      // Placed on two units, a person reports along both lines.
      expect(await line('two')).toEqual([w.u('rut'), w.u('ulf'), w.u('una')].sort());
      expect(await line('none')).toEqual([]);
      // Asked about in the wrong organisation, a person reports to nobody.
      expect(await line('far')).toEqual([]);
      expect(await line('far', w.other)).toEqual([w.u('farboss')]);
    });
  });
}
