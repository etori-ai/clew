import type { ManifestReference } from '@clew/contracts';
import type {
  AddModelInput,
  AddProviderInput,
  ModelDetail,
  ModelPatchInput,
  ModelSummary,
  ProviderDetail,
  ProviderPatchInput,
  ProviderSummary,
  ProviderTestReport,
} from '@clew/contracts';
import type {
  MenuEntry,
  SystemMark,
  PanelViewSpec,
  SnoozeInput,
  SnoozePreset,
  AddConnectorInput,
  Area,
  AssistantStatus,
  Attention,
  AvailabilityInput,
  AvailabilityResult,
  CalendarEvent,
  CalendarMember,
  CalendarRoom,
  CancelEventInput,
  CreateEventInput,
  DayView,
  MoveProposalInput,
  RescheduleEventInput,
  CheckReport,
  ClewObject,
  Completions,
  ConnectorDetail,
  ConnectorHealth,
  ConnectorPatchInput,
  ConnectorPreview,
  ConnectorSummary,
  ConversationEvent,
  ConversationInput,
  ConversationResponse,
  TurnEvent,
  ManifestDiff,
  PreviewOutput,
  Proposal,
  Role,
  Thread,
  TodayView,
  Verb,
} from '@clew/contracts';
import { sessionFetch } from '@clew/ui';
import type { McpDelivery, McpService, McpView, McpResult } from '@clew/contracts';

import { ApiError } from './api-error';
export { ApiError };

/** Every call goes through the same-origin proxy with the session CSRF token. Errors carry the server's Swedish message. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(response.status, 'Tjänsten svarade oväntat.');
  }
  if (!response.ok) throw new ApiError(response.status, (data as { error?: string }).error ?? 'Något gick fel.');
  return data as T;
}
/**
 * A conversation turn as it runs (D36): `POST /api/conversation/stream` answers with server-sent events, read here from
 * the response body. Each step and text delta goes to `onEvent`; the finished turn resolves, the server's Swedish error
 * rejects as an ApiError, and `signal` is Stoppa (the fetch aborts, the server stops the turn and writes nothing).
 */
