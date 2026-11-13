import type { DialogueActivity, DialogueArea, DialogueTone, StaffUnit } from '@clew/contracts';
import type { ActivityRecord, AreaRecord, AssessmentRecord, FollowedUnit, NoteRecord, QuestionRecord } from './model';

/**
 * The follow-up dialogue's rules (D118), pure: the words a state is shown with, the worst of several states, which
 * questions a unit sees, and how an area reads for one unit.
 */

/** The words of a state, as big-boss-board's managers know them; colour is never the only sign. */
export const TONE_WORDS: Record<DialogueTone, string> = { ok: 'Bra', warn: 'Bevaka', alert: 'Åtgärd krävs' };
const WEIGHT: Record<DialogueTone, number> = { ok: 0, warn: 1, alert: 2 };
/** The worst of these states; undefined for none. */
export function worst(tones: readonly DialogueTone[]): DialogueTone | undefined {
  let found: DialogueTone | undefined;
  for (const t of tones) if (!found || WEIGHT[t] > WEIGHT[found]) found = t;
  return found;
}
/** Free text as it is kept: line ends as `\n`, blank lines at either end gone, never only white space. */
export function normaliseText(value: string | undefined): string {
  return (value ?? '').replace(/\r\n?/g, '\n').trim();
}
export const isCalendarDay = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
};
/** The dimensions an area is assessed in: its own, or the area as a whole (`''`). */
export const dimensionsOf = (area: AreaRecord): Array<{ key: string; title: string }> =>
  area.dimensions.length ? area.dimensions : [{ key: '', title: '' }];
/**
 * The questions a unit sees in an area: the ones written for that unit where there are any, else the area's general
 * ones, in the configured order (big-boss-board's organisation-specific questions).
 */
export function questionsFor(questions: readonly QuestionRecord[], areaKey: string, unitId: string) {
  const ofArea = questions.filter(q => q.areaKey === areaKey);
  const own = ofArea.filter(q => q.unitId === unitId);
  return (own.length ? own : ofArea.filter(q => q.unitId === null)).sort((a, b) => a.ordinal - b.ordinal);
}
/** The newest assessment of each dimension of an assessed area for a unit; a dimension never assessed is absent. */
export function latestOf(area: AreaRecord, unitId: string, assessments: readonly AssessmentRecord[]) {
  const latest = new Map<string, AssessmentRecord>();
  for (const a of assessments) {
    if (a.unitId !== unitId || a.areaKey !== area.key) continue;
    const seen = latest.get(a.dimension);
    if (!seen || a.at > seen.at || (a.at === seen.at && a.id > seen.id)) latest.set(a.dimension, a);
  }
  const keys = new Set(dimensionsOf(area).map(d => d.key));
  return [...latest.values()].filter(a => keys.has(a.dimension));
}
/** An assessed area's state for a unit: the worst of its dimensions' newest assessments (D118 item 6). */
export const areaTone = (area: AreaRecord, unitId: string, assessments: readonly AssessmentRecord[]) =>
  area.kind === 'assessed' ? worst(latestOf(area, unitId, assessments).map(a => a.tone)) : undefined;
/** "Inga öppna aktiviteter", "1 öppen aktivitet", "3 öppna aktiviteter". */
export const openWords = (n: number) =>
  n === 0 ? 'Inga öppna aktiviteter' : n === 1 ? '1 öppen aktivitet' : `${n} öppna aktiviteter`;
/** "1 försenad", "2 försenade"; undefined for none. */
export const overdueWords = (n: number) => (n === 0 ? undefined : n === 1 ? '1 försenad' : `${n} försenade`);
/** An open activity whose due day has passed. */
export const isOverdue = (a: Pick<ActivityRecord, 'dueOn' | 'doneAt'>, today: string) =>
  a.doneAt === null && a.dueOn !== null && a.dueOn < today;
