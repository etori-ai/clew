import { afterAll } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { database, schema, type Transaction } from '../../packages/db/src/index';
import { postgresDialogueStore } from '../../apps/server/src/modules/dialogue/adapters/postgres';
import type { DialogueWorkItems } from '../../apps/server/src/modules/dialogue/model';
import { openSecret, sealSecret } from '../../apps/server/src/auth-crypto';
import { dialogueStoreContract } from '../dialogue-store-contract';

/** The dialogue store contract on Postgres (D118). Run with `bun run test:db` inside the devcontainer. */
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
});
/**
 * A stand-in for composition's card port: `open` writes the minimal thread row the activity's foreign key needs,
 * `remove` deletes it. The real one (the owner's stream, delivery and the timer) is composition's and has its own tests.
 */
const cards = (tx: Transaction): DialogueWorkItems => ({
  async open(input) {
    await tx.insert(schema.threads).values({
      id: input.threadId,
      personId: input.personId,
      kind: 'pushed',
      topic: 'dialogue:activity:' + input.activityId,
      title: 'Aktivitet',
      trigger: { reason: 'test', source: 'dialogue', at: input.at },
      connector: 'dialogue',
      area: 'dialogue',
    });
  },
  async close(threadId) {
    await tx.update(schema.threads).set({ state: 'handled' }).where(eq(schema.threads.id, threadId));
  },
  async reopen(threadId) {
    await tx.update(schema.threads).set({ state: 'open' }).where(eq(schema.threads.id, threadId));
  },
  async retime() {},
  async fire() {
    return false;
  },
  async remove(threadIds) {
    if (threadIds.length) await tx.delete(schema.threads).where(inArray(schema.threads.id, [...threadIds]));
  },
});

dialogueStoreContract('postgres', async () => {
  const prefix = 'test-dialogue-' + randomUUID().slice(0, 8);
  prefixes.push(prefix);
  return {
    store: postgresDialogueStore({ sealer: { seal: sealSecret, open: openSecret }, workItems: cards }),
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
