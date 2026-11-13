import type { Route } from '@playwright/test';
import type {
  BoardingImportBody,
  BoardingItemAddBody,
  BoardingItemRow,
  BoardingLayersOutput,
  BoardingPersonOutput,
  BoardingPlanOutput,
  BoardingPlanSummary,
  BoardingPlansOutput,
  BoardingPreview,
  BoardingStartBody,
  BoardingSuggestionsOutput,
  EntityAction,
  EntityRows,
  EntitySource,
  PanelViewSpec,
  View,
  ViewEntry,
} from '@clew/contracts';
import { BOARDING_KIND_WORDS, BOARDING_OWNER_WORDS, BOARDING_PHASE_WORDS } from '@clew/contracts';
import { NOW, TODAY, user } from './data';
import { CATALOGUE, manifest as desk } from '../../connectors/servicedesk/manifest.mjs';

/**
 * Introduktion och avslut (D124) as the browser sees it, answered over the mock's own state as the server would: the
 * reader's list and the suggestions (which the rail's row is drawn from too, item 12), one
 * person's plans, one plan for the manager, the person or an item's owner, the preview and the start, an item added,
 * ticked off or opened again, a plan closed, the layers and their import. The people are the suite's own (`data.ts`,
 * Clew's id is the key there): Anna Lindqvist has an introduction that starts 16 November and Erik Sandström is her
 * buddy; Maria Källström has none and starts 1 December, which the directory sent. The test person is the manager.
 */
export const BOARDING_LENS = 'boarding.person';
export const PLAN = 'plan-anna';
export const ANNA = 'anna';
export const MARIA = 'maria';
export const NOT_ENABLED = 'Introduktion och avslut är inte påslaget i den här installationen.';
const NOT_YOURS = 'Personen finns inte bland dem du är chef för.';
const NO_PLAN = 'Planen finns inte, eller så kan du inte se den.';

/** As `boarding.person` declares it (`modules/boarding/capabilities.ts`): where each report stands. */
const boardingView: View = {
  kind: 'list',
  title: 'status',
  noun: { one: 'person', other: 'personer' },
  fields: [
    {
      key: 'status',
      label: 'Introduktion och avslut',
      format: 'status',
      tones: { Försenad: 'warn', 'Plan saknas': 'alert', Klar: 'ok' },
    },
    { key: 'day', label: 'Dag', beside: true },
    { key: 'event', label: 'Plan' },
    { key: 'progress', label: 'Klara' },
  ],
};
/** The source on a person's page and Personal's lens: Clew's own, its way in the plan's page by Clew's id. */
export const boardingSource: EntitySource = {
  capability: BOARDING_LENS,
  connector: 'boarding',
  source: 'Clew',
  title: 'Introduktion och avslut',
  view: boardingView,
  page: { title: 'Öppna planen', href: '/boarding/{id}' },
  own: true,
};
export const boardingRows = (): EntityRows => ({
  capability: BOARDING_LENS,
  status: 'ok',
  rows: [
    // A source's rows name a person by their user name (D122), as the list's people carry it in `sourceKey`.
    {
      key: 'anna.lindqvist',
      status: 'Försenad',
      event: 'Introduktion',
      day: 'Börjar 16 nov.',
      progress: '1 av 6',
      plan: PLAN,
    },
    { key: 'maria.kallstrom', status: 'Plan saknas', event: 'Introduktion', day: 'Börjar 1 dec.' },
  ],
});

/**
 * The IT service desk's order and equipment as the fixture connector declares them (`connectors/servicedesk`), so the
 * suite draws the declarations: the order as an action about a person a page offers (its asks as the dialog asks them;
 * the effect read is left out here, which the action dialog's own spec covers), the equipment as a read the person may
 * open, which takes one person in `person`.
 */
const declared = (name: string) =>
  desk.capabilities.find(c => c.name === name)! as unknown as {
    name: string;
    title: string;
    description: string;
    asks: NonNullable<EntityAction['path']>['asks'];
    view: View;
    person: { param?: string; admits: string[] };
  };
