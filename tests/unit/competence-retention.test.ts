import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, StaffOverview } from '../../packages/contracts/src/index';
import { ForbiddenError } from '../../apps/server/src/context';
import { memoryCompetenceStore } from '../../apps/server/src/modules/competence/adapters/memory';
import {
  erasureDue,
  erasureStart,
  erasureWorkflowId,
  isRetentionDays,
  RETENTION_GRACE_MS,
} from '../../apps/server/src/modules/competence/domain';
import {
  competenceLeavers,
  competenceUsecases,
  RETENTION_ACTOR,
} from '../../apps/server/src/modules/competence/usecases';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { SCIM } from '../../apps/server/src/modules/people/contracts';
import { scimUsecases } from '../../apps/server/src/modules/people/usecases';

/**
 * The erasure of a person's competence a set time after the directory deactivates them (D108 item 14), on the memory
 * adapters: the SCIM use cases tell the people module's leavers port, which the test binds to the competence module's
 * leavers on the competence memory store as composition binds them on one Postgres transaction (the test mirrors the
 * person's `active` into the competence store, which in Postgres reads the same row). The period is an operator's
 * setting with no default; the timer's step is `eraseDue`, fenced by the intent's generation. Every branch asserts the
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
  // The people module's leavers port, bound as composition binds it: the competence module's own, in a transaction.
  const provision = memoryProvisionStore({
    leavers: () => ({
      deactivated: change =>
        store.transaction(async tx => {
          store.deactivate(change.personId);
          await competenceLeavers(tx).deactivated(change);
        }),
      reactivated: change =>
        store.transaction(async tx => {
          store.reactivate(change.personId);
          await competenceLeavers(tx).reactivated(change);
        }),
    }),
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
  const competence = competenceUsecases({ store, staff, clock: () => clock.now, ids });
  const at = () => clock.now.toISOString();
  return {
    clock,
    store,
    provision,
    scim,
    competence,
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
    intent: (personId: string) => store.state.erasures.get(personId),
    holdings: (personId: string) => [...store.state.holdings.values()].filter(h => h.personId === personId),
    /** The competence audit rows about the person or the organisation, as action and actor. */
    audit: (subject: string) =>
      store
        .audit()
        .filter(a => a.subject === subject)
        .map(a => ({ action: a.action, actor: a.actor, details: a.details })),
  };
}

describe('the domain of the erasure timer', () => {
  test('a period is a whole number of days from 1 to 3650', () => {
    expect([1, 30, 3650].every(isRetentionDays)).toBe(true);
    expect([0, -1, 3651, 1.5, Number.NaN, '30', null].some(isRetentionDays)).toBe(false);
  });
  test('the due time is the period after the start, never sooner than a day after the change', () => {
    const now = '2026-11-10T09:00:00.000Z';
    expect(erasureDue(now, 30, now)).toBe('2026-12-10T09:00:00.000Z');
    // Deactivated a hundred days ago and a period of thirty set now: a day's grace, not at once.
    expect(erasureDue('2026-08-02T09:00:00.000Z', 30, now)).toBe(
      new Date(Date.parse(now) + RETENTION_GRACE_MS).toISOString(),
    );
  });
  test('one workflow per person and generation, carrying whom, which generation and when', () => {
    expect(erasureStart({ personId: 'p1', generation: 2, dueAt: '2026-12-10T09:00:00.000Z' })).toEqual({
      workflow: 'competenceErasure',
      id: 'competence-erasure:p1:2',
      input: { personId: 'p1', generation: 2, dueAt: '2026-12-10T09:00:00.000Z' },
    });
    expect(erasureWorkflowId('p1', 1)).not.toBe(erasureWorkflowId('p1', 2));
  });
});

