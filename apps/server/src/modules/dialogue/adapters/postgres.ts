import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import type { ActivityRecord, AssessmentRecord, DialogueStore, DialogueTx, DialogueWorkItems, Sealer } from '../model';

const {
  dialogueAreas: areas,
  dialogueQuestions: questions,
  dialogueAssessments: assessments,
  dialogueActivities: activities,
  people,
  units,
  audit,
} = schema;
type AssessmentRow = typeof assessments.$inferSelect;
type ActivityRow = typeof activities.$inferSelect;
const iso = (at: Date | null) => (at === null ? null : at.toISOString());
const date = (at: string | null) => (at === null ? null : new Date(at));
/** The purposes free text is sealed under (D118 item 9): bound to the row, so a sealed text cannot be moved. */
const purpose = {
  activity: (id: string) => 'dialogue:activity:' + id,
  note: (id: string) => 'dialogue:note:' + id,
  comment: (id: string) => 'dialogue:assessment:' + id,
};

/**
 * The dialogue tables (D118) on one Postgres transaction. Composition opens the transaction itself, with the thread
 * store's `withThreadTx`, and passes the card port it builds over the same transaction, so an activity and its owner's
 * card commit or roll back as one. Free text is sealed with `sealer` and opened only where a read returns it; reads that
 * a write follows take a row lock.
 */
