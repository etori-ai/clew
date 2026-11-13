import { afterAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, like, or } from 'drizzle-orm';
import { closeDatabase, database, schema, type Transaction } from '../../packages/db/src/index';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { boardingStaff, boardingStoreWithCards } from '../../apps/server/src/composition/boarding';
import { boardingTx, postgresBoardingDirectory } from '../../apps/server/src/modules/boarding/adapters/postgres';
import { BoardingError, boardingLeavers, boardingUsecases } from '../../apps/server/src/modules/boarding/usecases';
import { postgresProvisionStore } from '../../apps/server/src/modules/people/adapters/postgres';
import { combineLeavers } from '../../apps/server/src/modules/people/leavers';
import { openSecret, sealSecret } from '../../apps/server/src/auth-crypto';
import { forgetTestWorkflows, testDurable } from './durable';

/**
 * Introduction and leaving end to end on Postgres (D124), over what composition builds: the composed `staff` port (the
 * people module's reach, `reportsByUnit`, and the Postgres directory's facts and tree), the store with cards, the
 * leavers port in real savepoints, and two writes that race. Run with `bun run test:db` inside the devcontainer; the
 * wrapper points at the worktree's own database, never the shared development one. Every world is synthetic and is
 * removed at the end.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');

const tags: string[] = [];
const cancelled: string[] = [];
const options = { durable: testDurable, cancel: async (id: string) => void cancelled.push(id) };
let now = new Date('2026-11-13T09:00:00.000Z');
const clock = () => now;
const sealer = { seal: sealSecret, open: openSecret };

afterAll(async () => {
  const db = database();
  for (const tag of tags) {
    const prefix = `bdb-${tag}`;
    const ids = (
      await db
        .select({ id: schema.people.id })
        .from(schema.people)
        .where(like(schema.people.id, prefix + '%'))
    ).map(r => r.id);
    const plans = (
      await db
        .select({ id: schema.boardingPlans.id })
        .from(schema.boardingPlans)
        .where(eq(schema.boardingPlans.organisationId, prefix + '-org'))
    ).map(r => r.id);
    if (plans.length) await db.delete(schema.boardingPlans).where(inArray(schema.boardingPlans.id, plans));
    await db.delete(schema.boardingLayers).where(eq(schema.boardingLayers.organisationId, prefix + '-org'));
    await db
      .delete(schema.audit)
      .where(or(like(schema.audit.subject, `%${prefix}%`), like(schema.audit.actor, `%${prefix}%`)));
    if (ids.length) {
      const threads = (
        await db.select({ id: schema.threads.id }).from(schema.threads).where(inArray(schema.threads.personId, ids))
      ).map(r => r.id);
      if (threads.length)
        await db.delete(schema.audit).where(
          inArray(
            schema.audit.subject,
            threads.flatMap(t => [`thread:${t}`, `timer:boarding:${t}`]),
          ),
        );
      await db.delete(schema.workOccurrences).where(inArray(schema.workOccurrences.personId, ids));
      await db.delete(schema.threads).where(inArray(schema.threads.personId, ids));
      await db.delete(schema.jobs).where(or(...ids.map(p => like(schema.jobs.id, `attention:automatic:${p}:%`))));
      await db.delete(schema.personPositions).where(inArray(schema.personPositions.personId, ids));
      await db.delete(schema.assignments).where(inArray(schema.assignments.personId, ids));
    }
    await db.delete(schema.positions).where(like(schema.positions.id, prefix + '%'));
    await db.delete(schema.groups).where(like(schema.groups.id, prefix + '%'));
    await db.delete(schema.units).where(like(schema.units.id, prefix + '%'));
    if (ids.length) await db.delete(schema.people).where(inArray(schema.people.id, ids));
  }
  await forgetTestWorkflows();
  await closeDatabase();
});

/**
 * A directory as provisioning writes it: an administration led by Ada, Karin's team under it with Hanna (a teacher
 * starting soon) and Bo, and Olle's school beside it. The layers: everyone, the administration and the teachers.
 */
