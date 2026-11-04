import type { Area, Attention, CalendarEvent, ConversationResponse, Proposal, SessionUser, Thread, TodayView } from '@clew/contracts';

/** Synthetic data, typed against the contracts so the suite follows the API. The clock is frozen to this Wednesday. */
export const NOW = '2026-11-04T08:00:00.000Z';
export const WEEK = '2026-11-02';
export const NEXT_WEEK = '2026-11-09';

export const user: SessionUser = { id: 'testperson', name: 'Testa Testsson', unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'manager' };

const thread = (values: Partial<Thread> & Pick<Thread, 'id' | 'title'>): Thread => ({
  kind: 'pushed', topic: values.id, state: 'open', trigger: { reason: 'Fakturorna förfaller i veckan', source: 'Raindance', at: NOW },
  createdAt: NOW, updatedAt: NOW, handledAt: null, messages: [], proposals: [], week: null, connector: 'raindance', area: 'budget',
  summary: 'Alla matchar sina beställningar och ryms i budgeten.', items: [], actions: [], waitingOn: null, deadline: null, receipt: null, remindedAt: null,
  ...values,
});
const proposal = (id: string, day: string, name: string): Proposal => ({
  id, threadId: 'samtal', status: 'proposed', start: `${day}T09:00:00.000Z`, end: `${day}T09:45:00.000Z`,
  participant: { name, email: `${id}@clew.test` }, eventRef: null, undoUntil: null,
});
export const threads = (): Thread[] => [
  thread({ id: 'fakturor', title: 'Attestera 3 fakturor, 48 200 kr', deadline: '2026-11-05',
    items: [
      { ref: 'raindance:inv:1', label: 'Sundsvalls Energi AB · 21 400 kr', detail: 'Konto 4010 · förfaller 5 nov · beställning 88213', selectable: true, selected: true },
      { ref: 'raindance:inv:2', label: 'Skolmaterial Norrland AB · 18 300 kr', detail: 'Konto 4410 · förfaller 6 nov · beställning 88240', selectable: true, selected: true },
      { ref: 'raindance:inv:3', label: 'Städservice Mitt AB · 8 500 kr', detail: 'Konto 4630 · förfaller 6 nov · saknar beställning', selectable: true, selected: false },
    ],
    actions: [
      { id: 'approve', label: 'Attestera', capability: 'raindance.approve', kind: 'execute', role: 'primary', usesItems: true },
      { id: 'open', label: 'Öppna i Raindance', capability: 'raindance.open', kind: 'read', role: 'secondary', target: 'link' },
    ] }),
  thread({ id: 'omtanke', title: 'Omtankesamtal med Anna Lindqvist', topic: 'omtanke', connector: 'heroma', area: 'personal', deadline: '2026-11-13',
    trigger: { reason: 'Tre sjukperioder på sex månader', source: 'Heroma', at: NOW }, summary: 'Tre korta sjukperioder sedan juni. Samtalet bör bokas före den 13 november.',
    actions: [
      { id: 'book', label: 'Boka samtalet', capability: 'heroma.bookTalk', kind: 'execute', role: 'primary' },
      { id: 'pattern', label: 'Se mönstret', capability: 'heroma.absencePattern', kind: 'read', role: 'secondary', target: 'panel' },
    ] }),
  thread({ id: 'ledighet', title: 'Ledighetsansökan från Johan Byström', topic: 'ledighet', connector: 'heroma', area: 'personal', deadline: '2026-11-20',
    trigger: { reason: 'Ansökan väntar på beslut', source: 'Heroma', at: NOW }, summary: 'Två dagar före jul. Ingen krock i schemat.',
    actions: [{ id: 'decide', label: 'Godkänn', capability: 'heroma.decideLeave', kind: 'execute', role: 'primary' }] }),
  thread({ id: 'samtal', title: 'Planera utvecklingssamtal', topic: 'utvecklingssamtal', connector: 'calendar', area: 'kalender', deadline: '2026-11-27', week: NEXT_WEEK,
    trigger: { reason: 'Samtalen ska vara klara i november', source: 'Kalendern', at: NOW },
    messages: [{ id: 'm1', role: 'assistant', body: 'Jag har ritat in två samtal nästa vecka. Båda ligger utanför lektionstid.', createdAt: NOW }],
    proposals: [proposal('p1', '2026-11-10', 'Anna Lindqvist'), proposal('p2', '2026-11-12', 'Erik Sandström')] }),
  thread({ id: 'introduktion', title: 'Introduktion av ny medarbetare', topic: 'introduktion', connector: 'heroma', area: 'personal', deadline: '2026-12-20',
    trigger: { reason: 'Ny medarbetare börjar i januari', source: 'Heroma', at: NOW }, summary: 'Mentor och schema ska vara klara före jul.' }),
  thread({ id: 'rutin', title: 'Ny rutin för läkemedelshantering', topic: 'rutin', connector: 'kommunikation', area: 'viktigt-nu',
    trigger: { reason: 'Nytt meddelande från förvaltningen', source: 'Kommunikation', at: NOW }, summary: 'Gäller från den 1 december.',
    actions: [{ id: 'ack', label: 'Jag har läst', capability: 'kommunikation.acknowledge', kind: 'execute', role: 'primary' }] }),
  thread({ id: 'tillbud', title: 'Tillbud 2026-1182, halkolycka i duschen', topic: 'tillbud', connector: 'treserva', area: 'kvalitet', waitingOn: 'skyddsombudet', deadline: '2026-11-12',
    trigger: { reason: 'Väntar på skyddsombudet', source: 'Treserva', at: NOW }, summary: 'Skyddsombudet har fått ärendet.' }),
  thread({ id: 'attest', title: 'Attesterade fakturor', topic: 'attest', state: 'handled', handledAt: NOW,
    receipt: { at: NOW, headline: '2 fakturor attesterade', undoUntil: '2026-11-04T08:10:00.000Z', undoCapability: 'raindance.unapprove',
      rows: [
        { ref: 'raindance:inv:7', label: 'Kontorsvaror AB', outcome: 'done', detail: 'Läst tillbaka från Raindance' },
        { ref: 'raindance:inv:8', label: 'IT-partner AB', outcome: 'unknown', detail: 'Väntar på svar från Raindance' },
      ] } }),
  thread({ id: 'avfardad', title: 'Påminnelse om brandskyddsrond', topic: 'brand', state: 'dismissed', handledAt: NOW, connector: 'kommunikation', area: 'viktigt-nu' }),
  thread({ id: 'fraga', title: 'Vem är på plats i dag?', topic: 'fraga', kind: 'question', state: 'handled', handledAt: NOW, connector: 'startsidan', area: 'fragor',
    messages: [{ id: 'q1', role: 'user', body: 'Vem är på plats i dag?', createdAt: NOW }, { id: 'q2', role: 'assistant', body: 'Tio personer är på plats.', createdAt: NOW }] }),
];