async function converseStream(
  input: ConversationInput,
  onEvent: (event: TurnEvent) => void,
  signal?: AbortSignal,
): Promise<ConversationResponse> {
  const response = await sessionFetch('/api/conversation/stream', {
    method: 'POST',
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok || !response.body) {
    let message = 'Något gick fel.';
    try {
      message = ((await response.json()) as { error?: string }).error ?? message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(response.status, message);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value.replace(/\r\n/g, '\n');
    for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
      const data = buffer
        .slice(0, end)
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, ''))
        .join('\n');
      buffer = buffer.slice(end + 2);
      if (!data) continue;
      let event: ConversationEvent;
      try {
        event = JSON.parse(data) as ConversationEvent;
      } catch {
        throw new ApiError(502, 'Tjänsten svarade oväntat.');
      }
      if (event.type === 'done') {
        void reader.cancel();
        return event.response;
      }
      if (event.type === 'error') {
        void reader.cancel();
        throw new ApiError(400, event.message);
      }
      onEvent(event);
    }
  }
  throw new ApiError(502, 'Svaret bröts innan det var klart. Försök igen.');
}
const post = <T>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
const patch = <T>(path: string, body: unknown) => call<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T>(path: string) => call<T>(path, { method: 'DELETE' });
export const api = {
  chatServices: () => call<{ services: McpService[]; deliveries: McpDelivery[] }>('/api/chat-services'),
  chatService: (id: string, deliveryId?: string) =>
    call<McpView>(
      '/api/chat-services/' +
        encodeURIComponent(id) +
        (deliveryId ? '?delivery=' + encodeURIComponent(deliveryId) : ''),
    ),
  decideService: (id: string, input: { decisionId: string; name: string; arguments: Record<string, unknown> }) =>
    call<McpResult>('/api/chat-services/' + encodeURIComponent(id) + '/decisions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** The manifest field by field (D60): a public document, read with the plain fetch since no session or token belongs on it. */
  manifestReference: async () => {
    const response = await fetch('/api/protocol/manifest-reference.json');
    if (!response.ok) throw new ApiError(response.status, 'The reference could not be read.');
    return response.json() as Promise<ManifestReference>;
  },
  threads: () =>
    call<{
      threads: Thread[];
      sources?: Array<{ connector: string; state: string; lastSuccess: string | null; error: string | null }>;
      deliveries?: Array<{ id: string; threadId: string; kind: 'automatic' | 'reminder' }>;
    }>('/api/threads'),
  claimDelivery: (id: string) => post<{ claimed: boolean }>(`/api/deliveries/${encodeURIComponent(id)}/claim`, {}),
  ask: (question: string) => post<Thread>('/api/ask', { question }),
  reply: (id: string, body: string) => post<Thread>(`/api/threads/${id}/reply`, { body }),
  confirm: (id: string, proposalIds: string[]) => post<Thread>(`/api/threads/${id}/confirm`, { proposalIds }),
  undo: (id: string) => post<Thread>(`/api/threads/${id}/undo`),
  replan: (id: string, week: string) => post<Thread>(`/api/threads/${id}/replan`, { week }),
  dismiss: (id: string) => post<Thread>(`/api/threads/${id}/dismiss`),
  completions: () => call<Completions>('/api/completions'),
  thread: (id: string) => call<Thread>(`/api/threads/${id}`),
  converse: (input: ConversationInput) => post<ConversationResponse>('/api/conversation', input),
  converseStream,
  objects: (q: string, near: string[] = []) =>
    call<{ objects: ClewObject[] }>(
      '/api/objects?q=' + encodeURIComponent(q) + (near.length ? '&near=' + encodeURIComponent(near.join(',')) : ''),
    ),
  verbs: (id: string) => call<{ verbs: Verb[] }>(`/api/threads/${id}/verbs`),
  reopen: (id: string) => post<Thread>(`/api/threads/${id}/reopen`),
  assistantStatus: () => call<AssistantStatus>('/api/assistant/status'),
  /** The person's own model in the composer (D24); null goes back to the default. */
  chooseModel: (modelId: string | null) => patch<AssistantStatus>('/api/assistant/model', { modelId }),
  today: () => call<TodayView>('/api/today'),
  attention: () => call<Attention>('/api/attention'),
  areas: () => call<{ areas: Area[]; menu?: MenuEntry[]; systems?: SystemMark[] }>('/api/areas'),
  connectors: () => call<{ connectors: unknown[]; tools: string[] }>('/api/connectors'),
  act: (id: string, actionId: string, refs?: string[]) =>
    post<{ kind: 'execute'; thread: Thread } | { kind: 'read' | 'propose'; output: unknown; view?: PanelViewSpec }>(
      `/api/threads/${id}/act`,
      { actionId, refs },
    ),
  undoReceipt: (id: string) => post<Thread>(`/api/threads/${id}/undo-receipt`),
  /** One item's document for the review flow (D70). */
  preview: (id: string, ref: string) =>
    call<PreviewOutput>(`/api/threads/${id}/preview?ref=${encodeURIComponent(ref)}`),
  checkExecution: (id: string) => post<Thread>(`/api/threads/${id}/execution/check`),
  snooze: (id: string, input: SnoozeInput = {}) => post<Thread>(`/api/threads/${id}/snooze`, input),
  snoozePresets: () => call<{ presets: SnoozePreset[] }>('/api/snooze/presets'),
  remindInvitees: (id: string) => post<Thread>(`/api/threads/${id}/remind-invitees`),
  remind: (id: string, seconds: number) =>
    post<{ id: string; fireAt: string; thread: Thread }>(`/api/threads/${id}/remind`, { seconds }),
  cancelReminder: (id: string, workflowId: string) => post<Thread>(`/api/threads/${id}/remind/cancel`, { workflowId }),
  capability: (name: string, input?: unknown) =>
    call<{ output: unknown; source?: string; view?: PanelViewSpec }>(
      `/api/cap/${name}` + (input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : ''),
    ),
  runCapability: (name: string, input?: unknown) => post<{ output: unknown }>(`/api/cap/${name}`, input ?? {}),
  // Administration (D23). Every call is checked again on the server; no secret ever comes back.
  admin: {
    connectors: () => call<{ connectors: ConnectorSummary[] }>('/api/admin/connectors'),
    units: () => call<{ units: Array<{ id: string; label: string }> }>('/api/admin/units'),
    connector: (id: string) => call<ConnectorDetail>(`/api/admin/connectors/${id}`),
    add: (input: AddConnectorInput) =>
      post<{ connector: ConnectorDetail; report: CheckReport }>('/api/admin/connectors', input),
    update: (id: string, input: ConnectorPatchInput) => patch<ConnectorDetail>(`/api/admin/connectors/${id}`, input),
    remove: (id: string) => del<{ closedCards: number }>(`/api/admin/connectors/${id}`),
    rotateSecret: (id: string, secret: string) =>
      post<ConnectorDetail>(`/api/admin/connectors/${id}/secret`, { secret }),
    test: (id: string) => post<CheckReport & { health: ConnectorHealth }>(`/api/admin/connectors/${id}/test`),
    refresh: (id: string, apply: boolean) =>
      post<{ diff: ManifestDiff; connector: ConnectorDetail }>(`/api/admin/connectors/${id}/refresh`, { apply }),
    preview: (id: string, role: Role, unitId?: string) =>
      call<ConnectorPreview>(
        `/api/admin/connectors/${id}/preview?role=${role}` + (unitId ? `&unitId=${encodeURIComponent(unitId)}` : ''),
      ),
    // Modeller (D24): providers and the models under them. A key goes in, never comes out.
    models: () => call<{ providers: ProviderSummary[]; models: ModelSummary[] }>('/api/admin/models'),
    model: (id: string) => call<ModelDetail>(`/api/admin/models/${id}`),
    addModel: (input: AddModelInput) => post<ModelDetail>('/api/admin/models', input),
    updateModel: (id: string, input: ModelPatchInput) => patch<ModelDetail>(`/api/admin/models/${id}`, input),
    removeModel: (id: string) => del<{ removed: true }>(`/api/admin/models/${id}`),
    testModel: (id: string) => post<ProviderTestReport>(`/api/admin/models/${id}/test`),
    provider: (id: string) => call<ProviderDetail>(`/api/admin/providers/${id}`),
    addProvider: (input: AddProviderInput) =>
      post<{ provider: ProviderDetail; report: ProviderTestReport }>('/api/admin/providers', input),
    updateProvider: (id: string, input: ProviderPatchInput) =>
      patch<ProviderDetail>(`/api/admin/providers/${id}`, input),
    removeProvider: (id: string) => del<{ removed: true }>(`/api/admin/providers/${id}`),
    providerKey: (id: string, apiKey: string) => post<ProviderDetail>(`/api/admin/providers/${id}/key`, { apiKey }),
    testProvider: (id: string) => post<ProviderTestReport>(`/api/admin/providers/${id}/test`),
  },
  calendar: (from?: string) =>
    call<{ from: string; events: CalendarEvent[]; proposals: Proposal[] }>(
      '/api/calendar' + (from ? `?from=${from}` : ''),
    ),
  // A person's own bookings and proposal moves (D28). The day view is a read capability, so the side panel reaches it the same way as any view.
  calendarDay: (date: string) =>
    call<{ output: DayView }>(`/api/cap/calendar.day?input=${encodeURIComponent(JSON.stringify({ date }))}`).then(
      r => r.output,
    ),
  members: () => call<{ members: CalendarMember[] }>('/api/calendar/members'),
  rooms: () => call<{ rooms: CalendarRoom[] }>('/api/calendar/rooms'),
  availability: (input: AvailabilityInput) => post<AvailabilityResult>('/api/calendar/availability', input),
  createEvent: (input: CreateEventInput) => post<Thread>('/api/calendar/events', input),
  rescheduleEvent: (input: RescheduleEventInput) => post<Thread>('/api/calendar/events/reschedule', input),
  cancelEvent: (input: CancelEventInput) => post<Thread>('/api/calendar/events/cancel', input),
  moveProposal: (threadId: string, proposalId: string, input: MoveProposalInput) =>
    post<Thread>(`/api/threads/${threadId}/proposals/${proposalId}/move`, input),
};
