import { afterAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { eq, inArray, or } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import type { AuthenticatedContext, StaffOverview } from '../../packages/contracts/src/index';
import { COMPETENCE_CONNECTOR } from '../../packages/connectors/src/index';
import { talkStoreWithCards } from '../../apps/server/src/composition/talks';
import { dueTimerId } from '../../apps/server/src/composition/talk-work-items';
import { talkUsecases } from '../../apps/server/src/modules/talks/usecases';
import { enqueuedWorkflows, forgetTestWorkflows, testDurable } from './durable';

/**
 * The operator's erasures of a leaver's cards, talks and competence (D116 item 7, D117 item 3), each run as a script as
 * the runbook runs it, against the database the test is given. Each refuses an id the people table does not hold and a
 * person who is still active, with exit code 1, writing nothing and no audit row. A deactivated person is erased with
 * the script's own answer alone on standard output, also when a removed card has a timer still waiting: the timer goes
 * with its card, and the script sends no cancel to the durable engine, which a script never starts, so no "durable
 * cancel failed" line comes before the answer. The card's workflow stays queued, for the generation fence (D86). Run
 * with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');

const tag = Math.random().toString(36).slice(2, 8);
const ORG = `erase-scripts-${tag}`,
  unitId = `${ORG}-unit`;
const manager = `${ORG}-manager`,
  leaver = `${ORG}-leaver`,
  active = `${ORG}-active`,
  leaverName = `Leaver.${tag}`;
const typeId = `${ORG}-type`,
  card = `${ORG}-card`,
  reminder = `reminder:${card}`;
const at = new Date('2026-11-13T08:00:00.000Z');
let n = 0;
const ids = () => `${ORG}-${++n}`;
const persona = (id: string): AuthenticatedContext => ({
  id,
  name: id,
  unitId,
  unitLabel: 'Enheten',
  role: 'manager',
  organisationId: ORG,
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
});
const staffPerson = (id: string, userName: string) => ({
  id,
  name: 'Synthetic ' + id,
  userName,
  email: null,
  role: 'employee' as const,
  enabled: true,
});
const overview: StaffOverview = {
  units: [
    {
      unitId,
      unitLabel: 'Enheten',
      people: [staffPerson(leaver, leaverName), staffPerson(active, `Active.${tag}`)],
    },
  ],
};
// The test's own engine queue: the action points' workflows are enqueued where no runner dequeues them.
const talks = talkUsecases({
  store: talkStoreWithCards({ durable: testDurable, cancel: async () => {} }, { clock: () => at }),
  staff: async p => (p.id === manager ? overview : { units: [] }),
  manages: async (managerId, employeeId) => managerId === manager && employeeId !== manager,
  bookings: async () => new Map(),
  clock: () => at,
  ids,
});
const threadIds: string[] = [];
const commitmentIds: string[] = [];

/** One script as the runbook runs it, with the environment the test was given. */
function run(script: string, ...args: string[]) {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, '../../scripts', script), ...args], {
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { code: result.exitCode, out: result.stdout.toString().trim(), err: result.stderr.toString().trim() };
}
const auditAbout = (...subjects: string[]) =>
  database()
    .select({ actor: schema.audit.actor, action: schema.audit.action, details: schema.audit.details })
    .from(schema.audit)
    .where(inArray(schema.audit.subject, subjects))
    .orderBy(schema.audit.id);
const unknown = (id: string) =>
  `No person has the id "${id}": nothing was erased and nothing was audited. A person is named by their id, never by a user name.`;
const stillActive = (id: string) =>
  `Person "${id}" is still active: only a person the source has deactivated is erased (D68 item 1). Nothing was erased and nothing was audited.`;

