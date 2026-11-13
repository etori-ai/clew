import {
  BOARDING_CONDITIONS,
  BOARDING_EVENT_WORDS,
  BOARDING_ITEM_TEXT_MAX,
  BOARDING_KIND_WORDS,
  BOARDING_OWNER_WORDS,
  BOARDING_PHASE_WORDS,
  boardingText,
  dayRhythm,
  shiftDate,
  stockholmDate,
  stockholmInstant,
  type BoardingEvent,
  type BoardingItemRow,
  type BoardingItemStatus,
  type BoardingOwnerRole,
  type BoardingPhase,
  type BoardingPlanState,
  type BoardingPlanSummary,
} from '@clew/contracts';
import type { ItemRecord, LayerItemRecord, LayerRecord, PersonRef, PlanRecord, Report, UnitNode } from './model';

/**
 * The rules of the boarding domain (D124) as pure functions: which layers apply to a person, how a plan's items are
 * assembled from them and a day, an item's phase, a plan's progress and state, who is suggested a plan, the rows the
 * reads and pages carry, and the Swedish words a person reads. No I/O, no clock: the use case hands in every day.
 */

/**
 * How far ahead an employment's start date makes Clew suggest an introduction (D124, this build's choice): six weeks,
 * so an item two weeks before the first day (ordering a computer) still has a month to be started in.
 */
export const SUGGESTION_WINDOW_DAYS = 42;
/**
 * A closed introduction anchored this many days before a start date, or later, is that start's introduction: no
 * suggestion is made again for it (a plan closed early, or a hire that was called off, is not suggested twice).
 */
export const SUGGESTION_COVERED_DAYS = 90;
/** A plan's day may lie at most a year from today, either way: further off is a typing error, not a plan. */
export const ANCHOR_RANGE_DAYS = 366;
/** The most items one plan may hold, its layers' and the ones a manager adds together. */
export const PLAN_ITEMS_MAX = 300;
/** The order layers are assembled in: everyone first, then the unit, the position and the employment type. */
const CONDITION_ORDER = BOARDING_CONDITIONS;
/** The phases of each event, in the order a plan's page lists them. */
export const PHASES_OF: Record<BoardingEvent, readonly BoardingPhase[]> = {
  introduction: ['beforeStart', 'firstDay', 'firstWeek', 'first90Days', 'later'],
  leaving: ['earlier', 'last90Days', 'lastWeek', 'lastDay', 'afterLeaving'],
};

/** The calendar day of an instant in Swedish time, `YYYY-MM-DD`. */
export const swedishDay = (at: Date) => stockholmDate(at.toISOString());
/** A real calendar day written `YYYY-MM-DD` (not 2026-02-30). */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
const utc = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
/** Whole calendar days from `from` to `to` (both `YYYY-MM-DD`): negative when `to` is before `from`. */
export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86_400_000);
/** A plan's day is a calendar day within `ANCHOR_RANGE_DAYS` of today. */
export const anchorInRange = (anchorOn: string, today: string) =>
  isCalendarDay(anchorOn) && Math.abs(daysBetween(today, anchorOn)) <= ANCHOR_RANGE_DAYS;

/**
 * The phase of an item from its distance in days to the plan's day (D124). An introduction: before the first day, the
 * first day, the first week (days 1 to 6), the first 90 days (7 to 89), later. A leaving mirrors it: earlier (90 days
 * or more before the last day), the last 90 days, the last week (6 to 1 days before), the last day, after it.
 */
export function phaseOf(event: BoardingEvent, offsetDays: number): BoardingPhase {
  if (event === 'introduction')
    return offsetDays < 0
      ? 'beforeStart'
      : offsetDays === 0
        ? 'firstDay'
        : offsetDays < 7
          ? 'firstWeek'
          : offsetDays < 90
            ? 'first90Days'
            : 'later';
  return offsetDays <= -90
    ? 'earlier'
    : offsetDays <= -7
      ? 'last90Days'
      : offsetDays < 0
        ? 'lastWeek'
        : offsetDays === 0
          ? 'lastDay'
          : 'afterLeaving';
}
/** The phase of a plan's item: its due day's distance from the plan's day. */
export const itemPhase = (plan: Pick<PlanRecord, 'event' | 'anchorOn'>, dueOn: string) =>
  phaseOf(plan.event, daysBetween(plan.anchorOn, dueOn));

