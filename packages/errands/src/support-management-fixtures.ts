/** Synthetic subset of SupportManagement's source model, not a generated API client or a full API mock. */
export interface SupportManagementErrand {
  id: string; errandNumber: string; title: string; description: string;
  status: 'NEW' | 'ONGOING' | 'SOLVED';
  classification: { category: 'INTERNAL_SUPPORT'; type: 'PREMISES' | 'IT' };
  reporterUserId: string; assignedUserId: string;
  phases: Array<{ name: 'HANDLING' | 'WAITING' | 'DONE'; displayName: string; ended: string | null }>;
  suspension: { suspendedFrom: string; suspendedTo: string } | null;
  version: number;
}
export interface SupportManagementFixture {
  errand: SupportManagementErrand;
  /** These are separate sub-resource reads, not fields on GET /errands/{id}. */
  investigations: Array<{ id: string; dueAt: string; completedAt: string | null }>;
  communication: Array<{ channel: 'WEBMESSAGE'; direction: 'INBOUND' | 'OUTBOUND'; message: string; sent: string }>;
  /** Handler notifications and reporter subscription events have different owners in the source. */
  notifications: Array<{ id: string; ownerId: string; subType: 'MESSAGE' | 'INVESTIGATION'; created: string }>;
  subscriberEvents: Array<{ id: string; subscriberId: string; subType: 'MESSAGE'; created: string }>;
}

export const supportManagementMetadata = {
  statuses: {
    NEW: { label: 'Nytt', closed: false },
    ONGOING: { label: 'Pågående', closed: false },
    SOLVED: { label: 'Löst', closed: true },
  },
  phases: { HANDLING: 'Handläggning', WAITING: 'Inväntar återkoppling', DONE: 'Avslutat' },
  categories: { INTERNAL_SUPPORT: 'Intern service' },
  types: { PREMISES: 'Lokaler', IT: 'IT-support' },
};

/** Each demo persona has an assigned errand and a reported errand. No live account is implied. */
export const supportManagementFixtures: readonly SupportManagementFixture[] = [
  {
    errand: {
      id: 'b82bd8ac-0000-4000-8000-000000000001', errandNumber: 'KC-26110001',
      title: 'Kontrollera ventilationen i arbetsrummet',
      description: 'Exempeldata: arbetsrummet blir varmt under eftermiddagen. En kontroll av ventilationen är beställd.',
      status: 'ONGOING', classification: { category: 'INTERNAL_SUPPORT', type: 'PREMISES' },
      reporterUserId: 'demo-facilities', assignedUserId: 'demo-hillevi',
      phases: [
        { name: 'WAITING', displayName: supportManagementMetadata.phases.WAITING, ended: '2026-11-04T08:00:00+01:00' },
        { name: 'HANDLING', displayName: supportManagementMetadata.phases.HANDLING, ended: null },
      ], suspension: null,
      version: 3,
    },
    investigations: [{ id: 'ventilation', dueAt: '2026-11-06T15:00:00+01:00', completedAt: null }],
    communication: [{ channel: 'WEBMESSAGE', direction: 'INBOUND', message: 'Kan kontrollen genomföras innan veckans slut?', sent: '2026-11-04T08:15:00+01:00' }],
    notifications: [{ id: 'sm-notification-1', ownerId: 'demo-hillevi', subType: 'INVESTIGATION', created: '2026-11-04T08:15:00+01:00' }],
    subscriberEvents: [],
  },
  {
    errand: {
      id: 'b82bd8ac-0000-4000-8000-000000000002', errandNumber: 'KC-26110002',
      title: 'Beställning av extra bildskärm',
      description: 'Exempeldata: en extra bildskärm har beställts till arbetsplatsen. IT-support inväntar leveransbesked.',
      status: 'ONGOING', classification: { category: 'INTERNAL_SUPPORT', type: 'IT' },
      reporterUserId: 'demo-hillevi', assignedUserId: 'demo-it-support',
      phases: [{ name: 'WAITING', displayName: supportManagementMetadata.phases.WAITING, ended: null }],
      suspension: { suspendedFrom: '2026-11-03T09:00:00+01:00', suspendedTo: '2026-11-10T09:00:00+01:00' },
      version: 2,
    },
    investigations: [], communication: [],
    notifications: [], subscriberEvents: [],
  },
  {
    errand: {
      id: 'b82bd8ac-0000-4000-8000-000000000003', errandNumber: 'KC-26110003',
      title: 'Komplettera uppgifter om nyckelbeställningen',
      description: 'Exempeldata: intern service behöver veta vilken entré nyckeln ska fungera till.',
      status: 'NEW', classification: { category: 'INTERNAL_SUPPORT', type: 'PREMISES' },
      reporterUserId: 'demo-facilities', assignedUserId: 'demo-hassan',
      phases: [{ name: 'HANDLING', displayName: supportManagementMetadata.phases.HANDLING, ended: null }], suspension: null,
      version: 1,
    },
    investigations: [],
    communication: [{ channel: 'WEBMESSAGE', direction: 'INBOUND', message: 'Vilken entré gäller beställningen?', sent: '2026-11-04T08:30:00+01:00' }],
    notifications: [{ id: 'sm-notification-3', ownerId: 'demo-hassan', subType: 'MESSAGE', created: '2026-11-04T08:30:00+01:00' }],
    subscriberEvents: [],
  },
  {
    errand: {
      id: 'b82bd8ac-0000-4000-8000-000000000004', errandNumber: 'KC-26110004',
      title: 'Återställning av skrivaren i personalrummet',
      description: 'Exempeldata: skrivaren tappade nätverksanslutningen och har nu anslutits igen.',
      status: 'SOLVED', classification: { category: 'INTERNAL_SUPPORT', type: 'IT' },
      reporterUserId: 'demo-hassan', assignedUserId: 'demo-it-support',
      phases: [{ name: 'DONE', displayName: supportManagementMetadata.phases.DONE, ended: null }], suspension: null,
      version: 4,
    },
    investigations: [],
    communication: [{ channel: 'WEBMESSAGE', direction: 'OUTBOUND', message: 'Skrivaren fungerar igen. Prova gärna att skriva ut.', sent: '2026-11-04T08:45:00+01:00' }],
    notifications: [],
    subscriberEvents: [{ id: 'sm-subscription-event-4', subscriberId: 'demo-hassan', subType: 'MESSAGE', created: '2026-11-04T08:45:00+01:00' }],
  },
];