async function world() {
  const tag = Math.random().toString(36).slice(2, 8);
  tags.push(tag);
  const prefix = `bdb-${tag}`,
    org = prefix + '-org',
    id = (s: string) => `${prefix}-${s}`;
  const db = database();
  const units = [
    { id: id('admin'), label: 'Barn och utbildning', parent: null },
    { id: id('team'), label: 'Teamet', parent: id('admin') },
    { id: id('school'), label: 'Skolan', parent: id('admin') },
  ];
  for (const u of units) {
    await db.insert(schema.units).values({ id: u.id, organisationId: org, label: u.label });
    await db.insert(schema.groups).values({
      id: id('group-' + u.id),
      organisationId: org,
      externalId: 'unit:' + u.id,
      label: u.label,
      parentUnitId: u.parent,
    });
  }
  const people = [
    { key: 'ada', unit: 'admin', role: 'manager' as const },
    { key: 'karin', unit: 'team', role: 'manager' as const },
    { key: 'olle', unit: 'school', role: 'manager' as const },
    { key: 'hanna', unit: 'team', role: 'employee' as const },
    { key: 'bo', unit: 'team', role: 'employee' as const },
  ];
  for (const p of people)
    await db.insert(schema.people).values({
      id: id(p.key),
      organisationId: org,
      name: `Synthetic ${p.key} ${tag}`,
      userName: `${p.key}.${tag}`,
      employments: [{ unitId: id(p.unit), employmentType: 'Tillsvidare', startDate: '2026-12-04' }],
    });
  for (const p of people)
    await db.insert(schema.assignments).values({ personId: id(p.key), unitId: id(p.unit), role: p.role });
  await db
    .insert(schema.positions)
    .values({ id: id('larare'), organisationId: org, code: id('larare'), label: 'Lärare' });
  await db.insert(schema.personPositions).values({ personId: id('hanna'), positionId: id('larare') });
  let n = 0;
  const store = boardingStoreWithCards(options, { clock });
  const boarding = boardingUsecases({
    store,
    staff: boardingStaff,
    clock,
    ids: () => `${prefix}-x${++n}`,
    directory: postgresBoardingDirectory(),
  });
  const row = (
    r: number,
    layer: string,
    condition: 'all' | 'unit' | 'position',
    value: string | null,
    title: string,
    owner: 'manager' | 'person' | 'buddy',
    offsetDays: number,
  ) => ({
    row: r,
    layer,
    event: 'introduction' as const,
    condition,
    value,
    title,
    kind: 'todo' as const,
    owner,
    offsetDays,
    tiedTo: null,
  });
  await boarding.seedLayers('operator:test', org, [
    row(2, 'Alla', 'all', null, 'Beställ dator', 'manager', -14),
    row(3, 'Alla', 'all', null, 'Lunch', 'buddy', 1),
    row(4, 'Förvaltningen', 'unit', id('admin'), 'Läs krisplanen', 'person', 3),
    row(5, 'Lärare', 'position', id('larare'), 'Schemat', 'manager', -5),
    row(6, 'Skolan', 'unit', id('school'), 'Skolans rutiner', 'person', 2),
  ]);
  const persona = (key: string): AuthenticatedContext => ({
    id: id(key),
    name: key,
    unitId: id('team'),
    unitLabel: 'Teamet',
    role: 'manager',
    organisationId: org,
    principal: { id: 'person:' + id(key), kind: 'person' },
    capabilities: [],
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2099-01-01T00:00:00.000Z',
    authorize: async () => ({ version: 'v1' }),
  });
  const start = () =>
    boarding.startPlan(persona('karin'), {
      personId: id('hanna'),
      event: 'introduction',
      anchorOn: '2026-12-04',
      buddyId: id('bo'),
    });
  return { tag, org, id, db, store, boarding, persona, start };
}

