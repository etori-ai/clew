/**
 * Every key in the browser cache (D33). `queries.ts` builds the reads on these; `thread-cache.ts` writes and invalidates
 * by them, so the two can never drift apart. This file imports nothing: a unit test loads it on its own.
 */
export const keys = {
  threads: ['threads'] as const,
  thread: (id: string) => ['thread', id] as const,
  areas: ['areas'] as const,
  today: ['today'] as const,
  attention: ['attention'] as const,
  figures: ['figures'] as const,
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
  view: (capability: string, input: string | null) => ['view', capability, input] as const,
  cardView: (threadId: string, actionId: string) => ['card-view', threadId, actionId] as const,
  /** The manifest reference (D60): public, the same for everyone, kept for the visit. */
  manifestReference: ['protocol', 'manifest-reference'] as const,
  admin: {
    all: ['admin'] as const,
    connectors: ['admin', 'connectors'] as const,
    connector: (id: string) => ['admin', 'connector', id] as const,
    units: ['admin', 'units'] as const,
    preview: (id: string, role: string) => ['admin', 'preview', id, role] as const,
    models: ['admin', 'models'] as const,
    model: (id: string) => ['admin', 'model', id] as const,
    provider: (id: string) => ['admin', 'provider', id] as const,
    listed: (id: string) => ['admin', 'listed', id] as const,
  },
};
