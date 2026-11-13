import type {
  AskValues,
  BoardingCondition,
  BoardingEvent,
  BoardingItemRow,
  BoardingPhase,
  BoardingPlanOutput,
  BoardingPlanSummary,
  BoardingPreview,
  EntityAction,
  EntityDetail,
  EntitySource,
  ViewEntry,
} from '@clew/contracts';
import { BOARDING_CONDITION_WORDS, BOARDING_EVENT_WORDS, STRICT_RELATIONS, boardingTieOf } from '@clew/contracts';
import { addDays, dayLabel, displayDate, shortDayLabel } from '@clew/calendar/dates';
import { viewPageHref } from './view-address';

/**
 * Introduction and leaving on Clew's own pages (D124): the words the plan's page, the start dialog and the
 * administration's layers say things in. Pure: no React, no request. Rows and counts only; no sentence sums them up.
 */

/** "Introduktion för Sara Holm", "Avslut för Lena Ek": the page's heading. */
export const planTitle = (event: BoardingEvent, name: string) => `${BOARDING_EVENT_WORDS[event]} för ${name}`;
/** The day a plan is anchored on, as a field and a fact name it. */
export const anchorWord: Record<BoardingEvent, string> = { introduction: 'Första dagen', leaving: 'Sista dagen' };
/** What the start dialog's last button and its title say. */
export const startWords: Record<
  BoardingEvent,
  { button: string; open: string; title: string; started: (name: string) => string }
> = {
  introduction: {
    button: 'Starta introduktionen',
    open: 'Starta introduktion',
    title: 'Förbered introduktionen',
    started: name => `Introduktionen för ${name} är startad.`,
  },
  leaving: {
    button: 'Starta avslutet',
    open: 'Starta avslut',
    title: 'Förbered avslutet',
    started: name => `Avslutet för ${name} är startat.`,
  },
};
/** A day as a sentence says it: "måndag 1 december". */
export const longDay = (day: string) => dayLabel(displayDate(day));
/** A day as a row says it: "mån 1 dec.". */
export const shortDay = (day: string) => shortDayLabel(displayDate(day));

/** Whole calendar days from `from` to `to`, both `YYYY-MM-DD`: negative when `to` comes first. */
export function daysBetween(from: string, to: string): number {
  const utc = (day: string) => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}
/**
 * How far the plan's day is from today, as its header says it: "Börjar om 18 dagar", "Började i går", "Slutar i dag".
 * A closed plan says nothing of it.
 */
export function distanceWords(event: BoardingEvent, anchorOn: string, today: string): string {
  const days = daysBetween(today, anchorOn);
  const [ahead, behind] = event === 'introduction' ? ['Börjar', 'Började'] : ['Slutar', 'Slutade'];
  if (days === 0) return `${ahead} i dag`;
  if (days === 1) return `${ahead} i morgon`;
  if (days === -1) return `${behind} i går`;
  return days > 0 ? `${ahead} om ${days} dagar` : `${behind} för ${-days} dagar sedan`;
}
/**
 * When a phase is, from the plan's day, as the heading of its section says it: the days the server counts into it
 * (`phaseOf`: an introduction's first week is days 1 to 6, its first 90 days 7 to 89; a leaving's last week the six days
 * before the last day).
 */