afterAll(async () => {
  const db = database();
  await db
    .delete(schema.audit)
    .where(
      or(
        inArray(schema.audit.subject, [
          `person:${leaver}`,
          `person:${active}`,
          `person:${leaverName}`,
          `organisation:${ORG}`,
          `thread:${card}`,
          ...threadIds.map(id => `thread:${id}`),
          ...commitmentIds.map(id => `commitment:${id}`),
        ]),
        eq(schema.audit.actor, `person:${manager}`),
      ),
    );
  const rounds = (
    await db
      .select({ id: schema.talkRounds.id })
      .from(schema.talkRounds)
      .where(eq(schema.talkRounds.organisationId, ORG))
  ).map(r => r.id);
  if (rounds.length) {
    await db.delete(schema.audit).where(
      inArray(
        schema.audit.subject,
        rounds.map(id => `round:${id}`),
      ),
    );
    await db.delete(schema.talkCommitments).where(inArray(schema.talkCommitments.roundId, rounds));
    await db.delete(schema.talks).where(inArray(schema.talks.roundId, rounds));
    await db.delete(schema.talkRounds).where(inArray(schema.talkRounds.id, rounds));
  }
  await db.delete(schema.workOccurrences).where(inArray(schema.workOccurrences.personId, [manager, leaver, active]));
  await db.delete(schema.threads).where(inArray(schema.threads.personId, [manager, leaver, active]));
  await db.delete(schema.competenceHoldings).where(eq(schema.competenceHoldings.typeId, typeId));
  await db.delete(schema.competenceTypes).where(eq(schema.competenceTypes.id, typeId));
  await db.delete(schema.people).where(inArray(schema.people.id, [manager, leaver, active]));
  await forgetTestWorkflows();
  await closeDatabase();
});

