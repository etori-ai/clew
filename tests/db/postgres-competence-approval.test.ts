import { afterAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, like, or } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import type { AuthenticatedContext, StaffOverview } from '../../packages/contracts/src/index';
import { competenceStoreWithCards } from '../../apps/server/src/composition/competence';
import { approvalCardId, approvalTopic } from '../../apps/server/src/composition/competence-work-items';
import { competenceUsecases } from '../../apps/server/src/modules/competence/usecases';
import type { CompetenceStore } from '../../apps/server/src/modules/competence/model';
import { forgetTestWorkflows, testDurable } from './durable';

/**
 * A person's own registration on Postgres through the store composition builds (D108 item 7,
 * `competenceStoreWithCards`: the competence tables and the approvals' cards on one thread-store transaction), with
 * the test's own engine queue. The holding, a card per manager with its delivery and message, and the audit rows commit
 * or roll back together; a decision and a registration taken back close every card in the transaction that changes the
 * row, and roll back with it; erasure leaves no row and no card. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');

const tag = Math.random().toString(36).slice(2, 8);
const ORG = `competence-approval-${tag}`;
const anna = `${ORG}-anna`,
  boss = `${ORG}-boss`,
  other = `${ORG}-other`;
const people = [anna, boss, other];
const NAMES = ['Synthetic Anställd', 'Synthetic Chef', 'Synthetic Kollega', 'Synthetic Brandskydd'];
const options = { durable: testDurable, cancel: async () => undefined };
let now = new Date('2026-03-02T09:00:00.000Z');
const clock = () => now;
let n = 0;
const ids = () => `${ORG}-${++n}`;
const persona = (id: string, role: 'manager' | 'employee'): AuthenticatedContext => ({
  id,
  name: id,
  unitId: `unit-${tag}`,
  unitLabel: 'Enheten',
  role,
  organisationId: ORG,
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
});
const asAnna = persona(anna, 'employee'),
  asBoss = persona(boss, 'manager');
const overview: StaffOverview = {
  units: [
    {
      unitId: `unit-${tag}`,
      unitLabel: 'Enheten',
      people: [{ id: anna, name: NAMES[0]!, userName: `e2e.${tag}`, email: null, role: 'employee', enabled: true }],
    },
  ],
};
const store = competenceStoreWithCards(options, { clock });
const usecases = (s: CompetenceStore) =>
  competenceUsecases({
    store: s,
    staff: async p => (p.id === boss || p.id === other ? overview : { units: [] }),
    above: async p => (p.id === anna ? [boss, other] : []),
    clock,
    ids,
  });
const competence = usecases(store);
/** A store whose every transaction throws after the use case's own work, as a failure late in the commit would. */
const failing: CompetenceStore = {
  transaction: fn =>
    store.transaction(async tx => {
      await fn(tx);
      throw new Error('after the use case');
    }),
};
const holdingIds: string[] = [];
const threadIds: string[] = [];
let typeIds: string[] = [];

afterAll(async () => {
  const db = database();
  const cards = threadIds.flatMap(t => people.map(p => approvalCardId(t, p)));
  await db
    .delete(schema.audit)
    .where(
      or(
        inArray(schema.audit.subject, [
          ...holdingIds.map(id => `holding:${id}`),
          ...cards.map(id => `thread:${id}`),
          ...typeIds.map(id => `competence-type:${id}`),
          `person:${anna}`,
        ]),
      ),
    );
  await db.delete(schema.competenceHoldings).where(inArray(schema.competenceHoldings.personId, people));
  await db.delete(schema.workOccurrences).where(inArray(schema.workOccurrences.personId, people));
  await db.delete(schema.threads).where(inArray(schema.threads.personId, people));
  await db.delete(schema.jobs).where(or(...people.map(p => like(schema.jobs.id, `attention:automatic:${p}:%`))));
  await db.delete(schema.competenceTypes).where(eq(schema.competenceTypes.organisationId, ORG));
  await db.delete(schema.people).where(inArray(schema.people.id, people));
  await forgetTestWorkflows();
  await closeDatabase();
});

const holdingRow = async (id: string) =>
  (await database().select().from(schema.competenceHoldings).where(eq(schema.competenceHoldings.id, id)))[0];
