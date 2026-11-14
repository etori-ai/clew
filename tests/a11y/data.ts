import type {
  CommitmentsResult,
  TalkRound,
  TalksResult,
  UserAdminRow,
  UsersAdminOverview,
  OrganisationOverview,
  OrganisationUnitPeople,
  StaffOverview,
  AssistantStatus,
  ModelDetail,
  ModelSummary,
  ProviderDetail,
  ProviderSummary,
  ProviderTestReport,
  SiteHeaderView,
  HandoverAssistant,
} from '@clew/contracts';
import type {
  EntityAction,
  EntityDetail,
  EntityList,
  EntityRef,
  EntityRows,
  EntitySource,
  View,
} from '@clew/contracts';
import type { ActionPath, DayView, MeetingTimes } from '@clew/contracts';
import type {
  Area,
  Attention,
  CalendarEvent,
  SnoozePreset,
  CheckReport,
  ConnectorDetail,
  ConnectorPreview,
  ConnectorSummary,
  ConversationResponse,
  Proposal,
  SearchResult,
  SessionUser,
  SourceCitation,
  SystemMark,
  Thread,
  TodayView,
} from '@clew/contracts';
import type { MenuEntry, NewsResult, PanelViewSpec } from '@clew/contracts';
import { newsCapabilities } from '../../apps/server/src/modules/news/capabilities';
import { brandskyddMark, mariaMark } from './competence';
import { manifest as communicationNewsManifest } from '../../connectors/communication/connector.mjs';

/** Synthetic data, typed against the contracts so the suite follows the API. The clock is frozen to this Wednesday. */
export const NOW = '2026-11-04T08:00:00.000Z';
export const WEEK = '2026-11-02';
export const NEXT_WEEK = '2026-11-09';

export const user: SessionUser = {
  id: 'testperson',
  name: 'Testa Testsson',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'manager',
};

const thread = (values: Partial<Thread> & Pick<Thread, 'id' | 'title'>): Thread => ({
  kind: 'pushed',
  topic: values.id,
  state: 'open',
  trigger: { reason: 'Fakturorna förfaller i veckan', source: 'Ekonomisystemet', at: NOW },
  createdAt: NOW,
  updatedAt: NOW,
  handledAt: null,
  messages: [],
  proposals: [],
  week: null,
  connector: 'finance',
  area: 'budget',
  summary: 'Alla matchar sina beställningar och ryms i budgeten.',
  items: [],
  actions: [],
  waitingOn: null,
  deadline: null,
  receipt: null,
  remindedAt: null,
  snoozedUntil: null,
  ...values,
});
/**
 * What the HR fixture's writes declare (D112 item 10), as the server resolves a work item's action's `path` from the
 * registered manifest: "Boka samtalet" asks for the time, the place and a message and says beforehand what it writes;
 * "Godkänn" on a leave request asks for an optional comment and has no effect read.
 */
export const BOOK_TALK_PATH: ActionPath = {
  asks: [
    { kind: 'meeting', property: 'when', label: 'När', required: true, durationMinutes: 45 },
    { kind: 'text', property: 'place', label: 'Plats', required: false },
    { kind: 'long-text', property: 'message', label: 'Meddelande till medarbetaren', required: false },
  ],
  effect: true,
  description: 'Registrerar ett omtankesamtal i personalsystemet.',
};
export const DECIDE_LEAVE_PATH: ActionPath = {
  asks: [{ kind: 'long-text', property: 'comment', label: 'Kommentar till medarbetaren', required: false }],
  effect: false,
  description: 'Beslutar en ledighetsansökan i personalsystemet.',
};
/** Three free times of 45 minutes in the person's own calendar, after the frozen Wednesday morning (`GET /api/asks/times`). */
export const meetingSlots = (): MeetingTimes['slots'] => [
  { start: '2026-11-05T12:15:00.000Z', end: '2026-11-05T13:00:00.000Z' },
  { start: '2026-11-06T08:00:00.000Z', end: '2026-11-06T08:45:00.000Z' },
  { start: '2026-11-09T13:00:00.000Z', end: '2026-11-09T13:45:00.000Z' },
];
const ownEvent = (id: string, title: string, start: string, end: string): CalendarEvent => ({
  id,
  title,
  start,
  end,
  allDay: false,
  mine: true,
  room: '',
  participants: [],
  ref: `memory:${id}`,
  revision: 'r1',
  canCancel: true,
  recurring: false,
  organizer: 'Testa Testsson',
});
/** The person's own day for the dialog's strip: planning in the morning and APT in the afternoon, Swedish time 09–11 and 15–16.30. */
export const ownDay = (date: string): DayView => ({
  from: date,
  events: [
    ownEvent(`plan-${date}`, 'Planeringstid', `${date}T08:00:00.000Z`, `${date}T10:00:00.000Z`),
    ownEvent(`apt-${date}`, 'APT', `${date}T14:00:00.000Z`, `${date}T15:30:00.000Z`),
  ],
  proposals: [],
});
const proposal = (id: string, day: string, name: string): Proposal => ({
  id,
  threadId: 'samtal',
  status: 'proposed',
  start: `${day}T09:00:00.000Z`,
  end: `${day}T09:45:00.000Z`,
  participant: { name, email: `${id}@clew.test` },
  eventRef: null,
  undoUntil: null,
  reminders: 0,
  remindedAt: null,
});
export const threads = (): Thread[] => [
  thread({
    id: 'fakturor',
    title: 'Attestera 3 fakturor, 48 200 kr',
    deadline: '2026-11-04',
    items: [
      {
        ref: 'finance:inv:1',
        label: 'Energibolaget AB · 21 400 kr',
        detail: 'Konto 4010 · förfaller 5 nov · beställning 88213',
        selectable: true,
        selected: true,
      },
      {
        ref: 'finance:inv:2',
        label: 'Skolmaterial Norrland AB · 18 300 kr',
        detail: 'Konto 4410 · förfaller 6 nov · beställning 88240',
        selectable: true,
        selected: true,
      },
      {
        ref: 'finance:inv:3',
        label: 'Städservice Mitt AB · 8 500 kr',
        detail: 'Konto 4630 · förfaller 6 nov · saknar beställning',
        selectable: true,
        selected: false,
      },
    ],
    actions: [
      {
        id: 'approve',
        label: 'Attestera',
        capability: 'finance.approve',
        kind: 'execute',
        role: 'primary',
        usesItems: true,
      },
      {
        id: 'open',
        label: 'Öppna i ekonomisystemet',
        capability: 'finance.open',
        kind: 'read',
        role: 'secondary',
        target: 'link',
      },
    ],
  }),
  thread({
    id: 'omtanke',
    title: 'Omtankesamtal med Anna Lindqvist',
    topic: 'omtanke',
    connector: 'hr',
    area: 'personal',
    deadline: '2026-11-13',
    trigger: { reason: 'Tre sjukperioder på sex månader', source: 'Personalsystemet', at: NOW },
    summary: 'Tre korta sjukperioder sedan juni. Samtalet bör bokas före den 13 november.',
    actions: [
      {
        id: 'book',
        label: 'Boka samtalet',
        capability: 'hr.bookTalk',
        kind: 'execute',
        role: 'primary',
        path: BOOK_TALK_PATH,
      },
      {
        id: 'pattern',
        label: 'Se mönstret',
        capability: 'hr.absencePattern',
        kind: 'read',
        role: 'secondary',
        target: 'panel',
      },
    ],
  }),
  thread({
    id: 'ledighet',
    title: 'Ledighetsansökan från Johan Byström',
    topic: 'ledighet',
    connector: 'hr',
    area: 'personal',
    deadline: '2026-11-20',
    trigger: { reason: 'Ansökan väntar på beslut', source: 'Personalsystemet', at: NOW },
    summary: 'Två dagar före jul. Ingen krock i schemat.',
    actions: [
      {
        id: 'decide',
        label: 'Godkänn',
        capability: 'hr.decideLeave',
        kind: 'execute',
        role: 'primary',
        input: { decision: 'approve' },
        path: DECIDE_LEAVE_PATH,
      },
    ],
  }),
  thread({
    id: 'samtal',
    title: 'Planera utvecklingssamtal',
    topic: 'utvecklingssamtal',
    connector: 'calendar',
    area: 'calendar',
    deadline: '2026-11-27',
    week: NEXT_WEEK,
    trigger: { reason: 'Samtalen ska vara klara i november', source: 'Kalendern', at: NOW },
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        body: 'Jag har ritat in två samtal nästa vecka. Båda ligger utanför lektionstid.',
        createdAt: NOW,
      },
    ],
    items: [
      {
        ref: 'unplaced:sara',
        label: 'Sara Holm',
        detail: 'upptagen hela veckan',
        selectable: false,
        selected: false,
      },
    ],
    proposals: [proposal('p1', '2026-11-10', 'Anna Lindqvist'), proposal('p2', '2026-11-12', 'Erik Sandström')],
  }),
  thread({
    id: 'samtal-svar',
    title: 'Planera utvecklingssamtal vecka 45',
    topic: 'utvecklingssamtal-v45',
    connector: 'calendar',
    area: 'calendar',
    week: WEEK,
    waitingOn: 'svar från 1 medarbetare',
    trigger: { reason: 'Samtalen ska vara klara i november', source: 'Kalendern', at: NOW },
    summary: '1 av 2 har svarat ja. 1 har inte svarat ännu.',
    messages: [
      {
        id: 'm2',
        role: 'assistant',
        body: '2 inbjudningar är skickade. Jag påminner den som inte svarat efter 2 arbetsdagar.',
        createdAt: NOW,
      },
    ],
    proposals: [
      {
        ...proposal('p3', '2026-11-05', 'Maria Källström'),
        threadId: 'samtal-svar',
        status: 'accepted',
        eventRef: 'memory:p3',
      },
      {
        ...proposal('p4', '2026-11-06', 'Johan Byström'),
        threadId: 'samtal-svar',
        status: 'confirmed',
        eventRef: 'memory:p4',
        reminders: 1,
        remindedAt: NOW,
      },
    ],
  }),
  thread({
    id: 'introduktion',
    title: 'Introduktion av ny medarbetare',
    topic: 'introduktion',
    connector: 'hr',
    area: 'personal',
    deadline: '2026-12-20',
    trigger: { reason: 'Ny medarbetare börjar i januari', source: 'Personalsystemet', at: NOW },
    summary: 'Mentor och schema ska vara klara före jul.',
  }),
  thread({
    id: 'rutin',
    title: 'Ny rutin för läkemedelshantering',
    topic: 'rutin',
    connector: 'communication',
    area: 'viktigt-nu',
    trigger: { reason: 'Nytt meddelande från förvaltningen', source: 'Kommunikation', at: NOW },
    summary: 'Gäller från den 1 december.',
    actions: [
      { id: 'ack', label: 'Jag har läst', capability: 'communication.acknowledge', kind: 'execute', role: 'primary' },
    ],
  }),
  thread({
    id: 'tillbud',
    title: 'Tillbud 2026-1182, halkolycka i duschen',
    topic: 'tillbud',
    connector: 'incidents',
    area: 'kvalitet',
    waitingOn: 'skyddsombudet',
    deadline: '2026-11-12',
    trigger: { reason: 'Väntar på skyddsombudet', source: 'Avvikelsesystemet', at: NOW },
    summary: 'Skyddsombudet har fått ärendet.',
  }),
  thread({
    id: 'brandskydd',
    title: 'Brandskyddsrond i oktober saknar protokoll',
    topic: 'brandskydd',
    connector: 'communication',
    area: 'kvalitet',
    deadline: '2026-11-30',
    snoozedUntil: '2026-11-05T05:00:00.000Z',
    trigger: { reason: 'Protokollet ska vara inlämnat', source: 'Kommunikation', at: NOW },
    summary: 'Lagd åt sidan till i morgon.',
  }),
  thread({
    id: 'attest',
    title: 'Attesterade fakturor',
    topic: 'attest',
    state: 'handled',
    handledAt: NOW,
    receipt: {
      at: NOW,
      headline: '2 fakturor attesterade',
      undoUntil: '2026-11-04T08:10:00.000Z',
      undoCapability: 'finance.unapprove',
      rows: [
        {
          ref: 'finance:inv:7',
          label: 'Kontorsvaror AB',
          outcome: 'done',
          detail: 'Läst tillbaka från ekonomisystemet',
        },
        {
          ref: 'finance:inv:8',
          label: 'IT-partner AB',
          outcome: 'unknown',
          detail: 'Väntar på svar från ekonomisystemet',
        },
      ],
    },
  }),
  thread({
    id: 'avfardad',
    title: 'Påminnelse om brandskyddsrond',
    topic: 'brand',
    state: 'dismissed',
    handledAt: NOW,
    connector: 'communication',
    area: 'viktigt-nu',
  }),
  thread({
    id: 'fraga',
    title: 'Vem är på plats i dag?',
    topic: 'fraga',
    kind: 'question',
    state: 'handled',
    handledAt: NOW,
    connector: 'clew',
    area: 'fragor',
    messages: [
      {
        id: 'q1',
        role: 'user',
        body: 'Vem är på plats i dag?',
        createdAt: NOW,
        meta: { chips: [{ ref: 'event:e1', kind: 'event', label: 'Rektorsmöte' }] },
      },
      { id: 'q2', role: 'assistant', body: 'Tio personer är på plats.', createdAt: NOW },
    ],
  }),
];

