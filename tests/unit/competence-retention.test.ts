import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, StaffOverview } from '../../packages/contracts/src/index';
import { ForbiddenError } from '../../apps/server/src/context';
import { memoryCompetenceStore } from '../../apps/server/src/modules/competence/adapters/memory';
import {
  erasureDue,
  isRetentionDays,
  RETENTION_GRACE_MS,
  retentionSummary,
  SWEEP_BATCH,
} from '../../apps/server/src/modules/competence/domain';
import type { CompetenceStore, ErasureRecord } from '../../apps/server/src/modules/competence/model';
import {
  competenceLeavers,
  competenceUsecases,
  RETENTION_ACTOR,
} from '../../apps/server/src/modules/competence/usecases';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { SCIM } from '../../apps/server/src/modules/people/contracts';
import { scimUsecases } from '../../apps/server/src/modules/people/usecases';
import { parseRetentionArguments } from '../../scripts/competence-retention-arguments';

/**
 * The erasure of a person's competence a set time after the directory deactivates them (D108 item 14), on the memory
 * adapters. The SCIM use cases tell the people module's leavers port, which the test binds to the competence module's
 * leavers on the competence memory store as composition binds them on the SCIM transaction (the test mirrors the
 * person's `active` into the competence store, which on Postgres reads the same row; the memory stores commit apart, so
 * one transaction across both is shown in `tests/db`). The period is an operator's setting with no default; the timer is
 * the intents and the hourly sweep (`sweepErasures`), each erasure fenced by the intent's spell. Every branch asserts the
 * state the stores end in and the audit rows written.
 */