const deskOrder = declared('servicedesk.order');
export const ORDER: EntityAction = {
  capability: deskOrder.name,
  connector: desk.id,
  source: desk.source,
  title: deskOrder.title,
  kind: 'execute',
  param: 'person',
  path: { asks: deskOrder.asks, effect: false, description: deskOrder.description },
};
/** Whom the order is offered about (D117): the relations it admits, as the person's page filters its actions by them. */
export const ORDER_ADMITS = deskOrder.person.admits;
const deskEquipment = declared('servicedesk.equipment');
export const EQUIPMENT_VIEW: ViewEntry = {
  capability: deskEquipment.name,
  title: deskEquipment.title,
  kind: 'list',
  person: deskEquipment.person.param!,
  admits: deskEquipment.person.admits,
};
export const equipmentAnswer = {
  output: {
    rows: [{ ref: 'eq-1', kind: 'Bärbar dator', model: 'Lenovo T14', inventoryNumber: 'IT-1042', since: '2026-11-02' }],
  },
  source: desk.source,
  view: {
    ...deskEquipment.view,
    capability: deskEquipment.name,
    connector: desk.id,
    source: desk.source,
  } as PanelViewSpec,
};
/** The receipt the desk's order is read back with: what was ordered, by the catalogue's word. */
export const orderReceipt = (item: string | undefined) => ({
  at: NOW,
  headline: 'Beställningen är lagd hos IT-servicedesken.',
  undoUntil: null,
  undoCapability: null,
  rows: [
    {
      ref: 'request:servicedesk:SD-26110050',
      label: CATALOGUE.find(c => c.value === item)?.label ?? 'Beställning',
      outcome: 'done' as const,
      detail: 'beställd, läst tillbaka från IT-servicedesken',
    },
  ],
});

type Who = { id: string; name: string };
const MANAGER: Who = { id: user.id, name: user.name };
const PERSON: Who = { id: ANNA, name: 'Anna Lindqvist' };
const BUDDY: Who = { id: 'erik', name: 'Erik Sandström' };
const owners = { manager: MANAGER, person: PERSON, buddy: BUDDY } as const;
type Seed = {
  id: string;
  title: string;
  kind: BoardingItemRow['kind'];
  owner: keyof typeof owners;
  dueOn: string;
  done?: boolean;
  /** What the item is done with, as a layers file names it (`boardingTieOf`). */
  tiedTo?: string;
};
/**
 * Anna's items, by phase: two before her first day (one done, one overdue), one due soon, two on the day, one in her
 * first week. The orders are tied to the IT service desk's order with the catalogue's item, the walk round to a page on
 * the intranet, the course to the read of her equipment, and the meeting to a capability nobody here may use. The
 * buddy's items tied to what Anna's page does not offer them are added by the spec that needs them (`tieForBuddy`).
 */
const SEEDS: Seed[] = [
  {
    id: 'i-dator',
    title: 'Beställ dator och telefon',
    kind: 'order',
    owner: 'manager',
    dueOn: '2026-10-30',
    done: true,
    tiedTo: 'servicedesk.order?item=laptop',
  },
  {
    id: 'i-kort',
    title: 'Beställ passerkort',
    kind: 'order',
    owner: 'manager',
    dueOn: '2026-11-02',
    tiedTo: 'servicedesk.order?item=access-card',
  },
  {
    id: 'i-mote',
    title: 'Boka välkomstmöte första dagen',
    kind: 'meeting',
    owner: 'manager',
    dueOn: '2026-11-13',
    tiedTo: 'payroll.salaryChange',
  },
  {
    id: 'i-rund',
    title: 'Rundvandring, nycklar och arbetsplats',
    kind: 'todo',
    owner: 'buddy',
    dueOn: '2026-11-16',
    tiedTo: 'https://intranet.example.org/rundvandring',
  },
  {
    id: 'i-logga',
    title: 'Logga in och byt lösenord',
    kind: 'todo',
    owner: 'person',
    dueOn: '2026-11-16',
    tiedTo: 'servicedesk.order?item=system-access',
  },
  {
    id: 'i-sakerhet',
    title: 'Informationssäkerhet, grundkurs',
    kind: 'course',
    owner: 'person',
    dueOn: '2026-11-20',
    tiedTo: 'servicedesk.equipment',
  },
];
const phaseOf = (dueOn: string, anchorOn: string): BoardingItemRow['phase'] => {
  const days = Math.round((Date.parse(dueOn) - Date.parse(anchorOn)) / 86_400_000);
  return days < 0
    ? 'beforeStart'
    : days === 0
      ? 'firstDay'
      : days < 7
        ? 'firstWeek'
        : days < 90
          ? 'first90Days'
          : 'later';
};
/** An item as the server stores it, owned by one of the plan's people. */
interface Item {
  id: string;
  planId: string;
  title: string;
  kind: BoardingItemRow['kind'];
  ownerRole: BoardingItemRow['ownerRole'];
  owner: Who;
  dueOn: string;
  done: boolean;
  added: boolean;
  tiedTo: string | null;
}
interface Plan {
  id: string;
  person: Who & { userName: string | null };
  event: 'introduction' | 'leaving';
  anchorOn: string;
  buddy: Who | null;
  startedAt: string;
  closedAt: string | null;
}
/** How the reader stands to the plans: the manager (the test person), the person it is about, or an item's owner. */
export type Reader = 'manager' | 'person' | 'owner';