describe('the erase scripts on PostgreSQL (D116 item 7, D117 item 3)', () => {
  test('setup: a leaver still active, with an action point and a competence card that each have a timer waiting', async () => {
    const db = database();
    await db.insert(schema.people).values([
      { id: manager, organisationId: ORG, name: 'Synthetic Chef' },
      { id: leaver, organisationId: ORG, name: 'Synthetic Leaver', userName: leaverName },
      { id: active, organisationId: ORG, name: 'Synthetic Active', userName: `Active.${tag}` },
    ]);
    await talks.openRound('operator:cli', {
      organisationId: ORG,
      label: 'Omgång',
      opensOn: '2026-09-01',
      dueOn: '2026-12-31',
    });
    for (const employee of [leaver, active]) {
      const id = await talks.addCommitment(persona(manager), employee, {
        owner: 'employee',
        text: 'Gå kursen',
        dueOn: '2026-12-15',
      });
      commitmentIds.push(id);
      const [row] = await db.select().from(schema.talkCommitments).where(eq(schema.talkCommitments.id, id));
      threadIds.push(row!.threadId!);
    }
    await db.insert(schema.competenceTypes).values({
      id: typeId,
      organisationId: ORG,
      name: `HLR ${tag}`,
      area: 'Säkerhet',
      kind: 'certificate',
      createdBy: 'operator:cli',
    });
    await db.insert(schema.competenceHoldings).values({
      id: `${ORG}-holding`,
      personId: leaver,
      typeId,
      issuedOn: '2024-06-01',
      expiresOn: '2026-06-01',
      evidence: 'manager',
      state: 'valid',
      registeredBy: manager,
    });
    // The competence scan's card in the leaver's stream, with a reminder they asked for and that has not fired.
    await db.insert(schema.threads).values({
      id: card,
      personId: leaver,
      kind: 'pushed',
      topic: `${COMPETENCE_CONNECTOR}:${card}`,
      title: 'HLR gick ut 1 juni',
      state: 'open',
      connector: COMPETENCE_CONNECTOR,
      area: COMPETENCE_CONNECTOR,
      trigger: { reason: 'Behörigheten har gått ut', source: 'Kompetens', at: at.toISOString() },
      createdAt: at,
      updatedAt: at,
    });
    await db.insert(schema.timerIntents).values({
      id: reminder,
      personId: leaver,
      threadId: card,
      kind: 'reminder',
      generation: 1,
      unitId,
      authorizationVersion: 'v1',
      dueAt: new Date('2026-12-01T07:00:00.000Z'),
      requestedAt: at,
      state: 'active',
      nextAt: at,
    });
    const [leaversCard] = threadIds;
    expect(
      (
        await db
          .select()
          .from(schema.timerIntents)
          .where(eq(schema.timerIntents.id, dueTimerId(leaversCard!)))
      ).map(t => t.state),
    ).toEqual(['active']);
    expect((await enqueuedWorkflows(dueTimerId(leaversCard!))).map(w => w.status)).toEqual(['ENQUEUED']);
  });

  test('an id the people table does not hold, such as the user name, is refused by each, and nothing is written', () => {
    expect(run('subject-erase.ts', 'person', leaverName, '--confirm')).toEqual({
      code: 1,
      out: '',
      err: unknown(leaverName),
    });
    for (const script of ['talks-erase.ts', 'competence-erase.ts'])
      expect([script, run(script, '--person', leaverName, '--confirm')]).toEqual([
        script,
        { code: 1, out: '', err: unknown(leaverName) },
      ]);
  });

  test('a person who is still active is refused by each, and nothing is written', async () => {
    expect(run('subject-erase.ts', 'person', leaver, '--confirm')).toEqual({
      code: 1,
      out: '',
      err: stillActive(leaver),
    });
    for (const script of ['talks-erase.ts', 'competence-erase.ts'])
      expect([script, run(script, '--person', leaver, '--confirm')]).toEqual([
        script,
        { code: 1, out: '', err: stillActive(leaver) },
      ]);
    expect(await auditAbout(`person:${leaver}`, `person:${leaverName}`, `thread:${card}`)).toEqual([]);
    const db = database();
    expect(
      (await db.select({ id: schema.threads.id }).from(schema.threads).where(eq(schema.threads.personId, leaver)))
        .map(t => t.id)
        .sort(),
    ).toEqual([card, threadIds[0]!].sort());
    // Their action point card still names them.
    expect(
      await db
        .select({ threadId: schema.threadSubjects.threadId })
        .from(schema.threadSubjects)
        .where(eq(schema.threadSubjects.key, leaver)),
    ).toEqual([{ threadId: threadIds[0]! }]);
    expect(
      await db
        .select({ id: schema.competenceHoldings.id })
        .from(schema.competenceHoldings)
        .where(eq(schema.competenceHoldings.personId, leaver)),
    ).toEqual([{ id: `${ORG}-holding` }]);
  });

  test('once the source has deactivated the person, each erases them and prints its answer alone, with no line from the engine', async () => {
    const db = database();
    await db.update(schema.people).set({ enabled: false }).where(eq(schema.people.id, leaver));
    // The leaver's own action point card names them as its subject (D116 item 1).
    expect(run('subject-erase.ts', 'person', leaver, '--confirm')).toEqual({
      code: 0,
      out: `Erased person "${leaver}" from 1 cards: 0 rows and 1 card subjects no longer name it. Audited as person:${leaver}.`,
      err: '',
    });
    expect(run('talks-erase.ts', '--person', leaver, '--confirm')).toEqual({
      code: 0,
      out: `Erased person "${leaver}" from the talks domain: 0 talks and 1 action points removed, 0 other records cleared, 1 cards removed. Audited as person:${leaver}.`,
      err: '',
    });
    expect(run('competence-erase.ts', '--person', leaver, '--confirm')).toEqual({
      code: 0,
      out: `Erased person "${leaver}" from the competence domain: 1 holdings removed, 0 other holdings cleared of their id, 1 cards removed. Audited as person:${leaver}.`,
      err: '',
    });
    // The cards went with their timers; the action point's workflow is left queued, and the fence covers it.
    const [leaversCard, activesCard] = threadIds;
    expect(await db.select().from(schema.threads).where(eq(schema.threads.personId, leaver))).toEqual([]);
    expect(
      await db
        .select({ id: schema.timerIntents.id })
        .from(schema.timerIntents)
        .where(inArray(schema.timerIntents.id, [reminder, dueTimerId(leaversCard!)])),
    ).toEqual([]);
    expect((await enqueuedWorkflows(dueTimerId(leaversCard!))).map(w => w.status)).toEqual(['ENQUEUED']);
    expect((await auditAbout(`person:${leaver}`)).map(a => [a.actor, a.action])).toEqual([
      ['operator:cli', 'thread.subject_erased'],
      ['operator:cli', 'talks.person_erased'],
      ['operator:cli', 'competence.person_erased'],
    ]);
    // The colleague who is still active keeps their action point, its card and its timer.
    expect(
      (
        await db
          .select()
          .from(schema.timerIntents)
          .where(eq(schema.timerIntents.id, dueTimerId(activesCard!)))
      ).map(t => t.state),
    ).toEqual(['active']);
  });
});