const ORG = 'org-1';
const BASE = 'https://clew.test/scim/v2';
const DAY = 24 * 60 * 60_000;
const OPERATOR = 'operator:cli';
const provisioner = { id: 'mk', organisationId: ORG, label: 'Metakatalogen' };
const NAMES = ['Anna Andersson', 'Bo Berg', 'annber', 'boberg', 'HLR'];
const MANAGER: AuthenticatedContext = {
  id: 'boss',
  name: 'Karin Chef',
  unitId: 'u1',
  unitLabel: 'Enhet 1',
  role: 'manager',
  organisationId: ORG,
  principal: { id: 'person:boss', kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
};
const user = (userName: string, displayName: string, active = true) => ({
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  externalId: 'mk-' + userName,
  userName,
  displayName,
  emails: [{ value: userName + '@example.test', type: 'work', primary: true }],
  active,
});

function world() {
  const clock = { now: new Date('2026-11-10T09:00:00.000Z') };
  let seq = 0;
  const ids = () => 'id-' + ++seq;
  const store = memoryCompetenceStore();
  const control = { portFails: false };
  const failures: Array<{ kind: string; personId: string }> = [];
  const logs: Array<{ level: 'info' | 'warn'; message: string; details: unknown[] }> = [];
  // The people module's leavers port, bound as composition binds it: the competence module's own, in a transaction.
  // `active` is mirrored first: on Postgres it is the person's own row, written by the SCIM change whatever the port does.
  const provision = memoryProvisionStore({
    leavers: () => ({
      async deactivated(change) {
        store.deactivate(change.personId);
        await store.transaction(async tx => {
          await competenceLeavers(tx).deactivated(change);
          if (control.portFails) throw Object.assign(new Error('the port failed'), { code: '55P03' });
        });
      },
      async reactivated(change) {
        store.reactivate(change.personId);
        await store.transaction(async tx => {
          await competenceLeavers(tx).reactivated(change);
          if (control.portFails) throw Object.assign(new Error('the port failed'), { code: '55P03' });
        });
      },
    }),
    leaverFailed: (_error, change, kind) => failures.push({ kind, personId: change.personId }),
  });
  const scim = scimUsecases({ store: provision, clock: () => clock.now, ids, digest: t => 'digest:' + t });
  // The manager, Karin, leads one unit with everyone hired on it, active or not as the directory says (D99 item 4).
  const staff = async (persona: AuthenticatedContext): Promise<StaffOverview> =>
    persona.id !== MANAGER.id
      ? { units: [] }
      : {
          units: [
            {
              unitId: 'u1',
              unitLabel: 'Enhet 1',
              people: [...provision.state.users.values()].map(u => ({
                id: u.id,
                name: u.name,
                userName: u.userName,
                email: null,
                role: 'employee' as const,
                enabled: u.enabled,
              })),
            },
          ],
        };
  const over = (s: CompetenceStore) =>
    competenceUsecases({
      store: s,
      staff,
      clock: () => clock.now,
      ids,
      log: (message, ...details) => logs.push({ level: 'warn', message, details }),
      info: (message, ...details) => logs.push({ level: 'info', message, details }),
    });
  const competence = over(store);
  const at = () => clock.now.toISOString();
  return {
    clock,
    store,
    provision,
    scim,
    competence,
    over,
    control,
    failures,
    logs,
    at,
    /** Move the clock on by days (fractions allowed). */
    later(days: number) {
      clock.now = new Date(clock.now.getTime() + days * DAY);
    },
    /** A person pushed by the provisioner, known to the competence module as the same row. */
    async hire(userName: string, displayName: string, active = true) {
      const created = await scim.createUser(provisioner, user(userName, displayName, active), BASE);
      store.addPerson({ id: created.id, organisationId: ORG, name: displayName, userName });
      if (!active) store.deactivate(created.id);
      return created.id;
    },
    patch: (id: string, Operations: unknown[]) =>
      scim.patchUser(provisioner, id, { schemas: [SCIM.patch], Operations }, BASE),
    deactivate(id: string) {
      return this.patch(id, [{ op: 'replace', path: 'active', value: false }]);
    },
    reactivate(id: string) {
      return this.patch(id, [{ op: 'replace', path: 'active', value: true }]);
    },
    /** A certificate registered in Clew for the person. */
    async certify(personId: string) {
      const typeId =
        store.state.types.size > 0
          ? [...store.state.types.keys()][0]!
          : await competence.seedType(OPERATOR, ORG, { name: 'HLR', area: 'Akut', kind: 'certificate' });
      return competence.seedHolding(OPERATOR, ORG, personId, { typeId, issuedOn: '2026-01-10' });
    },
    sweep: () => competence.sweepErasures(),
    intent: (personId: string) => store.state.erasures.get(personId),
    holdings: (personId: string) => [...store.state.holdings.values()].filter(h => h.personId === personId),
    /** The competence audit rows about the person or the organisation, as action, actor and details. */
    audit: (subject: string) =>
      store
        .audit()
        .filter(a => a.subject === subject)
        .map(a => ({ action: a.action, actor: a.actor, details: a.details })),
    erasedRows: (personId: string) =>
      store.audit().filter(a => a.subject === 'person:' + personId && a.action === 'competence.person_erased'),
  };
}

describe('the domain of the erasure timer', () => {
  test('a period is a whole number of days from 1 to 3650', () => {
    expect([1, 30, 3650].every(isRetentionDays)).toBe(true);
    expect([0, -1, 3651, 1.5, Number.NaN, '30', null].some(isRetentionDays)).toBe(false);
  });
  test('an erasure falls due the period after the deactivation, never sooner than a day after the period was set', () => {
    const setAt = '2026-01-01T09:00:00.000Z';
    expect(erasureDue('2026-11-10T09:00:00.000Z', 30, setAt)).toBe('2026-12-10T09:00:00.000Z');
    // Deactivated a hundred days before a period of thirty is set: a day after it was set, not at once.
    const now = '2026-11-10T09:00:00.000Z';
    expect(erasureDue('2026-08-02T09:00:00.000Z', 30, now)).toBe(
      new Date(Date.parse(now) + RETENTION_GRACE_MS).toISOString(),
    );
  });
  test('an organisation’s erasures in counts: held without a period; waiting, overdue and within a day with one', () => {
    const intent = (personId: string, since: string, state: ErasureRecord['state'] = 'inactive'): ErasureRecord => ({
      personId,
      organisationId: ORG,
      state,
      inactiveSince: since,
      generation: 1,
      updatedAt: since,
    });
    const intents = [
      intent('a', '2026-10-01T09:00:00.000Z'), // due 10-31: overdue
      intent('b', '2026-10-10T21:00:00.000Z'), // due 11-09 21:00: overdue
      intent('c', '2026-10-11T12:00:00.000Z'), // due 11-10 12:00: within a day
      intent('d', '2026-11-01T09:00:00.000Z'), // due 12-01
      intent('e', '2026-10-01T09:00:00.000Z', 'cancelled'),
    ];
    const now = '2026-11-10T09:00:00.000Z';
    expect(retentionSummary(intents, undefined, now)).toEqual({
      waiting: 0,
      held: 4,
      overdue: 0,
      dueWithinDay: 0,
      nextDue: null,
    });
    expect(retentionSummary(intents, { days: 30, setAt: '2026-01-01T00:00:00.000Z' }, now)).toEqual({
      waiting: 2,
      held: 0,
      overdue: 2,
      dueWithinDay: 1,
      nextDue: '2026-11-10T12:00:00.000Z',
    });
  });
});

describe('the leavers port is told on every path that changes active (D68, D108 item 14)', () => {
  test('PATCH, PUT and DELETE that deactivate, PUT and PATCH that reactivate, and a user created deactivated', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    const told = () => w.provision.state.leavers.map(l => [l.change, l.personId, l.organisationId, l.actor, l.at]);
    await w.deactivate(anna);
    expect(told()).toEqual([['deactivated', anna, ORG, 'provisioner:mk', w.at()]]);
    // Deactivating again, or changing something else, says nothing.
    await w.deactivate(anna);
    await w.patch(anna, [{ op: 'replace', path: 'displayName', value: 'Anna A' }]);
    expect(told()).toHaveLength(1);
    // A full PUT without `active` enables the person (RFC 7643's default), and is a reactivation.
    const { active: _, ...withoutActive } = user('annber', 'Anna Andersson');
    await w.scim.replaceUser(provisioner, anna, withoutActive, BASE);
    expect(told().at(-1)).toEqual(['reactivated', anna, ORG, 'provisioner:mk', w.at()]);
    await w.scim.replaceUser(provisioner, anna, user('annber', 'Anna Andersson', false), BASE);
    expect(told().at(-1)?.[0]).toBe('deactivated');
    await w.reactivate(anna);
    expect(told().at(-1)?.[0]).toBe('reactivated');
    // DELETE deactivates (D68), once.
    await w.scim.deleteUser(provisioner, anna);
    await w.scim.deleteUser(provisioner, anna);
    expect(told().map(t => t[0])).toEqual(['deactivated', 'reactivated', 'deactivated', 'reactivated', 'deactivated']);
    expect(w.intent(anna)).toMatchObject({ state: 'inactive', generation: 3, inactiveSince: w.at() });
    // A person pushed already deactivated is inactive from the start, and the intent says so.
    const bo = await w.hire('boberg', 'Bo Berg', false);
    expect(told().at(-1)).toEqual(['deactivated', bo, ORG, 'provisioner:mk', w.at()]);
    expect(w.intent(bo)).toEqual({
      personId: bo,
      organisationId: ORG,
      state: 'inactive',
      inactiveSince: w.at(),
      generation: 1,
      updatedAt: w.at(),
    });
  });

  test('a SCIM change that fails takes back the people store’s record of the call (on memory only; tests/db shows both stores roll back together)', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    const failing = scimUsecases({
      store: {
        transaction: fn =>
          w.provision.transaction(async tx => {
            await fn(tx);
            throw new Error('after the use case');
          }),
      },
      clock: () => w.clock.now,
      ids: () => 'x',
      digest: t => t,
    });
    await expect(
      failing.patchUser(
        provisioner,
        anna,
        { schemas: [SCIM.patch], Operations: [{ op: 'replace', path: 'active', value: false }] },
        BASE,
      ),
    ).rejects.toThrow('after the use case');
    expect(w.provision.state.leavers).toEqual([]);
    expect(w.provision.state.users.get(anna)?.enabled).toBe(true);
  });

  test('a port that fails never fails the deactivation: it is reported, and the sweep records it once a period is set', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.certify(anna);
    w.control.portFails = true;
    await w.deactivate(anna);
    expect(w.provision.state.users.get(anna)?.enabled).toBe(false);
    expect(
      w.provision.state.audit.some(a => a.action === 'scim.user.deactivated' && a.subject === 'person:' + anna),
    ).toBe(true);
    expect(w.failures).toEqual([{ kind: 'deactivated', personId: anna }]);
    expect(w.intent(anna)).toBeUndefined();
    w.control.portFails = false;
    // Without a period the sweep records nothing: no organisation's leavers are recorded until it has one.
    expect((await w.sweep()).recorded).toBe(0);
    await w.competence.setRetention(OPERATOR, ORG, 30);
    w.later(1);
    expect(await w.sweep()).toMatchObject({ recorded: 1, erased: 0 });
    expect(w.intent(anna)).toMatchObject({ state: 'inactive', inactiveSince: w.at(), generation: 1 });
    expect(w.audit('person:' + anna).at(-1)).toEqual({
      action: 'competence.leaver_recorded',
      actor: RETENTION_ACTOR,
      details: { organisationId: ORG, generation: 1 },
    });
    // Counted from when the sweep found it, not earlier.
    w.later(29.5);
    expect((await w.sweep()).erased).toBe(0);
    w.later(0.5);
    expect((await w.sweep()).erased).toBe(1);
    expect(w.holdings(anna)).toEqual([]);
  });
});