/** Every card of one approval, by manager, with its messages and deliveries. */
async function cardsOf(threadId: string) {
  const db = database();
  const threads = await db
    .select()
    .from(schema.threads)
    .where(and(eq(schema.threads.connector, 'competence'), eq(schema.threads.topic, approvalTopic(threadId))))
    .orderBy(schema.threads.id);
  const ids = threads.map(t => t.id);
  const messages = ids.length
    ? await db
        .select()
        .from(schema.threadMessages)
        .where(inArray(schema.threadMessages.threadId, ids))
        .orderBy(schema.threadMessages.createdAt, schema.threadMessages.seq)
    : [];
  const deliveries = ids.length
    ? await db.select().from(schema.deliveries).where(inArray(schema.deliveries.threadId, ids))
    : [];
  const subjects = ids.length
    ? await db.select().from(schema.threadSubjects).where(inArray(schema.threadSubjects.threadId, ids))
    : [];
  return { threads, messages, deliveries, subjects };
}
const auditOf = (subjects: string[]) =>
  database()
    .select({ actor: schema.audit.actor, action: schema.audit.action, subject: schema.audit.subject })
    .from(schema.audit)
    .where(inArray(schema.audit.subject, subjects))
    .orderBy(schema.audit.id);
const cardSubjects = (threadId: string) => [boss, other].map(p => `thread:${approvalCardId(threadId, p)}`);

