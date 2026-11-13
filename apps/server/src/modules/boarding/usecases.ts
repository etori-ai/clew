import type {
  AuthenticatedContext,
  BoardingAccess,
  BoardingCondition,
  BoardingImportBody,
  BoardingImportOutcome,
  BoardingImportRow,
  BoardingItemAddBody,
  BoardingLayersOutput,
  BoardingPersonOutput,
  BoardingPlanOutput,
  BoardingPlansOutput,
  BoardingPlanState,
  BoardingPreview,
  BoardingStartBody,
  BoardingSuggestion,
  Capability,
} from '@clew/contracts';
import { ENTITY_KEY_MAX, boardingImportRowProblem, boardingLayersOf, layerKey } from '@clew/contracts';
import { ForbiddenError, InputError } from '../../context';
import {
  PLAN_ITEMS_MAX,
  anchorInRange,
  applyingLayers,
  assemble,
  byPhase,
  covers,
  daysBetween,
  eventWords,
  holdsAfterLeaving,
  isCalendarDay,
  itemRow,
  normaliseTitle,
  orderItems,
  orderPlans,
  ownerOf,
  phaseOf,
  planNote,
  planState,
  planSummary,
  progress,
  sameUserName,
  suggestionsOf,
  swedishDay,
  upcomingStart,
  waitsFor,
  ANCHOR_RANGE_DAYS,
} from './domain';
import {
  PlanTaken,
  type BoardingDeps,
  type BoardingDirectory,
  type BoardingExport,
  type BoardingTx,
  type ItemRecord,
  type LeaverChange,
  type PersonRef,
  type PlanRecord,
  type Report,
} from './model';

/** A request the boarding module turns down for what it asks, not who asks (D124); a 400 with this message. */
export class BoardingError extends InputError {
  constructor(message: string) {
    super(message);
    this.name = 'BoardingError';
  }
}
/** The grant capability that administers the layers (D124). */
export const BOARDING_ADMIN: Capability = 'admin.boarding';
const NOT_A_MANAGER = 'Introduktion och avslut startas av den som är chef för personen.';
const NOT_YOURS = 'Personen finns inte bland dem du är chef för.';
const NO_PLAN = 'Planen finns inte, eller så kan du inte se den.';
const NOT_THE_MANAGER = 'Det är bara chefen för personen som kan ändra planen.';
const NOT_ALLOWED = 'Du kan inte ändra den här uppgiften.';
const PLAN_CLOSED = 'Planen är avslutad och kan inte ändras.';
const ALREADY_OPEN: Record<PlanRecord['event'], string> = {
  introduction: 'Personen har redan en pågående introduktion.',
  leaving: 'Personen har redan ett pågående avslut.',
};
const BAD_DAY = 'Ange ett giltigt datum.';
const DAY_OUT_OF_RANGE = 'Dagen ska ligga högst ett år före eller efter i dag.';
const DUE_OUT_OF_RANGE = 'Uppgiften ska vara klar högst ett år före eller efter planens dag.';
const BAD_TITLE = 'Skriv uppgiften på en rad, högst 200 tecken.';
const BAD_BUDDY = 'Faddern ska vara någon annan som du är chef för.';
const TOO_MANY_ITEMS = `En plan kan ha högst ${PLAN_ITEMS_MAX} uppgifter.`;
/** The longest key a card may name a person by (D97, `SubjectSchema`): a longer user name names nobody. */
const SUBJECT_KEY_MAX = ENTITY_KEY_MAX;
/** The actor of a row written because a timer fired; the convention of the other timer-driven rows. */
const TIMER_ACTOR = 'system:scheduler';
/** The version of the export document; a breaking change is a new version. */
export const BOARDING_EXPORT_FORMAT = 'clew.boarding/1';

/** Where one person asked about stands (`boarding.person`), keyed as asked: their open plan, or a plan that is missing. */
export interface PersonStanding {
  key: string;
  personId: string;
  /** The open plan; when the person has two (an introduction and a leaving), the one started last. */
  plan?: {
    id: string;
    event: PlanRecord['event'];
    anchorOn: string;
    done: number;
    total: number;
    /** Open items the reader owns. */
    waiting: number;
    state: BoardingPlanState;
  };
  /** No introduction covers an employment that starts within the suggestion window: the start date. */
  missingFrom?: string;
}

/**
 * What a change of a person's `active` means to boarding (D124 item 7), told by the people module's leavers port in the
 * transaction that changes it (bound in `composition/people.ts`, in a savepoint of its own beside the competence
 * module's, D113). Deactivated: every plan about the person is held from then on by the managers they report to at
 * that moment, read from the directory in the same transaction; activated again: nobody holds them, and the line
 * decides as before. Each plan changed gets an audit row of ids. The call is best effort: when it fails, nothing is
 * recorded, and the manager who started a plan holds it (`holdsAfterLeaving`).
 */