export class BoardingMock {
  /** Who the session's person is to the plans (the session itself stays the test person). */
  reader: Reader = 'manager';
  plans: Plan[] = [
    {
      id: PLAN,
      person: { ...PERSON, userName: ANNA },
      event: 'introduction',
      anchorOn: '2026-11-16',
      buddy: BUDDY,
      startedAt: '2026-10-26T08:00:00.000Z',
      closedAt: null,
    },
  ];
  items: Item[] = SEEDS.map(s => ({
    id: s.id,
    planId: PLAN,
    title: s.title,
    kind: s.kind,
    ownerRole: s.owner,
    owner: owners[s.owner],
    dueOn: s.dueOn,
    done: !!s.done,
    added: false,
    tiedTo: s.tiedTo ?? null,
  }));
  /** The reader's other reports, the buddies a start may name, and who may be started for. */
  reports: Array<Who & { userName: string; startOn?: string }> = [
    { ...PERSON, userName: ANNA },
    { ...BUDDY, userName: 'erik' },
    { id: MARIA, name: 'Maria Källström', userName: MARIA, startOn: '2026-12-01' },
  ];
  /** The layers, with the name the server gives a unit layer's unit (`unitLabel`), as it answers both reads. */
  layers: Array<BoardingLayersOutput['layers'][number] & { unitLabel?: string }> = [
    {
      id: 'l-alla',
      event: 'introduction',
      name: 'Alla nyanställda',
      condition: 'all',
      value: null,
      updatedAt: '2026-11-02T09:00:00.000Z',
      items: [
        {
          id: 'li-1',
          title: 'Beställ dator och telefon',
          kind: 'order',
          ownerRole: 'manager',
          offsetDays: -14,
          tiedTo: null,
          phase: 'beforeStart',
        },
        {
          id: 'li-2',
          title: 'Välkomstsamtal',
          kind: 'meeting',
          ownerRole: 'manager',
          offsetDays: 0,
          tiedTo: null,
          phase: 'firstDay',
        },
      ],
    },
    {
      id: 'l-skola',
      event: 'introduction',
      name: 'Skönsmons skola',
      condition: 'unit',
      value: 'unit-skola',
      unitLabel: 'Skönsmons skola',
      updatedAt: '2026-11-03T09:00:00.000Z',
      items: [
        {
          id: 'li-3',
          title: 'Läs skolans krisplan',
          kind: 'acknowledge',
          ownerRole: 'person',
          offsetDays: 3,
          tiedTo: null,
          phase: 'firstWeek',
        },
      ],
    },
    {
      id: 'l-avslut',
      event: 'leaving',
      name: 'Alla som slutar',
      condition: 'all',
      value: null,
      updatedAt: '2026-11-02T09:00:00.000Z',
      items: [
        {
          id: 'li-4',
          title: 'Avslutningssamtal',
          kind: 'meeting',
          ownerRole: 'manager',
          offsetDays: -7,
          tiedTo: null,
          phase: 'last90Days',
        },
      ],
    },
  ];
  /** Every write that reached the mock, in order: the method, the path and the body. */
  writes: Array<{ method: string; path: string; body?: unknown }> = [];
  /** The next write answers 400 with this sentence; it resets itself after that one. */
  refusal: string | null = null;
  /** The next preview answers 400 with this sentence; it resets itself after that one. */
  previewRefusal: string | null = null;
  /** Every preview read, as its body. */
  previews: BoardingStartBody[] = [];
  /** Every import, as its body. */
  imports: BoardingImportBody[] = [];
  private nextId = 1;