/**
 * The units a unit layer matches a person on (D124): every unit they are assigned to and every unit above it in the
 * tree, so a layer set on an administration applies to everyone below it. A cycle in the tree ends the walk.
 */
export function unitsUpward(unitIds: readonly string[], tree: readonly UnitNode[]): Set<string> {
  const parents = new Map(tree.map(u => [u.id, u.parentId]));
  const found = new Set<string>();
  for (const start of unitIds)
    for (let at: string | null | undefined = start; at && !found.has(at); at = parents.get(at)) found.add(at);
  return found;
}
/** Whether a layer applies to a person: everyone; a unit they are on or below; a position they hold; an employment type exactly as written. */
export function layerApplies(
  layer: Pick<LayerRecord, 'condition' | 'value'>,
  person: Pick<Report, 'positionCodes' | 'employments'>,
  units: ReadonlySet<string>,
): boolean {
  switch (layer.condition) {
    case 'all':
      return true;
    case 'unit':
      return layer.value !== null && units.has(layer.value);
    case 'position':
      return layer.value !== null && person.positionCodes.includes(layer.value);
    case 'employment_type':
      return layer.value !== null && person.employments.some(e => e.employmentType === layer.value);
  }
}
/**
 * D99's line upwards, as the people module walks it for `above`: from each unit the person is assigned to (from the unit
 * above, where they lead it) up to the nearest unit somebody leads, its leaders. A cycle ends the walk. Pure, and shared by
 * both directory adapters, so the two walk alike.
 */
export function lineUpwards(
  assignments: ReadonlyArray<{ unitId: string; role: 'manager' | 'employee' }>,
  parents: ReadonlyMap<string, string | null>,
  leadersOf: (unitId: string) => string[],
): string[] {
  const found = new Set<string>();
  for (const a of assignments) {
    const seen = new Set<string>();
    for (
      let at: string | null | undefined = a.role === 'manager' ? parents.get(a.unitId) : a.unitId;
      at && !seen.has(at);
      at = parents.get(at)
    ) {
      seen.add(at);
      const leads = leadersOf(at);
      if (!leads.length) continue;
      for (const id of leads) found.add(id);
      break;
    }
  }
  return [...found].sort();
}
const sv = (a: string, b: string) => a.localeCompare(b, 'sv');
/** The layers that apply to a person, in the order their items are assembled: by condition (`CONDITION_ORDER`), then name. */
export function applyingLayers<L extends Pick<LayerRecord, 'id' | 'condition' | 'value' | 'name'>>(
  layers: readonly L[],
  person: Pick<Report, 'unitIds' | 'positionCodes' | 'employments'>,
  tree: readonly UnitNode[],
): L[] {
  const units = unitsUpward(person.unitIds, tree);
  return layers
    .filter(l => layerApplies(l, person, units))
    .sort(
      (a, b) =>
        CONDITION_ORDER.indexOf(a.condition) - CONDITION_ORDER.indexOf(b.condition) ||
        sv(a.name, b.name) ||
        a.id.localeCompare(b.id),
    );
}
/** Who owns an item of a role (D124): the manager who starts the plan, the person, or the buddy, or with none the manager. */
export function ownerOf(
  role: BoardingOwnerRole,
  owners: { managerId: string; personId: string; buddyId: string | null },
): string {
  return role === 'manager'
    ? owners.managerId
    : role === 'person'
      ? owners.personId
      : (owners.buddyId ?? owners.managerId);
}
/** An item as assembled from a layer, before it has an id and a card. */
export interface AssembledItem {
  title: string;
  kind: LayerItemRecord['kind'];
  ownerRole: BoardingOwnerRole;
  ownerId: string;
  dueOn: string;
  layerId: string;
  tiedTo: string | null;
}
/**
 * A plan's items from the layers that apply (in `applyingLayers` order) and the plan's day (D124): every item of every
 * layer, flat, its due day the day plus its offset and its owner from its role; ordered by due day, then by the layers'
 * order and each item's place in its layer. Nothing is merged: two layers with the same item give two items.
 */
