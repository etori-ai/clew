import { describe, expect, test } from 'bun:test';
import { combineLeavers, type LeaversBinding } from '../../apps/server/src/modules/people/leavers';
import type { LeaverChange, LeaversTx } from '../../apps/server/src/modules/people/ports';
import { memoryCompetenceStore } from '../../apps/server/src/modules/competence/adapters/memory';
import { competenceLeavers } from '../../apps/server/src/modules/competence/usecases';
import { memoryBoardingDirectory, memoryBoardingStore } from '../../apps/server/src/modules/boarding/adapters/memory';
import { boardingLeavers } from '../../apps/server/src/modules/boarding/usecases';

/**
 * The people module's leavers port told to several domains (D108 item 14, D124 item 7, D113), as `composition/people.ts`
 * binds it: competence's erasure intent and boarding's holders, each in a savepoint of its own. Here a savepoint is the
 * domain's own memory transaction, which a throw rolls back; `tests/db/postgres-leavers.test.ts` holds the binding to
 * real savepoints in one Postgres transaction.
 */
const ORG = 'org-1';
const change: LeaverChange = {
  actor: 'provisioner:test',
  personId: 'bo',
  organisationId: ORG,
  at: '2026-11-20T08:00:00.000Z',
};

function world() {
  const competence = memoryCompetenceStore();
  const boarding = memoryBoardingStore({
    persons: ['bo', 'karin', 'olle'].map(id => ({ id, organisationId: ORG, name: id, userName: id, enabled: true })),
  });
  const directory = memoryBoardingDirectory({
    units: [{ id: 'u-team', parentId: null, organisationId: ORG, label: 'Teamet' }],
    people: [
      {
        id: 'olle',
        organisationId: ORG,
        enabled: true,
        assignments: [{ unitId: 'u-team', role: 'manager' }],
        positionCodes: [],
        employments: [],
      },
      {
        id: 'bo',
        organisationId: ORG,
        enabled: false,
        assignments: [{ unitId: 'u-team', role: 'employee' }],
        positionCodes: [],
        employments: [],
      },
    ],
  });
  const failed: Array<[string, keyof LeaversTx, string]> = [];
  /** Each binding's port runs in its own store's transaction: its savepoint here. */
  const bindings = (boardingThrows = false, competenceThrows = false): Array<LeaversBinding<null>> => [
    {
      module: 'competence',
      port: () => ({
        deactivated: c =>
          competence.transaction(async tx => {
            await competenceLeavers(tx).deactivated(c);
            if (competenceThrows) throw new Error('competence failed');
          }),
        reactivated: c => competence.transaction(tx => competenceLeavers(tx).reactivated(c)),
      }),
    },
    {
      module: 'boarding',
      port: () => ({
        deactivated: c =>
          boarding.transaction(async tx => {
            await boardingLeavers(tx, directory).deactivated(c);
            if (boardingThrows) throw new Error('boarding failed');
          }),
        reactivated: c => boarding.transaction(tx => boardingLeavers(tx, directory).reactivated(c)),
      }),
    },
  ];
  const leaversOf = (b: Array<LeaversBinding<null>>) =>
    combineLeavers<null>(
      b,
      (tx, fn) => fn(tx),
      (error, c, kind, module) => failed.push([module, kind, (error as Error).message]),
    )(null);
  return { competence, boarding, failed, bindings, leaversOf };
}
/** Bo's leaving plan, which Karin started; the directory says Olle leads Bo's team now. */
async function withPlan(w: ReturnType<typeof world>) {
  await w.boarding.transaction(tx =>
    tx.insertPlan({
      id: 'plan-1',
      organisationId: ORG,
      personId: 'bo',
      event: 'leaving',
      anchorOn: '2026-12-31',
      buddyId: null,
      startedBy: 'karin',
      startedAt: '2026-11-13T08:00:00.000Z',
      closedAt: null,
      heldAt: null,
      heldBy: [],
    }),
  );
}

describe('the leavers port told to competence and boarding (D113)', () => {
  test('a deactivation is told to both: competence records its intent and boarding who holds the plan', async () => {
    const w = world();
    await withPlan(w);
    await w.leaversOf(w.bindings()).deactivated(change);
    expect(w.competence.state.erasures.get('bo')).toMatchObject({ state: 'inactive', inactiveSince: change.at });
    expect(w.boarding.state.plans.get('plan-1')).toMatchObject({ heldAt: change.at, heldBy: ['olle'] });
    expect(w.failed).toEqual([]);
    await w.leaversOf(w.bindings()).reactivated(change);
    expect(w.competence.state.erasures.get('bo')).toMatchObject({ state: 'cancelled' });
    expect(w.boarding.state.plans.get('plan-1')).toMatchObject({ heldAt: null, heldBy: [] });
  });

  test('one domain failing is rolled back alone and reported by name; the other is still told, and the call does not fail', async () => {
    const w = world();
    await withPlan(w);
    await w.leaversOf(w.bindings(true)).deactivated(change);
    expect(w.competence.state.erasures.get('bo')).toMatchObject({ state: 'inactive' });
    expect(w.boarding.state.plans.get('plan-1')).toMatchObject({ heldAt: null, heldBy: [] });
    expect(w.failed).toEqual([['boarding', 'deactivated', 'boarding failed']]);

    const v = world();
    await withPlan(v);
    await v.leaversOf(v.bindings(false, true)).deactivated(change);
    expect(v.competence.state.erasures.get('bo')).toBeUndefined();
    expect(v.boarding.state.plans.get('plan-1')).toMatchObject({ heldBy: ['olle'] });
    expect(v.failed).toEqual([['competence', 'deactivated', 'competence failed']]);
  });

  test('a port that throws before it is told anything is reported too', async () => {
    const w = world();
    const broken: LeaversBinding<null> = {
      module: 'broken',
      port: () => {
        throw new Error('no port');
      },
    };
    await w.leaversOf([broken, ...w.bindings()]).deactivated(change);
    expect(w.failed).toEqual([['broken', 'deactivated', 'no port']]);
    expect(w.competence.state.erasures.get('bo')).toMatchObject({ state: 'inactive' });
  });
});