  private access(plan: Plan): 'manager' | 'person' | 'owner' | null {
    if (this.reader === 'manager') return 'manager';
    if (this.reader === 'person') return plan.person.id === ANNA ? 'person' : null;
    return this.items.some(i => i.planId === plan.id && i.owner.id === BUDDY.id) ? 'owner' : null;
  }
  /** The reader's own id: the test person as the manager, Anna as herself, Erik as the buddy. */
  private readerId() {
    return this.reader === 'manager' ? MANAGER.id : this.reader === 'person' ? ANNA : BUDDY.id;
  }
  private row(item: Item, plan: Plan, access: 'manager' | 'person' | 'owner'): BoardingItemRow {
    const mine = item.owner.id === this.readerId();
    const canTick = plan.closedAt === null && (access === 'manager' || mine);
    return {
      id: item.id,
      title: item.title,
      kind: item.kind,
      kindLabel: BOARDING_KIND_WORDS[item.kind],
      ownerRole: item.ownerRole,
      ownerLabel: BOARDING_OWNER_WORDS[item.ownerRole],
      owner: item.owner.name,
      ownerId: item.owner.id,
      mine,
      dueOn: item.dueOn,
      phase: phaseOf(item.dueOn, plan.anchorOn),
      phaseLabel: BOARDING_PHASE_WORDS[phaseOf(item.dueOn, plan.anchorOn)],
      done: item.done,
      ...(item.done ? { doneAt: NOW } : {}),
      status: item.done ? 'Klar' : item.dueOn < TODAY ? 'Försenad' : 'Att göra',
      // As the server: what an item is done with only to a reader who may tick it (D124 item 3).
      ...(item.tiedTo && canTick ? { tiedTo: item.tiedTo } : {}),
      added: item.added,
      canTick,
    };
  }
  /**
   * Two more of the buddy's own items, tied to what Anna's page offers only her and her manager (D117): the desk's order
   * about her, and the read of her equipment. The buddy may tick them, so is told what they are tied to.
   */
  tieForBuddy() {
    const buddyItem = (id: string, title: string, dueOn: string, tiedTo: string): Item => ({
      id,
      planId: PLAN,
      title,
      kind: 'todo',
      ownerRole: 'buddy',
      owner: BUDDY,
      dueOn,
      done: false,
      added: false,
      tiedTo,
    });
    this.items.push(
      buddyItem('i-telefon', 'Hjälp Anna att beställa telefon', '2026-11-17', 'servicedesk.order?item=phone'),
      buddyItem('i-utrustning', 'Gå igenom utrustningen med Anna', '2026-11-18', 'servicedesk.equipment'),
    );
  }
  /** How the reader stands to Anna (D117), as her page answers it: her manager, herself, or a colleague (the buddy). */
  relation(): 'managed' | 'self' | 'colleague' {
    return this.reader === 'manager' ? 'managed' : this.reader === 'person' ? 'self' : 'colleague';
  }
  /** One plan as `GET /api/boarding/plans/:id` answers it to the reader. */
  planOutput(plan: Plan): BoardingPlanOutput {
    const access = this.access(plan)!;
    const all = this.items.filter(i => i.planId === plan.id).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
    const shown = access === 'owner' ? all.filter(i => i.owner.id === BUDDY.id) : all;
    const rows = shown.map(i => this.row(i, plan, access));
    const order = ['beforeStart', 'firstDay', 'firstWeek', 'first90Days', 'later'] as const;
    return {
      heading: 'Introduktion',
      plan: {
        id: plan.id,
        personId: plan.person.id,
        name: plan.person.name,
        userName: plan.person.userName,
        event: plan.event,
        anchorOn: plan.anchorOn,
        buddy: plan.buddy,
        startedBy: MANAGER,
        startedAt: plan.startedAt,
        closedAt: plan.closedAt,
        // Counted over the items the reader is shown, as the server counts them: an owner's are their own.
        done: shown.filter(i => i.done).length,
        total: shown.length,
        access,
      },
      phases: order.flatMap(phase => {
        const items = rows.filter(r => r.phase === phase);
        return items.length ? [{ phase, label: BOARDING_PHASE_WORDS[phase], items }] : [];
      }),
      rows,
    };
  }
  private summary(plan: Plan): BoardingPlanSummary {
    const all = this.items.filter(i => i.planId === plan.id);
    const overdue = all.filter(i => !i.done && i.dueOn < TODAY).length;
    return {
      id: plan.id,
      personId: plan.person.id,
      name: plan.person.name,
      userName: plan.person.userName,
      event: plan.event,
      anchorOn: plan.anchorOn,
      startedAt: plan.startedAt,
      closedAt: plan.closedAt,
      done: all.filter(i => i.done).length,
      total: all.length,
      waiting: all.filter(i => !i.done && i.owner.id === this.readerId()).length,
      overdue,
      state: plan.closedAt
        ? 'closed'
        : overdue
          ? 'overdue'
          : all.every(i => i.done) && all.length
            ? 'complete'
            : 'open',
    };
  }
  /**
   * `GET /api/boarding/plans` (D124 item 12) as the server answers the reader, nearest day first: the open plans of the
   * manager's reports, the open plans about the reader themself apart from them, and whether the reader manages a unit
   * (the test person as the manager; Anna and the buddy manage nobody).
   */
  plansOutput(): BoardingPlansOutput {
    const me = this.readerId();
    const open = this.plans
      .filter(p => p.closedAt === null)
      .sort((a, b) => a.anchorOn.localeCompare(b.anchorOn) || a.id.localeCompare(b.id));
    return {
      rows: this.reader === 'manager' ? open.filter(p => p.person.id !== me).map(p => this.summary(p)) : [],
      own: open.filter(p => p.person.id === me).map(p => this.summary(p)),
      manages: this.reader === 'manager',
    };
  }
  /** `GET /api/boarding/suggestions`: the manager's reports whose employment starts soon with no introduction. */
  suggestionsOutput(): BoardingSuggestionsOutput {
    if (this.reader !== 'manager') return { rows: [] };
    return {
      rows: this.reports.flatMap(r =>
        r.startOn && !this.plans.some(p => p.person.id === r.id && p.event === 'introduction')
          ? [{ personId: r.id, name: r.name, userName: r.userName, startOn: r.startOn }]
          : [],
      ),
    };
  }
  /** A plan about the test person themself, started by their own manager: what the list shows apart from the rest. */
  ownPlan(event: Plan['event'] = 'leaving', anchorOn = '2026-12-31') {
    const id = `plan-${MANAGER.id}`;
    this.plans.push({
      id,
      person: { ...MANAGER, userName: MANAGER.id },
      event,
      anchorOn,
      buddy: null,
      startedAt: '2026-11-02T08:00:00.000Z',
      closedAt: null,
    });
    this.items.push({
      id: `${id}-1`,
      planId: id,
      title: 'Avslutningssamtal',
      kind: 'meeting',
      ownerRole: 'person',
      owner: MANAGER,
      dueOn: '2026-12-21',
      done: false,
      added: false,
      tiedTo: null,
    });
    return id;
  }
  /**
   * `n` more reports with an open plan each, for a list of realistic size: synthetic names, every fourth a leaving, the
   * days a few apart, each with three items, one done, and every fifth with one past its day.
   */
  addPlans(n: number) {
    const first = ['Amir', 'Britt', 'Cecilia', 'David', 'Elin', 'Fredrik', 'Greta', 'Hampus', 'Ida', 'Johan'];
    const last = ['Berg', 'Ek', 'Holm', 'Lind', 'Nyberg', 'Sjöberg', 'Strand', 'Wall'];
    for (let i = 1; i <= n; i++) {
      const id = `rapport-${i}`;
      const person = { id, name: `${first[i % first.length]} ${last[i % last.length]} ${i}`, userName: id };
      const anchorOn = new Date(Date.parse('2026-11-05') + i * 3 * 86_400_000).toISOString().slice(0, 10);
      const planId = `plan-${id}`;
      this.reports.push(person);
      this.plans.push({
        id: planId,
        person,
        event: i % 4 === 0 ? 'leaving' : 'introduction',
        anchorOn,
        buddy: null,
        startedAt: '2026-10-20T08:00:00.000Z',
        closedAt: null,
      });
      const item = (n: number, dueOn: string, done: boolean): Item => ({
        id: `${planId}-${n}`,
        planId,
        title: `Punkt ${n}`,
        kind: 'todo',
        ownerRole: 'manager',
        owner: MANAGER,
        dueOn,
        done,
        added: false,
        tiedTo: null,
      });
      this.items.push(
        item(1, '2026-10-30', true),
        item(2, i % 5 === 0 ? '2026-11-02' : anchorOn, false),
        item(3, anchorOn, false),
      );
    }
  }
  /** `GET /api/boarding/people/:id`: refused unless the reader manages the person or is them. */
  personOutput(personId: string): BoardingPersonOutput | null {
    const report = this.reports.find(r => r.id === personId);
    const self = this.reader === 'person' && personId === ANNA;
    if (!report || (this.reader !== 'manager' && !self)) return null;
    const plans = this.plans
      .filter(p => p.person.id === personId)
      .sort(
        (a, b) => Number(a.closedAt !== null) - Number(b.closedAt !== null) || b.startedAt.localeCompare(a.startedAt),
      );
    const manager = this.reader === 'manager';
    return {
      person: { id: report.id, name: report.name, userName: report.userName, enabled: true },
      canStart: manager,
      plans: plans.map(p => this.summary(p)),
      buddies: manager ? this.reports.filter(r => r.id !== personId).map(r => ({ id: r.id, name: r.name })) : [],
      ...(manager && report.startOn && !plans.some(p => p.event === 'introduction')
        ? { suggestedFirstDay: report.startOn }
        : {}),
    };
  }
  private preview(body: BoardingStartBody): BoardingPreview {
    const person = this.reports.find(r => r.id === body.personId)!;
    const buddy = body.buddyId ? (this.reports.find(r => r.id === body.buddyId) ?? null) : null;
    const layers = this.layers.filter(l => l.event === body.event);
    const ownerOf = (role: 'manager' | 'person' | 'buddy') =>
      role === 'manager' ? MANAGER : role === 'person' ? { id: person.id, name: person.name } : (buddy ?? MANAGER);
    const shift = (days: number) => new Date(Date.parse(body.anchorOn) + days * 86_400_000).toISOString().slice(0, 10);
    const applying: Array<BoardingPreview['layers'][number] & { unitLabel?: string }> = layers.map(l => ({
      id: l.id,
      name: l.name,
      condition: l.condition,
      value: l.value,
      ...(l.unitLabel ? { unitLabel: l.unitLabel } : {}),
    }));
    return {
      person: { id: person.id, name: person.name },
      event: body.event,
      anchorOn: body.anchorOn,
      buddy: buddy ? { id: buddy.id, name: buddy.name } : null,
      layers: applying,
      items: layers
        .flatMap(l =>
          l.items.map(i => ({
            title: i.title,
            kind: i.kind,
            ownerRole: i.ownerRole,
            owner: { id: ownerOf(i.ownerRole).id, name: ownerOf(i.ownerRole).name },
            dueOn: shift(i.offsetDays),
            phase: i.phase,
            layerId: l.id,
          })),
        )
        .sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
    };
  }

