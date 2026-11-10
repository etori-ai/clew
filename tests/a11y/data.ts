import type {
  UsersAdminOverview,
  StaffOverview,
  AssistantStatus,
  ModelDetail,
  ModelSummary,
  ProviderDetail,
  ProviderSummary,
  ProviderTestReport,
  SiteHeaderView,
} from '@clew/contracts';
import type {
  Area,
  Attention,
  CalendarEvent,
  Completions,
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
      { id: 'book', label: 'Boka samtalet', capability: 'hr.bookTalk', kind: 'execute', role: 'primary' },
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
    actions: [{ id: 'decide', label: 'Godkänn', capability: 'hr.decideLeave', kind: 'execute', role: 'primary' }],
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
        ref: 'unplaced:sara@clew.test',
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
    figure: {
      label: 'Utvecklingssamtal bokade',
      value: '14 av 23',
      comparison: 'senast 28 november',
      progress: { value: 14, max: 23 },
      tone: 'none',
      observedAt: NOW,
    },
    needsYou: 1,
    urgency: 'soon',
    standing: [{ capability: 'calendar.today', label: 'Dagens möten', kind: 'read' }],
    schedules: [{ label: 'Bevakar utvecklingssamtalen', when: 'Måndagar 06:00' }],
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
/** What the box offers while the person types (D34): the standing actions for the role. The areas under the box (D41) come from `areas`. */
export const completions: Completions = {
  completions: ['Vad har jag i dag?'],
  ask: [],
  recent: [],
  do: [
    { text: 'Attestera fakturor', capability: 'finance.approve', source: 'Ekonomisystemet', kind: 'execute' },
    { text: 'Rapportera avvikelse', capability: 'incidents.report', source: 'Avvikelsesystemet', kind: 'execute' },
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
/** Personal (D94): what the test person, a rektor, manages: their own school and a fritidshem with a co-manager. */
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
          name: 'Erik Nyström',
          userName: 'erik.nystrom',
          email: 'erik.nystrom@clew.test',
          role: 'employee',
          enabled: true,
        },
        {
          id: 'sara',
          name: 'Sara Pettersson',
          userName: 'sara.pettersson',
          email: 'sara.pettersson@clew.test',
          role: 'employee',
          enabled: false,
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
export const usersOverview = (): UsersAdminOverview => ({
  users: [
    {
      id: 'hassan',
      name: 'Hassan Ali',
      userName: 'hassan',
      externalId: 'dev:hassan',
      email: 'hassan@clew.test',
      enabled: true,
      bound: true,
      assignments: [{ unitId: 'unit-omsorg', unitLabel: 'Hemtjänst Centrum', role: 'employee' }],
      active: { unitId: 'unit-omsorg', unitLabel: 'Hemtjänst Centrum', role: 'employee' },
      capabilities: [],
      groups: [{ externalId: 'unit:unit-omsorg', label: 'Hemtjänst Centrum' }],
    },
    {
      id: 'hillevi',
      name: 'Hillevi Berg',
      userName: 'hillevi',
      externalId: 'dev:hillevi',
      email: 'hillevi@clew.test',
      enabled: true,
      bound: true,
      assignments: [{ unitId: 'unit-skola', unitLabel: 'Bergsåkers skola', role: 'manager' }],
      active: { unitId: 'unit-skola', unitLabel: 'Bergsåkers skola', role: 'manager' },
      capabilities: [],
      groups: [
        { externalId: 'unit:unit-skola', label: 'Bergsåkers skola' },
        { externalId: 'unit-manager:unit-skola', label: 'Chefer · Bergsåkers skola' },
        { externalId: 'S-1-5-21-rektorer', label: 'Rektorer' },
      ],
    },
    {
      id: 'mikael',
      name: 'Mikael Lund',
      userName: 'mikael',
      externalId: 'dev:mikael',
      email: 'mikael@clew.test',
      enabled: true,
      bound: false,
      assignments: [{ unitId: 'unit-it', unitLabel: 'IT och digitalisering', role: 'employee' }],
      active: { unitId: 'unit-it', unitLabel: 'IT och digitalisering', role: 'employee' },
      capabilities: ['admin.connectors', 'admin.users'],
      groups: [
        { externalId: 'unit:unit-it', label: 'IT och digitalisering' },
        { externalId: 'S-1-5-21-it-staff', label: 'IT-personal' },
      ],
    },
    {
      id: 'omar',
      name: 'Omar Ny',
      userName: 'omar',
      externalId: 'dev:omar',
      email: 'omar@clew.test',
      enabled: true,
      bound: false,
      assignments: [],
      active: null,
      capabilities: [],
      groups: [],
    },
  ],
  groupCapabilities: [
    { groupExternalId: 'S-1-5-21-it-staff', groupLabel: 'IT-personal', capability: 'admin.connectors' },
  ],
  groups: [
    { id: 'unit:unit-skola', label: 'Bergsåkers skola' },
    { id: 'S-1-5-21-it-staff', label: 'IT-personal' },
    { id: 'S-1-5-21-rektorer', label: 'Rektorer' },
  ],
  capabilities: ['admin.connectors', 'admin.users'],
  provisioners: [
    { id: 'hr', label: 'HR-systemet', lastSeenAt: '2026-11-06T05:00:00.000Z', silent: true },
    { id: 'metakatalogen', label: 'Metakatalogen', lastSeenAt: '2026-11-10T05:02:00.000Z', silent: false },
  ],
});
/** Provisioned groups as the audience editor lists them (D68): the external id is what an audience stores. */
export const groups = [
  { id: 'S-1-5-21-it-staff', label: 'IT-personal' },
  { id: 'S-1-5-21-rektorer', label: 'Rektorer' },
];

/** The shared header (D88) as the suite draws it: Clew's default, no connector behind it. */
export const siteHeader = (): SiteHeaderView => ({
  menu: { version: 1, site: { name: 'Startsidan', href: '/' }, items: [{ id: 'start', label: 'Start', href: '/' }] },
  logo: null,
  source: null,
});