/**
 * A conversation about competence with two answers, each with its card as the turn recorded it (D38): the older about
 * Anna's holdings (one person's, a read that is logged when it is made), the latest about what needs doing, naming Maria,
 * whose row is the fourth. Opening it reads the latest card's view alone.
 */
export const competenceConversation = thread({
  id: 'kompetens',
  title: 'När går Annas brandskydd ut?',
  kind: 'question',
  connector: 'clew',
  area: 'fragor',
  messages: [
    { id: 'k1', role: 'user', body: 'När går Annas brandskydd ut?', createdAt: NOW },
    {
      id: 'k2',
      role: 'assistant',
      body: 'Annas brandskydd gäller till 1 november 2028.',
      createdAt: NOW,
      meta: {
        source: 'Kompetens',
        assistant: 'model',
        shape: 'svar',
        view: {
          capability: 'competence.holdings',
          input: { person: 'anna.lindqvist' },
          title: 'Mina kompetenser',
          source: 'Kompetens',
          declared: true,
        },
        viewRows: { count: 6, show: 'named', marks: [brandskyddMark] },
        reads: [{ capability: 'competence.holdings', rows: 6 }],
      },
    },
    { id: 'k3', role: 'user', body: 'Vems brandskydd går ut snart?', createdAt: NOW },
    {
      id: 'k4',
      role: 'assistant',
      body: 'Maria Källströms brandskydd går ut 20 januari 2027.',
      createdAt: NOW,
      meta: {
        source: 'Kompetens',
        assistant: 'model',
        shape: 'svar',
        view: {
          capability: 'competence.attention',
          input: {},
          title: 'Krav som inte uppfylls',
          source: 'Kompetens',
          declared: true,
        },
        viewRows: { count: 4, show: 'named', marks: [mariaMark] },
        reads: [{ capability: 'competence.attention', rows: 4 }],
      },
    },
  ],
});

const area = (id: string, title: string, values: Partial<Area> = {}): Area => ({
  id,
  title,
  connector: id,
  source: 'Personalsystemet',
  figure: null,
  needsYou: 0,
  waiting: 0,
  urgency: null,
  standing: [],
  schedules: [],
  ...values,
});
export const areas: Area[] = [
  area('viktigt-nu', 'Viktigt nu', {
    connector: 'communication',
    source: 'Kommunikation',
    icon: 'bell',
    // Läget (D54, artboard 3): a figure without a value is a sentence.
    figure: { label: 'Inget nytt sedan i går.', tone: 'none' },
    needsYou: 1,
    urgency: 'notice',
    standing: [{ capability: 'communication.notices', label: 'Viktigt nu', kind: 'read' }],
  }),
  area('calendar', 'Kalender', {
    source: 'Kalendern',
    icon: 'calendar',
    needsYou: 1,
    urgency: 'soon',
    standing: [{ capability: 'calendar.today', label: 'Dagens möten', kind: 'read' }],
    schedules: [{ label: 'Bevakar utvecklingssamtalen', when: 'Måndagar 06:00' }],
  }),
  // The talks module's area (D96 item 7) carries the figure of talks held, which opens the round as a declared view:
  // in the round of `talkRows()` one talk of four is held, and it is due by the round's `dueOn`.
  area('talks', 'Utvecklingssamtal', {
    connector: 'talks',
    source: 'Utvecklingssamtal',
    figure: {
      label: 'Utvecklingssamtal hållna',
      value: '1 av 4',
      comparison: 'senast 30 november',
      progress: { value: 1, max: 4 },
      tone: 'none',
      opens: { capability: 'talks.talks', title: 'Utvecklingssamtal' },
      observedAt: NOW,
    },
    standing: [{ capability: 'talks.talks', label: 'Utvecklingssamtal', kind: 'read' }],
  }),
  area('personal', 'Personal', {
    connector: 'hr',
    icon: 'people',
    figure: {
      label: 'Sjukfrånvaro',
      value: '4,2 %',
      comparison: 'mål ≤ 4,0 % · +0,3 sedan oktober',
      tone: 'warn',
      opens: { capability: 'hr.absenceOverview', title: 'Frånvaro per person' },
      observedAt: NOW,
    },
    needsYou: 2,
    urgency: 'soon',
    standing: [
      { capability: 'hr.whoIsOn', label: 'Vem är på plats?', kind: 'read' },
      { capability: 'hr.absenceOverview', label: 'Frånvaro per person', kind: 'read' },
    ],
    schedules: [{ label: 'Läser frånvaron', when: 'Varje morgon 06:00' }],
  }),
  area('budget', 'Budget', {
    connector: 'finance',
    source: 'Ekonomisystemet',
    icon: 'chart',
    figure: {
      label: 'Förbrukat av ramen',
      value: '98 %',
      comparison: 'av periodens ram',
      progress: { value: 98, max: 100 },
      tone: 'ok',
      opens: { capability: 'finance.budget', title: 'Budget mot prognos' },
      observedAt: NOW,
    },
    needsYou: 1,
    urgency: 'urgent',
    standing: [
      { capability: 'finance.budget', label: 'Budget mot prognos', kind: 'read' },
      { capability: 'finance.approve', label: 'Attestera fakturor', kind: 'execute' },
    ],
  }),
  area('kvalitet', 'Kvalitet', {
    connector: 'incidents',
    source: 'Avvikelsesystemet',
    icon: 'document',
    figure: {
      label: 'Öppna tillbud',
      value: '3',
      comparison: '1 äldre än 14 dagar',
      tone: 'alert',
      opens: { capability: 'incidents.deviations', title: 'Avvikelser och tillbud' },
      observedAt: NOW,
    },
    waiting: 1,
  }),
  // The phone book as its connector declares its area (connectors/phonebook/manifest.mjs), so a view's header, a
  // token and an `@` row draw what production draws (D71): Kontakter with the phone icon, Telefonboken's hue.
  area('kontakter', 'Kontakter', {
    connector: 'phonebook',
    source: 'Telefonboken',
    icon: 'phone',
    standing: [
      { capability: 'phonebook.team', label: 'Mitt teams kontaktlista', kind: 'read' },
      { capability: 'phonebook.directory', label: 'Sök i telefonboken', kind: 'read' },
    ],
  }),
];
/**
 * The systems behind the areas with their marks' ordinals (D71), in the order an administrator registered them: the
 * personnel system first (teal), the finance system second (purple), the calendar Clew's own (the house).
 */
