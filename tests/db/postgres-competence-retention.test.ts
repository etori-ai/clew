import { afterAll, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, like, or } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import { competenceStoreWithCards } from '../../apps/server/src/composition/competence';
import { competenceTx } from '../../apps/server/src/modules/competence/adapters/postgres';
import type { CompetenceStore } from '../../apps/server/src/modules/competence/model';
import { competenceLeavers, competenceUsecases } from '../../apps/server/src/modules/competence/usecases';
import { postgresProvisionStore } from '../../apps/server/src/modules/people/adapters/postgres';
import { SCIM } from '../../apps/server/src/modules/people/contracts';
import type { LeaversTx, ProvisionStore } from '../../apps/server/src/modules/people/ports';
import { scimUsecases } from '../../apps/server/src/modules/people/usecases';
import { testDurable } from './durable';

/**
 * The erasure of D108 item 14 on Postgres, bound as composition binds it: the people module's leavers port is the
 * competence module's leavers on a `CompetenceTx` over a savepoint of the SCIM transaction itself, with a lock timeout.
 * So the deactivation and the intent commit together or roll back together; a failure or a lock wait in the port is
 * rolled back to the savepoint and the deactivation commits all the same; setting the period and a SCIM write never
 * wait on each other; a reactivation racing an erasure ends one way or the other, in both orders; two sweeps at once
 * erase once; and an erasure takes every card of the module in the person's stream. The erasure runs on the server's
 * store (`competenceStoreWithCards`). Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');

const tag = Math.random().toString(36).slice(2, 8);
const ORG = `competence-retention-${tag}`;
const people: string[] = [];
const p = { id: `mk-${tag}`, organisationId: ORG, label: 'Synthetic provisioner' };
const BASE = 'https://clew.test/scim/v2';
const OPERATOR = 'operator:test';
const DAY = 24 * 60 * 60_000;
let now = new Date('2026-03-02T09:00:00.000Z');
const clock = () => now;
let n = 0;
const ids = () => `${ORG}-${++n}`;
const failures: Array<{ kind: string; personId: string; code: unknown }> = [];
/** The binding composition makes; `fail` throws after the intent is written, as a failure late in the port would. */
const binding = { fail: false };
const leavers = (tx: Parameters<typeof competenceTx>[0]): LeaversTx => {
  const real = competenceLeavers(competenceTx(tx, testDurable));
  const then = async () => {
    if (binding.fail) throw Object.assign(new Error('the port failed'), { code: 'XX000' });
  };
  return {
    deactivated: async change => (await real.deactivated(change), then()),
    reactivated: async change => (await real.reactivated(change), then()),
  };
};
const provision = postgresProvisionStore({
  leavers,
  leaverFailed: (error, change, kind) => {
    const e = error as { code?: unknown; cause?: { code?: unknown } };
    failures.push({ kind, personId: change.personId, code: e.code ?? e.cause?.code });
  },
});
const scimOver = (store: ProvisionStore) => scimUsecases({ store, clock, ids, digest: t => t });
const scim = scimOver(provision);
const competenceOver = (store: CompetenceStore) =>
  competenceUsecases({ store, staff: async () => ({ units: [] }), clock, ids });
const store = competenceStoreWithCards({ durable: testDurable, cancel: async () => undefined }, { clock });
const competence = competenceOver(store);
const patch = (scimUc: ReturnType<typeof scimOver>, id: string, Operations: unknown[]) =>
  scimUc.patchUser(p, id, { schemas: [SCIM.patch], Operations }, BASE);
const active = (id: string, value: boolean, via = scim) => patch(via, id, [{ op: 'replace', path: 'active', value }]);
let typeId = '';
const seeded: string[] = [];

