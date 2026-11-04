import type { Area, AssistantStatus, Attention, CalendarEvent, ClewObject, Completions, ConversationInput, ConversationResponse, Figure, Proposal, Thread, TodayView, Verb } from '@clew/contracts';
import { sessionFetch } from '@clew/ui';

/** Every call goes through the same-origin proxy with the session CSRF token. Errors carry the server's Swedish message. */
export class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; this.name = 'ApiError'; } }
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const text = await response.text();
  let data: unknown; try { data = text ? JSON.parse(text) : {}; } catch { throw new ApiError(response.status, 'Tjänsten svarade oväntat.'); }
  if (!response.ok) throw new ApiError(response.status, (data as { error?: string }).error ?? 'Något gick fel.');
  return data as T;
}
const post = <T,>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
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
  snooze: (id: string) => post<Thread>(`/api/threads/${id}/snooze`),
  remind: (id: string, seconds: number) => post<{ id: string; fireAt: string; thread: Thread }>(`/api/threads/${id}/remind`, { seconds }),
  cancelReminder: (id: string, workflowId: string) => post<Thread>(`/api/threads/${id}/remind/cancel`, { workflowId }),
  capability: (name: string, input?: unknown) => call<{ output: unknown }>(`/api/cap/${name}` + (input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '')),
  runCapability: (name: string, input?: unknown) => post<{ output: unknown }>(`/api/cap/${name}`, input ?? {}),
  calendar: (from?: string) => call<{ from: string; events: CalendarEvent[]; proposals: Proposal[] }>('/api/calendar' + (from ? `?from=${from}` : '')),
};