export const systems: SystemMark[] = [
  { connector: 'hr', source: 'Personalsystemet', ordinal: 1 },
  { connector: 'finance', source: 'Ekonomisystemet', ordinal: 2 },
  { connector: 'incidents', source: 'Avvikelsesystemet', ordinal: 3 },
  { connector: 'phonebook', source: 'Telefonboken', ordinal: 4 },
  { connector: 'communication', source: 'Kommunikation', ordinal: 5 },
  { connector: 'calendar', source: 'Kalendern', ordinal: null },
];
/** The picker's rows (D29), fixed to the frozen clock. */
export const snoozePresets: SnoozePreset[] = [
  { id: 'hour', label: 'Om en timme', at: '2026-11-04T09:00:00.000Z', detail: '10:00' },
  { id: 'lunch', label: 'Efter lunch', at: '2026-11-04T12:00:00.000Z', detail: '13:00' },
  { id: 'tomorrow', label: 'I morgon', at: '2026-11-05T05:00:00.000Z', detail: '06:00 · i genomgången' },
  { id: 'week', label: 'Nästa vecka', at: '2026-11-09T05:00:00.000Z', detail: 'mån 9 nov 06:00' },
  {
    id: 'meeting',
    label: 'När jag är tillbaka från Ledningsgrupp',
    at: '2026-11-04T10:30:00.000Z',
    detail: '11:30 · från kalendern',
  },
];
/** The budget is spent: the header's badge carries its longest sentence, which is the widest thing in the header. */
export const attention: Attention = {
  used: 3,
  budget: 3,
  bundledUntil: 'i morgon 06:00',
  rhythm: [
    { kind: 'review', at: '06:00', state: 'done' },
    { kind: 'interruption', at: '07:12', state: 'done', title: 'Attestera 3 fakturor, 48 200 kr', count: 1 },
    { kind: 'interruption', at: '07:40', state: 'done', title: 'Omtankesamtal med Anna Lindqvist', count: 2 },
    { kind: 'interruption', at: '08:55', state: 'done', title: 'Ledighetsansökan från Johan Byström', count: 1 },
    { kind: 'bundle', at: '12:00', state: 'next' },
    { kind: 'bundle', at: '16:00', state: 'later' },
    { kind: 'quiet', at: '17:00', state: 'later' },
  ],
};
export const today: TodayView = {
  date: '2026-11-04',
  events: [
    {
      id: 'e1',
      title: 'Rektorsmöte',
      start: '2026-11-04T08:30:00.000Z',
      end: '2026-11-04T09:30:00.000Z',
      allDay: false,
      mine: true,
      room: 'A12',
      participants: [],
      ref: 'memory:e1',
      revision: 'r1',
      canCancel: true,
      recurring: false,
      organizer: 'Testa Testsson',
    },
  ],
  gaps: [{ start: '2026-11-04T09:30:00.000Z', end: '2026-11-04T11:00:00.000Z' }],
};
/** A meeting every weekday: a filled week is what pushes the columns past the screen. */
export const events = (from: string): CalendarEvent[] =>
  [0, 1, 2, 3, 4].map(offset => {
    const day = new Date(Date.parse(from) + offset * 86_400_000).toISOString().slice(0, 10);
    return {
      id: `v${offset}`,
      title: 'Morgonmöte ledningsgrupp',
      start: `${day}T07:15:00.000Z`,
      end: `${day}T07:45:00.000Z`,
      allDay: false,
      mine: true,
      room: 'A12',
      participants: ['Mona Berg', 'Per Lindahl'],
      ref: `memory:v${offset}`,
      revision: 'r1',
      canCancel: true,
      recurring: false,
      organizer: 'Testa Testsson',
    };
  });

/** The composite search's output (D26): two passages of one routine, a stale lathund, and one source that did not answer. */
export const searchOutput: SearchResult = {
  rows: [
    {
      ref: 'fall-2',
      connector: 'intranat',
      kind: 'document',
      label: 'Rutin vid fall i ordinärt boende',
      section: 'Vid fall',
      snippet: 'Innan den enskilde hjälps upp ska personalen bedöma smärta, yrsel och tecken på huvudskada.',
      source: 'Intranätet',
      owner: 'MAS',
      reviewedAt: '2026-03-12T00:00:00.000Z',
      link: 'https://intra.example/rutin-fall',
      stale: false,
    },
    {
      ref: 'fall-4',
      connector: 'intranat',
      kind: 'document',
      label: 'Rutin vid fall i ordinärt boende',
      section: 'Avvikelse',
      snippet: 'Varje fall registreras som avvikelse i avvikelsesystemet innan arbetspasset avslutas.',
      source: 'Intranätet',
      owner: 'MAS',
      reviewedAt: '2026-03-12T00:00:00.000Z',
      link: 'https://intra.example/rutin-fall#avvikelse',
      stale: false,
    },
    {
      ref: 'lathund-7',
      connector: 'eneo',
      kind: 'document',
      label: 'Lathund: avvikelser i avvikelsesystemet',
      snippet: 'Öppna Avvikelser, välj Ny och ange brukare.',
      source: 'Eneo',
      updatedAt: '2024-11-02T00:00:00.000Z',
      stale: true,
    },
  ],
  sources: [
    { id: 'intranat', source: 'Intranätet', status: 'ok' },
    { id: 'eneo', source: 'Eneo', status: 'ok' },
    { id: 'sharepoint', source: 'SharePoint', status: 'timeout' },
  ],
};
const citations: SourceCitation[] = searchOutput.rows.slice(0, 2).map((r, i) => ({
  n: i + 1,
  ref: `document:${r.connector}:${r.ref}`,
  label: r.label,
  source: r.source,
  stale: r.stale,
  link: r.link!,
  section: r.section!,
  owner: r.owner!,
  reviewedAt: r.reviewedAt!,
}));
/** The assistant of another system the harness lists when a spec asks for one (the assistants profile). */
export const hrAssistant: HandoverAssistant = {
  id: 'kunskap:hr',
  name: 'HR-assistenten',
  description: 'Svarar på frågor om anställning och ledighet.',
  source: 'Kunskapsbanken',
};
/**
 * One turn handed to another system's assistant, as the server writes it: the question marked with whom it went to, the
 * answer as that assistant's own with a source and the way to the same conversation there; `fails` is a source that did
 * not answer, said in Clew's words.
 */