/** Open first, by due day (undated last) and then by when they were added; then the done ones, the newest first. */
export function orderActivities<T extends Pick<ActivityRecord, 'id' | 'dueOn' | 'doneAt' | 'createdAt'>>(
  rows: readonly T[],
): T[] {
  const open = rows.filter(a => a.doneAt === null),
    done = rows.filter(a => a.doneAt !== null);
  open.sort(
    (a, b) =>
      (a.dueOn ?? '9999-12-31').localeCompare(b.dueOn ?? '9999-12-31') ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  done.sort((a, b) => b.doneAt!.localeCompare(a.doneAt!) || a.id.localeCompare(b.id));
  return [...open, ...done];
}
/** One area of one unit's dialogue as the page draws it; `names` gives a person's name by id. */
export function areaFor(input: {
  area: AreaRecord;
  unitId: string;
  questions: readonly QuestionRecord[];
  assessments: readonly AssessmentRecord[];
  activities: readonly ActivityRecord[];
  /** The reader's own notes (D120); another person's note is never drawn, whatever is handed in. */
  notes: readonly NoteRecord[];
  names: ReadonlyMap<string, string>;
  reader: string;
}): DialogueArea {
  const { area, unitId, names, reader } = input;
  const nameOf = (id: string | null) => (id ? names.get(id) : undefined);
  const dimensions =
    area.kind === 'assessed'
      ? dimensionsOf(area).map(d => ({
          key: d.key,
          title: d.title,
          history: input.assessments
            .filter(a => a.unitId === unitId && a.areaKey === area.key && a.dimension === d.key)
            .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
            .map(a => {
              const by = nameOf(a.authorId);
              return {
                tone: a.tone,
                ...(a.comment ? { comment: a.comment } : {}),
                ...(by ? { by } : {}),
                at: a.at,
              };
            }),
        }))
      : [];
  const tone = areaTone(area, unitId, input.assessments);
  const activities = orderActivities(input.activities.filter(a => a.unitId === unitId && a.areaKey === area.key)).map(
    (a): DialogueActivity => {
      const owner = nameOf(a.ownerId);
      return {
        id: a.id,
        text: a.text,
        ...(a.dueOn ? { dueOn: a.dueOn } : {}),
        ...(owner ? { owner } : {}),
        mine: a.ownerId === reader,
        ...(a.doneAt ? { doneAt: a.doneAt } : {}),
        ...(a.doneAt && a.doneNote ? { doneNote: a.doneNote } : {}),
        createdAt: a.createdAt,
      };
    },
  );
  return {
    key: area.key,
    title: area.title,
    kind: area.kind,
    ...(area.measure ? { measure: area.measure } : {}),
    ...(area.info ? { info: area.info } : {}),
    ...(tone ? { tone } : {}),
    dimensions,
    questions: questionsFor(input.questions, area.key, unitId).map(q => ({
      ...(q.heading ? { heading: q.heading } : {}),
      text: q.text,
      ...(q.basedOn ? { basedOn: q.basedOn } : {}),
    })),
    activities,
    notes: input.notes
      .filter(n => n.unitId === unitId && n.areaKey === area.key && n.authorId === reader)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map(n => ({
        id: n.id,
        text: n.text,
        createdAt: n.createdAt,
        ...(n.updatedAt !== n.createdAt ? { editedAt: n.updatedAt } : {}),
      })),
  };
}
/**
 * The units a manager follows up (D117, D99's reporting line): the units they manage, with themselves as the manager the
 * activities go to, then the units led by the managers who report to them, with that manager. One level down, never the
 * whole branch; a unit they manage is never also one below. An employee follows up nothing.
 */
export function followedFrom(personId: string, managed: readonly StaffUnit[]): FollowedUnit[] {
  const found = new Map<string, FollowedUnit>();
  for (const u of managed)
    found.set(u.unitId, { unitId: u.unitId, label: u.unitLabel, relation: 'own', managerId: personId });
  for (const u of managed)
    for (const p of u.people)
      for (const b of p.below ?? [])
        if (b.role === 'manager' && p.enabled !== false && !found.has(b.unitId))
          found.set(b.unitId, { unitId: b.unitId, label: b.unitLabel, relation: 'below', managerId: p.id });
  return [...found.values()];
}