export function assemble(
  layers: ReadonlyArray<Pick<LayerRecord, 'id'>>,
  items: readonly LayerItemRecord[],
  anchorOn: string,
  owners: { managerId: string; personId: string; buddyId: string | null },
): AssembledItem[] {
  const order = new Map(layers.map((l, i) => [l.id, i]));
  return items
    .filter(i => order.has(i.layerId))
    .map(i => ({ item: i, dueOn: shiftDate(anchorOn, i.offsetDays) }))
    .sort(
      (a, b) =>
        a.dueOn.localeCompare(b.dueOn) ||
        order.get(a.item.layerId)! - order.get(b.item.layerId)! ||
        a.item.position - b.item.position,
    )
    .map(({ item, dueOn }) => ({
      title: item.title,
      kind: item.kind,
      ownerRole: item.ownerRole,
      ownerId: ownerOf(item.ownerRole, owners),
      dueOn,
      layerId: item.layerId,
      tiedTo: item.tiedTo,
    }));
}

/** An open item whose due day is before `today` is overdue. */
export const isOverdue = (item: Pick<ItemRecord, 'doneAt' | 'dueOn'>, today: string) =>
  item.doneAt === null && item.dueOn < today;
/** An item's state as a list says it. */
export const itemStatus = (item: Pick<ItemRecord, 'doneAt' | 'dueOn'>, today: string): BoardingItemStatus =>
  item.doneAt !== null ? 'Klar' : isOverdue(item, today) ? 'Försenad' : 'Att göra';
/** How many of the items are done, of all. */
export const progress = (items: ReadonlyArray<Pick<ItemRecord, 'doneAt'>>) => ({
  done: items.filter(i => i.doneAt !== null).length,
  total: items.length,
});
/** A plan's state: closed by its manager; open with an item overdue; open with every item done; else open. */
export function planState(
  plan: Pick<PlanRecord, 'closedAt'>,
  items: ReadonlyArray<Pick<ItemRecord, 'doneAt' | 'dueOn'>>,
  today: string,
): BoardingPlanState {
  if (plan.closedAt !== null) return 'closed';
  if (items.some(i => isOverdue(i, today))) return 'overdue';
  return items.length > 0 && items.every(i => i.doneAt !== null) ? 'complete' : 'open';
}

/** A manager's title for one item: one line, at most `BOARDING_ITEM_TEXT_MAX` characters; undefined when it is not. */
export function normaliseTitle(text: string): string | undefined {
  const line = boardingText(text);
  if (!line || /[\u0000-\u001f\u007f-\u009f]/.test(line)) return undefined;
  return [...line].length <= BOARDING_ITEM_TEXT_MAX ? line : undefined;
}

/**
 * The first start date ahead within the window of a person's employments (D124), or undefined: a start date the
 * directory sent prefills a suggestion and nothing else. A date that is not a calendar day counts as none.
 */
export function upcomingStart(report: Pick<Report, 'employments'>, today: string): string | undefined {
  const last = shiftDate(today, SUGGESTION_WINDOW_DAYS);
  return report.employments
    .map(e => e.startDate)
    .filter((d): d is string => !!d && isCalendarDay(d) && d > today && d <= last)
    .sort()[0];
}
/** An introduction that covers a start: open, or closed and anchored at most `SUGGESTION_COVERED_DAYS` before it, or later. */
export const covers = (plan: Pick<PlanRecord, 'event' | 'closedAt' | 'anchorOn'>, startOn: string) =>
  plan.event === 'introduction' &&
  (plan.closedAt === null || plan.anchorOn >= shiftDate(startOn, -SUGGESTION_COVERED_DAYS));
/**
 * Who of the reports is suggested an introduction (D124): an active report whose employment starts after today and
 * within `SUGGESTION_WINDOW_DAYS`, with no introduction that covers that start. In the order the start dates come.
 */