export const handedConversation = (
  source: Thread[],
  text: string,
  conversationId = 'overlamnad',
  fails = false,
  /** How the turn went otherwise: Clew's own assistant chose it, it handed the question back, or it answered and is done. */
  how: { routed?: boolean; returns?: 'declined' | 'completed' } = {},
): ConversationResponse => {
  const previous = source.find(t => t.id === conversationId)?.messages ?? [];
  const who = { assistant: hrAssistant.id, name: hrAssistant.name, source: hrAssistant.source };
  const link = 'https://kunskap.example/samtal/1';
  const declined = how.returns === 'declined';
  const body = declined
    ? 'Du har APT 10:00 i morgon.'
    : fails
      ? 'Kunskapsbanken svarar inte just nu.'
      : `Enligt kollektivavtalet har du **25 semesterdagar** per år. Det är svar ${previous.length / 2 + 1} i det här samtalet.`;
  const answerMeta: NonNullable<Thread['messages'][number]['meta']> = declined
    ? { shape: 'svar', assistant: 'model', source: 'Kalendern', handedBack: who }
    : {
        shape: 'svar',
        assistant: 'handover',
        source: hrAssistant.name,
        handover: fails
          ? { ...who, failed: true }
          : {
              ...who,
              link,
              cites: [
                { label: 'Semesterregler', link: 'https://intra.example/semester' },
                { label: 'Kollektivavtalet' },
              ],
              ...(how.returns === 'completed' ? { returned: true } : {}),
            },
      };
  const reply = thread({
    id: conversationId,
    title: text.slice(0, 80),
    kind: 'question',
    connector: 'clew',
    area: 'fragor',
    handover: { ...who, session: 's-1', link },
    messages: [
      ...previous,
      {
        id: `u${previous.length}`,
        role: 'user',
        body: text,
        createdAt: NOW,
        meta: {
          handed: { ...who, ...(how.routed ? { routed: true } : {}), ...(declined ? { declined: true } : {}) },
        },
      },
      { id: `a${previous.length}`, role: 'assistant', body, createdAt: NOW, meta: answerMeta },
    ],
  });
  return {
    conversationId,
    thread: reply,
    shape: 'svar',
    assistant: declined ? 'model' : 'handover',
    answer: { body, source: declined ? 'Kalendern' : hrAssistant.name, at: NOW },
    clewActions: [],
    followUps: [],
  };
};
export const conversation = (source: Thread[], text: string, conversationId = 'konversation'): ConversationResponse => {
  const previous = source.find(t => t.id === conversationId)?.messages ?? [];
  // A question about a routine is answered from documents (D26): numbered steps, citations, the sources as a view.
  if (/ramlat/i.test(text)) {
    const body =
      '1. Lyft inte själv [1].\n2. Ring sjuksköterskan på jourtelefonen [1].\n3. Skriv avvikelse i avvikelsesystemet innan passet slutar [2].';
    const view = { capability: 'clew.search', input: { query: text }, title: 'Källor', source: 'Startsidan' };
    const reply = thread({
      id: conversationId,
      title: text.slice(0, 80),
      kind: 'question',
      connector: 'clew',
      area: 'fragor',
      messages: [
        ...previous,
        { id: `u${previous.length}`, role: 'user', body: text, createdAt: NOW },
        {
          id: `a${previous.length}`,
          role: 'assistant',
          body,
          createdAt: NOW,
          meta: {
            source: 'Startsidan',
            shape: 'steg',
            view,
            sources: citations,
            followUps: ['Och om hen slagit i huvudet?'],
          },
        },
      ],
    });
    return {
      conversationId,
      thread: reply,
      shape: 'steg',
      assistant: 'model',
      answer: { body, source: 'Startsidan', at: NOW },
      view,
      clewActions: [],
      followUps: ['Och om hen slagit i huvudet?', 'Vem ringer jag på natten?'],
      sources: citations,
    };
  }
  // A question a declared view answers (D38): the sentence counts, the view is drawn under it from its source.
  if (/telefonbok/i.test(text)) {
    const body = 'Sök i telefonboken: 2 rader.';
    const view = {
      capability: 'phonebook.directory',
      input: { query: 'lärare' },
      title: 'Sök i telefonboken',
      source: 'Telefonboken',
      declared: true,
    };
    const reply = thread({
      id: conversationId,
      title: text.slice(0, 80),
      kind: 'question',
      connector: 'clew',
      area: 'fragor',
      messages: [
        ...previous,
        { id: `u${previous.length}`, role: 'user', body: text, createdAt: NOW },
        {
          id: `a${previous.length}`,
          role: 'assistant',
          body,
          createdAt: NOW,
          meta: { source: 'Telefonboken', shape: 'vy', view },
        },
      ],
    });
    return {
      conversationId,
      thread: reply,
      shape: 'vy',
      assistant: 'router',
      answer: { body, source: 'Telefonboken', at: NOW },
      view,
      clewActions: [],
      followUps: [],
    };
  }
  // A question the administered model answers (D24): the answer names the model under it.
  if (/semester/i.test(text)) {
    const body = 'Du har 18 semesterdagar kvar i år.',
      model = { id: 'gpt-oss-120b', title: 'Kapabel' };
    const reply = thread({
      id: conversationId,
      title: text.slice(0, 80),
      kind: 'question',
      connector: 'clew',
      area: 'fragor',
      messages: [
        ...previous,
        { id: `u${previous.length}`, role: 'user', body: text, createdAt: NOW },
        {
          id: `a${previous.length}`,
          role: 'assistant',
          body,
          createdAt: NOW,
          meta: { source: 'Personalsystemet', assistant: 'model', model },
        },
      ],
    });
    return {
      conversationId,
      thread: reply,
      shape: 'svar',
      assistant: 'model',
      answer: { body, source: 'Personalsystemet', at: NOW },
      clewActions: [],
      followUps: [],
      model,
    };
  }
  // The assistant fills in an action of the work item the conversation is about (D112 item 8): a draft kept in the
  // conversation, never sent. The time is the first free time on Friday the person's calendar answers (`meetingSlots`).
  if (/^boka det/i.test(text)) {
    const body = 'Ni är båda lediga fredag 09:00. Jag har fyllt i bokningen; inget är skickat.';
    const draft = {
      kind: 'action' as const,
      threadId: 'omtanke',
      actionId: 'book',
      values: { when: '2026-11-06T08:00:00.000Z', place: 'Rum 12', message: 'Hej! Ses vi på fredag?' },
    };
    const reply = thread({
      id: conversationId,
      title: text.slice(0, 80),
      kind: 'question',
      connector: 'clew',
      area: 'fragor',
      messages: [
        ...previous,
        { id: `u${previous.length}`, role: 'user', body: text, createdAt: NOW },
        {
          id: `a${previous.length}`,
          role: 'assistant',
          body,
          createdAt: NOW,
          meta: { source: 'Personalsystemet', shape: 'forslag', assistant: 'model', draft },
        },
      ],
    });
    return {
      conversationId,
      thread: reply,
      shape: 'forslag',
      assistant: 'model',
      answer: { body, source: 'Personalsystemet', at: NOW },
      draft: { ...draft, thread: source.find(t => t.id === 'omtanke')! },
      clewActions: [],
      followUps: [],
    };
  }
  // A question that names an open card is answered with that card (D34, H1): the sentence is the card's, the card is drawn in the turn.
  if (/attestera/i.test(text)) {
    const body = 'Två matchar sina beställningar, en saknar beställning. Den första förfaller i dag.';
    const reply = thread({
      id: conversationId,
      title: text.slice(0, 80),
      kind: 'question',
      connector: 'clew',
      area: 'fragor',
      messages: [
        ...previous,
        { id: `u${previous.length}`, role: 'user', body: text, createdAt: NOW },
        {
          id: `a${previous.length}`,
          role: 'assistant',
          body,
          createdAt: NOW,
          meta: { source: 'Ekonomisystemet', shape: 'svar', cards: ['fakturor'] },
        },
      ],
    });
    return {
      conversationId,
      thread: reply,
      shape: 'svar',
      assistant: 'router',
      answer: { body, source: 'Ekonomisystemet', at: NOW },
      clewActions: [],
      followUps: [],
    };
  }
  const body = 'Tio personer är på plats i dag. Sara Nyström är sjuk.';
  const reply = thread({
    id: conversationId,
    title: 'Vem är på plats i dag?',
    kind: 'question',
    connector: 'clew',
    area: 'fragor',
    messages: [
      ...previous,
      { id: `u${previous.length}`, role: 'user', body: text, createdAt: NOW },
      { id: `a${previous.length}`, role: 'assistant', body, createdAt: NOW, meta: { source: 'Personalsystemet' } },
    ],
  });
  return {
    conversationId,
    thread: reply,
    shape: 'svar',
    assistant: 'router',
    answer: { body, source: 'Personalsystemet', at: NOW },
    clewActions: [],
    followUps: ['Vem är sjuk i morgon?'],
  };
};

/**
 * Administration (D23): the calendar bundled (Clew's own, no ordinal), two remote systems that answer, one that is down
 * and one draft, each with its place in the registration order (D71). Typed against the admin contracts.
 */
const summary = (values: Partial<ConnectorSummary> & Pick<ConnectorSummary, 'id' | 'source'>): ConnectorSummary => ({
  bundled: false,
  kind: 'passthrough',
  ordinal: null,
  url: `http://${values.id}:4010`,
  state: 'enabled',
  health: { status: 'ok', at: NOW },
  audience: { mode: 'all' },
  scanEnabled: true,
  toolsEnabled: true,
  header: false,
  registered: true,
  counts: { capabilities: 5, execute: 2, tools: 3 },
  manifestAt: NOW,
  secretChangedAt: NOW,
  createdAt: '2026-11-03T06:00:00.000Z',
  updatedAt: NOW,
  ...values,
});
export const connectors = (): ConnectorSummary[] => [
  summary({
    id: 'calendar',
    source: 'Kalendern',
    bundled: true,
    url: null,
    secretChangedAt: null,
    counts: { capabilities: 7, execute: 2, tools: 4 },
  }),
  summary({ id: 'hr', source: 'Personalsystemet', ordinal: 1, counts: { capabilities: 9, execute: 3, tools: 5 } }),
  summary({
    id: 'finance',
    source: 'Ekonomisystemet',
    ordinal: 2,
    audience: { mode: 'selected', roles: ['manager'], units: ['unit-skola'] },
    counts: { capabilities: 4, execute: 1, tools: 2 },
  }),
  summary({
    id: 'hello',
    source: 'Hello',
    ordinal: 3,
    health: { status: 'unreachable', at: NOW, detail: 'ECONNREFUSED' },
  }),
  summary({
    id: 'errands',
    source: 'SupportManagement',
    ordinal: 4,
    state: 'draft',
    registered: false,
    health: { status: 'untested', at: NOW },
    manifestAt: null,
    counts: { capabilities: 6, execute: 2, tools: 4 },
  }),
];
/**
 * Hello has two views that can be tools in the menu (D40), one it names itself and one under the capability's title; the
 * others have none, so both states of the list are on the page. `menuOn` is what the administrator has chosen, and
 * `figuresOff` the areas whose figure an administrator switched off on Hem (D54).
 */
