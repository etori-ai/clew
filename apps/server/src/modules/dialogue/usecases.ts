import {
  DIALOGUE_TEXT_MAX,
  stockholmDate,
  type AuthenticatedContext,
  type DialogueActivityAddBody,
  type DialogueActivityDoneBody,
  type DialogueActivityEditBody,
  type DialogueAssessBody,
  type DialogueConfig,
  type DialogueNoteAddBody,
  type DialogueNoteEditBody,
  type DialogueTone,
  type DialogueUnit,
} from '@clew/contracts';
import { ForbiddenError, InputError } from '../../context';
import { areaFor, areaTone, isCalendarDay, isOverdue, normaliseText, orderActivities } from './domain';
import type { ActivityRecord, AreaRecord, DialogueDeps, DialogueTx, FollowedUnit, QuestionRecord } from './model';

/** A request the dialogue turns down for what it asks, not who asks; a 400 with this message. */
export class DialogueError extends InputError {
  constructor(message: string) {
    super(message);
    this.name = 'DialogueError';
  }
}
const NOT_A_MANAGER = 'Dialogstödet är för den som är chef för en enhet.';
const NOT_FOLLOWED = 'Enheten finns inte bland dem du följer upp.';
const NOT_ALLOWED = 'Du kan inte ändra den här aktiviteten.';
const NO_AREA = 'Området finns inte i dialogen.';
const NOT_ASSESSED = 'Området bedöms inte för hand.';
const BAD_DIMENSION = 'Välj vilken del av området bedömningen gäller.';
const BAD_DAY = 'Ange ett giltigt datum.';
const BLANK = 'Skriv vad som ska göras.';
const NOT_DONE = 'Markera aktiviteten som klar innan du tar bort den.';
const BLANK_NOTE = 'Skriv din anteckning.';
const NOT_YOUR_NOTE = 'Du kan inte ändra den här anteckningen.';
/** The actor of a row written because a timer fired; the convention of the other timer-driven rows. */
const TIMER_ACTOR = 'system:scheduler';
/** The version of the export document; a breaking change is a new version. */
export const DIALOGUE_EXPORT_FORMAT = 'clew.dialogue/1';
/** One unit's dialogue in short (`dialogue.unit`, D97): its state over the assessed areas and its open activities. */
export interface UnitStanding {
  key: string;
  /** The assessed areas whose state is `alert`, by title in the configured order. */
  alert: string[];
  /** The assessed areas whose state is `warn`, by title in the configured order. */
  warn: string[];
  /** Whether any assessed area has a state at all. */
  assessed: boolean;
  open: number;
  overdue: number;
}

/**
 * The follow-up dialogue's use cases (D118). Who follows up which unit is read when asked (`deps.followed`, D117), never
 * stored, so a manager whose reporting line changes reads and writes nothing of the old units the same day. Every change
 * is one `deps.store` transaction with its audit row and, for an activity, its owner's card. Audit rows carry ids, keys,
 * dates, counts and tones: never a text, a note, a comment or a name.
 *
 * A manager's own notes (D120) are written on a unit they follow up and read, changed and removed by their author only;
 * a note has no card and no state, and its audit rows say which unit and area, never what it says.
 */