export function boardingLeavers(
  tx: Pick<BoardingTx, 'plansAbout' | 'holdPlan' | 'releasePlan' | 'audit'>,
  directory: Pick<BoardingDirectory, 'lineManagers'>,
) {
  return {
    async deactivated({ actor, personId, organisationId, at }: LeaverChange): Promise<void> {
      // Every plan, open or closed: a closed plan is read-only, but its typed titles are still read by whoever holds it.
      const plans = (await tx.plansAbout([personId])).filter(p => p.organisationId === organisationId);
      if (!plans.length) return;
      const holders = [...new Set(await directory.lineManagers(organisationId, personId))].sort();
      for (const plan of [...plans].sort((a, b) => a.id.localeCompare(b.id))) {
        await tx.holdPlan(plan.id, holders, at);
        await tx.audit({
          actor,
          action: 'boarding.plan_held',
          subject: 'plan:' + plan.id,
          at,
          details: { personId, holders },
        });
      }
    },
    async reactivated({ actor, personId, organisationId, at }: LeaverChange): Promise<void> {
      const plans = (await tx.plansAbout([personId])).filter(
        p => p.organisationId === organisationId && p.heldAt !== null,
      );
      for (const plan of [...plans].sort((a, b) => a.id.localeCompare(b.id))) {
        await tx.releasePlan(plan.id);
        await tx.audit({
          actor,
          action: 'boarding.plan_released',
          subject: 'plan:' + plan.id,
          at,
          details: { personId },
        });
      }
    },
  };
}
export type BoardingLeavers = ReturnType<typeof boardingLeavers>;

/**
 * The boarding module's use cases (D124): introduction and leaving plans. A manager's reach is computed from the
 * directory when asked (`deps.staff`: their reports, D99 and D117's `managed`), never stored, so a former manager
 * reaches nothing the day the line changes; once a person is deactivated their plans are held by the managers they had
 * then (`boardingLeavers`). Every change is one `deps.store` transaction with its audit row and, for an item, its
 * owner's card. Audit rows carry ids, dates, counts and roles: never a title a manager typed, never a name.
 */