export const connectorDetail = (
  c: ConnectorSummary,
  menuOn: string[] = [],
  figuresOff: string[] = [],
): ConnectorDetail => ({
  ...c,
  protocol: 1,
  scan: true,
  // The economy system declares a header capability in the suite, so its page offers the switch (D88).
  headerCapability: c.id === 'finance' ? 'finance.header' : null,
  createdBy: 'person:mikael',
  updatedBy: 'person:mikael',
  capabilities: [
    {
      name: `${c.id}.overview`,
      kind: 'read',
      title: 'Översikt',
      description: 'Läget just nu.',
      model: true,
      roles: null,
      enabled: true,
      tool: c.toolsEnabled,
      menu: c.id === 'hello' ? { label: 'Hello', icon: 'book', on: menuOn.includes('hello.overview') } : null,
    },
    {
      name: `${c.id}.approve`,
      kind: 'execute',
      title: 'Godkänn valda',
      description: 'Godkänner raderna.',
      model: false,
      roles: ['manager'],
      enabled: true,
      tool: false,
      menu: null,
    },
    {
      name: `${c.id}.draft`,
      kind: 'propose',
      title: 'Föreslå svar',
      description: 'Ett utkast.',
      model: true,
      roles: ['manager'],
      enabled: false,
      tool: false,
      menu: null,
    },
    ...(c.id === 'hello'
      ? [
          {
            name: 'hello.openItems',
            kind: 'read' as const,
            title: 'Saker att göra',
            description: 'Det som väntar.',
            model: false,
            roles: null,
            enabled: true,
            tool: false,
            menu: { label: 'Saker att göra', icon: 'document' as const, on: menuOn.includes('hello.openItems') },
          },
        ]
      : []),
  ],
  areas: [
    {
      id: c.id,
      title: c.id === 'finance' ? 'Budget' : c.source,
      roles: ['manager', 'employee'],
      standing: [`${c.id}.overview`],
      figure: true,
      figureShown: !figuresOff.includes(c.id),
      icon: c.id === 'finance' ? 'chart' : 'people',
    },
  ],
  history: [
    { at: '2026-11-03T06:00:00.000Z', actor: 'person:mikael', action: 'connector.added', details: { url: c.url } },
    { at: NOW, actor: 'person:mikael', action: 'connector.enabled', details: {} },
  ],
});
export const checkReport: CheckReport = {
  ok: false,
  items: [
    {
      level: 'ok',
      group: 'connection',
      label: 'Systemets beskrivning är giltig',
      description: '5 funktioner, 1 område. Skickar kort.',
    },
    {
      level: 'fail',
      group: 'connection',
      label: 'Fel nyckel släpps igenom',
      description: 'Ett anrop signerat med en annan nyckel fick svaret 200. Tjänsten ska svara 401.',
    },
    {
      level: 'warn',
      group: 'capabilities',
      label: 'Dagens möten',
      description: 'Svarar inte för chef. En förmåga som anropar Clew behöver att Clew är igång.',
      capability: 'hello.dayWithMeetings',
    },
    {
      level: 'ok',
      group: 'surfaces',
      label: 'Området Hej',
      description: 'Chef och medarbetare: 1 stående handling, inget nyckeltal.',
    },
  ],
};
export const connectorPreview = (role: 'manager' | 'employee'): ConnectorPreview => ({
  role,
  unitId: null,
  visible: role === 'manager',
  areas: role === 'manager' ? [{ id: 'budget', title: 'Budget', standing: ['Budget mot prognos'] }] : [],
  tools: role === 'manager' ? ['finance.budget'] : [],
  menu: [],
});
/** Modeller (D24): one provider with a capable default and a small model for managers, one provider that is down with a model switched off. */
const provider = (values: Partial<ProviderSummary> & Pick<ProviderSummary, 'id' | 'title'>): ProviderSummary => ({
  baseUrl: `http://${values.id}.test/v1`,
  hasKey: true,
  keyChangedAt: NOW,
  health: { status: 'ok', at: NOW },
  models: 2,
  enabledModels: 2,
  createdAt: '2026-11-03T06:00:00.000Z',
  updatedAt: NOW,
  ...values,
});
const modelSummary = (
  values: Partial<ModelSummary> & Pick<ModelSummary, 'id' | 'title' | 'model' | 'providerId' | 'providerTitle'>,
): ModelSummary => ({
  description: '',
  state: 'enabled',
  audience: { mode: 'all' },
  isDefault: false,
  tools: true,
  reasoning: 'provider-default',
  health: { status: 'ok', at: NOW },
  createdAt: '2026-11-03T06:00:00.000Z',
  updatedAt: NOW,
  ...values,
});
export const modelProviders = (): ProviderSummary[] => [
  provider({ id: 'kommunen', title: 'Kommunens modeller' }),
  provider({
    id: 'pilot',
    title: 'Pilotleverantör',
    hasKey: false,
    keyChangedAt: null,
    health: { status: 'unreachable', at: NOW, detail: 'ECONNREFUSED' },
    models: 1,
    enabledModels: 0,
  }),
];
export const models = (): ModelSummary[] => [
  modelSummary({
    id: 'gpt-oss-120b',
    title: 'Kapabel',
    model: 'gpt-oss:120b',
    providerId: 'kommunen',
    providerTitle: 'Kommunens modeller',
    description: 'Långa svar och utkast.',
    isDefault: true,
  }),
  modelSummary({
    id: 'gpt-oss-20b',
    title: 'Snabb (lokal)',
    model: 'gpt-oss:20b',
    providerId: 'kommunen',
    providerTitle: 'Kommunens modeller',
    description: 'Korta frågor om dagen.',
    audience: { mode: 'selected', roles: ['manager'] },
  }),
  modelSummary({
    id: 'qwen3-32b',
    title: 'Qwen3 32B',
    model: 'qwen3:32b',
    providerId: 'pilot',
    providerTitle: 'Pilotleverantör',
    state: 'disabled',
    health: { status: 'unreachable', at: NOW, detail: 'ECONNREFUSED' },
  }),
];
const modelHistory = (kind: 'model' | 'provider') => [
  { at: '2026-11-03T06:00:00.000Z', actor: 'person:mikael', action: `${kind}.added`, details: {} },
  { at: NOW, actor: 'person:mikael', action: kind === 'model' ? 'model.enabled' : 'provider.key', details: {} },
];
export const modelDetail = (m: ModelSummary): ModelDetail => ({
  ...m,
  createdBy: 'person:mikael',
  updatedBy: 'person:mikael',
  history: modelHistory('model'),
});
export const providerDetail = (p: ProviderSummary): ProviderDetail => ({
  ...p,
  createdBy: 'person:mikael',
  updatedBy: 'person:mikael',
  history: modelHistory('provider'),
});
export const providerReport: ProviderTestReport = {
  ok: true,
  models: ['gpt-oss:120b', 'gpt-oss:20b', 'llama3.3:70b'],
  health: { status: 'ok', at: NOW },
  findings: [{ level: 'ok', text: 'Adressen svarar och listar 3 modeller.' }],
};
/** The person's models in the box: one choice hides the menu (every other suite), two show it. */
export const assistantStatus = (choices: number, currentId = 'gpt-oss-120b'): AssistantStatus => {
  const all = models()
    .filter(m => m.state === 'enabled')
    .slice(0, choices)
    .map(m => ({ id: m.id, title: m.title, description: m.description, isDefault: m.isDefault }));
  const current = all.find(c => c.id === currentId) ?? all[0] ?? null;
  return {
    configured: !!current,
    available: !!current,
    model: current?.title ?? null,
    checkedAt: NOW,
    current,
    choices: all,
  };
};
export const units = [
  { id: 'unit-skola', label: 'Bergsåkers skola' },
  { id: 'unit-omsorg', label: 'Hemtjänst Centrum' },
  { id: 'unit-it', label: 'IT och digitalisering' },
];
/** Administration › Användare (D85): the provisioned people and the mapping as the page lists them. */
/**
 * Personal (D94): what the test person, a rektor, manages: their own school and a fritidshem with a co-manager. Since
 * D97 the page lists `entityList()`; this is what the talk's drawer still reads for the person it opens.
 */
export const staffOverview = (): StaffOverview => ({
  units: [
    {
      unitId: 'unit-skola',
      unitLabel: 'Skönsmons skola',
      people: [
        {
          id: 'anna',
          name: 'Anna Lindqvist',
          userName: 'anna.lindqvist',
          email: 'anna.lindqvist@clew.test',
          role: 'employee',
          enabled: true,
        },
        {
          id: 'erik',
          name: 'Erik Sandström',
          userName: 'erik.sandstrom',
          email: 'erik.sandstrom@clew.test',
          role: 'employee',
          enabled: true,
        },
        {
          id: 'karin',
          name: 'Karin Lindqvist',
          userName: 'karin.lindqvist',
          email: 'karin.lindqvist@clew.test',
          role: 'employee',
          enabled: true,
        },
      ],
    },
    {
      unitId: 'unit-fritids',
      unitLabel: 'Skönsmons fritidshem',
      people: [
        {
          id: 'lena',
          name: 'Lena Berg',
          userName: 'lena.berg',
          email: 'lena.berg@clew.test',
          role: 'employee',
          enabled: true,
        },
        {
          id: 'omar',
          name: 'Omar Sjöberg',
          userName: 'omar.sjoberg',
          email: 'omar.sjoberg@clew.test',
          role: 'manager',
          enabled: true,
        },
      ],
    },
  ],
});
/**
 * Utvecklingssamtal (D96), as `clew.talks` and `clew.commitments` answer them over the people of `staffOverview()`
 * (the same ids, and for the school the same people as `entityList()`). Anna's talk is held, Erik's and Lena's are
 * booked, Karin's is missing; Omar, the fritidshem's
 * co-manager, is not in the round, so a page also meets a person without a row. Action points: Anna has one carried
 * over, two open this round and one done; Erik one carried over (overdue) and one done from an earlier round; the test
 * person, as an employee in their own talk, has their own and one their manager owns.
 */
export type TalkEntry = TalksResult['rows'][number];
export type CommitmentEntry = CommitmentsResult['rows'][number];
/** The built-in module answers: Clew can write. */
export const TALKS_SOURCE = 'Utvecklingssamtal';
/** Another system answers the profile: the pages are read-only and every row opens that system. */
export const TALKS_READ_ONLY_SOURCE = 'Personalsystemet';
/** What a write answers with `talksFail` set. */
export const TALKS_FAIL_ERROR = 'Ändringen kunde inte sparas. Försök igen.';
/** The day a talk is marked held when the body names none: today in Swedish time, by the frozen clock. */
export const TODAY = '2026-11-04';
/** The test person's user name, what `clew.commitments` takes as `person` for them. */
export const USER_NAME = 'testa.testsson';
export const talkRound = (): TalkRound => ({
  label: 'Utvecklingssamtal hösten 2026',
  opensOn: '2026-09-01',
  dueOn: '2026-11-30',
});
const person = (id: string) => {
  const p = staffOverview()
    .units.flatMap(u => u.people)
    .find(x => x.id === id);
  return p
    ? { personId: p.id, userName: p.userName ?? p.id, name: p.name }
    : { personId: user.id, userName: USER_NAME, name: user.name };
};
/** One row per person in the round, without the open count, which follows the action points. */
export const talkRows = (): Array<Omit<TalkEntry, 'openCommitments'>> =>
  [
    { id: 'anna', state: 'held' as const, at: '2026-11-03' },
    { id: 'erik', state: 'booked' as const, at: '2026-11-11T08:00:00.000Z' },
    { id: 'karin', state: 'missing' as const },
    { id: 'lena', state: 'booked' as const, at: '2026-11-12T13:30:00.000Z' },
  ].map(({ id, ...row }) => ({ ...person(id), ref: `talk:talks:${id}`, ...row }));
const commitment = (
  id: string,
  about: string,
  row: Pick<CommitmentEntry, 'owner' | 'mine' | 'text' | 'dueOn'> & Partial<CommitmentEntry>,
): CommitmentEntry => ({
  ...person(about),
  id,
  ref: `commitment:talks:${id}`,
  done: false,
  carried: false,
  ...row,
});
/** Every action point the mock holds, each with its `id`, in the order the server lists them. */
export const allCommitments = (): CommitmentEntry[] => [
  commitment('c-anna-1', 'anna', {
    owner: 'employee',
    mine: false,
    text: 'Gå kursen i handledning',
    dueOn: '2026-06-30',
    carried: true,
  }),
  commitment('c-anna-2', 'anna', {
    owner: 'manager',
    mine: true,
    text: 'Boka in auskultation i årskurs 4',
    dueOn: '2026-11-27',
  }),
  commitment('c-anna-3', 'anna', {
    owner: 'employee',
    mine: false,
    text: 'Uppdatera den individuella utvecklingsplanen',
    dueOn: '2026-11-20',
  }),
  commitment('c-anna-4', 'anna', {
    owner: 'employee',
    mine: false,
    text: 'Läsa in sig på den nya kursplanen',
    dueOn: '2026-11-03',
    done: true,
    doneAt: '2026-11-03T14:00:00.000Z',
  }),
  commitment('c-erik-1', 'erik', {
    owner: 'manager',
    mine: true,
    text: 'Se över schemat för rastvakter',
    dueOn: '2026-05-29',
    carried: true,
  }),
  commitment('c-erik-2', 'erik', {
    owner: 'employee',
    mine: false,
    text: 'Hospitera hos specialpedagogen',
    dueOn: '2026-04-30',
    done: true,
    doneAt: '2026-04-28T10:00:00.000Z',
  }),
  commitment('c-me-1', user.id, {
    owner: 'employee',
    mine: true,
    text: 'Delta i nätverket för skolledare',
    dueOn: '2026-03-31',
    carried: true,
  }),
  commitment('c-me-2', user.id, {
    owner: 'employee',
    mine: true,
    text: 'Gå den sista kursen i rektorsprogrammet',
    dueOn: '2026-12-15',
  }),
  commitment('c-me-3', user.id, {
    owner: 'manager',
    mine: false,
    text: 'Ta fram en plan för kompetensutveckling',
    dueOn: '2026-11-30',
  }),
  commitment('c-me-4', user.id, {
    owner: 'employee',
    mine: true,
    text: 'Skriva verksamhetsberättelsen',
    dueOn: '2026-10-31',
    done: true,
    doneAt: '2026-10-28T09:00:00.000Z',
  }),
];
/**
 * `clew.talks` as the built-in module answers it: the round, one row per person with the open count from `commitments`.
 * `bookedUnknown` is the answer when the calendar did not answer: no row is booked, and a missing one may be.
 */