/** A person of the organisation with a certificate registered in Clew. */
async function person(name: string, enabled = true) {
  const id = `${ORG}-${name}`;
  people.push(id);
  await database()
    .insert(schema.people)
    .values({
      id,
      organisationId: ORG,
      name: 'Synthetic',
      userName: `${tag}.${name}`,
      externalId: `${tag}-${name}`,
      enabled,
    });
  if (!typeId)
    typeId = await competence.seedType(OPERATOR, ORG, { name: 'Brandskydd ' + tag, area: 'Säkerhet', kind: 'course' });
  seeded.push(await competence.seedHolding(OPERATOR, ORG, id, { typeId, issuedOn: '2026-01-10' }));
  return id;
}
/** A transaction held open after its work until `release`, with its locks: `inside` resolves once it is there. */
function held<S extends { transaction: (fn: never) => Promise<unknown> }>(base: S) {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve)),
    inside = new Promise<void>(resolve => (entered = resolve));
  const wrapped = {
    transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      (base.transaction as (f: (tx: unknown) => Promise<unknown>) => Promise<unknown>)(async tx => {
        const result = await fn(tx);
        entered();
        await gate;
        return result;
      }),
  } as unknown as S;
  return { store: wrapped, inside, release };
}
/** Whether a promise has been fulfilled within `ms`; one that is refused throws, so it cannot pass for one that waited. */
const settledWithin = async (promise: Promise<unknown>, ms: number) => {
  let done = false;
  const settled = promise.then(() => (done = true));
  await Promise.race([settled, new Promise(resolve => setTimeout(resolve, ms))]);
  return done;
};
const intent = async (personId: string) =>
  (
    await database().select().from(schema.competenceErasures).where(eq(schema.competenceErasures.personId, personId))
  )[0];
const holdings = async (personId: string) =>
  (await database().select().from(schema.competenceHoldings).where(eq(schema.competenceHoldings.personId, personId)))
    .length;
const enabled = async (personId: string) =>
  (
    await database()
      .select({ enabled: schema.people.enabled })
      .from(schema.people)
      .where(eq(schema.people.id, personId))
  )[0]?.enabled;
const erasedRows = (personId: string) =>
  database()
    .select({ details: schema.audit.details })
    .from(schema.audit)
    .where(and(eq(schema.audit.subject, 'person:' + personId), eq(schema.audit.action, 'competence.person_erased')));

afterAll(async () => {
  const db = database();
  await db
    .delete(schema.audit)
    .where(
      or(
        inArray(schema.audit.subject, [...people.map(id => 'person:' + id), 'organisation:' + ORG]),
        like(schema.audit.subject, `thread:${ORG}%`),
        inArray(schema.audit.subject, [...seeded.map(id => 'holding:' + id), 'competence-type:' + typeId]),
      ),
    );
  await db.delete(schema.workOccurrences).where(inArray(schema.workOccurrences.personId, people));
  await db.delete(schema.threads).where(inArray(schema.threads.personId, people));
  await db.delete(schema.competenceHoldings).where(inArray(schema.competenceHoldings.personId, people));
  await db.delete(schema.competenceErasures).where(inArray(schema.competenceErasures.personId, people));
  await db.delete(schema.competenceRetention).where(eq(schema.competenceRetention.organisationId, ORG));
  await db.delete(schema.competenceTypes).where(eq(schema.competenceTypes.organisationId, ORG));
  await db.delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, people));
  await db.delete(schema.people).where(inArray(schema.people.id, people));
  await closeDatabase();
});

test('the intent commits with the deactivation and rolls back with it; a person created inactive has one at once', async () => {
  const anna = await person('anna');
  const failing = scimOver({
    transaction: fn =>
      provision.transaction(async tx => {
        await fn(tx);
        throw new Error('after the use case');
      }),
  });
  await expect(active(anna, false, failing)).rejects.toThrow('after the use case');
  expect(await enabled(anna)).toBe(true);
  expect(await intent(anna)).toBeUndefined();
  await active(anna, false);
  expect(await enabled(anna)).toBe(false);
  expect(await intent(anna)).toMatchObject({
    state: 'inactive',
    generation: 1,
    inactiveSince: now,
    organisationId: ORG,
  });
  // A rolled-back reactivation leaves it inactive.
  await expect(active(anna, true, failing)).rejects.toThrow('after the use case');
  expect((await intent(anna))?.state).toBe('inactive');
  await active(anna, true);
  expect(await intent(anna)).toMatchObject({ state: 'cancelled', inactiveSince: null, generation: 1 });
  // Pushed already deactivated.
  const created = await scim.createUser(
    p,
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      externalId: `${tag}-created`,
      userName: `${tag}.created`,
      displayName: 'Synthetic',
      emails: [{ value: `${tag}.created@example.test`, type: 'work', primary: true }],
      active: false,
    },
    BASE,
  );
  people.push(created.id);
  expect(await intent(created.id)).toMatchObject({ state: 'inactive', generation: 1, inactiveSince: now });
  expect(failures).toEqual([]);
});

