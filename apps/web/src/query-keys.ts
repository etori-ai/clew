/**
 * Every key in the browser cache (D33). `queries.ts` builds the reads on these; `thread-cache.ts` writes and invalidates
 * by them, so the two can never drift apart. This file imports nothing: a unit test loads it on its own.
 */
export const keys = {
  threads: ['threads'] as const,
  thread: (id: string) => ['thread', id] as const,
  /** A work item's Händelser (D112 item 4), read again whenever the item changes (`version` is its `updatedAt`). */
  itemEvents: (id: string, version: string) => ['item-events', id, version] as const,
  areas: ['areas'] as const,
  today: ['today'] as const,
  attention: ['attention'] as const,
  completions: ['completions'] as const,
  assistant: ['assistant'] as const,
  /** The prefix of every loaded week; invalidated when a thread with proposals changes. */
  calendarAll: ['calendar'] as const,
  calendar: (week: string) => ['calendar', week] as const,
  members: ['calendar-members'] as const,
  rooms: ['calendar-rooms'] as const,
  snoozePresets: ['snooze-presets'] as const,
  verbsAll: ['verbs'] as const,
  verbs: (threadId: string) => ['verbs', threadId] as const,
  viewAll: ['view'] as const,
  document: (request: unknown) => ['document', request] as const,
  previewAll: ['preview'] as const,
  view: (capability: string, input: string | null) => ['view', capability, input] as const,
  cardView: (threadId: string, actionId: string) => ['card-view', threadId, actionId] as const,
  /**
   * The action dialog's reads (D112 item 10): what an action would write for exactly these rows and answers, and the
   * free times and the day for a meeting ask. Reads, never cached across an item's change (`version` is its `updatedAt`).
   */
  actionEffect: (threadId: string, actionId: string, version: string, refs: readonly string[], values: object) =>
    ['action-effect', threadId, actionId, version, refs, values] as const,
  meetingTimes: (capability: string, property: string, before: string | null, date: string | null) =>
    ['meeting-times', capability, property, before, date] as const,
  /** One item's document in the review flow (D70), kept for the visit: the source's document does not change under the person. */
  preview: (threadId: string, ref: string, revision?: string) => ['preview', threadId, ref, revision ?? null] as const,
  /** The manifest reference (D60): public, the same for everyone, kept for the visit. */
  manifestReference: ['protocol', 'manifest-reference'] as const,
  /** The shared header (D88): the person's, kept for the visit. */
  header: ['header'] as const,
  /** The news from every news source the person may read (D112, amended 2026-11-11), Hem's "Nyheter". */
  news: ['news'] as const,
  /** Personal (D94): the manager's units and their people. */
  staff: ['staff'] as const,
  /** Entities (D97): the list per kind, one source's rows over it, one opened entity and one source's section on it. */
  entities: {
    all: ['entities'] as const,
    list: (kind: string) => ['entities', kind, 'list'] as const,
    rows: (kind: string, capability: string) => ['entities', kind, 'rows', capability] as const,
    detail: (kind: string, key: string) => ['entities', kind, 'detail', key] as const,
    section: (kind: string, key: string, capability: string) =>
      ['entities', kind, 'detail', key, 'section', capability] as const,
  },
  /** Kompetens (D108): the catalogue a certificate is registered from, and the administrator's whole catalogue. */
  competenceTypes: ['competence', 'types'] as const,
  competenceCatalogue: ['competence', 'catalogue'] as const,
  competenceAll: ['competence'] as const,
  /** The follow-up dialogue (D118): one unit's dialogue. */
  dialogue: {
    all: ['dialogue'] as const,
    unit: (unitId: string) => ['dialogue', 'unit', unitId] as const,
  },
  /** Utvecklingssamtal (D96): the round, and action points per reader (`null`) or per person (their user name, else id). */
  talks: {
    all: ['talks'] as const,
    round: ['talks', 'round'] as const,
    commitmentsAll: ['talks', 'commitments'] as const,
    commitments: (person?: string) => ['talks', 'commitments', person ?? null] as const,
  },
  admin: {
    all: ['admin'] as const,
    connectors: ['admin', 'connectors'] as const,
    connector: (id: string) => ['admin', 'connector', id] as const,
    units: ['admin', 'units'] as const,
    groups: ['admin', 'groups'] as const,
    users: ['admin', 'users'] as const,
    /** Under `users`, so what invalidates the overview also invalidates every page of the people (D100). */
    usersPage: (query: object) => ['admin', 'users', 'page', query] as const,
    organisation: ['admin', 'organisation'] as const,
    organisationUnit: (unitId: string) => ['admin', 'organisation', 'unit', unitId] as const,
    appearance: ['admin', 'appearance'] as const,
    preview: (id: string, role: string) => ['admin', 'preview', id, role] as const,
    models: ['admin', 'models'] as const,
    model: (id: string) => ['admin', 'model', id] as const,
    provider: (id: string) => ['admin', 'provider', id] as const,
    listed: (id: string) => ['admin', 'listed', id] as const,
  },
};