describe('the leavers port is told on every path that changes active (D68, D108 item 14)', () => {
  test('PATCH, PUT and DELETE that deactivate, PUT and PATCH that reactivate, and a user created deactivated', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    const told = () => w.provision.state.leavers.map(l => [l.change, l.personId, l.actor, l.at]);
    await w.deactivate(anna);
    expect(told()).toEqual([['deactivated', anna, 'provisioner:mk', w.at()]]);
    // Deactivating again, or changing something else, says nothing.
    await w.deactivate(anna);
    await w.patch(anna, [{ op: 'replace', path: 'displayName', value: 'Anna A' }]);
    expect(told()).toHaveLength(1);
    // A full PUT without `active` enables the person (RFC 7643's default), and is a reactivation.
    const { active: _, ...withoutActive } = user('annber', 'Anna Andersson');
    await w.scim.replaceUser(provisioner, anna, withoutActive, BASE);
    expect(told().at(-1)).toEqual(['reactivated', anna, 'provisioner:mk', w.at()]);
    await w.scim.replaceUser(provisioner, anna, user('annber', 'Anna Andersson', false), BASE);
    expect(told().at(-1)?.[0]).toBe('deactivated');
    await w.reactivate(anna);
    expect(told().at(-1)?.[0]).toBe('reactivated');
    // DELETE deactivates (D68), once.
    await w.scim.deleteUser(provisioner, anna);
    await w.scim.deleteUser(provisioner, anna);
    expect(told().map(t => t[0])).toEqual(['deactivated', 'reactivated', 'deactivated', 'reactivated', 'deactivated']);
    // A person pushed already deactivated is inactive from the start.
    const bo = await w.hire('boberg', 'Bo Berg', false);
    expect(told().at(-1)).toEqual(['deactivated', bo, 'provisioner:mk', w.at()]);
  });

  test('a SCIM change that fails takes back what the port was told, with the rest of the transaction', async () => {
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
});

describe('a deactivated person’s competence is erased a set time after (D108 item 14)', () => {
  test('with no period set nothing is scheduled and nothing erased: the deactivation is held, and a reactivation lets go of it', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.certify(anna);
    await w.deactivate(anna);
    const deactivatedAt = w.at();
    expect(w.intent(anna)).toEqual({
      personId: anna,
      organisationId: ORG,
      state: 'held',
      inactiveSince: deactivatedAt,
      dueAt: null,
      generation: 0,
      updatedAt: deactivatedAt,
    });
    expect(w.store.state.enqueued).toEqual([]);
    expect(w.audit('person:' + anna).filter(a => a.action.startsWith('competence.erasure'))).toEqual([]);
    w.later(400);
    expect(w.holdings(anna)).toHaveLength(1);
    expect(await w.competence.retentionOf(ORG)).toMatchObject({ period: null, waiting: 0, held: 1 });
    await w.reactivate(anna);
    expect(w.intent(anna)).toMatchObject({ state: 'cancelled', inactiveSince: null, dueAt: null, generation: 0 });
    expect(w.store.state.cancelled).toEqual([]);
  });

  test('deactivated with a period set: scheduled in the deactivation’s transaction, erased when due, audited with the cause and counts', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    const bo = await w.hire('boberg', 'Bo Berg');
    await w.certify(anna);
    await w.certify(bo);
    expect(await w.competence.setRetention(OPERATOR, ORG, 30)).toEqual({
      changed: true,
      previous: null,
      days: 30,
      scheduled: 0,
      retimed: 0,
      cancelled: 0,
    });
    expect(w.audit('organisation:' + ORG).at(-1)).toEqual({
      action: 'competence.retention_set',
      actor: OPERATOR,
      details: { days: 30, previous: null, scheduled: 0, retimed: 0, cancelled: 0 },
    });
    await w.scim.deleteUser(provisioner, anna);
    const dueAt = new Date(w.clock.now.getTime() + 30 * DAY).toISOString();
    expect(w.intent(anna)).toMatchObject({ state: 'waiting', inactiveSince: w.at(), dueAt, generation: 1 });
    expect(w.store.state.enqueued).toEqual([erasureStart({ personId: anna, generation: 1, dueAt })]);
    expect(w.audit('person:' + anna)).toContainEqual({
      action: 'competence.erasure_scheduled',
      actor: 'provisioner:mk',
      details: { organisationId: ORG, days: 30, dueAt, generation: 1 },
    });
    // Not yet: the workflow woke early by the server's clock and asks again.
    w.later(29);
    expect(await w.competence.eraseDue(anna, 1)).toBe('early');
    expect(w.holdings(anna)).toHaveLength(1);
    w.later(1);
    expect(await w.competence.eraseDue(anna, 1)).toBe('erased');
    expect(w.holdings(anna)).toEqual([]);
    expect(w.holdings(bo)).toHaveLength(1);
    expect(w.intent(anna)).toMatchObject({ state: 'erased', dueAt: null, generation: 1, updatedAt: w.at() });
    expect(w.audit('person:' + anna).at(-1)).toEqual({
      action: 'competence.person_erased',
      actor: RETENTION_ACTOR,
      details: { cause: 'retention', holdings: 1, cleared: 0, requirements: 0, approvals: 0, generation: 1 },
    });
    // A second wake (a retried step, an adopted workflow) erases nothing and writes nothing.
    const written = w.store.audit().length;
    expect(await w.competence.eraseDue(anna, 1)).toBe('stale');
    expect(w.store.audit()).toHaveLength(written);
    // No audit row names a person or a type.
    const all = JSON.stringify(w.store.audit());
    for (const name of NAMES) expect(all).not.toContain(name);
  });

  test('reactivated before the due time: the wait is cancelled after the commit and the person keeps everything', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.certify(anna);
    await w.competence.setRetention(OPERATOR, ORG, 30);
    await w.deactivate(anna);
    const dueAt = w.intent(anna)!.dueAt;
    // Between the deactivation and the erasure her holdings leave every view: her manager reaches them no more.
    expect((await w.competence.holdings(MANAGER, { person: 'annber' }).catch(e => e)) instanceof ForbiddenError).toBe(
      true,
    );
    w.later(10);
    await w.reactivate(anna);
    expect(w.intent(anna)).toMatchObject({ state: 'cancelled', dueAt: null, inactiveSince: null, generation: 1 });
    // Back, she is as she left: her manager reads the certificate registered before.
    expect((await w.competence.holdings(MANAGER, { person: 'annber' })).rows.map(r => r.status)).toEqual(['valid']);
    expect(w.store.state.cancelled).toEqual([erasureWorkflowId(anna, 1)]);
    expect(w.audit('person:' + anna).at(-1)).toEqual({
      action: 'competence.erasure_cancelled',
      actor: 'provisioner:mk',
      details: { organisationId: ORG, reason: 'reactivated', dueAt, generation: 1 },
    });
    // The cancelled workflow wakes anyway (a cancel that never arrived): the fence refuses it.
    w.later(30);
    expect(await w.competence.eraseDue(anna, 1)).toBe('stale');
    expect(w.holdings(anna)).toHaveLength(1);
  });

  test('deactivated twice: the second deactivation is a new generation from its own time, and the first’s wake is stale', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.certify(anna);
    await w.competence.setRetention(OPERATOR, ORG, 30);
    await w.deactivate(anna);
    w.later(5);
    await w.reactivate(anna);
    w.later(5);
    await w.deactivate(anna);
    const second = w.intent(anna)!;
    expect(second).toMatchObject({ state: 'waiting', inactiveSince: w.at(), generation: 2 });
    expect(second.dueAt).toBe(new Date(w.clock.now.getTime() + 30 * DAY).toISOString());
    expect(w.store.state.enqueued.map(s => s.id)).toEqual([erasureWorkflowId(anna, 1), erasureWorkflowId(anna, 2)]);
    w.later(20);
    expect(await w.competence.eraseDue(anna, 1)).toBe('stale');
    expect(w.holdings(anna)).toHaveLength(1);
    w.later(10);
    expect(await w.competence.eraseDue(anna, 2)).toBe('erased');
    expect(w.holdings(anna)).toEqual([]);
    // Back again after the erasure and gone once more: the next generation, and nothing left to erase but the record.
    await w.reactivate(anna);
    expect(w.intent(anna)?.state).toBe('erased');
    await w.deactivate(anna);
    expect(w.intent(anna)).toMatchObject({ state: 'waiting', generation: 3 });
  });

  test('a changed period re-times every erasure that waits as a new generation; shortened, none falls due within a day', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.certify(anna);
    await w.competence.setRetention(OPERATOR, ORG, 30);
    await w.deactivate(anna);
    const since = w.intent(anna)!.inactiveSince!;
    w.later(5);
    // Lengthened: counted from the deactivation.
    expect(await w.competence.setRetention(OPERATOR, ORG, 60)).toMatchObject({
      previous: 30,
      retimed: 1,
      scheduled: 0,
    });
    expect(w.intent(anna)).toMatchObject({
      state: 'waiting',
      generation: 2,
      inactiveSince: since,
      dueAt: new Date(Date.parse(since) + 60 * DAY).toISOString(),
    });
    expect(w.store.state.cancelled).toEqual([erasureWorkflowId(anna, 1)]);
    // Shortened below what has passed: a day from now, not at once.
    expect(await w.competence.setRetention(OPERATOR, ORG, 2)).toMatchObject({ previous: 60, retimed: 1 });
    expect(w.intent(anna)).toMatchObject({
      generation: 3,
      dueAt: new Date(w.clock.now.getTime() + RETENTION_GRACE_MS).toISOString(),
    });
    expect(await w.competence.retentionOf(ORG)).toMatchObject({ waiting: 1, dueWithinDay: 1 });
    expect(w.audit('organisation:' + ORG).at(-1)).toEqual({
      action: 'competence.retention_set',
      actor: OPERATOR,
      details: { days: 2, previous: 60, scheduled: 0, retimed: 1, cancelled: 0 },
    });
    // The same period again changes nothing and writes nothing.
    const written = w.store.audit().length;
    expect(await w.competence.setRetention(OPERATOR, ORG, 2)).toMatchObject({ changed: false });
    expect(w.store.audit()).toHaveLength(written);
    // The old generations wake to nothing; the current one erases.
    w.later(1);
    expect(await w.competence.eraseDue(anna, 1)).toBe('stale');
    expect(await w.competence.eraseDue(anna, 2)).toBe('stale');
    expect(w.holdings(anna)).toHaveLength(1);
    expect(await w.competence.eraseDue(anna, 3)).toBe('erased');
    expect(w.holdings(anna)).toEqual([]);
  });

  test('cleared, every wait is cancelled and the people are held with their times; set again, counted from them', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.certify(anna);
    await w.competence.setRetention(OPERATOR, ORG, 30);
    await w.deactivate(anna);
    const since = w.intent(anna)!.inactiveSince!;
    w.later(3);
    expect(await w.competence.setRetention(OPERATOR, ORG, null)).toMatchObject({
      changed: true,
      previous: 30,
      days: null,
      cancelled: 1,
    });
    expect(w.intent(anna)).toMatchObject({ state: 'held', dueAt: null, inactiveSince: since, generation: 1 });
    expect(w.store.state.retention.has(ORG)).toBe(false);
    expect(w.audit('organisation:' + ORG).at(-1)).toEqual({
      action: 'competence.retention_cleared',
      actor: OPERATOR,
      details: { days: null, previous: 30, scheduled: 0, retimed: 0, cancelled: 1 },
    });
    w.later(40);
    expect(await w.competence.eraseDue(anna, 1)).toBe('stale');
    expect(w.holdings(anna)).toHaveLength(1);
    // Set again: from the deactivation, which is long past, so a day from now.
    expect(await w.competence.setRetention(OPERATOR, ORG, 10)).toMatchObject({ scheduled: 1, retimed: 0 });
    expect(w.intent(anna)).toMatchObject({
      state: 'waiting',
      generation: 2,
      inactiveSince: since,
      dueAt: new Date(w.clock.now.getTime() + RETENTION_GRACE_MS).toISOString(),
    });
  });

  test('setting a period schedules everyone already deactivated: from their deactivation where known, else from now', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    const bo = await w.hire('boberg', 'Bo Berg');
    const cia = await w.hire('ciacar', 'Cia Carlsson');
    await w.deactivate(anna);
    const annaLeft = w.at();
    // Bo was deactivated before Clew recorded it: the competence store knows him as inactive and nothing more.
    w.store.deactivate(bo);
    w.later(1);
    expect(await w.competence.setRetention(OPERATOR, ORG, 30)).toMatchObject({ scheduled: 2, retimed: 0 });
    expect(w.intent(anna)).toMatchObject({
      inactiveSince: annaLeft,
      dueAt: new Date(Date.parse(annaLeft) + 30 * DAY).toISOString(),
      generation: 1,
    });
    expect(w.intent(bo)).toMatchObject({
      state: 'waiting',
      inactiveSince: w.at(),
      dueAt: new Date(w.clock.now.getTime() + 30 * DAY).toISOString(),
      generation: 1,
    });
    expect(w.intent(cia)).toBeUndefined();
    expect(w.store.state.enqueued.map(s => s.id).sort()).toEqual(
      [erasureWorkflowId(anna, 1), erasureWorkflowId(bo, 1)].sort(),
    );
  });

  test('erased by hand before the timer fires: the intent is settled, its wait cancelled, and the wake erases nothing more', async () => {
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
    });
    expect(w.intent(anna)).toMatchObject({ state: 'erased', dueAt: null, generation: 1 });
    expect(w.store.state.cancelled).toEqual([erasureWorkflowId(anna, 1)]);
    w.later(30);
    expect(await w.competence.eraseDue(anna, 1)).toBe('stale');
    expect(w.audit('person:' + anna).filter(a => a.action === 'competence.person_erased')).toEqual([
      {
        action: 'competence.person_erased',
        actor: OPERATOR,
        details: { cause: 'operator', holdings: 1, cleared: 0, requirements: 0, approvals: 0 },
      },
    ]);
    // A period set later schedules nothing for someone erased.
    expect(await w.competence.setRetention(OPERATOR, ORG, 60)).toMatchObject({ scheduled: 0, retimed: 0 });
  });

  test('a person found active when due, though no reactivation reached the intent, is not erased and the intent is cancelled', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.certify(anna);
    await w.competence.setRetention(OPERATOR, ORG, 30);
    await w.deactivate(anna);
    w.store.reactivate(anna);
    w.later(30);
    expect(await w.competence.eraseDue(anna, 1)).toBe('active');
    expect(w.holdings(anna)).toHaveLength(1);
    expect(w.intent(anna)).toMatchObject({ state: 'cancelled', dueAt: null });
    expect(w.audit('person:' + anna).at(-1)).toMatchObject({
      action: 'competence.erasure_cancelled',
      actor: RETENTION_ACTOR,
      details: { reason: 'active', generation: 1 },
    });
  });

  test('a period removed under a waiting intent erases nothing, and an unknown person is stale', async () => {
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.certify(anna);
    await w.competence.setRetention(OPERATOR, ORG, 30);
    await w.deactivate(anna);
    await w.store.transaction(tx => tx.removeRetention(ORG));
    w.later(30);
    expect(await w.competence.eraseDue(anna, 1)).toBe('unset');
    expect(w.holdings(anna)).toHaveLength(1);
    expect(await w.competence.eraseDue('nobody', 1)).toBe('stale');
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
    expect(await w.competence.eraseDue(anna, 1)).toBe('erased');
    expect(w.holdings(anna)).toEqual([]);
    expect(w.audit('person:' + anna).at(-1)?.details).toMatchObject({ cause: 'retention', holdings: 2 });
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

  test('a leavers call whose transaction fails leaves the intent as it was and cancels nothing', async () => {
    // The memory stores commit apart, so this shows only the competence side's own rollback: a leavers call that
    // throws leaves its intent as it was. On Postgres both are one transaction (tests/db).
    const w = world();
    const anna = await w.hire('annber', 'Anna Andersson');
    await w.competence.setRetention(OPERATOR, ORG, 30);
    await w.deactivate(anna);
    const before = structuredClone(w.intent(anna));
    await expect(
      w.store.transaction(async tx => {
        await competenceLeavers(tx).reactivated({ actor: 'provisioner:mk', personId: anna, at: w.at() });
        throw new Error('after the port');
      }),
    ).rejects.toThrow('after the port');
    expect(w.intent(anna)).toEqual(before!);
    expect(w.store.state.cancelled).toEqual([]);
  });
});