export function suggestionsOf(
  reports: readonly Report[],
  plans: ReadonlyArray<Pick<PlanRecord, 'personId' | 'event' | 'closedAt' | 'anchorOn'>>,
  today: string,
): Array<{ report: Report; startOn: string }> {
  return reports
    .flatMap(report => {
      if (!report.enabled) return [];
      const startOn = upcomingStart(report, today);
      if (!startOn || plans.some(p => p.personId === report.id && covers(p, startOn))) return [];
      return [{ report, startOn }];
    })
    .sort((a, b) => a.startOn.localeCompare(b.startOn) || sv(a.report.name, b.report.name));
}
/** The suggestion's card identity (D47): one per person and start, so a new start date is a new card. */
export const suggestionCard = (personId: string, startOn: string) => ({
  topic: `boarding:suggestion:${personId}:${startOn}`,
  key: `boarding:suggestion:${personId}`,
  revision: startOn,
  period: startOn,
});

const dayAndMonth = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long', timeZone: 'UTC' });
/** A calendar day as a sentence reads it: `2026-12-04` is "4 december". */
export const swedishDayAndMonth = (day: string) => dayAndMonth.format(new Date(day + 'T12:00:00Z'));
const shortDay = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** A calendar day as a list line reads it: `2026-12-04` is "4 dec", without the abbreviation's full stop. */
export function swedishShortDay(day: string): string {
  const parts = shortDay.formatToParts(new Date(day + 'T12:00:00Z'));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value.replace(/\.$/, '') ?? '';
  return [part('day'), part('month')].filter(Boolean).join(' ');
}
/** The plan's day as a row says it: "Börjar 4 dec", "Slutar 31 jan". */
export const dayWords = (event: BoardingEvent, anchorOn: string) =>
  (event === 'introduction' ? 'Börjar ' : 'Slutar ') + swedishShortDay(anchorOn);
/** Progress as a row says it: "3 av 12". */
export const progressWords = (done: number, total: number) => `${done} av ${total}`;
/** Items that wait for the reader, only when there are any: "1 uppgift", "3 uppgifter". */
export const waitingWords = (n: number) => (n <= 0 ? undefined : n === 1 ? '1 uppgift' : `${n} uppgifter`);
/** Swedish. Where a person stands, as a section on their page and a lens on Personal say it (D124). */
export const PERSON_STATUS = {
  open: 'Pågår',
  overdue: 'Försenad',
  complete: 'Klar',
  missing: 'Plan saknas',
} as const;
/** A plan's heading: "Introduktion" or "Avslut". */
export const eventWords = (event: BoardingEvent) => BOARDING_EVENT_WORDS[event];
/** The line under a plan's heading: "Första dagen 4 december · 3 av 12 klara". */
export const planNote = (plan: Pick<PlanRecord, 'event' | 'anchorOn' | 'closedAt'>, done: number, total: number) =>
  `${plan.event === 'introduction' ? 'Första dagen' : 'Sista dagen'} ${swedishDayAndMonth(plan.anchorOn)} · ${done} av ${total} klara` +
  (plan.closedAt !== null ? ' · avslutad' : '');

/**
 * Whether an item is the reader's to do: they own it, or its owner is gone (erased, or their row deleted) and the reader
 * is the plan's manager, whose role it falls to (D124 item 7). Nothing opens a card for it: the erasure removed the old
 * one, and the manager finds it on the plan.
 */
export const waitsFor = (item: Pick<ItemRecord, 'ownerId'>, readerId: string, managerReads: boolean) =>
  item.ownerId === null ? managerReads : item.ownerId === readerId;
/**
 * Who holds a plan once its person is deactivated (D124 item 7): the managers recorded when the directory deactivated
 * them; when nothing was recorded (the leavers call is best effort, D113), the manager who started it.
 */
export const holdsAfterLeaving = (plan: Pick<PlanRecord, 'heldAt' | 'heldBy' | 'startedBy'>, personId: string) =>
  plan.heldAt !== null ? plan.heldBy.includes(personId) : plan.startedBy === personId;
