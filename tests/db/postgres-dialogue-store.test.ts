import { afterAll } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { dialogueStoreWithCards } from '../../apps/server/src/composition/dialogue';
import { dialogueStoreContract } from '../dialogue-store-contract';
import { forgetTestWorkflows, testDurable } from './durable';

/**
 * The dialogue store contract on Postgres (D118), on the store composition builds: the dialogue tables and
 * composition's card port in one thread-store transaction, its timers' workflows enqueued on the test's own queue, where
 * no runner dequeues them. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
const prefixes: string[] = [];
afterAll(async () => {
  const db = database();
  for (const p of prefixes) {
    await db.delete(schema.dialogueNotes).where(like(schema.dialogueNotes.id, p + '%'));
    await db.delete(schema.dialogueActivities).where(like(schema.dialogueActivities.id, p + '%'));
    await db.delete(schema.dialogueAssessments).where(like(schema.dialogueAssessments.id, p + '%'));
    await db.delete(schema.dialogueQuestions).where(like(schema.dialogueQuestions.organisationId, p + '%'));
    await db.delete(schema.dialogueAreas).where(like(schema.dialogueAreas.organisationId, p + '%'));
    await db.delete(schema.threads).where(like(schema.threads.id, p + '%'));
    await db.delete(schema.audit).where(like(schema.audit.subject, '%:' + p + '%'));
    await db.delete(schema.units).where(like(schema.units.id, p + '%'));
    await db.delete(schema.people).where(like(schema.people.id, p + '%'));
  }
  await forgetTestWorkflows();
});
dialogueStoreContract('postgres', async () => {
  const prefix = 'test-dialogue-' + randomUUID().slice(0, 8);
  prefixes.push(prefix);
  return {
    store: dialogueStoreWithCards({ durable: testDurable, cancel: async () => {} }, { clock: () => new Date() }),
    prefix,
    async seedPerson(id, organisationId, name) {
      await database().insert(schema.people).values({ id, organisationId, name });
    },
    async seedUnit(id, organisationId, label) {
      await database().insert(schema.units).values({ id, organisationId, label });
    },
    async auditFor(subject) {
      return database()
        .select({ actor: schema.audit.actor, action: schema.audit.action })
        .from(schema.audit)
        .where(eq(schema.audit.subject, subject))
        .orderBy(schema.audit.id);
    },
    async removedWhy(threadId) {
      const [row] = await database()
        .select({ details: schema.audit.details })
        .from(schema.audit)
        .where(and(eq(schema.audit.subject, 'thread:' + threadId), eq(schema.audit.action, 'thread.removed')));
      return (row?.details as { reason?: string } | undefined)?.reason;
    },
    async stored(id) {
      const [row] = await database()
        .select({ text: schema.dialogueActivities.textSealed, note: schema.dialogueActivities.doneNoteSealed })
        .from(schema.dialogueActivities)
        .where(eq(schema.dialogueActivities.id, id));
      return row!;
    },
    async storedComment(id) {
      const [row] = await database()
        .select({ comment: schema.dialogueAssessments.commentSealed })
        .from(schema.dialogueAssessments)
        .where(eq(schema.dialogueAssessments.id, id));
      return row!.comment;
    },
    async storedNote(id) {
      const [row] = await database()
        .select({ text: schema.dialogueNotes.textSealed })
        .from(schema.dialogueNotes)
        .where(eq(schema.dialogueNotes.id, id));
      return row!.text;
    },
  };
});