describe('a deactivated person’s competence is erased a set time after (D108 item 14)', () => {
  test('with no period set nothing is erased: the deactivation is recorded, and a reactivation cancels it', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.certify(anna);
    await w.deactivate(anna);
    const deactivatedAt = w.at();
    expect(w.intent(anna)).toEqual({
      personId: anna,
      organisationId: ORG,
      state: 'inactive',
      inactiveSince: deactivatedAt,
      generation: 1,
      updatedAt: deactivatedAt,
    });
    // The port writes the intent and nothing else: no audit row of the module's own in the SCIM transaction.
    expect(w.store.audit().filter(a => a.subject === 'person:' + anna)).toEqual([]);
    w.later(400);
    expect(await w.sweep()).toMatchObject({ erased: 0, failed: 0, overdue: 0 });
    expect(w.holdings(anna)).toHaveLength(1);
    expect(await w.competence.retentionOf(ORG)).toMatchObject({ period: null, waiting: 0, held: 1 });
    await w.reactivate(anna);
    expect(w.intent(anna)).toMatchObject({ state: 'cancelled', inactiveSince: null, generation: 1 });
  });

  test('deactivated with a period set: erased by the sweep once due, once, audited with the cause, the spell and counts', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    const bo = await w.hire('boberg', 'Bo Berg');
    await w.certify(anna);
    await w.certify(bo);
    expect(await w.competence.setRetention(OPERATOR, ORG, 30)).toEqual({
      changed: true,
      previous: null,
      days: 30,
      inactive: 0,
    });
    expect(w.audit('organisation:' + ORG).at(-1)).toEqual({
      action: 'competence.retention_set',
      actor: OPERATOR,
      details: { days: 30, previous: null, inactive: 0 },
    });
    await w.scim.deleteUser(provisioner, anna);
    expect(await w.competence.retentionOf(ORG)).toMatchObject({
      waiting: 1,
      overdue: 0,
      nextDue: new Date(w.clock.now.getTime() + 30 * DAY).toISOString(),
    });
    // Not yet due: the sweep erases nothing, and eraseDue asked early says so.
    w.later(29);
    expect(await w.sweep()).toMatchObject({ erased: 0 });
    expect(await w.competence.eraseDue(anna, 1)).toBe('early');
    expect(w.holdings(anna)).toHaveLength(1);
    w.later(1);
    expect(await w.sweep()).toEqual({
      recorded: 0,
      returned: 0,
      erased: 1,
      skipped: 0,
      failed: 0,
      left: 0,
      overdue: 0,
    });
    expect(w.holdings(anna)).toEqual([]);
    expect(w.holdings(bo)).toHaveLength(1);
    expect(w.intent(anna)).toMatchObject({ state: 'erased', generation: 1, updatedAt: w.at() });
    expect(w.audit('person:' + anna).at(-1)).toEqual({
      action: 'competence.person_erased',
      actor: RETENTION_ACTOR,
      details: { cause: 'retention', holdings: 1, cleared: 0, requirements: 0, approvals: 0, cards: 0, generation: 1 },
    });
    // Every card of the module in her stream goes in the same transaction (the memory store records the call).
    expect(w.store.calls()).toContainEqual({ op: 'removeOwned', personId: anna });
    expect(w.logs).toContainEqual({
      level: 'info',
      message: 'competence: the erasure sweep ran',
      details: [{ recorded: 0, returned: 0, erased: 1, skipped: 0, failed: 0, left: 0, overdue: 0 }],
    });
    // A second round, or an erasure asked for again, erases nothing and writes nothing.
    const written = w.store.audit().length;
    expect(await w.sweep()).toMatchObject({ erased: 0, skipped: 0 });
    expect(await w.competence.eraseDue(anna, 1)).toBe('stale');
    expect(w.store.audit()).toHaveLength(written);
    const all = JSON.stringify(w.store.audit());
    for (const name of NAMES) expect(all).not.toContain(name);
  });

  test('reactivated before the due time: nothing is erased, and the manager reads what was there before', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.certify(anna);
    await w.competence.setRetention(OPERATOR, ORG, 30);
    await w.deactivate(anna);
    // Between the deactivation and the erasure her holdings leave every view: her manager reaches them no more.
    expect((await w.competence.holdings(MANAGER, { person: 'annber' }).catch(e => e)) instanceof ForbiddenError).toBe(
      true,
    );
    w.later(10);
    await w.reactivate(anna);
    expect(w.intent(anna)).toMatchObject({ state: 'cancelled', inactiveSince: null, generation: 1 });
    expect((await w.competence.holdings(MANAGER, { person: 'annber' })).rows.map(r => r.status)).toEqual(['valid']);
    w.later(30);
    expect(await w.sweep()).toMatchObject({ erased: 0 });
    expect(await w.competence.eraseDue(anna, 1)).toBe('stale');
    expect(w.holdings(anna)).toHaveLength(1);
  });

  test('deactivated twice: the second deactivation is a new spell from its own time, and the first’s erasure is stale', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.certify(anna);
    await w.competence.setRetention(OPERATOR, ORG, 30);
    await w.deactivate(anna);
    w.later(5);
    await w.reactivate(anna);
    w.later(5);
    await w.deactivate(anna);
    expect(w.intent(anna)).toMatchObject({ state: 'inactive', inactiveSince: w.at(), generation: 2 });
    w.later(25);
    expect(await w.sweep()).toMatchObject({ erased: 0 });
    expect(await w.competence.eraseDue(anna, 1)).toBe('stale');
    w.later(5);
    expect(await w.sweep()).toMatchObject({ erased: 1 });
    expect(w.holdings(anna)).toEqual([]);
    // Back after the erasure, and gone again: the next spell, nothing left to erase but the record.
    await w.reactivate(anna);
    expect(w.intent(anna)?.state).toBe('cancelled');
    await w.deactivate(anna);
    expect(w.intent(anna)).toMatchObject({ state: 'inactive', generation: 3 });
  });

  test('a changed period moves no row and applies at once; shortened, nothing falls due within a day of the change', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.certify(anna);
    await w.competence.setRetention(OPERATOR, ORG, 30);
    await w.deactivate(anna);
    const before = structuredClone(w.intent(anna));
    w.later(5);
    // Lengthened: counted from the deactivation, so not erased at the old due time.
    expect(await w.competence.setRetention(OPERATOR, ORG, 60)).toMatchObject({ previous: 30, inactive: 1 });
    expect(w.intent(anna)).toEqual(before!);
    w.later(26);
    expect((await w.sweep()).erased).toBe(0);
    // Shortened below what has passed: due a day after the change, not at once.
    expect(await w.competence.setRetention(OPERATOR, ORG, 2)).toMatchObject({ previous: 60 });
    expect(await w.competence.retentionOf(ORG)).toMatchObject({ waiting: 1, overdue: 0, dueWithinDay: 1 });
    expect((await w.sweep()).erased).toBe(0);
    expect(w.audit('organisation:' + ORG).at(-1)).toEqual({
      action: 'competence.retention_set',
      actor: OPERATOR,
      details: { days: 2, previous: 60, inactive: 1 },
    });
    // The same period again changes nothing and writes nothing.
    const written = w.store.audit().length;
    expect(await w.competence.setRetention(OPERATOR, ORG, 2)).toMatchObject({ changed: false });
    expect(w.store.audit()).toHaveLength(written);
    w.later(1);
    expect((await w.sweep()).erased).toBe(1);
  });

  test('cleared, nothing is erased; set again, counted from the deactivation and never sooner than a day after', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.certify(anna);
    await w.competence.setRetention(OPERATOR, ORG, 30);
    await w.deactivate(anna);
    w.later(3);
    expect(await w.competence.setRetention(OPERATOR, ORG, null)).toEqual({
      changed: true,
      previous: 30,
      days: null,
      inactive: 1,
    });
    expect(w.store.state.retention.has(ORG)).toBe(false);
    expect(w.audit('organisation:' + ORG).at(-1)).toEqual({
      action: 'competence.retention_cleared',
      actor: OPERATOR,
      details: { days: null, previous: 30, inactive: 1 },
    });
    w.later(40);
    expect(await w.sweep()).toMatchObject({ erased: 0 });
    expect(await w.competence.eraseDue(anna, 1)).toBe('unset');
    expect(w.holdings(anna)).toHaveLength(1);
    await w.competence.setRetention(OPERATOR, ORG, 10);
    expect((await w.sweep()).erased).toBe(0);
    w.later(1);
    expect((await w.sweep()).erased).toBe(1);
  });

  test('a period set when people are long deactivated brings them due a day later, in one round of the sweep, one after the other', async () => {
    const w = world();
    const people: string[] = [];
    const count = SWEEP_BATCH * 2 + 50;
    for (let i = 0; i < count; i++) {
      const id = 'p' + String(i).padStart(4, '0');
      w.store.addPerson({ id, organisationId: ORG, name: 'Synthetic', userName: 'u' + id });
      await w.store.transaction(tx =>
        competenceLeavers(tx).deactivated({ actor: 'provisioner:mk', personId: id, organisationId: ORG, at: w.at() }),
      );
      w.store.deactivate(id);
      people.push(id);
    }
    w.later(400);
    await w.competence.setRetention(OPERATOR, ORG, 30);
    expect(await w.competence.retentionOf(ORG)).toMatchObject({ waiting: count, dueWithinDay: count, overdue: 0 });
    w.later(1);
    // Counted: never two transactions at once.
    let open = 0,
      most = 0;
    const counting: CompetenceStore = {
      transaction: async fn => {
        most = Math.max(most, ++open);
        try {
          return await w.store.transaction(fn);
        } finally {
          open--;
        }
      },
    };
    expect(await w.over(counting).sweepErasures()).toMatchObject({ erased: count, failed: 0, left: 0 });
    expect(most).toBe(1);
    expect(people.every(id => w.intent(id)?.state === 'erased')).toBe(true);
  });

  test('a deactivation no intent recorded (before the intents, or a failed port) is recorded by the sweep from when it found it', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    const bo = await w.hire('boberg', 'Bo Berg');
    const cia = await w.hire('ciacar', 'Cia Carlsson');
    await w.certify(bo);
    await w.deactivate(anna);
    const annaLeft = w.at();
    // Bo was deactivated before Clew recorded it: the store knows him as inactive and nothing more.
    w.store.deactivate(bo);
    w.later(1);
    await w.competence.setRetention(OPERATOR, ORG, 30);
    expect(await w.sweep()).toMatchObject({ recorded: 1 });
    expect(w.intent(anna)).toMatchObject({ inactiveSince: annaLeft, generation: 1 });
    expect(w.intent(bo)).toMatchObject({ state: 'inactive', inactiveSince: w.at(), generation: 1 });
    expect(w.intent(cia)).toBeUndefined();
    w.later(29);
    expect(await w.sweep()).toMatchObject({ erased: 1 });
    expect(w.intent(anna)?.state).toBe('erased');
    w.later(1);
    expect(await w.sweep()).toMatchObject({ erased: 1 });
    expect(w.holdings(bo)).toEqual([]);
  });

  test('erased by hand before the period runs: the intent is settled, and neither the sweep nor a later period erases again', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.certify(anna);
    await w.competence.setRetention(OPERATOR, ORG, 30);
    await w.deactivate(anna);
    w.later(2);
    expect(await w.competence.erasePerson(OPERATOR, anna)).toEqual({
      holdings: 1,
      cleared: 0,
      requirements: 0,
      approvals: 0,
      cards: 0,
    });
    expect(w.intent(anna)).toMatchObject({ state: 'erased', generation: 1 });
    w.later(30);
    expect(await w.sweep()).toMatchObject({ erased: 0, recorded: 0 });
    await w.competence.setRetention(OPERATOR, ORG, 60);
    w.later(100);
    expect(await w.sweep()).toMatchObject({ erased: 0, recorded: 0 });
    expect(w.erasedRows(anna).map(a => a.details)).toEqual([
      { cause: 'operator', holdings: 1, cleared: 0, requirements: 0, approvals: 0, cards: 0 },
    ]);
  });

  test('a person active again whose reactivation no intent recorded is never erased: the sweep cancels the intent', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.certify(anna);
    await w.competence.setRetention(OPERATOR, ORG, 30);
    await w.deactivate(anna);
    w.control.portFails = true;
    await w.reactivate(anna);
    expect(w.failures).toEqual([{ kind: 'reactivated', personId: anna }]);
    expect(w.intent(anna)?.state).toBe('inactive');
    w.control.portFails = false;
    w.later(30);
    expect(await w.sweep()).toMatchObject({ returned: 1, erased: 0 });
    expect(w.holdings(anna)).toHaveLength(1);
    expect(w.intent(anna)).toMatchObject({ state: 'cancelled', inactiveSince: null });
    expect(w.audit('person:' + anna).at(-1)).toEqual({
      action: 'competence.erasure_cancelled',
      actor: RETENTION_ACTOR,
      details: { organisationId: ORG, generation: 1, reason: 'active', was: 'inactive' },
    });
    // Asked for directly while she is active, the erasure says so and erases nothing.
    await w.deactivate(anna);
    w.store.reactivate(anna);
    w.later(30);
    expect(await w.competence.eraseDue(anna, 2)).toBe('active');
    expect(w.holdings(anna)).toHaveLength(1);
  });

  test('back after an erasure and gone again with both ports failing: the sweep reconciles each and erases the new spell', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.competence.setRetention(OPERATOR, ORG, 30);
    await w.deactivate(anna);
    w.later(30);
    expect((await w.sweep()).erased).toBe(1);
    w.control.portFails = true;
    await w.reactivate(anna);
    expect(w.intent(anna)?.state).toBe('erased');
    // A round while she is active marks the erased intent as hers no more.
    expect(await w.sweep()).toMatchObject({ returned: 1 });
    expect(w.intent(anna)?.state).toBe('cancelled');
    await w.certify(anna);
    await w.deactivate(anna);
    w.control.portFails = false;
    expect(w.failures.map(f => f.kind)).toEqual(['reactivated', 'deactivated']);
    // The next round records the new spell from when it finds it, and its period runs from there.
    expect(await w.sweep()).toMatchObject({ recorded: 1 });
    expect(w.intent(anna)).toMatchObject({ state: 'inactive', generation: 2 });
    w.later(30);
    expect(await w.sweep()).toMatchObject({ erased: 1 });
    expect(w.holdings(anna)).toEqual([]);
  });

  test('an erasure that fails is logged and asked for again next round; one due for over a day is a warning', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    const bo = await w.hire('boberg', 'Bo Berg');
    await w.certify(anna);
    await w.certify(bo);
    await w.competence.setRetention(OPERATOR, ORG, 30);
    await w.deactivate(anna);
    await w.deactivate(bo);
    // A store whose erasure of Anna fails, as a database that refuses a write would.
    const flaky: CompetenceStore = {
      transaction: fn =>
        w.store.transaction(tx =>
          fn({
            ...tx,
            erasePerson: async id => {
              if (id === anna) throw Object.assign(new Error('refused'), { code: '40001' });
              return tx.erasePerson(id);
            },
          }),
        ),
    };
    w.later(31.5);
    expect(await w.over(flaky).sweepErasures()).toMatchObject({ erased: 1, failed: 1, left: 1, overdue: 1 });
    expect(w.holdings(anna)).toHaveLength(1);
    expect(w.intent(anna)?.state).toBe('inactive');
    expect(w.logs.filter(l => l.level === 'warn')).toEqual([
      {
        level: 'warn',
        message: 'competence: the erasure sweep could not erase one person; the next round asks again',
        details: [{ code: '40001' }],
      },
      {
        level: 'warn',
        message: 'competence: the erasure sweep left erasures due',
        details: [{ recorded: 0, returned: 0, erased: 1, skipped: 0, failed: 1, left: 1, overdue: 1 }],
      },
    ]);
    // The next round, with the store well again, erases her.
    expect(await w.sweep()).toMatchObject({ erased: 1, failed: 0, left: 0, overdue: 0 });
    expect(w.holdings(anna)).toEqual([]);
  });

  test('copied rows the daily read has not removed yet go with the erasure, as the registered ones do', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.certify(anna);
    await w.store.transaction(async tx => {
      await tx.putSource({
        connectorId: 'lms',
        source: 'Lärplattformen',
        run: null,
        claimedAt: null,
        leaseUntil: null,
        startedAt: null,
        finishedAt: null,
        outcome: null,
        counts: null,
      });
      await tx.putCopied([
        {
          ...w.holdings(anna)[0]!,
          id: 'copied-1',
          typeId: null,
          evidence: 'system',
          registeredBy: null,
          copy: { connectorId: 'lms', sourceId: 's1', sourceType: 'course:1', sourceLabel: 'Kurs', readAt: w.at() },
        },
      ]);
    });
    await w.competence.setRetention(OPERATOR, ORG, 30);
    await w.deactivate(anna);
    w.later(30);
    expect((await w.sweep()).erased).toBe(1);
    expect(w.holdings(anna)).toEqual([]);
    expect(w.erasedRows(anna).at(-1)?.details).toMatchObject({ cause: 'retention', holdings: 2 });
  });

  test('a period out of bounds is refused before anything is written', async () => {
    const w = world();
    for (const days of [0, 3651, 1.5, -3])
      await expect(w.competence.setRetention(OPERATOR, ORG, days)).rejects.toThrow(
        'whole number of days from 1 to 3650',
      );
    expect(w.store.state.retention.size).toBe(0);
    expect(w.store.audit()).toEqual([]);
  });

  test('a leavers call whose transaction fails leaves the intent as it was', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.deactivate(anna);
    const before = structuredClone(w.intent(anna));
    await expect(
      w.store.transaction(async tx => {
        await competenceLeavers(tx).reactivated({
          actor: 'provisioner:mk',
          personId: anna,
          organisationId: ORG,
          at: w.at(),
        });
        throw new Error('after the port');
      }),
    ).rejects.toThrow('after the port');
    expect(w.intent(anna)).toEqual(before!);
  });
});