test('a port that fails, or waits longer than its lock timeout, never fails the deactivation: it rolls back to its savepoint and the sweep reconciles', async () => {
  const bo = await person('bo');
  binding.fail = true;
  await active(bo, false);
  binding.fail = false;
  expect(await enabled(bo)).toBe(false);
  // The intent the port wrote before it failed went with its savepoint; the deactivation stands.
  expect(await intent(bo)).toBeUndefined();
  expect(failures).toEqual([{ kind: 'deactivated', personId: bo, code: 'XX000' }]);
  await competence.setRetention(OPERATOR, ORG, 30);
  expect((await competence.sweepErasures()).recorded).toBeGreaterThanOrEqual(1);
  expect(await intent(bo)).toMatchObject({ state: 'inactive', generation: 1, inactiveSince: now });
  // An erasure holds Bo's intent: his reactivation waits for it at most the lock timeout, then commits without it.
  const holding = held(store);
  const locking = holding.store.transaction(async tx => void (await tx.erasure(bo)));
  await holding.inside;
  const started = Date.now();
  await active(bo, true);
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(await enabled(bo)).toBe(true);
  expect(failures.at(-1)).toEqual({ kind: 'reactivated', personId: bo, code: '55P03' });
  holding.release();
  await locking;
  expect((await intent(bo))?.state).toBe('inactive');
  // The sweep finds him active and cancels the intent; nothing of his was erased.
  now = new Date(now.getTime() + 31 * DAY);
  expect((await competence.sweepErasures()).returned).toBeGreaterThanOrEqual(1);
  expect((await intent(bo))?.state).toBe('cancelled');
  expect(await erasedRows(bo)).toEqual([]);
  expect(await holdings(bo)).toBe(1);
  await competence.setRetention(OPERATOR, ORG, null);
});

test('setting the period and a SCIM write that holds the person row FOR UPDATE never wait on each other, in either order', async () => {
  const cia = await person('cia');
  // A change of `externalId` with the deactivation takes FOR UPDATE on the person: the strongest lock a SCIM write takes.
  const write = (via = scim, value = false) =>
    via.replaceUser(
      p,
      cia,
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        externalId: `${tag}-cia-${value ? 'back' : 'gone'}`,
        userName: `${tag}.cia`,
        displayName: 'Synthetic',
        emails: [{ value: `${tag}.cia@example.test`, type: 'work', primary: true }],
        active: value,
      },
      BASE,
    );
  // The period's transaction held open with its lock: the deactivation commits meanwhile.
  const setting = held(store);
  const set = competenceOver(setting.store).setRetention(OPERATOR, ORG, 30);
  await setting.inside;
  expect(await settledWithin(write(), 1_500)).toBe(true);
  expect(await intent(cia)).toMatchObject({ state: 'inactive', generation: 1 });
  setting.release();
  await set;
  // The SCIM write held open with the person row FOR UPDATE: the period changes meanwhile.
  const writing = held(provision);
  const back = write(scimOver(writing.store), true);
  await writing.inside;
  expect(await settledWithin(competence.setRetention(OPERATOR, ORG, 10), 1_500)).toBe(true);
  writing.release();
  await back;
  expect((await intent(cia))?.state).toBe('cancelled');
  await competence.setRetention(OPERATOR, ORG, null);
});

test('a deactivation while the period is being set or cleared waits for neither, and is erased under the period as it ends', async () => {
  const dan = await person('dan'),
    eve = await person('eve');
  // Set: held open while Dan leaves; his erasure falls due under it.
  const setting = held(store);
  const set = competenceOver(setting.store).setRetention(OPERATOR, ORG, 5);
  await setting.inside;
  expect(await settledWithin(active(dan, false), 1_500)).toBe(true);
  setting.release();
  await set;
  now = new Date(now.getTime() + 5 * DAY);
  await competence.sweepErasures();
  expect(await holdings(dan)).toBe(0);
  expect(await erasedRows(dan)).toHaveLength(1);
  // Cleared: held open while Eve leaves; nothing of hers is erased however long she is gone.
  const clearing = held(store);
  const clear = competenceOver(clearing.store).setRetention(OPERATOR, ORG, null);
  await clearing.inside;
  expect(await settledWithin(active(eve, false), 1_500)).toBe(true);
  clearing.release();
  await clear;
  now = new Date(now.getTime() + 400 * DAY);
  await competence.sweepErasures();
  expect(await holdings(eve)).toBe(1);
  expect(await erasedRows(eve)).toEqual([]);
  expect(await intent(eve)).toMatchObject({ state: 'inactive', generation: 1 });
});