export function talksResult({
  round = talkRound(),
  rows = talkRows(),
  commitments = allCommitments(),
  bookedUnknown = false,
}: {
  round?: TalkRound | null;
  rows?: Array<Omit<TalkEntry, 'openCommitments'>>;
  commitments?: CommitmentEntry[];
  bookedUnknown?: boolean;
} = {}): TalksResult {
  return {
    round,
    rows: round
      ? rows.map(row => {
          const open = commitments.filter(c => c.personId === row.personId && !c.done).length;
          if (!bookedUnknown || row.state !== 'booked') return { ...row, openCommitments: open };
          const { at: _at, ...rest } = row;
          return { ...rest, state: 'missing' as const, openCommitments: open };
        })
      : [],
    ...(bookedUnknown ? { bookedUnknown: true } : {}),
    writable: true,
    source: TALKS_SOURCE,
  };
}
/**
 * A point Anna's former manager owns, which the reader, her manager now, may take over (Q12). Not among
 * `allCommitments()`, so the lists and counts of the other specs stand; a spec adds it to the mock's.
 */
export const formerManagersPoint = (): CommitmentEntry =>
  commitment('c-anna-5', 'anna', {
    owner: 'manager',
    mine: false,
    text: 'Ordna en mentor för det första året',
    dueOn: '2026-11-25',
  });
/** A point Anna's other manager owns, who manages her still: theirs to tick off, not the reader's (Q12). */
export const coManagersPoint = (): CommitmentEntry =>
  commitment('c-anna-6', 'anna', {
    owner: 'manager',
    mine: false,
    text: 'Boka en kurs i ledarskap',
    dueOn: '2026-11-26',
  });
/** Whether the reader may mark a point done or open it again: their own, or a former manager's they take over (Q12). */
export const changeable = (row: CommitmentEntry): boolean => row.mine || row.id === 'c-anna-5';
/**
 * An action point as answered: `carried` means from an earlier round and still open, so a done one is never carried,
 * and `id`, which the write routes take, comes only on a point the reader may change.
 */
const answered = (row: CommitmentEntry): CommitmentEntry => {
  const { id, ...rest } = row;
  return { ...rest, carried: row.carried && !row.done, ...(id && changeable(row) ? { id } : {}) };
};
/** `clew.commitments` with `person`: one employee's action points, as their manager reads them. */
export const commitmentsFor = (personId: string, commitments = allCommitments()): CommitmentsResult => ({
  rows: commitments.filter(c => c.personId === personId).map(answered),
  writable: true,
  source: TALKS_SOURCE,
});
/**
 * `clew.commitments` without `person`: the reader's own list, the action points about the reader (their own and the
 * ones their manager owns, `mine: false`) and, for a manager, the ones the reader owns in their people's talks.
 * `employee` leaves out the latter, as for someone who manages nobody.
 */
export const myCommitments = (commitments = allCommitments(), employee = false): CommitmentsResult => ({
  rows: commitments.filter(c => c.personId === user.id || (!employee && c.mine)).map(answered),
  writable: true,
  source: TALKS_SOURCE,
});
/** Another system answers (D96 item 9): read-only, no `id`, and every row opens that system by its link. */
export const readOnlyTalks = (result: TalksResult): TalksResult => ({
  ...result,
  rows: result.rows.map(row => ({ ...row, link: `https://personal.clew.test/samtal/${row.personId}` })),
  writable: false,
  source: TALKS_READ_ONLY_SOURCE,
});
export const readOnlyCommitments = (result: CommitmentsResult): CommitmentsResult => ({
  rows: result.rows.map(({ id: _id, ...row }) => ({
    ...row,
    link: `https://personal.clew.test/atgarder/${row.ref.split(':').at(-1)}`,
  })),
  writable: false,
  source: TALKS_READ_ONLY_SOURCE,
});
/** The people of Administration › Användare as the suite lists them (D100), by name. */
export const usersPeople = (): UserAdminRow[] => [
  {
    id: 'hassan',
    name: 'Hassan Ali',
    userName: 'hassan',
    externalId: 'dev:hassan',
    email: 'hassan@clew.test',
    title: 'Undersköterska',
    positions: [{ code: 'underskoterska', label: 'Undersköterska' }],
    enabled: true,
    bound: true,
    assignments: [{ unitId: 'unit-omsorg', unitLabel: 'Hemtjänst Centrum', role: 'employee' }],
    active: { unitId: 'unit-omsorg', unitLabel: 'Hemtjänst Centrum', role: 'employee' },
    capabilities: [],
    relationGrants: [],
  },
  {
    id: 'hillevi',
    name: 'Hillevi Berg',
    // Her user name differs from her id: her page is at her id (D122).
    userName: 'hillevi.berg',
    externalId: 'dev:hillevi',
    email: 'hillevi@clew.test',
    title: 'Rektor',
    positions: [],
    enabled: true,
    bound: true,
    assignments: [{ unitId: 'unit-skola', unitLabel: 'Bergsåkers skola', role: 'manager' }],
    active: { unitId: 'unit-skola', unitLabel: 'Bergsåkers skola', role: 'manager' },
    capabilities: [],
    relationGrants: [],
  },
  {
    id: 'mikael',
    name: 'Mikael Lund',
    userName: 'mikael',
    externalId: 'dev:mikael',
    email: 'mikael@clew.test',
    title: 'Systemförvaltare',
    positions: [],
    enabled: true,
    bound: false,
    assignments: [{ unitId: 'unit-it', unitLabel: 'IT och digitalisering', role: 'employee' }],
    active: { unitId: 'unit-it', unitLabel: 'IT och digitalisering', role: 'employee' },
    capabilities: ['admin.connectors', 'admin.users'],
    relationGrants: [],
  },
  {
    id: 'omar',
    name: 'Omar Ny',
    userName: 'omar',
    externalId: 'dev:omar',
    email: 'omar@clew.test',
    title: null,
    positions: [],
    enabled: true,
    bound: false,
    assignments: [],
    active: null,
    capabilities: [],
    relationGrants: [],
  },
];
/**
 * Enough people for three pages: sixty on one unit, by name, after which nobody in `usersPeople` sorts. The first has
 * a title longer than a narrow column (D110); the rest have none, as people do in a catalogue that sends no titles.
 */
export const manyPeople = (): UserAdminRow[] =>
  Array.from({ length: 60 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0'),
      placed = { unitId: 'unit-omsorg', unitLabel: 'Hemtjänst Centrum', role: 'employee' as const };
    return {
      id: 'p' + n,
      name: 'Person ' + n,
      userName: 'person' + n,
      externalId: 'dev:p' + n,
      email: `person${n}@clew.test`,
      title: i === 0 ? 'Verksamhetsutvecklare med ansvar för digitalisering och välfärdsteknik' : null,
      positions: [],
      enabled: true,
      bound: false,
      assignments: [placed],
      active: placed,
      capabilities: [],
      relationGrants: [],
    };
  });
export const usersOverview = (): UsersAdminOverview => ({
  groupCapabilities: [
    { groupExternalId: 'S-1-5-21-it-staff', groupLabel: 'IT-personal', capability: 'admin.connectors' },
  ],
  groupRelations: [],
  units: [
    { id: 'unit-skola', label: 'Bergsåkers skola', parentLabel: 'Grundskola' },
    { id: 'unit-omsorg', label: 'Hemtjänst Centrum', parentLabel: null },
    { id: 'unit-it', label: 'IT och digitalisering', parentLabel: null },
  ],
  groups: [
    { id: 'unit:unit-skola', label: 'Bergsåkers skola' },
    { id: 'S-1-5-21-it-staff', label: 'IT-personal' },
    { id: 'S-1-5-21-rektorer', label: 'Rektorer' },
  ],
  capabilities: ['admin.connectors', 'admin.users'],
  relationGrants: ['registrar'],
  provisioners: [
    { id: 'hr', label: 'HR-systemet', lastSeenAt: '2026-11-06T05:00:00.000Z', silent: true, previousValidUntil: null },
    {
      id: 'metakatalogen',
      label: 'Metakatalogen',
      lastSeenAt: '2026-11-10T05:02:00.000Z',
      silent: false,
      previousValidUntil: null,
    },
  ],
});
/** Provisioned groups as the audience editor lists them (D68): the external id is what an audience stores. */
export const groups = [
  { id: 'S-1-5-21-it-staff', label: 'IT-personal' },
  { id: 'S-1-5-21-rektorer', label: 'Rektorer' },
];

/**
 * Entities (D97), as the canvas draws Personal (artboards A2, B, A3 and C): one school, five people keyed by user name,
 * two sources about a person that an administrator chose as columns and lenses, one action from each, and a third
 * source on the opened person that does not answer. The two sources' views are the ones the talks module
 * (`talks.person`) and the HR fixture (`hr.person`) declare, under the suite's own capability names. Times are fixed
 * against the frozen clock (Wednesday 4 November).
 */