describe("a person's own registration on Postgres through the composition store (D108 item 7)", () => {
  test('setup: three synthetic people and two competence types', async () => {
    await database()
      .insert(schema.people)
      .values([
        { id: anna, organisationId: ORG, name: NAMES[0]!, userName: `e2e.${tag}` },
        { id: boss, organisationId: ORG, name: NAMES[1]! },
        { id: other, organisationId: ORG, name: NAMES[2]! },
      ]);
    typeIds = [
      await competence.seedType('operator:test', ORG, { name: NAMES[3]!, area: 'Säkerhet', kind: 'certificate' }),
      await competence.seedType('operator:test', ORG, {
        name: 'HLR',
        area: 'Akut',
        kind: 'course',
        validityMonths: 24,
      }),
    ];
  });

  test('a throw inside the same transaction leaves no holding, card, delivery, message or audit row', async () => {
    const before = n;
    await expect(
      usecases(failing).registerOwn(asAnna, { typeId: typeIds[0]!, issuedOn: '2026-02-01' }),
    ).rejects.toThrow('after the use case');
    // The use case drew the holding's id and then the approval's.
    const id = `${ORG}-${before + 1}`,
      threadId = `${ORG}-${before + 2}`;
    holdingIds.push(id);
    threadIds.push(threadId);
    expect(await holdingRow(id)).toBeUndefined();
    const c = await cardsOf(threadId);
    expect([c.threads, c.messages, c.deliveries]).toEqual([[], [], []]);
    expect(await auditOf([`holding:${id}`, ...cardSubjects(threadId)])).toEqual([]);
  });

  let id = '',
    threadId = '';
  test('registering commits the pending holding, a card per manager with its delivery and message, and every audit row', async () => {
    id = await competence.registerOwn(asAnna, { typeId: typeIds[0]!, issuedOn: '2026-02-01' });
    holdingIds.push(id);
    const row = (await holdingRow(id))!;
    threadId = row.threadId!;
    threadIds.push(threadId);
    expect(row).toMatchObject({
      personId: anna,
      evidence: 'self',
      state: 'pending',
      registeredBy: anna,
      decidedBy: null,
      decidedAt: null,
    });
    const c = await cardsOf(threadId);
    expect(c.threads.map(t => [t.id, t.personId, t.state, t.kind, t.title])).toEqual([
      [approvalCardId(threadId, boss), boss, 'open', 'pushed', 'Intyg att granska'],
      [approvalCardId(threadId, other), other, 'open', 'pushed', 'Intyg att granska'],
    ]);
    expect(c.threads[0]!.actions).toEqual([
      {
        id: 'review',
        label: 'Granska',
        capability: 'competence.approval',
        kind: 'read',
        role: 'primary',
        input: { holding: id },
      },
    ]);
    // The card is about Anna by her key, which is never drawn: each manager finds it on her page.
    expect(c.subjects.map(s => [s.personId, s.entity, s.key]).sort()).toEqual([
      [boss, 'person', `e2e.${tag}`],
      [other, 'person', `e2e.${tag}`],
    ]);
    expect(c.deliveries.map(d => d.kind)).toEqual(['automatic', 'automatic']);
    expect(c.messages).toHaveLength(2);
    expect((await auditOf([`holding:${id}`, ...cardSubjects(threadId)])).map(a => [a.action, a.subject])).toEqual([
      ['thread.pushed', `thread:${approvalCardId(threadId, boss)}`],
      ['thread.pushed', `thread:${approvalCardId(threadId, other)}`],
      ['competence.holding_submitted', `holding:${id}`],
    ]);
    // Nothing stored on the cards or in the audit rows names a person or the competence.
    const stored = JSON.stringify({ c, audit: await auditOf([`holding:${id}`, ...cardSubjects(threadId)]) });
    for (const name of NAMES) expect(stored).not.toContain(name);
  });

  test('a decision that fails late rolls back with its cards; the decision closes every card in its transaction', async () => {
    now = new Date('2026-03-03T09:00:00.000Z');
    await expect(usecases(failing).decideHolding(asBoss, id, 'approve')).rejects.toThrow('after the use case');
    expect(await holdingRow(id)).toMatchObject({ state: 'pending', decidedBy: null });
    expect((await cardsOf(threadId)).threads.map(t => t.state)).toEqual(['open', 'open']);

    await competence.decideHolding(asBoss, id, 'approve');
    expect(await holdingRow(id)).toMatchObject({ state: 'valid', evidence: 'self', decidedBy: boss, decidedAt: now });
    const c = await cardsOf(threadId);
    expect(c.threads.map(t => [t.personId, t.state])).toEqual([
      [boss, 'handled'],
      [other, 'handled'],
    ]);
    expect(c.messages.filter(m => m.body === 'Intyget är godkänt.')).toHaveLength(2);
    expect((await auditOf([`holding:${id}`, ...cardSubjects(threadId)])).map(a => a.action)).toEqual([
      'thread.pushed',
      'thread.pushed',
      'competence.holding_submitted',
      'thread.handled',
      'thread.handled',
      'competence.holding_approved',
    ]);
    await expect(competence.decideHolding(asBoss, id, 'reject')).rejects.toThrow('Registreringen är redan granskad.');
  });

  test('taken back while it waits, the row goes and every card closes in the same transaction', async () => {
    const second = await competence.registerOwn(asAnna, { typeId: typeIds[1]!, issuedOn: '2026-02-01' });
    holdingIds.push(second);
    const secondThread = (await holdingRow(second))!.threadId!;
    threadIds.push(secondThread);
    await expect(usecases(failing).withdrawOwn(asAnna, second)).rejects.toThrow('after the use case');
    expect(await holdingRow(second)).toMatchObject({ state: 'pending' });
    expect((await cardsOf(secondThread)).threads.map(t => t.state)).toEqual(['open', 'open']);

    await competence.withdrawOwn(asAnna, second);
    expect(await holdingRow(second)).toBeUndefined();
    const c = await cardsOf(secondThread);
    expect(c.threads.map(t => t.state)).toEqual(['handled', 'handled']);
    expect(c.messages.filter(m => m.body === 'Medarbetaren tog tillbaka registreringen.')).toHaveLength(2);
    expect((await auditOf([`holding:${second}`])).map(a => a.action)).toEqual([
      'competence.holding_submitted',
      'competence.holding_withdrawn',
    ]);
  });

  test('a second registration of one type waiting is refused by the index, and nothing of it is written', async () => {
    const waiting = await competence.registerOwn(asAnna, { typeId: typeIds[1]!, issuedOn: '2026-02-10' });
    holdingIds.push(waiting);
    threadIds.push((await holdingRow(waiting))!.threadId!);
    const before = n;
    await expect(competence.registerOwn(asAnna, { typeId: typeIds[1]!, issuedOn: '2026-02-11' })).rejects.toThrow(
      'Du har redan en registrering av den kompetensen som väntar på godkännande.',
    );
    const refusedThread = `${ORG}-${before + 2}`;
    threadIds.push(refusedThread);
    expect((await cardsOf(refusedThread)).threads).toEqual([]);
  });

  test('erasing her leaves no registration of hers and no card of their approvals in any stream', async () => {
    await database().update(schema.people).set({ enabled: false }).where(eq(schema.people.id, anna));
    const erased = await competence.erasePerson('operator:cli', anna);
    expect(erased).toEqual({ holdings: 2, cleared: 0, requirements: 0, approvals: 2 });
    expect(
      await database().select().from(schema.competenceHoldings).where(eq(schema.competenceHoldings.personId, anna)),
    ).toEqual([]);
    for (const t of threadIds) expect((await cardsOf(t)).threads).toEqual([]);
    expect(
      (await auditOf([`person:${anna}`, ...threadIds.flatMap(cardSubjects)])).filter(a => a.action !== 'thread.pushed'),
    ).toEqual(
      expect.arrayContaining([
        { actor: 'operator:cli', action: 'competence.person_erased', subject: `person:${anna}` },
        { actor: 'competence:approval', action: 'thread.removed', subject: `thread:${approvalCardId(threadId, boss)}` },
      ]),
    );
  });
});