describe('introduction and leaving on what composition builds (D124)', () => {
  test('the composed staff port: the manager’s reports with their units, positions and employments, and the tree the unit layers walk', async () => {
    const w = await world();
    const staffing = await boardingStaff(w.persona('karin'));
    expect(staffing.manages).toBe(true);
    expect(staffing.reports.map(r => r.id).sort()).toEqual([w.id('bo'), w.id('hanna')].sort());
    expect(staffing.reports.find(r => r.id === w.id('hanna'))).toMatchObject({
      unitIds: [w.id('team')],
      positionCodes: [w.id('larare')],
      employments: [{ employmentType: 'Tillsvidare', startDate: '2026-12-04' }],
    });
    expect(staffing.tree.filter(u => u.id.startsWith('bdb-' + w.tag))).toContainEqual({
      id: w.id('team'),
      parentId: w.id('admin'),
    });
    // Ada leads the administration above the team: Karin is her report, not the other way round.
    expect((await boardingStaff(w.persona('ada'))).reports.map(r => r.id).sort()).toEqual(
      [w.id('karin'), w.id('olle')].sort(),
    );
    expect((await boardingStaff(w.persona('hanna'))).manages).toBe(false);
    const preview = await w.boarding.preview(w.persona('karin'), {
      personId: w.id('hanna'),
      event: 'introduction',
      anchorOn: '2026-12-04',
    });
    expect(preview.layers.map(l => [l.name, l.unitLabel])).toEqual([
      ['Alla', undefined],
      ['Förvaltningen', 'Barn och utbildning'],
      ['Lärare', undefined],
    ]);
    expect(preview.items.map(i => i.title)).toEqual(['Beställ dator', 'Schemat', 'Lunch', 'Läs krisplanen']);
  });

  test('deactivated, the person’s plan is held by the manager of their team then: the new one, not the one who started it', async () => {
    const w = await world();
    const { id } = await w.start();
    // Olle takes over Karin's team; Karin moves to the school.
    await w.db.delete(schema.assignments).where(eq(schema.assignments.personId, w.id('karin')));
    await w.db.insert(schema.assignments).values({ personId: w.id('karin'), unitId: w.id('school'), role: 'employee' });
    await w.db.insert(schema.assignments).values({ personId: w.id('olle'), unitId: w.id('team'), role: 'manager' });
    // The directory deactivates Hanna, and the leavers port tells boarding in that transaction, reading the line there.
    await w.db.transaction(async tx => {
      await tx
        .update(schema.people)
        .set({ enabled: false })
        .where(eq(schema.people.id, w.id('hanna')));
      await boardingLeavers(boardingTx(tx, { sealer }), postgresBoardingDirectory(tx)).deactivated({
        actor: 'provisioner:test',
        personId: w.id('hanna'),
        organisationId: w.org,
        at: now.toISOString(),
      });
    });
    expect(await w.store.transaction(tx => tx.plan(id))).toMatchObject({
      heldAt: now.toISOString(),
      heldBy: [w.id('olle')],
    });
    expect((await w.boarding.plan(w.persona('olle'), id)).plan.access).toBe('manager');
    expect((await w.boarding.plans(w.persona('olle'))).rows.map(r => r.id)).toEqual([id]);
    expect((await w.boarding.plan(w.persona('karin'), id)).plan.access).toBe('owner');
    expect((await w.boarding.plans(w.persona('karin'))).rows).toEqual([]);
    const [audited] = await w.db
      .select()
      .from(schema.audit)
      .where(and(eq(schema.audit.subject, 'plan:' + id), eq(schema.audit.action, 'boarding.plan_held')));
    expect(audited?.details).toEqual({ personId: w.id('hanna'), holders: [w.id('olle')] });
    // Activated again: nobody holds it.
    await w.db.transaction(async tx => {
      await tx
        .update(schema.people)
        .set({ enabled: true })
        .where(eq(schema.people.id, w.id('hanna')));
      await boardingLeavers(boardingTx(tx, { sealer }), postgresBoardingDirectory(tx)).reactivated({
        actor: 'provisioner:test',
        personId: w.id('hanna'),
        organisationId: w.org,
        at: now.toISOString(),
      });
    });
    expect(await w.store.transaction(tx => tx.plan(id))).toMatchObject({ heldAt: null, heldBy: [] });
  });

  test('the leavers port tells each domain in a savepoint of its own: one that fails is rolled back alone, and the change commits', async () => {
    const w = await world();
    const { id } = await w.start();
    const failed: string[] = [];
    /** A domain that writes and then fails: its row must not survive. */
    const failing = {
      module: 'failing',
      port: (tx: Transaction) => {
        const write = async () => {
          await tx.insert(schema.audit).values({
            actor: 'failing:' + w.tag,
            action: 'failing.wrote',
            subject: 'person:' + w.id('hanna'),
            details: {},
          });
          throw new Error('the failing domain failed');
        };
        return { deactivated: write, reactivated: write };
      },
    };
    const boardingBinding = {
      module: 'boarding',
      port: (tx: Transaction) => boardingLeavers(boardingTx(tx, { sealer }), postgresBoardingDirectory(tx)),
    };
    const store = postgresProvisionStore({
      leavers: combineLeavers<Transaction>(
        [failing, boardingBinding],
        (tx, fn) => tx.transaction(fn),
        (_e, _c, _k, module) => void failed.push(module),
      ),
    });
    const change = { actor: 'provisioner:test', personId: w.id('hanna'), organisationId: w.org, at: now.toISOString() };
    await store.transaction(async tx => {
      await tx.updateUser(w.id('hanna'), { enabled: false, updatedAt: now.toISOString() } as never);
      await tx.leavers.deactivated(change);
    });
    expect(failed).toEqual(['failing']);
    // The change committed, boarding recorded who holds the plan, and the failing domain's write is gone.
    const [hanna] = await w.db
      .select({ enabled: schema.people.enabled })
      .from(schema.people)
      .where(eq(schema.people.id, w.id('hanna')));
    expect(hanna?.enabled).toBe(false);
    expect((await w.store.transaction(tx => tx.plan(id)))?.heldBy).toEqual([w.id('karin')]);
    expect(
      await w.db
        .select()
        .from(schema.audit)
        .where(eq(schema.audit.actor, 'failing:' + w.tag)),
    ).toEqual([]);
  });

  test('two starts of one introduction race to the open-plan index: one plan, and the other is told so in Swedish', async () => {
    const w = await world();
    const results = await Promise.allSettled([w.start(), w.start()]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const [lost] = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(lost?.reason).toBeInstanceOf(BoardingError);
    expect((lost?.reason as Error).message).toBe('Personen har redan en pågående introduktion.');
    const plans = await w.db
      .select()
      .from(schema.boardingPlans)
      .where(eq(schema.boardingPlans.personId, w.id('hanna')));
    expect(plans).toHaveLength(1);
    // The loser left no item and no card behind.
    expect(
      await w.db.select().from(schema.boardingItems).where(eq(schema.boardingItems.planId, plans[0]!.id)),
    ).toHaveLength(4);
    const cards = await w.db
      .select()
      .from(schema.threads)
      .where(
        and(
          inArray(schema.threads.personId, [w.id('karin'), w.id('hanna'), w.id('bo')]),
          eq(schema.threads.connector, 'boarding'),
        ),
      );
    expect(cards).toHaveLength(4);
  });

  test('a tick racing a close: no deadlock, and either the tick lands first or it is refused because the plan is closed', async () => {
    const w = await world();
    for (let round = 0; round < 4; round++) {
      const { id } = await w.start();
      const items = await w.store.transaction(tx => tx.items([id]));
      const own = items.find(i => i.ownerId === w.id('hanna'))!;
      const [tick, close] = await Promise.allSettled([
        w.boarding.setDone(w.persona('hanna'), own.id),
        w.boarding.closePlan(w.persona('karin'), id),
      ]);
      expect(close.status).toBe('fulfilled');
      const after = (await w.store.transaction(tx => tx.items([id]))).find(i => i.id === own.id)!;
      if (tick.status === 'fulfilled') expect(after.doneAt).not.toBeNull();
      else {
        expect((tick.reason as Error).message).toBe('Planen är avslutad och kan inte ändras.');
        expect(after.doneAt).toBeNull();
      }
      const states = await w.db
        .select({ state: schema.threads.state })
        .from(schema.threads)
        .where(
          inArray(
            schema.threads.id,
            items.map(i => i.threadId!),
          ),
        );
      expect(states.every(s => s.state === 'handled')).toBe(true);
    }
  });
});