export const ENTITY_UNIT = { id: 'unit-skola', label: 'Bergsåkers skola' };
/** Clew's own talks module, under its connector's source (`TALKS_SOURCE` on the server). */
export const TALK_LENS = 'clew.talkPeople';
export const PRESENCE_LENS = 'hr.presence';
/** A source an opened person has that never answers in the suite. */
export const SILENT_SECTION = 'competence.skills';
/** As `talks.person` declares it (D97): the time beside the state, the late points beside the open ones, the next talk the row in one value. */
const talkView: View = {
  kind: 'list',
  title: 'state',
  noun: { one: 'person', other: 'personer' },
  fields: [
    { key: 'state', label: 'Samtal', format: 'status', tones: { Saknas: 'warn', Bokat: 'none', Hållet: 'ok' } },
    { key: 'at', label: 'När', format: 'instant', beside: true },
    { key: 'next', label: 'Nästa samtal', format: 'status', tones: { 'Inte bokat': 'warn' }, compact: true },
    { key: 'open', label: 'Åtgärdspunkter' },
    { key: 'overdue', label: 'Försenade', format: 'status', tones: { '*': 'warn' }, beside: true },
  ],
};
/** As `hr.person` declares it: presence is the row in one value, so a section reads "I dag" and "Kommande". */
const presenceView: View = {
  kind: 'list',
  title: 'presence',
  noun: { one: 'medarbetare', other: 'medarbetare' },
  fields: [
    {
      key: 'presence',
      label: 'Närvaro',
      format: 'status',
      tones: { 'Sjuk · dag 1': 'none', 'Sjuk · dag 2': 'none', Sjukskriven: 'none', VAB: 'none', Semester: 'none' },
      compact: true,
    },
    { key: 'today', label: 'I dag' },
    { key: 'upcoming', label: 'Kommande' },
  ],
};
const competenceView: View = {
  kind: 'list',
  title: 'name',
  fields: [
    { key: 'name', label: 'Kompetens' },
    { key: 'validTo', label: 'Giltig till', format: 'date' },
  ],
};
export const talkSource: EntitySource = {
  capability: TALK_LENS,
  connector: 'clew',
  source: TALKS_SOURCE,
  title: 'Utvecklingssamtal',
  view: talkView,
  page: { title: 'Öppna samtalet', href: '?talk={id}' },
  // Clew's own domain (a core connector): its section and its lens are captioned "Clew".
  own: true,
};
export const presenceSource: EntitySource = {
  capability: PRESENCE_LENS,
  connector: 'hr',
  source: 'Personalsystemet',
  title: 'Frånvaro',
  view: presenceView,
};
const competenceSource: EntitySource = {
  capability: SILENT_SECTION,
  connector: 'competence',
  source: 'Kompetenssystemet',
  title: 'Kompetenser',
  view: competenceView,
};
export const entityActions = (): EntityAction[] => [
  {
    capability: 'clew.bookTalk',
    connector: 'clew',
    source: TALKS_SOURCE,
    title: 'Boka samtal',
    kind: 'propose',
    param: 'person',
    own: true,
  },
  {
    capability: 'hr.registerAbsence',
    connector: 'hr',
    source: 'Personalsystemet',
    title: 'Registrera frånvaro',
    kind: 'propose',
    param: 'person',
  },
];
/** A person of the list (D122): Clew's key is their id, the address; a source's rows name them by their user name. */
const entityPerson = (key: string, userName: string, name: string, detail: string): EntityRef => ({
  kind: 'person',
  key,
  sourceKey: userName,
  name,
  detail: `${detail} · ${ENTITY_UNIT.label}`,
  id: key,
});
/**
 * `GET /api/entities/person`: the directory's order, which is the list's order on "Alla". "Just nu" as artboard A2:
 * Erik and Johan each have a card to act on, Karin one of Clew's proposals; each is the one card, so its link opens it.
 */
export const entityList = (): EntityList => ({
  kind: 'person',
  attention: [
    { key: 'erik', act: 1, proposals: 0, threadId: 'omtanke' },
    { key: 'johan', act: 1, proposals: 0, threadId: 'samtal-svar' },
    { key: 'karin', act: 0, proposals: 1, threadId: 'samtal' },
  ],
  groups: [
    {
      ...ENTITY_UNIT,
      entities: [
        entityPerson('anna', 'anna.lindqvist', 'Anna Lindqvist', 'Lärare F–3'),
        entityPerson('erik', 'erik.sandstrom', 'Erik Sandström', 'Fritidspedagog'),
        entityPerson('johan', 'johan.bystrom', 'Johan Byström', 'Lärare 4–6'),
        entityPerson('karin', 'karin.lindqvist', 'Karin Lindqvist', 'Speciallärare'),
        entityPerson('maria', 'maria.kallstrom', 'Maria Källström', 'Lärare 4–6'),
      ],
    },
  ],
  columns: [
    { capability: PRESENCE_LENS, source: 'Personalsystemet', title: 'Frånvaro', field: presenceView.fields[0]! },
    { capability: TALK_LENS, source: TALKS_SOURCE, title: 'Utvecklingssamtal', field: talkView.fields[2]!, own: true },
  ],
  lenses: [talkSource, presenceSource],
  actions: entityActions(),
});
/**
 * `GET /api/entities/person/rows?capability=`: each source's rows, one per person it knows, in its own order, each by
 * the person's user name, the key the source was asked with (D122).
 */
export const entityRows = (): Record<string, EntityRows> => ({
  [TALK_LENS]: {
    capability: TALK_LENS,
    status: 'ok',
    heading: 'Utvecklingssamtal 2026',
    note: 'Senast lör 28 nov',
    rows: [
      { key: 'anna.lindqvist', state: 'Bokat', at: '2026-11-16T10:00:00.000Z', next: 'mån 16 nov', open: 'Inga' },
      { key: 'erik.sandstrom', state: 'Bokat', at: '2026-11-17T08:00:00.000Z', next: 'tis 17 nov', open: '1 öppen' },
      {
        key: 'johan.bystrom',
        state: 'Bokat',
        at: '2026-11-12T08:00:00.000Z',
        next: 'tors 12 nov',
        open: '3 öppna',
        overdue: '2 försenade',
      },
      { key: 'karin.lindqvist', state: 'Saknas', next: 'Inte bokat', open: 'Inga' },
      { key: 'maria.kallstrom', state: 'Hållet', at: '2026-11-04', next: 'Hållet 4 nov', open: '2 öppna' },
    ],
  },
  [PRESENCE_LENS]: {
    capability: PRESENCE_LENS,
    status: 'ok',
    rows: [
      { key: 'anna.lindqvist', presence: 'I tjänst', today: 'På plats 07:30–16:00' },
      { key: 'erik.sandstrom', presence: 'Sjuk · dag 1', today: 'Sjuk · dag 1, till fre 6 nov' },
      { key: 'johan.bystrom', presence: 'I tjänst', today: 'På plats', upcoming: 'Semester 21–23 dec' },
      { key: 'karin.lindqvist', presence: 'I tjänst', today: 'På plats 08:00–16:30' },
      { key: 'maria.kallstrom', presence: 'I tjänst', today: 'På plats 07:00–15:30' },
    ],
  },
});
/** `GET /api/entities/person/:key`: the opened person, Johan as artboard C draws him, the others with no cards. */
export function entityDetail(list: EntityList, key: string): EntityDetail | undefined {
  const group = list.groups.find(g => g.entities.some(e => e.key === key));
  const entity = group?.entities.find(e => e.key === key);
  if (!group || !entity) return undefined;
  return {
    // A unit the reader manages: its page opens for them.
    entity: { ...entity, unit: { id: group.id, label: group.label, opens: true } },
    relation: 'managed',
    actions: list.actions,
    sections: [talkSource, presenceSource, competenceSource],
    cards:
      key === 'johan'
        ? [
            {
              threadId: 'samtal-svar',
              title: 'En åtgärdspunkt skulle vara klar 3 nov',
              source: TALKS_SOURCE,
              kind: 'act',
            },
            { threadId: 'brandskydd', title: 'Intyg i HLR gick ut 15 sep', source: 'Kompetenssystemet', kind: 'fyi' },
          ]
        : [],
  };
}

/** The shared header (D88) as the suite draws it: Clew's default, no connector behind it. */
export const siteHeader = (): SiteHeaderView => ({
  menu: { version: 1, site: { name: 'Startsidan', href: '/' }, items: [{ id: 'start', label: 'Start', href: '/' }] },
  logo: null,
  source: null,
});

/**
 * Administration › Organisation (D99): a tree of four levels as a catalogue pushed it, with what a push can leave
 * wrong: an administration nobody leads whose unit is led from nowhere above it either, a unit nobody is placed on, a
 * unit people are on that no unit group names, and two people placed on no unit.
 */