export function dialogueTx(tx: Transaction, options: { sealer: Sealer; workItems: DialogueWorkItems }): DialogueTx {
  const { sealer } = options;
  const assessmentOf = (r: AssessmentRow): AssessmentRecord => ({
    id: r.id,
    organisationId: r.organisationId,
    unitId: r.unitId,
    areaKey: r.areaKey,
    dimension: r.dimension,
    tone: r.tone,
    comment: r.commentSealed === null ? null : sealer.open(r.commentSealed, purpose.comment(r.id)),
    authorId: r.authorId,
    at: r.at.toISOString(),
  });
  const activityOf = (r: ActivityRow): ActivityRecord => ({
    id: r.id,
    organisationId: r.organisationId,
    unitId: r.unitId,
    areaKey: r.areaKey,
    ownerId: r.ownerId,
    text: sealer.open(r.textSealed, purpose.activity(r.id)),
    dueOn: r.dueOn,
    doneAt: iso(r.doneAt),
    doneBy: r.doneBy,
    doneNote: r.doneNoteSealed === null ? null : sealer.open(r.doneNoteSealed, purpose.note(r.id)),
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    threadId: r.threadId,
  });
  const self: DialogueTx = {
    async areas(organisationId) {
      const rows = await tx
        .select()
        .from(areas)
        .where(eq(areas.organisationId, organisationId))
        .orderBy(asc(areas.ordinal), asc(areas.key));
      return rows.map(r => ({ ...r, dimensions: r.dimensions ?? [] }));
    },
    async questions(organisationId) {
      return tx
        .select()
        .from(questions)
        .where(eq(questions.organisationId, organisationId))
        .orderBy(asc(questions.areaKey), asc(questions.ordinal), asc(questions.id));
    },
    async replaceConfig(organisationId, newAreas, newQuestions) {
      await tx.delete(questions).where(eq(questions.organisationId, organisationId));
      await tx.delete(areas).where(eq(areas.organisationId, organisationId));
      if (newAreas.length) await tx.insert(areas).values(newAreas);
      if (newQuestions.length) await tx.insert(questions).values(newQuestions);
    },
    async assessments(organisationId, unitIds) {
      if (!unitIds.length) return [];
      const rows = await tx
        .select()
        .from(assessments)
        .where(and(eq(assessments.organisationId, organisationId), inArray(assessments.unitId, [...unitIds])))
        .orderBy(desc(assessments.at), desc(assessments.id));
      return rows.map(assessmentOf);
    },
    async insertAssessment(a) {
      await tx.insert(assessments).values({
        id: a.id,
        organisationId: a.organisationId,
        unitId: a.unitId,
        areaKey: a.areaKey,
        dimension: a.dimension,
        tone: a.tone,
        commentSealed: a.comment === null ? null : sealer.seal(a.comment, purpose.comment(a.id)),
        authorId: a.authorId,
        at: new Date(a.at),
      });
    },
    async activities(organisationId, unitIds) {
      if (!unitIds.length) return [];
      const rows = await tx
        .select()
        .from(activities)
        .where(and(eq(activities.organisationId, organisationId), inArray(activities.unitId, [...unitIds])))
        .orderBy(asc(activities.createdAt), asc(activities.id));
      return rows.map(activityOf);
    },
    async openAreaKeys(organisationId) {
      const rows = await tx
        .selectDistinct({ key: activities.areaKey })
        .from(activities)
        .where(and(eq(activities.organisationId, organisationId), isNull(activities.doneAt)))
        .orderBy(asc(activities.areaKey));
      return rows.map(r => r.key);
    },
    async activitiesOwnedBy(ownerId) {
      const rows = await tx
        .select()
        .from(activities)
        .where(and(eq(activities.ownerId, ownerId), isNull(activities.doneAt)))
        .orderBy(asc(activities.createdAt), asc(activities.id));
      return rows.map(activityOf);
    },
    async activity(id) {
      const [r] = await tx.select().from(activities).where(eq(activities.id, id)).for('update');
      return r ? activityOf(r) : undefined;
    },
    async activityByThread(threadId) {
      const [r] = await tx.select().from(activities).where(eq(activities.threadId, threadId)).for('update');
      return r ? activityOf(r) : undefined;
    },
    async insertActivity(a) {
      await tx.insert(activities).values({
        id: a.id,
        organisationId: a.organisationId,
        unitId: a.unitId,
        areaKey: a.areaKey,
        ownerId: a.ownerId,
        textSealed: sealer.seal(a.text, purpose.activity(a.id)),
        dueOn: a.dueOn,
        doneAt: date(a.doneAt),
        doneBy: a.doneBy,
        doneNoteSealed: a.doneNote === null ? null : sealer.seal(a.doneNote, purpose.note(a.id)),
        createdBy: a.createdBy,
        createdAt: new Date(a.createdAt),
        updatedAt: new Date(a.updatedAt),
        threadId: a.threadId,
      });
    },
    async updateActivity(id, patch) {
      const set: Partial<typeof activities.$inferInsert> = {};
      if ('text' in patch && patch.text !== undefined) set.textSealed = sealer.seal(patch.text, purpose.activity(id));
      if ('dueOn' in patch) set.dueOn = patch.dueOn ?? null;
      if ('doneAt' in patch) set.doneAt = date(patch.doneAt ?? null);
      if ('doneBy' in patch) set.doneBy = patch.doneBy ?? null;
      if ('doneNote' in patch)
        set.doneNoteSealed = patch.doneNote ? sealer.seal(patch.doneNote, purpose.note(id)) : null;
      if ('updatedAt' in patch && patch.updatedAt) set.updatedAt = new Date(patch.updatedAt);
      if (!Object.keys(set).length) return;
      await tx.update(activities).set(set).where(eq(activities.id, id));
    },
    async deleteActivity(id) {
      await tx.delete(activities).where(eq(activities.id, id));
    },
    async names(ids) {
      if (!ids.length) return new Map();
      const rows = await tx
        .select({ id: people.id, name: people.name })
        .from(people)
        .where(inArray(people.id, [...ids]));
      return new Map(rows.map(r => [r.id, r.name]));
    },
    async unitLabels(ids) {
      if (!ids.length) return new Map();
      const rows = await tx
        .select({ id: units.id, label: units.label })
        .from(units)
        .where(inArray(units.id, [...ids]));
      return new Map(rows.map(r => [r.id, r.label]));
    },
    async lockPersonForErasure(personId) {
      const [person] = await tx
        .select({ enabled: people.enabled })
        .from(people)
        .where(eq(people.id, personId))
        .for('share');
      return person?.enabled;
    },
    async erasePerson(personId) {
      const cleared = new Set<string>(),
        threadIds = new Set<string>();
      // The cards of what they owned go too; read before the pointer is nulled.
      const owned = await tx
        .select({ id: activities.id, threadId: activities.threadId })
        .from(activities)
        .where(eq(activities.ownerId, personId))
        .orderBy(asc(activities.id))
        .for('update');
      for (const r of owned) if (r.threadId) threadIds.add(r.threadId);
      for (const r of await tx
        .update(activities)
        .set({ ownerId: null, threadId: null })
        .where(eq(activities.ownerId, personId))
        .returning({ id: activities.id }))
        cleared.add('activity:' + r.id);
      for (const column of ['createdBy', 'doneBy'] as const)
        for (const r of await tx
          .update(activities)
          .set({ [column]: null })
          .where(eq(activities[column], personId))
          .returning({ id: activities.id }))
          cleared.add('activity:' + r.id);
      for (const r of await tx
        .update(assessments)
        .set({ authorId: null })
        .where(eq(assessments.authorId, personId))
        .returning({ id: assessments.id }))
        cleared.add('assessment:' + r.id);
      return { cleared: cleared.size, threadIds: [...threadIds].sort() };
    },
    async exportOrganisation(organisationId) {
      const [areaRows, questionRows, assessmentRows, activityRows] = [
        await self.areas(organisationId),
        await self.questions(organisationId),
        await tx
          .select()
          .from(assessments)
          .where(eq(assessments.organisationId, organisationId))
          .orderBy(asc(assessments.at), asc(assessments.id)),
        await tx
          .select()
          .from(activities)
          .where(eq(activities.organisationId, organisationId))
          .orderBy(asc(activities.createdAt), asc(activities.id)),
      ];
      return {
        areas: areaRows,
        questions: questionRows,
        assessments: assessmentRows.map(assessmentOf),
        activities: activityRows.map(activityOf),
      };
    },
    async audit(e) {
      await tx.insert(audit).values({
        actor: e.actor,
        action: e.action,
        subject: e.subject,
        createdAt: new Date(e.at),
        details: e.details ?? {},
      });
    },
    workItems: options.workItems,
  };
  return self;
}
/**
 * The dialogue store over its own `database().transaction`, for a caller that does not share the transaction with the
 * thread store: `workItems` builds the card port over the same transaction.
 */
export function postgresDialogueStore(options: {
  sealer: Sealer;
  workItems: (tx: Transaction) => DialogueWorkItems;
}): DialogueStore {
  return {
    transaction: fn =>
      database().transaction(tx => fn(dialogueTx(tx, { sealer: options.sealer, workItems: options.workItems(tx) }))),
  };
}
