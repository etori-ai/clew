import type { Attention, CalendarEvent, Figure, Proposal, Thread, TodayView } from '@clew/contracts';
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
  completions: () => call<{ completions: string[] }>('/api/completions'),
  today: () => call<TodayView>('/api/today'),
  figures: () => call<{ figures: Figure[] }>('/api/figures'),
  attention: () => call<Attention>('/api/attention'),
  calendar: (from?: string) => call<{ from: string; events: CalendarEvent[]; proposals: Proposal[] }>('/api/calendar' + (from ? `?from=${from}` : '')),
};