export function phaseWhen(phase: BoardingPhase, anchorOn: string): string {
  const day = (offset: number) => longDay(addDays(anchorOn, offset));
  const span = (from: number, to: number) => `${day(from)} till ${day(to)}`;
  switch (phase) {
    case 'beforeStart':
      return `senast ${day(-1)}`;
    case 'firstDay':
    case 'lastDay':
      return day(0);
    case 'firstWeek':
      return span(1, 6);
    case 'first90Days':
      return span(7, 89);
    case 'later':
      return `från ${day(90)}`;
    case 'earlier':
      return `senast ${day(-90)}`;
    case 'last90Days':
      return span(-89, -7);
    case 'lastWeek':
      return span(-6, -1);
    case 'afterLeaving':
      return `från ${day(1)}`;
  }
}
/** "1 punkt", "7 punkter". */
export const itemsWords = (n: number) => (n === 1 ? '1 punkt' : `${n} punkter`);
/** "1 plan", "30 planer": how many a card of the list holds. */
export const plansWords = (n: number) => (n === 1 ? '1 plan' : `${n} planer`);
/** "1 försenad", "3 försenade": a plan's items past their day, as its badge says it. */
export const overdueWords = (n: number) => (n === 1 ? '1 försenad' : `${n} försenade`);
/** A plan's day in a row: "Första dagen mån 16 nov.", "Sista dagen tors 31 dec.". */
export const anchorDay = (event: BoardingEvent, anchorOn: string) => `${anchorWord[event]} ${shortDay(anchorOn)}`;
/** A plan's progress in a row: "1 av 6", under the heading "Klara" as the lens on Personal says it. */
export const progressWords = (done: number, total: number) => `${done} av ${total}`;
/**
 * One plan as the list's row says it where there are no columns (a phone, a narrow window, the reader's own plan): the
 * event, its day and its progress, "Introduktion · Första dagen mån 16 nov. · 1 av 6 klara". Facts only.
 */
export const planLine = (plan: Pick<BoardingPlanSummary, 'event' | 'anchorOn' | 'done' | 'total'>) =>
  `${BOARDING_EVENT_WORDS[plan.event]} · ${anchorDay(plan.event, plan.anchorOn)} · ${progressWords(plan.done, plan.total)} klara`;
/** Who does an item, as its row says it: "Du", or the role with the owner's name ("Fadder, Erik Nyström"). */
export const ownerWords = (row: Pick<BoardingItemRow, 'mine' | 'owner' | 'ownerLabel'>) =>
  row.mine ? 'Du' : row.owner ? `${row.ownerLabel}, ${row.owner}` : row.ownerLabel;
/** The line under an item's title: its kind, who does it and the day it is due. */
export const itemLine = (row: Pick<BoardingItemRow, 'kindLabel' | 'mine' | 'owner' | 'ownerLabel' | 'dueOn'>) =>
  `${row.kindLabel} · ${ownerWords(row)} · senast ${shortDay(row.dueOn)}`;
/**
 * Whom a layer applies to, in words: "Alla anställda", "Enhet: Sköndals skola och enheterna under den". A unit is named
 * by the name the server gives (`unitLabel`, present while the unit exists), else by its id as the file wrote it (the
 * import page, which has no unit tree, or a unit since removed).
 */
export function conditionWords(condition: BoardingCondition, value: string | null, unitLabel?: string): string {
  if (condition === 'all' || !value) return 'Alla anställda';
  if (condition === 'unit') return `${BOARDING_CONDITION_WORDS.unit}: ${unitLabel || value} och enheterna under den`;
  return `${BOARDING_CONDITION_WORDS[condition]}: ${value}`;
}
/**
 * A layer's unit name as the server sends it (`unitLabel` on a layer of `BoardingPreview` and `BoardingLayersOutput`, for
 * a unit condition whose unit exists); undefined without one. Read from any layer, so it holds before and after the
 * field is in the contract.
 */
export function unitLabelOf(layer: object): string | undefined {
  const label = (layer as { unitLabel?: unknown }).unitLabel;
  return typeof label === 'string' && label ? label : undefined;
}

/** Counts over rows: done of all, what waits for the reader, what is past its day. */
export function counts(rows: readonly Pick<BoardingItemRow, 'done' | 'mine' | 'status'>[]) {
  return {
    done: rows.filter(r => r.done).length,
    total: rows.length,
    waiting: rows.filter(r => r.mine && !r.done).length,
    overdue: rows.filter(r => r.status === 'Försenad').length,
  };
}
/**
 * The counts the plan's header says: done of all as the server counts them, over the items the reader is shown (an
 * item's owner counts their own, D124), one source for the header, the progress and what is said after a tick; what
 * waits for the reader and what is past its day from the rows, which the server does not count.
 */