  /** `/api/boarding/**`, the module's own routes; null on `MockApi` is the module switched off (403 for all). */
  async handle(route: Route, path: string) {
    const request = route.request(),
      method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    const empty = () => route.fulfill({ status: 204, body: '' });
    const refuse = (status: number, error: string) =>
      route.fulfill({ status, json: { error, ...(status === 403 ? { code: 'denied' } : {}) } });
    const body = () => (request.postData() ? request.postDataJSON() : undefined);
    if (method !== 'GET') {
      this.writes.push({ method, path, body: body() });
      const refusal = path === '/boarding/preview' ? this.previewRefusal : this.refusal;
      if (refusal) {
        if (path === '/boarding/preview') this.previewRefusal = null;
        else this.refusal = null;
        return refuse(400, refusal);
      }
    }
    const person = /^\/boarding\/people\/([^/]+)$/.exec(path);
    if (person && method === 'GET') {
      const answer = this.personOutput(decodeURIComponent(person[1]!));
      return answer ? json(answer) : refuse(403, NOT_YOURS);
    }
    const planPath = /^\/boarding\/plans\/([^/]+)(\/items|\/close)?$/.exec(path);
    if (planPath) {
      const plan = this.plans.find(p => p.id === decodeURIComponent(planPath[1]!));
      if (!plan || !this.access(plan)) return refuse(403, NO_PLAN);
      if (method === 'GET' && !planPath[2]) return json(this.planOutput(plan));
      if (planPath[2] === '/close') {
        plan.closedAt = NOW;
        return empty();
      }
      if (planPath[2] === '/items') {
        const added = body() as BoardingItemAddBody;
        const id = `added-${this.nextId++}`;
        this.items.push({
          id,
          planId: plan.id,
          title: added.title,
          kind: added.kind,
          ownerRole: added.ownerRole,
          owner:
            added.ownerRole === 'manager' ? MANAGER : added.ownerRole === 'person' ? PERSON : (plan.buddy ?? MANAGER),
          dueOn: added.dueOn,
          done: false,
          added: true,
          tiedTo: null,
        });
        return json({ id }, 201);
      }
    }
    const done = /^\/boarding\/items\/([^/]+)\/done$/.exec(path);
    if (done) {
      const item = this.items.find(i => i.id === decodeURIComponent(done[1]!));
      if (!item) return refuse(403, 'Du kan inte ändra den här uppgiften.');
      item.done = method === 'POST';
      return empty();
    }
    if (path === '/boarding/plans' && method === 'GET') return json(this.plansOutput());
    if (path === '/boarding/suggestions' && method === 'GET') return json(this.suggestionsOutput());
    if (path === '/boarding/preview' && method === 'POST') {
      const asked = body() as BoardingStartBody;
      this.previews.push(asked);
      return json(this.preview(asked));
    }
    if (path === '/boarding/plans' && method === 'POST') {
      const asked = body() as BoardingStartBody;
      const preview = this.preview(asked);
      const report = this.reports.find(r => r.id === asked.personId)!;
      const id = `plan-${this.nextId++}`;
      this.plans.push({
        id,
        person: { id: report.id, name: report.name, userName: report.userName },
        event: asked.event,
        anchorOn: asked.anchorOn,
        buddy: preview.buddy,
        startedAt: NOW,
        closedAt: null,
      });
      for (const item of preview.items)
        this.items.push({
          id: `item-${this.nextId++}`,
          planId: id,
          title: item.title,
          kind: item.kind,
          ownerRole: item.ownerRole,
          owner: item.owner,
          dueOn: item.dueOn,
          done: false,
          added: false,
          tiedTo: null,
        });
      return json({ id }, 201);
    }
    if (path === '/boarding/layers' && method === 'GET') return json({ layers: this.layers });
    if (path === '/boarding/layers/import' && method === 'POST') {
      const asked = body() as BoardingImportBody;
      this.imports.push(asked);
      const names = new Set(asked.rows.map(r => `${r.event}\n${r.layer.toLowerCase()}`));
      const known = new Set(this.layers.map(l => `${l.event}\n${l.name.toLowerCase()}`));
      const added = [...names].filter(n => !known.has(n)).length;
      return json({ layers: names.size, added, replaced: names.size - added, unchanged: 0 });
    }
    return null;
  }
}
/** The module switched off: every route refuses, as the server's guard does. */
export const boardingOff = (route: Route) =>
  route.fulfill({ status: 403, json: { error: NOT_ENABLED, code: 'denied' } });