export function dialogueUsecases(deps: DialogueDeps) {
  const now = () => deps.clock();
  async function followed(persona: AuthenticatedContext) {
    const units = await deps.followed(persona);
    return new Map(units.map(u => [u.unitId, u]));
  }
  async function unitOf(persona: AuthenticatedContext, unitId: string): Promise<FollowedUnit> {
    const units = await followed(persona);
    if (!units.size) throw new ForbiddenError(NOT_A_MANAGER);
    const unit = units.get(unitId);
    if (!unit) throw new ForbiddenError(NOT_FOLLOWED);
    return unit;
  }
  async function areaOf(tx: DialogueTx, organisationId: string, key: string) {
    const area = (await tx.areas(organisationId)).find(a => a.key === key);
    if (!area) throw new DialogueError(NO_AREA);
    return area;
  }
  function text(value: string, max: number, blank = BLANK) {
    const t = normaliseText(value);
    if (!t) throw new DialogueError(blank);
    if (t.length > max) throw new DialogueError(`Högst ${max} tecken.`);
    return t;
  }
  function optionalText(value: string | undefined, max: number) {
    const t = normaliseText(value);
    if (t.length > max) throw new DialogueError(`Högst ${max} tecken.`);
    return t || null;
  }
  function day(value: string | null | undefined) {
    if (value === undefined || value === null) return null;
    if (!isCalendarDay(value)) throw new DialogueError(BAD_DAY);
    return value;
  }
  /**
   * An activity the persona may change: the unit is one they follow up, or they own it. Locked for the transaction.
   * Refused alike when it does not exist, so an id tells nobody anything.
   */
  async function activityFor(
    tx: DialogueTx,
    persona: AuthenticatedContext,
    units: Map<string, FollowedUnit>,
    id: string,
  ) {
    const a = await tx.activity(id);
    if (!a || a.organisationId !== persona.organisationId || (!units.has(a.unitId) && a.ownerId !== persona.id))
      throw new ForbiddenError(NOT_ALLOWED);
    return a;
  }
  /**
   * A note the persona wrote, locked for the transaction. Refused alike when it does not exist or is another person's,
   * so an id tells nobody anything.
   */
  async function noteFor(tx: DialogueTx, persona: AuthenticatedContext, id: string) {
    const n = await tx.note(id);
    if (!n || n.organisationId !== persona.organisationId || n.authorId !== persona.id)
      throw new ForbiddenError(NOT_YOUR_NOTE);
    return n;
  }
  const by = (persona: AuthenticatedContext, a: ActivityRecord) => (a.ownerId === persona.id ? 'owner' : 'manager');
  async function setDone(persona: AuthenticatedContext, id: string, done: boolean, note?: string) {
    const units = await followed(persona);
    const doneNote = done ? optionalText(note, DIALOGUE_TEXT_MAX.note) : null;
    const at = now().toISOString();
    await deps.store.transaction(async tx => {
      const a = await activityFor(tx, persona, units, id);
      if ((a.doneAt !== null) === done) return;
      if (done) {
        await tx.updateActivity(id, { doneAt: at, doneBy: persona.id, doneNote, updatedAt: at });
        if (a.threadId) await tx.workItems.close(a.threadId, at);
      } else {
        await tx.updateActivity(id, { doneAt: null, doneBy: null, doneNote: null, updatedAt: at });
        if (a.threadId) await tx.workItems.reopen(a.threadId, a.dueOn, at);
      }
      await tx.audit({
        actor: persona.principal.id,
        action: done ? 'dialogue.activity_done' : 'dialogue.activity_reopened',
        subject: 'dialogue-activity:' + id,
        at,
        details: { unitId: a.unitId, area: a.areaKey, by: by(persona, a), ...(done ? { note: !!doneNote } : {}) },
      });
    });
  }

  return {
    /**
     * One unit's dialogue (D118 items 3 to 6): every configured area in order, its questions for this unit, the history
     * of its assessments per dimension, its activities and the reader's own notes (D120), text opened. Only for a unit
     * the persona follows up.
     */
    async unit(persona: AuthenticatedContext, unitId: string): Promise<Omit<DialogueUnit, 'writable'>> {
      const unit = await unitOf(persona, unitId);
      return deps.store.transaction(async tx => {
        // One after the other: a transaction is one connection.
        const areas = await tx.areas(persona.organisationId),
          questions = await tx.questions(persona.organisationId),
          assessments = await tx.assessments(persona.organisationId, [unitId]),
          activities = await tx.activities(persona.organisationId, [unitId]),
          notes = await tx.notes(persona.organisationId, [unitId], persona.id);
        const people = new Set<string>();
        for (const a of assessments) if (a.authorId) people.add(a.authorId);
        for (const a of activities) if (a.ownerId) people.add(a.ownerId);
        const names = await tx.names([...people].sort());
        return {
          unit: { id: unit.unitId, label: unit.label, relation: unit.relation },
          areas: areas.map(area =>
            areaFor({ area, unitId, questions, assessments, activities, notes, names, reader: persona.id }),
          ),
        };
      });
    },
    /**
     * The dialogue of these units in short (D97, `dialogue.unit`): which assessed areas need action or watching, and the open
     * and overdue activities, one row per key the persona follows up; any other key has no row.
     */
    async aboutUnits(persona: AuthenticatedContext, keys: readonly string[]): Promise<UnitStanding[]> {
      const units = await followed(persona);
      const wanted = [...new Set(keys)].filter(k => units.has(k));
      if (!wanted.length) return [];
      const today = stockholmDate(now().toISOString());
      return deps.store.transaction(async tx => {
        const areas = await tx.areas(persona.organisationId),
          assessments = await tx.assessments(persona.organisationId, wanted),
          activities = await tx.activities(persona.organisationId, wanted);
        const configured = new Set(areas.map(a => a.key));
        return wanted.map(key => {
          const own = activities.filter(a => a.unitId === key && a.doneAt === null && configured.has(a.areaKey));
          const tones = areas.map(area => ({ title: area.title, tone: areaTone(area, key, assessments) }));
          return {
            key,
            alert: tones.filter(t => t.tone === 'alert').map(t => t.title),
            warn: tones.filter(t => t.tone === 'warn').map(t => t.title),
            assessed: tones.some(t => t.tone !== undefined),
            open: own.length,
            overdue: own.filter(a => isOverdue(a, today)).length,
          };
        });
      });
    },
    /** The open activities the persona owns, with the unit each is on: what the owner's card opens. */
    async mine(persona: AuthenticatedContext) {
      return deps.store.transaction(async tx => {
        const own = orderActivities(await tx.activitiesOwnedBy(persona.id));
        const areas = await tx.areas(persona.organisationId),
          labels = await tx.unitLabels([...new Set(own.map(a => a.unitId))].sort());
        const titles = new Map(areas.map(a => [a.key, a.title]));
        return own
          .filter(a => titles.has(a.areaKey))
          .map(a => ({
            id: a.id,
            text: a.text,
            unitId: a.unitId,
            unit: labels.get(a.unitId) ?? '',
            area: titles.get(a.areaKey)!,
            dueOn: a.dueOn,
          }));
      });
    },
    /**
     * A manager sets an assessed area's state for a unit they follow up (D118 item 6): append-only, the newest counts.
     * An area with dimensions takes one of them; an area assessed as a whole takes none.
     */
    async assess(persona: AuthenticatedContext, unitId: string, body: DialogueAssessBody) {
      await unitOf(persona, unitId);
      const comment = optionalText(body.comment, DIALOGUE_TEXT_MAX.comment);
      const at = now().toISOString(),
        id = deps.ids();
      await deps.store.transaction(async tx => {
        const area = await areaOf(tx, persona.organisationId, body.area);
        if (area.kind !== 'assessed') throw new DialogueError(NOT_ASSESSED);
        const dimension = body.dimension ?? '';
        const allowed = area.dimensions.length ? area.dimensions.map(d => d.key) : [''];
        if (!allowed.includes(dimension)) throw new DialogueError(BAD_DIMENSION);
        await tx.insertAssessment({
          id,
          organisationId: persona.organisationId,
          unitId,
          areaKey: area.key,
          dimension,
          tone: body.tone,
          comment,
          authorId: persona.id,
          at,
        });
        await tx.audit({
          actor: persona.principal.id,
          action: 'dialogue.assessed',
          subject: 'dialogue-assessment:' + id,
          at,
          details: {
            unitId,
            area: area.key,
            ...(dimension ? { dimension } : {}),
            tone: body.tone,
            comment: !!comment,
          },
        });
      });
      return id;
    },
    /**
     * A manager adds an activity to an area of a unit they follow up (D118 items 4 and 5). Its owner is the unit's
     * manager (the reader on their own unit), who gets it as a card about the unit; a dated one has a timer.
     */
    async addActivity(persona: AuthenticatedContext, unitId: string, body: DialogueActivityAddBody) {
      const unit = await unitOf(persona, unitId);
      const value = text(body.text, DIALOGUE_TEXT_MAX.activity);
      const dueOn = day(body.dueOn);
      const at = now().toISOString(),
        id = deps.ids(),
        threadId = deps.ids();
      await deps.store.transaction(async tx => {
        const area = await areaOf(tx, persona.organisationId, body.area);
        await tx.workItems.open({
          threadId,
          personId: unit.managerId,
          activityId: id,
          dueOn,
          at,
          subject: { entity: 'unit', key: unitId },
        });
        await tx.insertActivity({
          id,
          organisationId: persona.organisationId,
          unitId,
          areaKey: area.key,
          ownerId: unit.managerId,
          text: value,
          dueOn,
          doneAt: null,
          doneBy: null,
          doneNote: null,
          createdBy: persona.id,
          createdAt: at,
          updatedAt: at,
          threadId,
        });
        await tx.audit({
          actor: persona.principal.id,
          action: 'dialogue.activity_added',
          subject: 'dialogue-activity:' + id,
          at,
          details: {
            unitId,
            area: area.key,
            dueOn,
            owner: unit.managerId === persona.id ? 'self' : 'unit-manager',
          },
        });
      });
      return id;
    },
    /** The text and due date of an activity changed; an open one's card follows the date. */
    async editActivity(persona: AuthenticatedContext, id: string, body: DialogueActivityEditBody) {
      const units = await followed(persona);
      const value = text(body.text, DIALOGUE_TEXT_MAX.activity);
      const dueOn = day(body.dueOn);
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const a = await activityFor(tx, persona, units, id);
        if (a.text === value && a.dueOn === dueOn) return;
        await tx.updateActivity(id, { text: value, dueOn, updatedAt: at });
        if (a.threadId && a.doneAt === null && a.dueOn !== dueOn) await tx.workItems.retime(a.threadId, dueOn, at);
        await tx.audit({
          actor: persona.principal.id,
          action: 'dialogue.activity_edited',
          subject: 'dialogue-activity:' + id,
          at,
          details: { unitId: a.unitId, area: a.areaKey, dueOn, text: a.text !== value, by: by(persona, a) },
        });
      });
    },
    completeActivity: (persona: AuthenticatedContext, id: string, body: DialogueActivityDoneBody = {}) =>
      setDone(persona, id, true, body.note),
    reopenActivity: (persona: AuthenticatedContext, id: string) => setDone(persona, id, false),
    /** A done activity removed (D118 item 7), with its card; an open one must be marked done first. */
    async removeActivity(persona: AuthenticatedContext, id: string) {
      const units = await followed(persona);
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const a = await activityFor(tx, persona, units, id);
        if (a.doneAt === null) throw new DialogueError(NOT_DONE);
        await tx.deleteActivity(id);
        if (a.threadId) await tx.workItems.remove([a.threadId]);
        await tx.audit({
          actor: persona.principal.id,
          action: 'dialogue.activity_removed',
          subject: 'dialogue-activity:' + id,
          at,
          details: { unitId: a.unitId, area: a.areaKey, by: by(persona, a) },
        });
      });
    },
    /**
     * A manager writes a note of their own on an area of a unit they follow up (D120). Nobody else reads it; it has no
     * card and nothing to mark done.
     */
    async addNote(persona: AuthenticatedContext, unitId: string, body: DialogueNoteAddBody) {
      await unitOf(persona, unitId);
      const value = text(body.text, DIALOGUE_TEXT_MAX.ownNote, BLANK_NOTE);
      const at = now().toISOString(),
        id = deps.ids();
      await deps.store.transaction(async tx => {
        const area = await areaOf(tx, persona.organisationId, body.area);
        await tx.insertNote({
          id,
          organisationId: persona.organisationId,
          unitId,
          areaKey: area.key,
          authorId: persona.id,
          text: value,
          createdAt: at,
          updatedAt: at,
        });
        await tx.audit({
          actor: persona.principal.id,
          action: 'dialogue.note_added',
          subject: 'dialogue-note:' + id,
          at,
          details: { unitId, area: area.key },
        });
      });
      return id;
    },
    /** The author changes a note's text. */
    async editNote(persona: AuthenticatedContext, id: string, body: DialogueNoteEditBody) {
      const value = text(body.text, DIALOGUE_TEXT_MAX.ownNote, BLANK_NOTE);
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const n = await noteFor(tx, persona, id);
        if (n.text === value) return;
        await tx.updateNote(id, { text: value, updatedAt: at });
        await tx.audit({
          actor: persona.principal.id,
          action: 'dialogue.note_edited',
          subject: 'dialogue-note:' + id,
          at,
          details: { unitId: n.unitId, area: n.areaKey },
        });
      });
    },
    /** The author removes a note for good: unlike an activity, a note is not kept once it is not wanted. */
    async removeNote(persona: AuthenticatedContext, id: string) {
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const n = await noteFor(tx, persona, id);
        await tx.deleteNote(id);
        await tx.audit({
          actor: persona.principal.id,
          action: 'dialogue.note_removed',
          subject: 'dialogue-note:' + id,
          at,
          details: { unitId: n.unitId, area: n.areaKey },
        });
      });
    },
    /**
     * A dated activity's timer fired: when the activity is still open, its card comes back to the top of the owner's
     * stream. Returns whether it did; a done or removed activity, or a replaced timer, changes nothing.
     */
    async activityDue(threadId: string, generation: number) {
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
        const a = await tx.activityByThread(threadId);
        if (!a || a.doneAt !== null) return false;
        const fired = await tx.workItems.fire(threadId, generation, at);
        if (fired)
          await tx.audit({
            actor: TIMER_ACTOR,
            action: 'dialogue.activity_due',
            subject: 'dialogue-activity:' + a.id,
            at,
            details: { unitId: a.unitId, area: a.areaKey, dueOn: a.dueOn, generation },
          });
        return fired;
      });
    },
    /**
     * An operator replaces the organisation's areas, dimensions and questions (D118 item 3). Assessments and activities
     * stay; an area left out of the file is no longer shown, and comes back with its records if it is loaded again.
     */
    async replaceConfig(actor: string, organisationId: string, config: DialogueConfig) {
      // An operator's file: what is wrong with it is said in English, as every script's output is.
      const keys = config.areas.map(a => a.key);
      if (new Set(keys).size !== keys.length) throw new Error('An area appears twice in the file.');
      for (const a of config.areas) {
        const dims = (a.dimensions ?? []).map(d => d.key);
        if (new Set(dims).size !== dims.length) throw new Error(`Area "${a.key}" has a dimension twice.`);
        if (a.kind === 'measured' && dims.length)
          throw new Error(`Area "${a.key}" is measured and cannot be assessed in dimensions.`);
      }
      const areas: AreaRecord[] = config.areas.map((a, i) => ({
        organisationId,
        key: a.key,
        title: a.title,
        kind: a.kind,
        measure: a.measure ?? null,
        info: a.info ?? null,
        dimensions: a.dimensions ?? [],
        ordinal: i,
      }));
      const questions: QuestionRecord[] = config.areas.flatMap(a =>
        (a.questions ?? []).flatMap((q, i) =>
          (q.units ?? [null]).map(unitId => ({
            id: deps.ids(),
            organisationId,
            areaKey: a.key,
            unitId,
            heading: q.heading ?? null,
            text: q.text,
            basedOn: q.basedOn ?? null,
            ordinal: i,
          })),
        ),
      );
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        // An area with open activities stays: without it they would leave the drawer and the owner's list while
        // their cards and timers live on, and nobody could close them.
        const dropped = (await tx.openAreaKeys(organisationId)).filter(k => !keys.includes(k));
        if (dropped.length)
          throw new Error(
            `The file leaves out ${dropped.map(k => `"${k}"`).join(', ')}, which still has open activities. Keep the area until they are done.`,
          );
        await tx.replaceConfig(organisationId, areas, questions);
        await tx.audit({
          actor,
          action: 'dialogue.config_replaced',
          subject: 'organisation:' + organisationId,
          at,
          details: { areas: areas.length, questions: questions.length },
        });
      });
      return { areas: areas.length, questions: questions.length };
    },
    /** Whether the organisation has any areas configured: the development seed loads its example only when not. */
    hasAreas: (organisationId: string) =>
      deps.store.transaction(async tx => (await tx.areas(organisationId)).length > 0),
    /**
     * An operator removes a person from every dialogue row, the cards of what they owned and their own notes. Counts
     * only in the audit.
     */
    async erasePerson(actor: string, personId: string) {
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
        const erased = await tx.erasePerson(personId);
        await tx.workItems.remove(erased.threadIds);
        await tx.audit({
          actor,
          action: 'dialogue.person_erased',
          subject: 'person:' + personId,
          at,
          details: { cleared: erased.cleared, cards: erased.threadIds.length },
        });
        return { cleared: erased.cleared, cards: erased.threadIds.length };
      });
    },
    /** The organisation's whole dialogue as `clew.dialogue/1`, text opened, for an operator to hand on or archive. */
    async exportDomain(actor: string, organisationId: string) {
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
        const data = await tx.exportOrganisation(organisationId);
        await tx.audit({
          actor,
          action: 'dialogue.exported',
          subject: 'organisation:' + organisationId,
          at,
          details: {
            areas: data.areas.length,
            assessments: data.assessments.length,
            activities: data.activities.length,
            notes: data.notes.length,
          },
        });
        return { format: DIALOGUE_EXPORT_FORMAT, exportedAt: at, organisationId, ...data };
      });
    },
  };
}
export type DialogueUsecases = ReturnType<typeof dialogueUsecases>;