export function planCounts(plan: {
  plan: Pick<BoardingPlanOutput['plan'], 'done' | 'total'>;
  rows: BoardingPlanOutput['rows'];
}) {
  return { ...counts(plan.rows), done: plan.plan.done, total: plan.plan.total };
}
/** An item ticked off or opened again, as the page draws it until the server's answer is read: its state from `today`. */
export function ticked<R extends Pick<BoardingItemRow, 'done' | 'dueOn' | 'status' | 'doneAt'>>(
  row: R,
  done: boolean,
  today: string,
): R {
  const { doneAt: _doneAt, ...rest } = row;
  return {
    ...rest,
    done,
    status: done ? 'Klar' : row.dueOn < today ? 'Försenad' : 'Att göra',
  } as R;
}
/** The plan with one item ticked off or opened again, in its rows and its phases, and the counts with it. */
export function withTicked(plan: BoardingPlanOutput, itemId: string, done: boolean, today: string): BoardingPlanOutput {
  const change = (r: BoardingItemRow) => (r.id === itemId ? ticked(r, done, today) : r);
  const was = plan.rows.find(r => r.id === itemId);
  const delta = !was || was.done === done ? 0 : done ? 1 : -1;
  return {
    ...plan,
    plan: { ...plan.plan, done: plan.plan.done + delta },
    rows: plan.rows.map(change),
    phases: plan.phases.map(p => ({ ...p, items: p.items.map(change) })),
  };
}
/**
 * The plan the page shows when the address chooses none (D124): an open one, the one started last (the server lists
 * open plans first, newest first), else the latest closed one.
 */
export const defaultPlan = (plans: readonly BoardingPlanSummary[]): BoardingPlanSummary | undefined => plans[0];
/** Whether the person has an open plan of this event, which a second start would be refused for. */
export const hasOpen = (plans: readonly BoardingPlanSummary[], event: BoardingEvent) =>
  plans.some(p => p.event === event && p.closedAt === null);

/** What starting would make, per owner (the start dialog's last step): in the order their first item is due. */
export function previewOwners(preview: BoardingPreview, readerId: string) {
  const owners = new Map<string, { id: string; name: string; you: boolean; count: number; first: string }>();
  for (const item of preview.items) {
    const at = owners.get(item.owner.id);
    if (at) {
      at.count++;
      if (item.dueOn < at.first) at.first = item.dueOn;
    } else
      owners.set(item.owner.id, {
        id: item.owner.id,
        name: item.owner.name,
        you: item.owner.id === readerId,
        count: 1,
        first: item.dueOn,
      });
  }
  return [...owners.values()].sort((a, b) => a.first.localeCompare(b.first) || a.name.localeCompare(b.name, 'sv'));
}
/** How many items each layer gives, by the layer's id. */
export function layerCounts(preview: BoardingPreview): Map<string, number> {
  const counted = new Map<string, number>();
  for (const item of preview.items) counted.set(item.layerId, (counted.get(item.layerId) ?? 0) + 1);
  return counted;
}

/**
 * What an item's row opens (D124), from what the item is tied to (`tiedTo`, read by `boardingTieOf`, the rule the server
 * imports layers with): an action about the plan's person the reader may start for them (the actions the person's page
 * offers the reader, from `GET /api/entities/person/:key`), with the answers its dialog starts from; a read the reader
 * may open (`views`), its page with the person as its input where it takes one; or an https address, opened in a new tab.
 * Anything else, and an item the reader may not act on, opens nothing: the item is still a to-do. A done item starts no
 * action but keeps a read's or an address's link. The plan holds the item, never what it is done with: nothing here
 * ticks an item, and a placed order does not either.
 *
 * A read that takes the person is opened for them only where it admits how the reader stands to them (D117: the view
 * entry's `admits` against the person's page's `relation`, and a relation the reader holds by grant to a colleague,
 * D121), so the page never offers a read the server refuses; until that is known it offers none. About someone else it
 * is named as the person's page names it in a section's way in (`view.open.title`, "Kompetenser"), since the read's own
 * title is the reader's ("Mina kompetenser"); about the reader themself, by its own title.
 */