describe('the retention script’s arguments', () => {
  test('`--name value` and `--name=value` alike; an unknown, missing, repeated or contradictory argument is refused', () => {
    expect(parseRetentionArguments(['--organisation', 'org-1'])).toEqual({ organisation: 'org-1', off: false });
    expect(parseRetentionArguments(['--organisation=org-1', '--days=30'])).toEqual({
      organisation: 'org-1',
      days: '30',
      off: false,
    });
    expect(parseRetentionArguments(['--days', '30', '--organisation', 'org-1'])).toEqual({
      organisation: 'org-1',
      days: '30',
      off: false,
    });
    expect(parseRetentionArguments(['--organisation', 'org-1', '--off'])).toEqual({ organisation: 'org-1', off: true });
    for (const [args, says] of [
      [[], 'Name the organisation'],
      [['--organisation'], '--organisation needs a value'],
      [['--organisation', '--days', '3'], '--organisation needs a value'],
      [['--organisation', 'org-1', '--days'], '--days needs a value'],
      [['--organisation', 'org-1', '--days='], '--days needs a value'],
      [['--organisation', 'org-1', '--dayz', '3'], 'Unknown argument "--dayz"'],
      [['--organisation', 'org-1', 'extra'], 'Unknown argument "extra"'],
      [['--organisation', 'org-1', '--days', '3', '--off'], 'either --days or --off'],
      [['--organisation', 'a', '--organisation', 'b'], 'Give --organisation once'],
    ] as const)
      expect(parseRetentionArguments(args)).toContain(says);
  });
});