/**
 * When an item's card comes back (D124 item 5): 06:00 Swedish time the morning after its due day, daylight saving
 * included. Undefined when that morning is not after `at`: a due day already past gets no timer, so starting a plan
 * late or opening an overdue item again fires no burst of reminders; the card is simply open and overdue.
 */
export function dueTimerAt(dueOn: string, at: string): string | undefined {
  const morning = stockholmInstant(shiftDate(dueOn, 1), dayRhythm.review);
  return Date.parse(morning) > Date.parse(at) ? morning : undefined;
}
/** One item as the plan's page and `boarding.plan` list it to the reader. */
export function itemRow(
  item: ItemRecord,
  plan: Pick<PlanRecord, 'event' | 'anchorOn'>,
  context: { readerId: string; today: string; owner: PersonRef | undefined; canTick: boolean; managerReads: boolean },
): BoardingItemRow {
  const phase = itemPhase(plan, item.dueOn);
  // An item whose owner is gone (erased, or their row deleted) is the plan's manager's (D124 item 7).
  const role = item.ownerId === null ? 'manager' : item.ownerRole;
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    kindLabel: BOARDING_KIND_WORDS[item.kind],
    ownerRole: role,
    ownerLabel: BOARDING_OWNER_WORDS[role],
    ...(context.owner ? { owner: context.owner.name, ownerId: context.owner.id } : {}),
    mine: waitsFor(item, context.readerId, context.managerReads),
    dueOn: item.dueOn,
    phase,
    phaseLabel: BOARDING_PHASE_WORDS[phase],
    done: item.doneAt !== null,
    ...(item.doneAt ? { doneAt: item.doneAt } : {}),
    status: itemStatus(item, context.today),
    ...(item.tiedTo ? { tiedTo: item.tiedTo } : {}),
    added: item.added,
    canTick: context.canTick,
  };
}
/** The items in the order a plan lists them: by due day, then their place in the plan. */
export const orderItems = <T extends Pick<ItemRecord, 'dueOn' | 'position'>>(items: readonly T[]) =>
  [...items].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.position - b.position);
/** The rows grouped by phase in the event's order, a phase without items left out. */
export function byPhase(event: BoardingEvent, rows: readonly BoardingItemRow[]) {
  return PHASES_OF[event].flatMap(phase => {
    const items = rows.filter(r => r.phase === phase);
    return items.length ? [{ phase, label: BOARDING_PHASE_WORDS[phase], items }] : [];
  });
}
/** One plan in a list, counted for the reader: done of all, how many wait for the reader, how many are overdue. */
export function planSummary(
  plan: PlanRecord,
  person: Pick<PersonRef, 'name' | 'userName'>,
  items: readonly ItemRecord[],
  readerId: string,
  today: string,
  managerReads: boolean,
): BoardingPlanSummary {
  const { done, total } = progress(items);
  return {
    id: plan.id,
    personId: plan.personId,
    name: person.name,
    userName: person.userName,
    event: plan.event,
    anchorOn: plan.anchorOn,
    startedAt: plan.startedAt,
    closedAt: plan.closedAt,
    done,
    total,
    waiting: items.filter(i => i.doneAt === null && waitsFor(i, readerId, managerReads)).length,
    overdue: items.filter(i => isOverdue(i, today)).length,
    state: planState(plan, items, today),
  };
}
/** Plans as listed: open before closed, then the nearest day first, then newest started. */
export const orderPlans = <T extends Pick<BoardingPlanSummary, 'closedAt' | 'anchorOn' | 'startedAt' | 'id'>>(
  plans: readonly T[],
) =>
  [...plans].sort(
    (a, b) =>
      Number(a.closedAt !== null) - Number(b.closedAt !== null) ||
      (a.closedAt === null ? a.anchorOn.localeCompare(b.anchorOn) : b.startedAt.localeCompare(a.startedAt)) ||
      a.id.localeCompare(b.id),
  );
/** What another system knows a person by: the provisioned user name, compared without regard to case. */
export const sameUserName = (userName: string | null | undefined, key: string) =>
  !!userName && userName.toLowerCase() === key.toLowerCase();