export type RowControl =
  | { kind: 'action'; action: EntityAction; values: AskValues }
  | { kind: 'read'; title: string; href: string }
  | { kind: 'link'; href: string; host: string };
/** How the reader stands to the plan's person (D117): what their page answers, and the relations held by grant (D121). */
export interface PersonStanding {
  relation: EntityDetail['relation'];
  grants: readonly string[];
}
export function rowControl(
  row: Pick<BoardingItemRow, 'canTick' | 'done' | 'tiedTo'>,
  context: {
    /** The actions about the plan's person the reader may start, as the person's page offers them. */
    actions: readonly EntityAction[];
    /** The reads the reader may open. */
    views: readonly ViewEntry[];
    /** The plan's person's user name: the key an action and a read take them by. */
    person: string | null;
    /** How the reader stands to the plan's person; null until the person's page has answered. */
    standing: PersonStanding | null;
    /** The sections of the person's page, whose ways in name a read about someone else. */
    sections: readonly EntitySource[];
    /** The page the row is on, the way back from a read's page. */
    from: string;
  },
): RowControl | null {
  if (!row.canTick) return null;
  const tie = boardingTieOf(row.tiedTo);
  if (!tie) return null;
  if (tie.kind === 'link') return { kind: 'link', href: tie.href, host: new URL(tie.href).hostname };
  const action = context.person ? context.actions.find(a => a.capability === tie.capability) : undefined;
  if (action) return row.done ? null : { kind: 'action', action, values: tie.values };
  const view = context.views.find(v => v.capability === tie.capability);
  if (!view) return null;
  // A read that takes one person is opened with the plan's, and only where it admits the reader for them.
  const about = view.person ? context.person : null;
  if (view.person && !(about && admitted(view.admits ?? STRICT_RELATIONS, context.standing))) return null;
  const title =
    about && context.standing?.relation !== 'self'
      ? (openTitle(context.sections, view.capability) ?? view.title)
      : view.title;
  return {
    kind: 'read',
    title,
    href: viewPageHref(
      { capability: view.capability, title, ...(view.person && about ? { input: { [view.person]: about } } : {}) },
      context.from,
    ),
  };
}
/** Whether a read that admits `admits` answers the reader about the plan's person (D117, D121). */
const admitted = (admits: readonly string[], standing: PersonStanding | null) =>
  !!standing &&
  (admits.includes(standing.relation) ||
    (standing.relation === 'colleague' && standing.grants.some(g => admits.includes(g))));
/** The title a section of the person's page gives its way into `capability`, the read about them in full. */
const openTitle = (sections: readonly EntitySource[], capability: string) =>
  sections
    .map(s => (s.view.kind === 'table' || s.view.kind === 'list' ? s.view.open : undefined))
    .find(open => open?.capability === capability)?.title;
/**
 * Whether the person's page is read for the rows (`GET /api/entities/person/:key`): a row the reader may act on is tied
 * to a capability that is no read the reader may open (an action, which the page offers), or to a read that takes the
 * person (how the reader stands to them, and what the page calls the read).
 */
export const needsPersonPage = (
  rows: readonly Pick<BoardingItemRow, 'canTick' | 'done' | 'tiedTo'>[],
  views: readonly ViewEntry[],
) =>
  rows.some(r => {
    if (!r.canTick) return false;
    const tie = boardingTieOf(r.tiedTo);
    if (tie?.kind !== 'capability') return false;
    const view = views.find(v => v.capability === tie.capability);
    return view ? !!view.person : !r.done;
  });