export const organisationOverview = (): OrganisationOverview => {
  const unit = (
    unitId: string,
    unitLabel: string,
    parentId: string | null,
    managers: string[],
    placed: number,
    branch: number,
    line: 'own' | 'above' | 'none',
    pushed = true,
  ) => ({
    unitId,
    unitLabel,
    parentId,
    managers: managers.map(name => ({ id: name.toLowerCase().replace(/\W+/g, '-'), name })),
    placed,
    branch,
    line,
    pushed,
  });
  return {
    units: [
      unit('unit-arkiv', 'Arkivet', 'unit-kultur', [], 0, 0, 'none'),
      unit('unit-utbildning', 'Barn och utbildning', 'unit-kommun', ['Elin Lindqvist'], 2, 9, 'own'),
      unit('unit-skola', 'Bergsåkers skola', 'unit-grundskola', ['Hillevi Berg', 'Karin Åberg'], 3, 3, 'own'),
      unit('unit-grundskola', 'Grundskola', 'unit-utbildning', ['Mattias Eriksson'], 1, 7, 'own'),
      unit('unit-hagaskolan', 'Hagaskolan', 'unit-grundskola', [], 3, 3, 'above'),
      unit('unit-hemtjanst', 'Hemtjänst', 'unit-omsorg', [], 0, 4, 'above'),
      unit('unit-omsorg-centrum', 'Hemtjänst Centrum', 'unit-hemtjanst', ['Sara Pettersson'], 4, 4, 'own'),
      unit('unit-kommun', 'Kommunen', null, ['Yusuf Lundgren'], 1, 15, 'own'),
      unit('unit-kultur', 'Kultur och fritid', null, [], 2, 2, 'none'),
      unit('unit-okand', 'unit-okand', null, ['Nils Öberg'], 1, 1, 'own', false),
      unit('unit-omsorg', 'Vård och omsorg', 'unit-kommun', ['Amir Sjöberg'], 1, 5, 'own'),
    ],
    unplaced: 2,
  };
};
/** The people of the units of `organisationOverview()` that a test opens; a unit not listed has nobody placed on it. */
export const organisationPeople: Record<string, OrganisationUnitPeople['people']> = {
  'unit-skola': [
    {
      id: 'anna',
      name: 'Anna Lindqvist',
      userName: 'anna.lindqvist',
      email: 'anna.lindqvist@clew.test',
      role: 'employee',
      enabled: true,
    },
    {
      id: 'hillevi',
      name: 'Hillevi Berg',
      userName: 'hillevi',
      email: 'hillevi@clew.test',
      role: 'manager',
      enabled: true,
    },
    { id: 'karin', name: 'Karin Åberg', userName: 'karin.aberg', email: null, role: 'manager', enabled: true },
    // Deactivated: listed with the mark, and not among the three the tree's row counts.
    { id: 'vera', name: 'Vera Öst', userName: 'vera.ost', email: null, role: 'employee', enabled: false },
  ],
  'unit-grundskola': [
    {
      id: 'mattias',
      name: 'Mattias Eriksson',
      userName: 'mattias.eriksson',
      email: 'mattias.eriksson@clew.test',
      role: 'manager',
      enabled: true,
    },
  ],
  'unit-omsorg': [
    {
      id: 'amir',
      name: 'Amir Sjöberg',
      userName: 'amir.sjoberg',
      email: 'amir.sjoberg@clew.test',
      role: 'manager',
      enabled: true,
    },
  ],
};
/**
 * Who reports to a unit's managers from the units below it (D99 item 4), for the units a test opens: under Grundskola
 * the two who lead Bergsåkers skola, and a person placed on Hagaskolan, which nobody leads; under Vård och omsorg the
 * manager of Hemtjänst Centrum, two levels down, since Hemtjänst between them has no manager of its own.
 */
export const organisationReports: Record<string, OrganisationUnitPeople['reports']> = {
  'unit-grundskola': [
    {
      id: 'hillevi',
      name: 'Hillevi Berg',
      userName: 'hillevi',
      email: 'hillevi@clew.test',
      role: 'manager',
      enabled: true,
      below: [{ unitId: 'unit-skola', unitLabel: 'Bergsåkers skola', role: 'manager' }],
    },
    {
      id: 'karin',
      name: 'Karin Åberg',
      userName: 'karin.aberg',
      email: null,
      role: 'manager',
      enabled: true,
      below: [{ unitId: 'unit-skola', unitLabel: 'Bergsåkers skola', role: 'manager' }],
    },
    {
      id: 'omar',
      name: 'Omar Hosseini',
      userName: 'omar.hosseini',
      email: 'omar.hosseini@clew.test',
      role: 'employee',
      enabled: true,
      below: [{ unitId: 'unit-hagaskolan', unitLabel: 'Hagaskolan', role: 'employee' }],
    },
  ],
  'unit-omsorg': [
    {
      id: 'sara',
      name: 'Sara Pettersson',
      userName: 'sara.pettersson',
      email: 'sara.pettersson@clew.test',
      role: 'manager',
      enabled: true,
      below: [{ unitId: 'unit-omsorg-centrum', unitLabel: 'Hemtjänst Centrum', role: 'manager' }],
    },
  ],
};

/**
 * Nyheter (D112, amended 2026-11-11): the combined news list as the server answers `clew.news`, four pieces of news
 * from two sources, newest first. Two leave Clew by their link; two open in Clew beside the page, by the read the
 * communication fixture declares for one item. The views are the ones the core connector and the fixture really
 * declare, so the suite draws the declarations.
 */
const declaredNews = newsCapabilities({ list: async () => newsOutput() }, () => true).capabilities[0]!;
/** What the registry adds for the browser: whose view it is, and that its rows may open in another connector. */
export const newsSpec = {
  ...declaredNews.view!,
  capability: 'clew.news',
  connector: 'clew',
  source: 'Startsidan',
  chip: false,
  rowViews: true,
} as PanelViewSpec;
const newsItemView = (
  communicationNewsManifest as { capabilities: Array<{ name: string; view?: object }> }
).capabilities.find(c => c.name === 'communication.newsItem')!.view!;
export const newsItemSpec = {
  ...newsItemView,
  capability: 'communication.newsItem',
  connector: 'communication',
  source: 'Kommunikation',
  chip: false,
} as PanelViewSpec;
const opensInClew = (ref: string) => ({
  capability: 'communication.newsItem',
  input: { ref },
  title: 'Nyhet',
  source: 'Kommunikation',
});
export const NEWS_LINK = 'https://intranat.example/nyheter/nytt-lonesystem';
export const newsOutput = (): NewsResult => ({
  rows: [
    {
      ref: 'intranet:news:1',
      title: 'Nytt lönesystem från årsskiftet',
      sender: 'HR',
      publishedAt: '2026-11-04T07:00:00.000Z',
      link: NEWS_LINK,
      connector: 'intranet',
      system: 'Intranätet',
    },
    {
      ref: 'communication:notice:skolskjuts',
      title: 'Så fungerar vinterns skolskjuts',
      sender: 'Barn och utbildning',
      publishedAt: '2026-11-03T09:00:00.000Z',
      connector: 'communication',
      system: 'Kommunikation',
      view: opensInClew('communication:notice:skolskjuts'),
    },
    {
      ref: 'intranet:news:2',
      title: 'Ledarforum 3 december: anmälan öppen',
      sender: 'Kommunledningen',
      publishedAt: '2026-11-02T09:00:00.000Z',
      link: 'https://intranat.example/nyheter/ledarforum',
      connector: 'intranet',
      system: 'Intranätet',
    },
    {
      ref: 'communication:notice:matsalen',
      title: 'Enkät om matsalen',
      sender: 'Kostenheten',
      publishedAt: '2026-11-01T09:00:00.000Z',
      connector: 'communication',
      system: 'Kommunikation',
      view: opensInClew('communication:notice:matsalen'),
    },
  ],
});
/** One piece of news opened in Clew: what `communication.newsItem` answers. */
export const newsItemOutput = {
  ref: 'communication:notice:skolskjuts',
  title: 'Så fungerar vinterns skolskjuts',
  sender: 'Barn och utbildning',
  publishedAt: '2026-11-03T09:00:00.000Z',
  body: 'Från 1 december går skolbussarna efter vintertidtabellen.',
};
/**
 * A notice (D112, amended 2026-11-11 and 2026-11-12), as the communication fixture pushes one: its text as the summary,
 * a few paragraphs; its reason saying who published it, when, and that a receipt is required; its one row the notice
 * itself, with nothing to say beyond its title; "Jag har läst" as the read receipt and "Läs hela nyheten" as the read
 * that leads out of Clew to the whole of it.
 */
export const NOTICE_PUBLISHED = '2026-11-03T05:30:00.000Z';
export const NOTICE_LINK = 'https://kommunikation.example.invalid/meddelanden/rutin';
export const NOTICE_TEXT = [
  'Från den 1 december gäller en ny rutin för läkemedelshantering i hemtjänsten och på förvaltningens boenden.',
  'Varje dos signeras direkt efter att den har getts. En dos som inte kunde ges rapporteras till ansvarig sjuksköterska under samma pass.',
  'I den fullständiga rutinen finns checklistor och kontaktuppgifter. Bekräfta att du har tagit del av rutinen.',
];
export const NOTICE_REASON = 'Publicerat av Vård och omsorg 2026-11-03 06:30 · läskvitto krävs';
export function asNotice(base: Thread, id = base.id, over: Partial<Thread> = {}): Thread {
  const ref = `communication:notice:${id}`;
  return {
    ...base,
    id,
    topic: id,
    summary: NOTICE_TEXT.join('\n\n'),
    trigger: { ...base.trigger, reason: NOTICE_REASON },
    items: [{ ref, label: over.title ?? base.title, detail: '', selectable: false, selected: true }],
    actions: [
      {
        id: 'ack',
        label: 'Jag har läst',
        capability: 'communication.acknowledge',
        kind: 'execute',
        role: 'primary',
        usesItems: true,
        acknowledgement: { publishedAt: NOTICE_PUBLISHED },
      },
      {
        id: 'open',
        label: 'Läs hela nyheten',
        capability: 'communication.open',
        kind: 'read',
        role: 'secondary',
        target: 'link',
        input: { ref },
      },
    ],
    ...over,
  };
}
/** "Alla nyheter" placed in the rail under Verktyg by an administrator (D40), as the registry lists it. */
export const newsMenuRow: MenuEntry = {
  connector: 'clew',
  source: 'Startsidan',
  capability: 'clew.news',
  title: 'Nyheter',
  label: 'Nyheter',
  icon: 'book',
};
/** The shared header (D88) with the intranet's page of tools marked (D112, amended 2026-11-11). */
export const TOOLBOX_HREF = 'https://intranat.example/verktyg';
export const siteHeaderWithToolbox = (): SiteHeaderView => ({
  menu: {
    version: 1,
    site: { name: 'Startsidan', href: '/' },
    items: [
      { id: 'start', label: 'Start', href: '/' },
      {
        id: 'anstallning-arbetsmiljo',
        label: 'Anställning och arbetsmiljö',
        href: '/intranat/anstallning-arbetsmiljo',
        children: [{ id: 'verktyg', label: 'Verktyg', href: TOOLBOX_HREF, purpose: 'toolbox' }],
      },
    ],
  },
  logo: null,
  source: { id: 'intranet', label: 'Intranätet' },
});