export function boardingUsecases(deps: BoardingDeps) {
  const now = () => deps.clock();
  /** Today in Swedish time, from `clock`. */
  const currentDay = () => swedishDay(now());
  /** The persona's reports now, by id: active only, never the persona; and the tree the unit layers walk. */
  async function staffing(persona: AuthenticatedContext) {
    const s = await deps.staff(persona);
    const reports = new Map<string, Report>();
    for (const r of s.reports) if (r.id !== persona.id && r.enabled && !reports.has(r.id)) reports.set(r.id, r);
    return { manages: s.manages, reports, tree: s.tree };
  }
  /** A report of the persona's, or the refusal: a non-manager, someone else's report, the persona's own manager. */
  async function reportOf(persona: AuthenticatedContext, personId: string) {
    const s = await staffing(persona);
    if (!s.manages) throw new ForbiddenError(NOT_A_MANAGER);
    const report = s.reports.get(personId);
    if (!report) throw new ForbiddenError(NOT_YOURS);
    return { report, ...s };
  }
  const admin = async (persona: AuthenticatedContext) => {
    if (!persona.capabilities.includes(BOARDING_ADMIN)) throw new ForbiddenError();
    await persona.authorize();
  };
  /**
   * How the persona stands to a plan (D124 item 7): the person it is about; its manager, who is whoever the person
   * reports to now, or, once the person is deactivated and so reports to nobody, whoever holds the plan
   * (`holdsAfterLeaving`: the managers they had when they were deactivated, or, with nothing recorded, the manager who
   * started it); or the owner of some of its items (a buddy, a former manager), who reads those items only. Anyone else
   * is no one, and is told the plan does not exist.
   */
  function accessOf(
    persona: AuthenticatedContext,
    plan: PlanRecord,
    person: PersonRef | undefined,
    items: readonly ItemRecord[],
    reports: ReadonlyMap<string, Report>,
  ): BoardingAccess | undefined {
    if (plan.organisationId !== persona.organisationId) return undefined;
    if (plan.personId === persona.id) return 'person';
    if (reports.has(plan.personId)) return 'manager';
    if (person && !person.enabled && holdsAfterLeaving(plan, persona.id)) return 'manager';
    if (items.some(i => i.ownerId === persona.id)) return 'owner';
    return undefined;
  }
  /** The plan and what the persona may do with it, read in `tx`; a plan the persona may not see is no plan. */
  async function planFor(
    tx: BoardingTx,
    persona: AuthenticatedContext,
    planId: string,
    reports: ReadonlyMap<string, Report>,
    lock = false,
  ) {
    const plan = await tx.plan(planId, lock);
    if (!plan) throw new ForbiddenError(NO_PLAN);
    const items = await tx.items([plan.id]);
    const [person] = await tx.persons([plan.personId]);
    const access = accessOf(persona, plan, person, items, reports);
    if (!access) throw new ForbiddenError(NO_PLAN);
    return { plan, items, person, access };
  }
  /** A plan's day: a calendar day within a year of today. */
  function checkAnchor(anchorOn: string) {
    if (!isCalendarDay(anchorOn)) throw new BoardingError(BAD_DAY);
    if (!anchorInRange(anchorOn, currentDay())) throw new BoardingError(DAY_OUT_OF_RANGE);
  }
  /** The buddy named in a start: another of the persona's reports, never the person; none when none is named. */
  function buddyOf(buddyId: string | undefined, reports: ReadonlyMap<string, Report>, personId: string) {
    if (buddyId === undefined) return null;
    const buddy = reports.get(buddyId);
    if (!buddy || buddy.id === personId) throw new BoardingError(BAD_BUDDY);
    return buddy;
  }
  /** What starting a plan would make: the layers that apply to the report and the items assembled from them. */
  async function assembled(
    tx: BoardingTx,
    persona: AuthenticatedContext,
    report: Report,
    tree: Parameters<typeof applyingLayers>[2],
    body: BoardingStartBody,
    buddyId: string | null,
  ) {
    const layers = applyingLayers(await tx.layers(persona.organisationId, body.event), report, tree);
    const items = assemble(layers, await tx.layerItems(layers.map(l => l.id)), body.anchorOn, {
      managerId: persona.id,
      personId: report.id,
      buddyId,
    });
    if (items.length > PLAN_ITEMS_MAX) throw new BoardingError(TOO_MANY_ITEMS);
    return { layers, items };
  }
  /** The card's subject: the person the plan is about, by the key another system knows them by; nobody without one. */
  const subjectOf = (userName: string | null) =>
    userName && [...userName].length <= SUBJECT_KEY_MAX
      ? { subject: { entity: 'person' as const, key: userName } }
      : {};
  /** Mark an item done or open again: for its owner, or the plan's manager, while the plan is open. */
  async function setDone(persona: AuthenticatedContext, id: string, done: boolean) {
    const { reports } = await staffing(persona);
    const at = now().toISOString();
    await deps.store.transaction(async tx => {
      // The plan first, then the item (the module's lock order, `BoardingTx`): the item is read once to find its plan.
      const found = await tx.item(id);
      const plan = found && (await tx.plan(found.planId, true));
      const item = plan && (await tx.item(id, true));
      if (!plan || !item) throw new ForbiddenError(NOT_ALLOWED);
      const [person] = await tx.persons([plan.personId]);
      const asOwner = item.ownerId !== null && item.ownerId === persona.id;
      const asManager = accessOf(persona, plan, person, [], reports) === 'manager';
      if (!asOwner && !asManager) throw new ForbiddenError(NOT_ALLOWED);
      if (plan.closedAt !== null) throw new BoardingError(PLAN_CLOSED);
      if ((item.doneAt !== null) === done) return;
      if (done) {
        await tx.updateItem(id, { doneAt: at, doneBy: persona.id });
        if (item.threadId) await tx.workItems.close(item.threadId, at, 'done');
      } else {
        await tx.updateItem(id, { doneAt: null, doneBy: null });
        if (item.threadId) await tx.workItems.reopen(item.threadId, item.dueOn, at);
      }
      await tx.audit({
        actor: persona.principal.id,
        action: done ? 'boarding.item_done' : 'boarding.item_reopened',
        subject: 'item:' + id,
        at,
        details: { planId: plan.id, ownerRole: item.ownerRole, by: asOwner ? 'owner' : 'manager' },
      });
    });
  }
  /**
   * Import layers for an organisation (D124): every row checked again with the page's rule, grouped into layers by
   * event and name. A layer the organisation lacks is added; one it has, by event and name without regard to case, is
   * replaced when its name as written, condition, value or items differ, and left alone when they do not, so the same
   * file imported twice changes nothing. Layers the file does not name are left alone. Plans already started keep the
   * items they were given. One transaction, one audit row of counts, never a title.
   */
  async function importInto(
    actor: string,
    organisationId: string,
    rows: readonly BoardingImportRow[],
  ): Promise<BoardingImportOutcome> {
    for (const r of rows) {
      const problem = boardingImportRowProblem(r);
      if (problem) throw new BoardingError(`Rad ${r.row}: ${problem}`);
    }
    const { layers, problems } = boardingLayersOf(rows);
    const first = problems[0];
    if (first) throw new BoardingError(`Rad ${first.row}: ${first.message}`);
    const at = now().toISOString();
    return deps.store.transaction(async tx => {
      await tx.lockLayers(organisationId);
      const existing = await tx.layers(organisationId);
      const held = await tx.layerItems(existing.map(l => l.id));
      const byKey = new Map(existing.map(l => [layerKey(l.event, l.name), l]));
      let added = 0,
        replaced = 0,
        unchanged = 0;
      for (const layer of layers) {
        const items = (layerId: string) =>
          layer.items.map((item, position) => ({
            id: deps.ids(),
            layerId,
            position,
            title: item.title,
            kind: item.kind,
            ownerRole: item.owner,
            offsetDays: item.offsetDays,
            tiedTo: item.tiedTo,
          }));
        const found = byKey.get(layerKey(layer.event, layer.name));
        if (!found) {
          const id = deps.ids();
          await tx.insertLayer({
            id,
            organisationId,
            event: layer.event,
            name: layer.name,
            condition: layer.condition,
            value: layer.value,
            createdBy: actor,
            createdAt: at,
            updatedAt: at,
          });
          await tx.replaceLayerItems(id, items(id));
          added++;
          continue;
        }
        const before = held.filter(i => i.layerId === found.id);
        const same =
          found.name === layer.name &&
          found.condition === layer.condition &&
          found.value === layer.value &&
          before.length === layer.items.length &&
          layer.items.every((item, i) => {
            const b = before[i]!;
            return (
              b.title === item.title &&
              b.kind === item.kind &&
              b.ownerRole === item.owner &&
              b.offsetDays === item.offsetDays &&
              b.tiedTo === item.tiedTo
            );
          });
        if (same) {
          unchanged++;
          continue;
        }
        await tx.updateLayer(found.id, {
          name: layer.name,
          condition: layer.condition,
          value: layer.value,
          updatedAt: at,
        });
        await tx.replaceLayerItems(found.id, items(found.id));
        replaced++;
      }
      const outcome = { layers: layers.length, added, replaced, unchanged };
      await tx.audit({
        actor,
        action: 'boarding.layers_imported',
        subject: 'organisation:' + organisationId,
        at,
        details: { organisationId, rows: rows.length, ...outcome },
      });
      return outcome;
    });
  }
  /** The persona's open plans to list: of their reports, and the ones they hold for someone since deactivated. */
  async function listedPlans(tx: BoardingTx, persona: AuthenticatedContext, reports: ReadonlyMap<string, Report>) {
    const ofReports = (await tx.plansAbout([...reports.keys()])).filter(p => p.closedAt === null);
    const theirs = (await tx.openPlansOf(persona.id)).filter(p => !reports.has(p.personId));
    const persons = new Map((await tx.persons(theirs.map(p => p.personId))).map(p => [p.id, p]));
    return [
      ...ofReports,
      ...theirs.filter(p => {
        const person = persons.get(p.personId);
        return (
          p.organisationId === persona.organisationId &&
          p.personId !== persona.id &&
          !!person &&
          !person.enabled &&
          holdsAfterLeaving(p, persona.id)
        );
      }),
    ];
  }
  /** The name of the unit each layer on a unit applies to, where the directory has the unit. */
  async function unitLabelsOf(
    organisationId: string,
    layers: ReadonlyArray<{ condition: BoardingCondition; value: string | null }>,
  ) {
    const ids = [...new Set(layers.flatMap(l => (l.condition === 'unit' && l.value !== null ? [l.value] : [])))];
    return ids.length && deps.directory ? deps.directory.unitLabels(organisationId, ids) : new Map<string, string>();
  }
  /** `unitLabel` for a layer on a unit the directory names; nothing for any other layer. */
  const labelled = (labels: ReadonlyMap<string, string>, l: { condition: BoardingCondition; value: string | null }) => {
    const label = l.condition === 'unit' && l.value !== null ? labels.get(l.value) : undefined;
    return label ? { unitLabel: label } : {};
  };

  /** The suggestions of `suggestions`, on `day`. */
  async function suggestionsFor(persona: AuthenticatedContext, day: string): Promise<BoardingSuggestion[]> {
    const { reports } = await staffing(persona);
    if (!reports.size) return [];
    // A start date the directory sent that is no calendar day counts as none; the count says a mapping is wrong.
    const unreadable = [...reports.values()].filter(r =>
      r.employments.some(e => e.startDate !== undefined && !isCalendarDay(e.startDate)),
    ).length;
    if (unreadable) deps.log?.('boarding: start dates that are no calendar day were left out', { reports: unreadable });
    const plans = await deps.store.transaction(tx => tx.plansAbout([...reports.keys()]));
    return suggestionsOf([...reports.values()], plans, day).map(({ report, startOn }) => ({
      personId: report.id,
      name: report.name,
      userName: report.userName,
      startOn,
    }));
  }

  return {
    /** An administrator reads the organisation's layers (D124), by event and name, each with its items in order. */
    async layers(persona: AuthenticatedContext): Promise<BoardingLayersOutput> {
      await admin(persona);
      const { layers, items } = await deps.store.transaction(async tx => {
        const layers = await tx.layers(persona.organisationId);
        return { layers, items: await tx.layerItems(layers.map(l => l.id)) };
      });
      const labels = await unitLabelsOf(persona.organisationId, layers);
      return {
        layers: layers.map(l => ({
          id: l.id,
          event: l.event,
          name: l.name,
          condition: l.condition,
          value: l.value,
          ...labelled(labels, l),
          updatedAt: l.updatedAt,
          items: items
            .filter(i => i.layerId === l.id)
            .map(i => ({
              id: i.id,
              title: i.title,
              kind: i.kind,
              ownerRole: i.ownerRole,
              offsetDays: i.offsetDays,
              tiedTo: i.tiedTo,
              phase: phaseOf(l.event, i.offsetDays),
            })),
        })),
      };
    },
    /** An administrator with `admin.boarding` imports a file of layers (D124); see `importInto`. */
    async importLayers(persona: AuthenticatedContext, body: BoardingImportBody): Promise<BoardingImportOutcome> {
      await admin(persona);
      return importInto(persona.principal.id, persona.organisationId, body.rows);
    },
    /** An operator imports layers for an organisation, as the development seed does. */
    seedLayers: (actor: string, organisationId: string, rows: readonly BoardingImportRow[]) =>
      importInto(actor, organisationId, rows),

    /**
     * What starting a plan for a report would make (D124), the start dialog's last step: the layers that apply on the
     * given day, in the order they are assembled, and every item with its due day, owner and phase. Writes nothing.
     */
    async preview(persona: AuthenticatedContext, body: BoardingStartBody): Promise<BoardingPreview> {
      const { report, reports, tree } = await reportOf(persona, body.personId);
      checkAnchor(body.anchorOn);
      const buddy = buddyOf(body.buddyId, reports, report.id);
      const names = new Map<string, string>([
        [persona.id, persona.name],
        [report.id, report.name],
        ...(buddy ? [[buddy.id, buddy.name] as [string, string]] : []),
      ]);
      const { layers, items } = await deps.store.transaction(tx =>
        assembled(tx, persona, report, tree, body, buddy?.id ?? null),
      );
      const labels = await unitLabelsOf(persona.organisationId, layers);
      return {
        person: { id: report.id, name: report.name },
        event: body.event,
        anchorOn: body.anchorOn,
        buddy: buddy ? { id: buddy.id, name: buddy.name } : null,
        layers: layers.map(l => ({
          id: l.id,
          name: l.name,
          condition: l.condition,
          value: l.value,
          ...labelled(labels, l),
        })),
        items: items.map(i => ({
          title: i.title,
          kind: i.kind,
          ownerRole: i.ownerRole,
          owner: { id: i.ownerId, name: names.get(i.ownerId) ?? '' },
          dueOn: i.dueOn,
          phase: phaseOf(body.event, daysBetween(body.anchorOn, i.dueOn)),
          layerId: i.layerId,
        })),
      };
    },

    /**
     * The manager starts a plan for one of their reports (D124): Clew suggests, the manager starts, on a day they enter.
     * The layers that apply are assembled into items, each owned by the manager, the person or the buddy (the manager
     * when there is none), and every item's card is opened in its owner's stream in the same transaction, before the
     * item that refers to it. A second open plan of the same event is refused. Returns the plan's id.
     */
    async startPlan(persona: AuthenticatedContext, body: BoardingStartBody): Promise<{ id: string }> {
      const { report, reports, tree } = await reportOf(persona, body.personId);
      checkAnchor(body.anchorOn);
      const buddy = buddyOf(body.buddyId, reports, report.id);
      const at = now().toISOString(),
        id = deps.ids();
      return deps.store.transaction(async tx => {
        if ((await tx.plansAbout([report.id])).some(p => p.event === body.event && p.closedAt === null))
          throw new BoardingError(ALREADY_OPEN[body.event]);
        const { layers, items } = await assembled(tx, persona, report, tree, body, buddy?.id ?? null);
        try {
          await tx.insertPlan({
            id,
            organisationId: persona.organisationId,
            personId: report.id,
            event: body.event,
            anchorOn: body.anchorOn,
            buddyId: buddy?.id ?? null,
            startedBy: persona.id,
            startedAt: at,
            closedAt: null,
            heldAt: null,
            heldBy: [],
          });
        } catch (error) {
          if (error instanceof PlanTaken) throw new BoardingError(ALREADY_OPEN[body.event]);
          throw error;
        }
        for (const [position, item] of items.entries()) {
          const itemId = deps.ids(),
            threadId = deps.ids();
          await tx.workItems.open({
            threadId,
            personId: item.ownerId,
            itemId,
            planId: id,
            event: body.event,
            title: item.title,
            dueOn: item.dueOn,
            at,
            ...subjectOf(report.userName),
          });
          await tx.insertItem({
            id: itemId,
            planId: id,
            position,
            title: item.title,
            added: false,
            kind: item.kind,
            ownerRole: item.ownerRole,
            ownerId: item.ownerId,
            dueOn: item.dueOn,
            doneAt: null,
            doneBy: null,
            threadId,
            sourceLayerId: item.layerId,
            tiedTo: item.tiedTo,
            createdAt: at,
          });
        }
        await tx.audit({
          actor: persona.principal.id,
          action: 'boarding.plan_started',
          subject: 'plan:' + id,
          at,
          details: {
            personId: report.id,
            event: body.event,
            anchorOn: body.anchorOn,
            layers: layers.length,
            items: items.length,
            buddy: buddy !== null,
          },
        });
        return { id };
      });
    },

    /**
     * One plan (`boarding.plan`, the plan's page): for its manager and the person it is about, every item; for the
     * owner of some of its items, those items only, and the counts and the note over those alone. The manager is
     * whoever the person reports to now, or whoever holds the plan once the person is deactivated (`accessOf`). An item
     * whose owner is gone is the manager's. Reads, so no audit row.
     */
    async plan(persona: AuthenticatedContext, planId: string): Promise<BoardingPlanOutput> {
      const { reports } = await staffing(persona);
      const day = currentDay();
      return deps.store.transaction(async tx => {
        const { plan, items, person, access } = await planFor(tx, persona, planId, reports);
        const shown = access === 'owner' ? items.filter(i => i.ownerId === persona.id) : items;
        const named = new Map(
          (
            await tx.persons([
              ...new Set([
                ...shown.flatMap(i => (i.ownerId ? [i.ownerId] : [])),
                ...(plan.buddyId ? [plan.buddyId] : []),
                ...(plan.startedBy ? [plan.startedBy] : []),
              ]),
            ])
          ).map(p => [p.id, p]),
        );
        const open = plan.closedAt === null;
        const rows = orderItems(shown).map(i =>
          itemRow(i, plan, {
            readerId: persona.id,
            today: day,
            owner: i.ownerId ? named.get(i.ownerId) : undefined,
            canTick: open && (access === 'manager' || i.ownerId === persona.id),
            managerReads: access === 'manager',
          }),
        );
        // An owner who is neither the manager nor the person is told how far their own items have come, nothing more.
        const { done, total } = progress(shown);
        const ref = (id: string | null) => {
          const p = id ? named.get(id) : undefined;
          return p ? { id: p.id, name: p.name } : null;
        };
        return {
          heading: eventWords(plan.event),
          note: planNote(plan, done, total),
          plan: {
            id: plan.id,
            personId: plan.personId,
            name: person?.name ?? '',
            userName: person?.userName ?? null,
            event: plan.event,
            anchorOn: plan.anchorOn,
            buddy: ref(plan.buddyId),
            startedBy: ref(plan.startedBy),
            startedAt: plan.startedAt,
            closedAt: plan.closedAt,
            done,
            total,
            access,
          },
          phases: byPhase(plan.event, rows),
          rows,
        };
      });
    },

    /**
     * The persona's open plans (D124 items 7 and 12, the list a manager works from and what the rail's row leads to):
     * `rows`, every open plan of their reports and the open plans they hold for someone since deactivated; `own`, the
     * open plans about the persona themself, never among `rows`; and whether they manage a unit now, so the list is theirs
     * with no plan on it. One read answers whom the place applies to. Reads, so no audit row.
     */
    async plans(persona: AuthenticatedContext): Promise<BoardingPlansOutput> {
      const { manages, reports } = await staffing(persona);
      const day = currentDay();
      return deps.store.transaction(async tx => {
        const plans = await listedPlans(tx, persona, reports);
        const own = (await tx.plansAbout([persona.id])).filter(
          p => p.closedAt === null && p.organisationId === persona.organisationId,
        );
        const items = await tx.items([...plans, ...own].map(p => p.id));
        const persons = new Map(
          (await tx.persons([...new Set([...plans, ...own].map(p => p.personId))])).map(p => [p.id, p]),
        );
        const summary = (p: PlanRecord, person: Pick<PersonRef, 'name' | 'userName'>, managerReads: boolean) =>
          planSummary(
            p,
            person,
            items.filter(i => i.planId === p.id),
            persona.id,
            day,
            managerReads,
          );
        return {
          rows: orderPlans(
            plans.flatMap(p => {
              const person = persons.get(p.personId);
              return person ? [summary(p, person, true)] : [];
            }),
          ),
          // The persona reads their own plan as its person: what waits for them is what they own.
          own: orderPlans(
            own.map(p => summary(p, persons.get(p.personId) ?? { name: persona.name, userName: null }, false)),
          ),
          manages,
        };
      });
    },

    /**
     * One person's plans, as the plan page opens on them (D124): for the person themselves their own, for the manager they
     * report to all of theirs with what starting a new one needs, and, once the person is deactivated, for whoever
     * holds a plan of theirs, those plans. Anyone else is refused. Reads, so no audit row.
     */
    async personPlans(persona: AuthenticatedContext, personId: string): Promise<BoardingPersonOutput> {
      const { reports } = await staffing(persona);
      const day = currentDay();
      return deps.store.transaction(async tx => {
        const [person] = await tx.persons([personId]);
        if (!person || person.organisationId !== persona.organisationId) throw new ForbiddenError(NOT_YOURS);
        const report = reports.get(personId);
        const all = await tx.plansAbout([personId]);
        const held = all.filter(p => !person.enabled && holdsAfterLeaving(p, persona.id));
        const plans = personId === persona.id || report ? all : held;
        if (!plans.length && personId !== persona.id && !report) throw new ForbiddenError(NOT_YOURS);
        const items = await tx.items(plans.map(p => p.id));
        const start = report ? upcomingStart(report, day) : undefined;
        return {
          person: { id: person.id, name: person.name, userName: person.userName, enabled: person.enabled },
          canStart: !!report,
          plans: orderPlans(
            plans.map(p =>
              planSummary(
                p,
                person,
                items.filter(i => i.planId === p.id),
                persona.id,
                day,
                !!report || held.includes(p),
              ),
            ),
          ),
          buddies: report
            ? [...reports.values()]
                .filter(r => r.id !== personId)
                .map(r => ({ id: r.id, name: r.name }))
                .sort((a, b) => a.name.localeCompare(b.name, 'sv') || a.id.localeCompare(b.id))
            : [],
          ...(start && !all.some(p => covers(p, start)) ? { suggestedFirstDay: start } : {}),
        };
      });
    },

    /**
     * Who of the persona's reports Clew suggests an introduction for (D124): an active report whose employment starts
     * after today and within `SUGGESTION_WINDOW_DAYS`, with no introduction that covers that start. The start date only
     * prefills the suggestion; nothing starts from it. Reads, so no audit row.
     */
    suggestions: (persona: AuthenticatedContext) => suggestionsFor(persona, currentDay()),
    /**
     * The scan's read (D47): the suggestions and the instant they were read at, which is the observation's. The whole of
     * the persona's reports is read every time, so it is a complete observation; a read that fails throws.
     */
    async scanOf(persona: AuthenticatedContext): Promise<{ observedAt: string; suggestions: BoardingSuggestion[] }> {
      const at = now();
      return { observedAt: at.toISOString(), suggestions: await suggestionsFor(persona, swedishDay(at)) };
    },

    /**
     * `boarding.person` (D97): for each key asked about that is one of the persona's reports, their open plan with its
     * progress and what waits for the reader, or, with no plan, a start within the suggestion window that no
     * introduction covers. `keys` are user names, compared without regard to case; a row carries the key as asked.
     * Anyone else, a key asked twice and a report with neither are answered as no row. Reads, so no audit row.
     */
    async aboutPeople(persona: AuthenticatedContext, keys: readonly string[]): Promise<PersonStanding[]> {
      const { reports } = await staffing(persona);
      const asked = new Map<string, Report>();
      for (const key of keys) {
        const r = [...reports.values()].find(x => sameUserName(x.userName, key));
        if (r && ![...asked.values()].includes(r)) asked.set(key, r);
      }
      if (!asked.size) return [];
      const day = currentDay();
      return deps.store.transaction(async tx => {
        const plans = await tx.plansAbout([...asked.values()].map(r => r.id));
        const open = plans.filter(p => p.closedAt === null);
        const items = await tx.items(open.map(p => p.id));
        return [...asked].flatMap(([key, report]): PersonStanding[] => {
          const plan = open
            .filter(p => p.personId === report.id)
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
          if (plan) {
            const own = items.filter(i => i.planId === plan.id);
            const { done, total } = progress(own);
            return [
              {
                key,
                personId: report.id,
                plan: {
                  id: plan.id,
                  event: plan.event,
                  anchorOn: plan.anchorOn,
                  done,
                  total,
                  waiting: own.filter(i => i.doneAt === null && waitsFor(i, persona.id, true)).length,
                  state: planState(plan, own, day),
                },
              },
            ];
          }
          const start = upcomingStart(report, day);
          if (start && !plans.some(p => p.personId === report.id && covers(p, start)))
            return [{ key, personId: report.id, missingFrom: start }];
          return [];
        });
      });
    },

    /**
     * The manager adds an item to one plan (D124): its title is free text about this person's plan, sealed at rest and
     * never on the card, in an audit row or a log line. It ties to nothing: `tiedTo` is an administrator's, on a layer's
     * item. Its owner is the manager adding it, the person or the buddy (the manager adding it when there is none). The
     * card is opened first in the same transaction. Returns the item's id.
     */
    async addItem(persona: AuthenticatedContext, planId: string, body: BoardingItemAddBody): Promise<{ id: string }> {
      const title = normaliseTitle(body.title);
      if (!title) throw new BoardingError(BAD_TITLE);
      if (!isCalendarDay(body.dueOn)) throw new BoardingError(BAD_DAY);
      const { reports } = await staffing(persona);
      const at = now().toISOString(),
        id = deps.ids(),
        threadId = deps.ids();
      return deps.store.transaction(async tx => {
        const { plan, items, person, access } = await planFor(tx, persona, planId, reports, true);
        if (access !== 'manager') throw new ForbiddenError(NOT_THE_MANAGER);
        if (plan.closedAt !== null) throw new BoardingError(PLAN_CLOSED);
        if (Math.abs(daysBetween(plan.anchorOn, body.dueOn)) > ANCHOR_RANGE_DAYS)
          throw new BoardingError(DUE_OUT_OF_RANGE);
        if (items.length >= PLAN_ITEMS_MAX) throw new BoardingError(TOO_MANY_ITEMS);
        const ownerId = ownerOf(body.ownerRole, {
          managerId: persona.id,
          personId: plan.personId,
          buddyId: plan.buddyId,
        });
        await tx.workItems.open({
          threadId,
          personId: ownerId,
          itemId: id,
          planId: plan.id,
          event: plan.event,
          title: null,
          dueOn: body.dueOn,
          at,
          ...subjectOf(person?.userName ?? null),
        });
        await tx.insertItem({
          id,
          planId: plan.id,
          position: items.reduce((max, i) => Math.max(max, i.position), -1) + 1,
          title,
          added: true,
          kind: body.kind,
          ownerRole: body.ownerRole,
          ownerId,
          dueOn: body.dueOn,
          doneAt: null,
          doneBy: null,
          threadId,
          sourceLayerId: null,
          tiedTo: null,
          createdAt: at,
        });
        await tx.audit({
          actor: persona.principal.id,
          action: 'boarding.item_added',
          subject: 'item:' + id,
          at,
          details: { planId: plan.id, kind: body.kind, ownerRole: body.ownerRole, dueOn: body.dueOn },
        });
        return { id };
      });
    },

    /** The item's owner, or the plan's manager, marks it done; its card closes with it. */
    setDone: (persona: AuthenticatedContext, id: string) => setDone(persona, id, true),
    /** The same people open it again; its card opens again with its timer. */
    setNotDone: (persona: AuthenticatedContext, id: string) => setDone(persona, id, false),

    /**
     * The plan's manager closes it (D124): every open item's card is closed in the same transaction; the items keep
     * what they were, and the plan is read-only from then on. Closing a closed plan changes nothing and writes nothing.
     */
    async closePlan(persona: AuthenticatedContext, planId: string): Promise<void> {
      const { reports } = await staffing(persona);
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const { plan, items, access } = await planFor(tx, persona, planId, reports, true);
        if (access !== 'manager') throw new ForbiddenError(NOT_THE_MANAGER);
        if (plan.closedAt !== null) return;
        let cards = 0;
        for (const item of items)
          if (item.doneAt === null && item.threadId) {
            await tx.workItems.close(item.threadId, at, 'closed');
            cards++;
          }
        await tx.closePlan(plan.id, at);
        const { done, total } = progress(items);
        await tx.audit({
          actor: persona.principal.id,
          action: 'boarding.plan_closed',
          subject: 'plan:' + plan.id,
          at,
          details: { personId: plan.personId, event: plan.event, done, total, cards },
        });
      });
    },

    /**
     * The timer of an item's card fired at `generation`. While the module is switched on and the item and its plan are
     * open, the card comes back, and when it did the audit row says so. A done or unknown item, a closed plan, or a
     * timer the card no longer has, changes nothing. While the module is switched off the timer is dropped (D124 item
     * 5): no card comes back, no delivery and no audit row; the card stays as it was, open and overdue unless its owner
     * put it away, and gets a timer again only when the item is ticked back. Returns whether the card came back.
     */
    async itemDue(threadId: string, generation: number): Promise<boolean> {
      if (deps.switchedOn && !(await deps.switchedOn())) return false;
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
        // The plan first, then the item (the module's lock order): the card names the item, the item its plan.
        const found = await tx.itemByThread(threadId);
        const plan = found && (await tx.plan(found.planId, true));
        const item = plan && (await tx.item(found.id, true));
        if (!plan || !item || item.doneAt !== null || plan.closedAt !== null) return false;
        const fired = await tx.workItems.fire(threadId, generation, at);
        if (fired)
          await tx.audit({
            actor: TIMER_ACTOR,
            action: 'boarding.item_due',
            subject: 'item:' + item.id,
            at,
            details: { planId: plan.id, dueOn: item.dueOn, generation },
          });
        return fired;
      });
    },

    /**
     * Erase one person from the domain: every plan about them with its items and the cards of those, the cards of the
     * items they owned in other plans, and their id on other people's plans. `actor` is the operator's.
     */
    async erasePerson(
      actor: string,
      personId: string,
    ): Promise<{ plans: number; items: number; cleared: number; cards: number }> {
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
        const erased = await tx.erasePerson(personId);
        if (erased.threadIds.length) await tx.workItems.remove(erased.threadIds);
        const counts = {
          plans: erased.plans,
          items: erased.items,
          cleared: erased.cleared,
          cards: erased.threadIds.length,
        };
        await tx.audit({ actor, action: 'boarding.person_erased', subject: 'person:' + personId, at, details: counts });
        return counts;
      });
    },

    /** The whole domain of one organisation as one versioned document, titles included. */
    async exportDomain(
      actor: string,
      organisationId: string,
    ): Promise<{ format: typeof BOARDING_EXPORT_FORMAT; exportedAt: string; organisationId: string } & BoardingExport> {
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
        const data = await tx.exportOrganisation(organisationId);
        await tx.audit({
          actor,
          action: 'boarding.exported',
          subject: 'organisation:' + organisationId,
          at,
          details: { layers: data.layers.length, plans: data.plans.length, items: data.items.length },
        });
        return { format: BOARDING_EXPORT_FORMAT, exportedAt: at, organisationId, ...data };
      });
    },
  };
}
export type BoardingUsecases = ReturnType<typeof boardingUsecases>;