const area = (id: string, title: string, values: Partial<Area> = {}): Area => ({ id, title, connector: id, source: 'Heroma', figure: null, needsYou: 0, waiting: 0, urgency: null, standing: [], schedules: [], ...values });
export const areas: Area[] = [
  area('viktigt-nu', 'Viktigt nu', { source: 'Kommunikation', needsYou: 1, urgency: 'notice' }),
  area('kalender', 'Kalender', { source: 'Kalendern', needsYou: 1, urgency: 'soon', schedules: [{ label: 'Bevakar utvecklingssamtalen', when: 'Måndagar 06:00' }] }),
  area('personal', 'Personal', { figure: { label: 'Korttidsfrånvaro 4,2 %', tone: 'warn' }, needsYou: 2, urgency: 'soon',
    standing: [{ capability: 'heroma.whoIsOn', label: 'Vem är på plats?', kind: 'read' }, { capability: 'heroma.absenceOverview', label: 'Frånvaro per person', kind: 'read' }],
    schedules: [{ label: 'Läser frånvaron', when: 'Varje morgon 06:00' }] }),
  area('budget', 'Budget', { source: 'Raindance', figure: { label: 'Prognos +1,8 %', tone: 'ok' }, needsYou: 1, urgency: 'urgent', standing: [{ capability: 'raindance.budget', label: 'Budget mot prognos', kind: 'read' }] }),
  area('kvalitet', 'Kvalitet', { source: 'Treserva', waiting: 1 }),
];
/** The budget is spent: the header's badge carries its longest sentence, which is the widest thing in the header. */
export const attention: Attention = { used: 3, budget: 3, bundledUntil: 'i morgon 06:00' };
export const today: TodayView = {
  date: '2026-11-04',
  events: [{ id: 'e1', title: 'Rektorsmöte', start: '2026-11-04T08:30:00.000Z', end: '2026-11-04T09:30:00.000Z', allDay: false, mine: true, room: 'A12', participants: [] }],
  gaps: [{ start: '2026-11-04T09:30:00.000Z', end: '2026-11-04T11:00:00.000Z' }],
};
/** A meeting every weekday: a filled week is what pushes the columns past the screen. */
export const events = (from: string): CalendarEvent[] => [0, 1, 2, 3, 4].map(offset => {
  const day = new Date(Date.parse(from) + offset * 86_400_000).toISOString().slice(0, 10);
  return { id: `v${offset}`, title: 'Morgonmöte ledningsgrupp', start: `${day}T07:15:00.000Z`, end: `${day}T07:45:00.000Z`, allDay: false, mine: true, room: 'A12', participants: ['Mona Berg', 'Per Lindahl'] };
});

export const conversation = (source: Thread[], text: string, conversationId = 'konversation'): ConversationResponse => {
  const body = 'Tio personer är på plats i dag. Sara Nyström är sjuk.';
  const previous = source.find(t => t.id === conversationId)?.messages ?? [];
  const reply = thread({ id: conversationId, title: 'Vem är på plats i dag?', kind: 'question', connector: 'startsidan', area: 'fragor',
    messages: [...previous, { id: `u${previous.length}`, role: 'user', body: text, createdAt: NOW }, { id: `a${previous.length}`, role: 'assistant', body, createdAt: NOW, meta: { source: 'Heroma' } }] });
  return { conversationId, thread: reply, shape: 'svar', assistant: 'router', answer: { body, source: 'Heroma', at: NOW }, clewActions: [], followUps: ['Vem är sjuk i morgon?'] };
};