test('a reactivation racing the erasure: an erasure that holds the intent first erases, one that comes second finds it cancelled', async () => {
  const fay = await person('fay'),
    gus = await person('gus');
  await competence.setRetention(OPERATOR, ORG, 1);
  await active(fay, false);
  await active(gus, false);
  now = new Date(now.getTime() + 2 * DAY);
  // The erasure first: it erases and holds the intent; the reactivation waits, then marks her active again.
  const erasing = held(store);
  const erase = competenceOver(erasing.store).eraseDue(fay, 1);
  await erasing.inside;
  const back = active(fay, true);
  await new Promise(resolve => setTimeout(resolve, 300));
  erasing.release();
  expect(await erase).toBe('erased');
  await back;
  expect(await enabled(fay)).toBe(true);
  expect(await holdings(fay)).toBe(0);
  expect((await intent(fay))?.state).toBe('cancelled');
  expect(await erasedRows(fay)).toHaveLength(1);
  // The reactivation first: it holds the intent cancelled; the erasure waits, then finds it so and erases nothing.
  const returning = held(provision);
  const backFirst = active(gus, true, scimOver(returning.store));
  await returning.inside;
  const late = competence.eraseDue(gus, 1);
  await new Promise(resolve => setTimeout(resolve, 300));
  returning.release();
  await backFirst;
  expect(await late).toBe('stale');
  expect(await holdings(gus)).toBe(1);
  expect(await erasedRows(gus)).toEqual([]);
  await competence.setRetention(OPERATOR, ORG, null);
});

test('two sweeps at once erase each person once, and an erasure takes every card of the module in the person’s stream', async () => {
  const hal = await person('hal'),
    ida = await person('ida');
  const card = (personId: string, id: string, connector: string, topic: string) =>
    database()
      .insert(schema.threads)
      .values({
        id: `${ORG}-${id}`,
        personId,
        kind: 'pushed',
        topic,
        title: 'Brandskydd gick ut 1 mars',
        trigger: { reason: 'Har gått ut', source: 'Kompetens', at: now.toISOString() },
        connector,
        area: 'competence',
      });
  await card(hal, 'due', 'competence', 'competence:due:' + typeId);
  await card(hal, 'missing', 'competence', 'competence:missing:' + typeId);
  await card(hal, 'other', 'hr', 'hr:delegation');
  await card(ida, 'due-ida', 'competence', 'competence:due:' + typeId);
  await database()
    .insert(schema.workOccurrences)
    .values({
      id: `${ORG}-occurrence`,
      personId: hal,
      connector: 'competence',
      assignment: 'own',
      sourceKey: 'competence:due:' + typeId,
      period: 'expired|2026-03-01|none',
      revision: 'expired',
      observedAt: now,
      sourceState: 'present',
      disposition: 'open',
      threadId: null,
      legacy: false,
    });
  await competence.setRetention(OPERATOR, ORG, 1);
  await active(hal, false);
  await active(ida, false);
  // Ida's card goes with her erasure; Hal keeps only the card of another connector.
  now = new Date(now.getTime() + 2 * DAY);
  const [one, two] = await Promise.all([competence.sweepErasures(), competence.sweepErasures()]);
  expect(one.failed + two.failed).toBe(0);
  for (const id of [hal, ida]) expect(await erasedRows(id)).toHaveLength(1);
  const left = await database()
    .select({ id: schema.threads.id })
    .from(schema.threads)
    .where(eq(schema.threads.personId, hal));
  expect(left.map(t => t.id)).toEqual([`${ORG}-other`]);
  expect(
    await database().select().from(schema.workOccurrences).where(eq(schema.workOccurrences.personId, hal)),
  ).toEqual([]);
  expect(await holdings(hal)).toBe(0);
  await competence.setRetention(OPERATOR, ORG, null);
});
