import { afterAll, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import { competenceStoreWithCards } from '../../apps/server/src/composition/competence';
import { competenceTx } from '../../apps/server/src/modules/competence/adapters/postgres';
import { erasureWorkflowId } from '../../apps/server/src/modules/competence/domain';
import type { CompetenceStore } from '../../apps/server/src/modules/competence/model';
import { competenceLeavers, competenceUsecases } from '../../apps/server/src/modules/competence/usecases';
import { postgresProvisionStore } from '../../apps/server/src/modules/people/adapters/postgres';
import { SCIM } from '../../apps/server/src/modules/people/contracts';
import type { ProvisionStore } from '../../apps/server/src/modules/people/ports';
import { scimUsecases } from '../../apps/server/src/modules/people/usecases';
import { enqueuedWorkflows, testDurable } from './durable';

/**
 * The erasure timer's intent on Postgres (D108 item 14), bound as composition binds it: the people module's leavers port
 * is the competence module's leavers on a `CompetenceTx` over the SCIM transaction itself. So the deactivation, its
 * `scim.*` audit row, the intent, its audit row and the workflow's start (D86) commit together or roll back together,
 * and the wait a reactivation ends is cancelled only once it has committed. A deactivation that arrives while the
 * period is being set waits for it and reads it. The erasure itself runs on the server's store
 * (`competenceStoreWithCards`). Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');

const tag = Math.random().toString(36).slice(2, 8);
const ORG = `competence-retention-${tag}`;
const anna = `${ORG}-anna`,
  bo = `${ORG}-bo`;
const people = [anna, bo];
const p = { id: `mk-${tag}`, organisationId: ORG, label: 'Synthetic provisioner' };
const BASE = 'https://clew.test/scim/v2';
const OPERATOR = 'operator:test';
let now = new Date('2026-03-02T09:00:00.000Z');
const clock = () => now;
let n = 0;
const ids = () => `${ORG}-${++n}`;
const cancelled: string[] = [];
const cancel = async (id: string) => void cancelled.push(id);
const provision = postgresProvisionStore({
  leavers: (tx, ended) => competenceLeavers(competenceTx(tx, testDurable, undefined, ended)),
  cancel,
});
const scimOver = (store: ProvisionStore) => scimUsecases({ store, clock, ids, digest: t => t });
const scim = scimOver(provision);
const competenceOver = (store: CompetenceStore) =>
  competenceUsecases({ store, staff: async () => ({ units: [] }), clock, ids });
const store = competenceStoreWithCards({ durable: testDurable, cancel }, { clock });
const competence = competenceOver(store);
const active = (id: string, value: boolean) =>
  scim.patchUser(p, id, { schemas: [SCIM.patch], Operations: [{ op: 'replace', path: 'active', value }] }, BASE);

afterAll(async () => {
  const db = database();
  await db
    .delete(schema.audit)
    .where(inArray(schema.audit.subject, [...people.map(id => 'person:' + id), 'organisation:' + ORG]));
  await db.delete(schema.audit).where(like(schema.audit.subject, `holding:${ORG}%`));
  await db.delete(schema.audit).where(like(schema.audit.subject, `competence-type:${ORG}%`));
  await db.delete(schema.competenceHoldings).where(inArray(schema.competenceHoldings.personId, people));
  await db.delete(schema.competenceErasures).where(inArray(schema.competenceErasures.personId, people));
  await db.delete(schema.competenceRetention).where(eq(schema.competenceRetention.organisationId, ORG));
  await db.delete(schema.competenceTypes).where(eq(schema.competenceTypes.organisationId, ORG));
  await db.delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, people));
  await db.delete(schema.people).where(inArray(schema.people.id, people));
  await db.execute(
    sql`delete from dbos.workflow_status where application_name = ${testDurable.application} and workflow_uuid like ${'competence-erasure:' + ORG + '%'}`,
  );
  await closeDatabase();
});

const intent = async (personId: string) =>
  (
    await database().select().from(schema.competenceErasures).where(eq(schema.competenceErasures.personId, personId))
  )[0];
const enabled = async (personId: string) =>
  (
    await database()
      .select({ enabled: schema.people.enabled })
      .from(schema.people)
      .where(eq(schema.people.id, personId))
  )[0]?.enabled;
const actions = async (personId: string) =>
  (
    await database()
      .select({ action: schema.audit.action, actor: schema.audit.actor })
      .from(schema.audit)
      .where(eq(schema.audit.subject, 'person:' + personId))
      .orderBy(schema.audit.id)
  ).map(r => r.action);

test('the intent, its audit row and its workflow commit with the deactivation and roll back with it; a reactivation cancels after its commit', async () => {
  const db = database();
  for (const id of people)
    await db
      .insert(schema.people)
      .values({ id, organisationId: ORG, name: 'Synthetic', userName: id.replaceAll('-', '.') });
  const typeId = await competence.seedType(OPERATOR, ORG, { name: 'Brandskydd', area: 'Säkerhet', kind: 'course' });
  await competence.seedHolding(OPERATOR, ORG, anna, { typeId, issuedOn: '2026-01-10' });
  expect(await competence.setRetention(OPERATOR, ORG, 30)).toMatchObject({ changed: true, scheduled: 0 });

  // A SCIM transaction that fails after the use case's work: nothing of the deactivation, the intent or its start.
  const failing = scimOver({
    transaction: fn =>
      provision.transaction(async tx => {
        await fn(tx);
        throw new Error('after the use case');
      }),
  });
  await expect(
    failing.patchUser(
      p,
      anna,
      { schemas: [SCIM.patch], Operations: [{ op: 'replace', path: 'active', value: false }] },
      BASE,
    ),
  ).rejects.toThrow('after the use case');
  expect(await enabled(anna)).toBe(true);
  expect(await intent(anna)).toBeUndefined();
  expect(await enqueuedWorkflows('competence-erasure:' + anna)).toEqual([]);
  expect(await actions(anna)).toEqual([]);

  // Committed: the person, the intent and the start are there together.
  await active(anna, false);
  expect(await enabled(anna)).toBe(false);
  const dueAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
  expect(await intent(anna)).toMatchObject({ state: 'waiting', generation: 1, dueAt, inactiveSince: now });
  expect(await enqueuedWorkflows('competence-erasure:' + anna)).toEqual([
    {
      id: erasureWorkflowId(anna, 1),
      workflow: 'competenceErasure',
      status: 'ENQUEUED',
      input: { personId: anna, generation: 1, dueAt: dueAt.toISOString() },
    },
  ]);
  expect((await actions(anna)).slice(0, 2)).toEqual(['scim.user.deactivated', 'competence.erasure_scheduled']);
  expect(cancelled).toEqual([]);

  // A reactivation that fails cancels nothing and leaves the erasure waiting.
  await expect(
    failing.patchUser(
      p,
      anna,
      { schemas: [SCIM.patch], Operations: [{ op: 'replace', path: 'active', value: true }] },
      BASE,
    ),
  ).rejects.toThrow('after the use case');
  expect((await intent(anna))?.state).toBe('waiting');
  expect(cancelled).toEqual([]);
  // One that commits ends the wait after its commit.
  now = new Date(now.getTime() + 60_000);
  await active(anna, true);
  expect(await intent(anna)).toMatchObject({ state: 'cancelled', dueAt: null, inactiveSince: null, generation: 1 });
  expect(cancelled).toEqual([erasureWorkflowId(anna, 1)]);
  expect((await actions(anna)).slice(-2)).toEqual(['scim.user.reactivated', 'competence.erasure_cancelled']);

  // Gone again and due: the server's store erases her, once, and the stale generation finds nothing.
  await active(anna, false);
  expect(await intent(anna)).toMatchObject({ state: 'waiting', generation: 2 });
  now = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
  expect(await competence.eraseDue(anna, 1)).toBe('stale');
  expect(await competence.eraseDue(anna, 2)).toBe('erased');
  expect(await competence.eraseDue(anna, 2)).toBe('stale');
  expect(await db.select().from(schema.competenceHoldings).where(eq(schema.competenceHoldings.personId, anna))).toEqual(
    [],
  );
  expect(await intent(anna)).toMatchObject({ state: 'erased', dueAt: null, generation: 2 });
  const erased = await db
    .select({ actor: schema.audit.actor, details: schema.audit.details })
    .from(schema.audit)
    .where(and(eq(schema.audit.subject, 'person:' + anna), eq(schema.audit.action, 'competence.person_erased')));
  expect(erased).toEqual([
    {
      actor: 'system:competence-retention',
      details: { cause: 'retention', holdings: 1, cleared: 0, requirements: 0, approvals: 0, generation: 2 },
    },
  ]);
});

test('a deactivation that arrives while the period is being set waits for it, and is scheduled by it', async () => {
  // The period is set in a transaction held open after its work: it holds the organisation's retention lock.
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve)),
    inside = new Promise<void>(resolve => (entered = resolve));
  const holding: CompetenceStore = {
    transaction: fn =>
      store.transaction(async tx => {
        const result = await fn(tx);
        entered();
        await gate;
        return result;
      }),
  };
  const clearing = competenceOver(holding).setRetention(OPERATOR, ORG, null);
  await inside;
  let done = false;
  const deactivating = active(bo, false).then(() => (done = true));
  await new Promise(resolve => setTimeout(resolve, 300));
  // Bo's deactivation is written but waits for the lock: it has not read the period yet.
  expect(done).toBe(false);
  release();
  await clearing;
  await deactivating;
  // It read the period as the clearing left it: none, so Bo is held, not scheduled under the old period.
  expect(await intent(bo)).toMatchObject({ state: 'held', dueAt: null, generation: 0 });
  expect(await enqueuedWorkflows('competence-erasure:' + bo)).toEqual([]);
  // Set again: Bo is scheduled from his deactivation.
  expect(await competence.setRetention(OPERATOR, ORG, 10)).toMatchObject({ scheduled: 1 });
  expect(await intent(bo)).toMatchObject({ state: 'waiting', generation: 1 });
  expect((await enqueuedWorkflows('competence-erasure:' + bo)).map(w => w.id)).toEqual([erasureWorkflowId(bo, 1)]);
});
