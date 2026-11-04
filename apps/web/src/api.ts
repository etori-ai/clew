import type { SnoozeInput, SnoozePreset, AddConnectorInput, Area, AssistantStatus, Attention, AvailabilityInput, AvailabilityResult, CalendarEvent, CalendarMember, CalendarRoom, CancelEventInput, CreateEventInput, DayView, MoveProposalInput, RescheduleEventInput, CheckReport, ClewObject, Completions, ConnectorDetail, ConnectorHealth, ConnectorPatchInput, ConnectorPreview, ConnectorSummary, ConversationInput, ConversationResponse, Figure, ManifestDiff, Proposal, Role, Thread, TodayView, Verb } from '@clew/contracts';
import { sessionFetch } from '@clew/ui';

import { ApiError } from './api-error';
export { ApiError };

/** Every call goes through the same-origin proxy with the session CSRF token. Errors carry the server's Swedish message. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const text = await response.text();
  let data: unknown; try { data = text ? JSON.parse(text) : {}; } catch { throw new ApiError(response.status, 'Tjänsten svarade oväntat.'); }
  if (!response.ok) throw new ApiError(response.status, (data as { error?: string }).error ?? 'Något gick fel.');
  return data as T;
}
const post = <T,>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
const patch = <T,>(path: string, body: unknown) => call<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T,>(path: string) => call<T>(path, { method: 'DELETE' });
export const api = {
  threads: () => call<{ threads: Thread[] }>('/api/threads'),
  ask: (question: string) => post<Thread>('/api/ask', { question }),
  reply: (id: string, body: string) => post<Thread>(`/api/threads/${id}/reply`, { body }),
  confirm: (id: string, proposalIds: string[]) => post<Thread>(`/api/threads/${id}/confirm`, { proposalIds }),
  undo: (id: string) => post<Thread>(`/api/threads/${id}/undo`),
  replan: (id: string, week: string) => post<Thread>(`/api/threads/${id}/replan`, { week }),
  dismiss: (id: string) => post<Thread>(`/api/threads/${id}/dismiss`),
  completions: () => call<Completions>('/api/completions'),
  thread: (id: string) => call<Thread>(`/api/threads/${id}`),
  converse: (input: ConversationInput) => post<ConversationResponse>('/api/conversation', input),
  objects: (q: string) => call<{ objects: ClewObject[] }>('/api/objects?q=' + encodeURIComponent(q)),
  verbs: (id: string) => call<{ verbs: Verb[] }>(`/api/threads/${id}/verbs`),
  reopen: (id: string) => post<Thread>(`/api/threads/${id}/reopen`),
  assistantStatus: () => call<AssistantStatus>('/api/assistant/status'),
  today: () => call<TodayView>('/api/today'),
  figures: () => call<{ figures: Figure[] }>('/api/figures'),
  attention: () => call<Attention>('/api/attention'),
  areas: () => call<{ areas: Area[] }>('/api/areas'),
  connectors: () => call<{ connectors: unknown[]; tools: string[] }>('/api/connectors'),
  act: (id: string, actionId: string, refs?: string[]) => post<{ kind: 'execute'; thread: Thread } | { kind: 'read' | 'propose'; output: unknown }>(`/api/threads/${id}/act`, { actionId, refs }),
  undoReceipt: (id: string) => post<Thread>(`/api/threads/${id}/undo-receipt`),
  snooze: (id: string, input: SnoozeInput = {}) => post<Thread>(`/api/threads/${id}/snooze`, input),
  snoozePresets: () => call<{ presets: SnoozePreset[] }>('/api/snooze/presets'),
  remindInvitees: (id: string) => post<Thread>(`/api/threads/${id}/remind-invitees`),
  remind: (id: string, seconds: number) => post<{ id: string; fireAt: string; thread: Thread }>(`/api/threads/${id}/remind`, { seconds }),
  cancelReminder: (id: string, workflowId: string) => post<Thread>(`/api/threads/${id}/remind/cancel`, { workflowId }),
  capability: (name: string, input?: unknown) => call<{ output: unknown }>(`/api/cap/${name}` + (input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '')),
  runCapability: (name: string, input?: unknown) => post<{ output: unknown }>(`/api/cap/${name}`, input ?? {}),
  // Administration (D23). Every call is checked again on the server; no secret ever comes back.
  admin: {
    connectors: () => call<{ connectors: ConnectorSummary[] }>('/api/admin/connectors'),
    units: () => call<{ units: Array<{ id: string; label: string }> }>('/api/admin/units'),
    connector: (id: string) => call<ConnectorDetail>(`/api/admin/connectors/${id}`),
    add: (input: AddConnectorInput) => post<{ connector: ConnectorDetail; report: CheckReport }>('/api/admin/connectors', input),
    update: (id: string, input: ConnectorPatchInput) => patch<ConnectorDetail>(`/api/admin/connectors/${id}`, input),
    remove: (id: string) => del<{ closedCards: number }>(`/api/admin/connectors/${id}`),
    rotateSecret: (id: string, secret: string) => post<ConnectorDetail>(`/api/admin/connectors/${id}/secret`, { secret }),
    test: (id: string) => post<CheckReport & { health: ConnectorHealth }>(`/api/admin/connectors/${id}/test`),
    refresh: (id: string, apply: boolean) => post<{ diff: ManifestDiff; connector: ConnectorDetail }>(`/api/admin/connectors/${id}/refresh`, { apply }),
    preview: (id: string, role: Role, unitId?: string) => call<ConnectorPreview>(`/api/admin/connectors/${id}/preview?role=${role}` + (unitId ? `&unitId=${encodeURIComponent(unitId)}` : '')),
  },
  calendar: (from?: string) => call<{ from: string; events: CalendarEvent[]; proposals: Proposal[] }>('/api/calendar' + (from ? `?from=${from}` : '')),
  // A person's own bookings and proposal moves (D28). The day view is a read capability, so the side panel reaches it the same way as any view.
  calendarDay: (date: string) => call<{ output: DayView }>(`/api/cap/calendar.day?input=${encodeURIComponent(JSON.stringify({ date }))}`).then(r => r.output),
  members: () => call<{ members: CalendarMember[] }>('/api/calendar/members'),
  rooms: () => call<{ rooms: CalendarRoom[] }>('/api/calendar/rooms'),
  availability: (input: AvailabilityInput) => post<AvailabilityResult>('/api/calendar/availability', input),
  createEvent: (input: CreateEventInput) => post<{ event: CalendarEvent }>('/api/calendar/events', input).then(r => r.event),
  rescheduleEvent: (input: RescheduleEventInput) => post<{ event: CalendarEvent }>('/api/calendar/events/reschedule', input).then(r => r.event),
  cancelEvent: (input: CancelEventInput) => post<{ cancelled: true }>('/api/calendar/events/cancel', input),
  moveProposal: (threadId: string, proposalId: string, input: MoveProposalInput) => post<Thread>(`/api/threads/${threadId}/proposals/${proposalId}/move`, input),
};
