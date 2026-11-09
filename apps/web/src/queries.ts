import { queryOptions } from '@tanstack/react-query';
import type { Role, DocumentRequest } from '@clew/contracts';
import { api } from './api';
import { keys } from './query-keys';

/**
 * Every read the browser makes, as query options (D33): the key from `query-keys.ts`, the call from `api.ts`, and the
 * one policy that differs from the client's defaults. A screen spreads these into `useQuery`; a mutation that returns a
 * Thread writes the cache through `thread-cache.ts` instead of reloading a page.
 */
export const threadsQuery = queryOptions({ queryKey: keys.threads, queryFn: () => api.threads() });
export const threadQuery = (id: string) => queryOptions({ queryKey: keys.thread(id), queryFn: () => api.thread(id) });
export const areasQuery = queryOptions({ queryKey: keys.areas, queryFn: () => api.areas() });
/** Personal (D94): the people on the units the manager manages; a 403 is the page's own state, not retried. */
export const staffQuery = queryOptions({ queryKey: keys.staff, queryFn: () => api.staff(), retry: false });
/** The day and the model's status are extras on the page: a failure is tolerated, never retried, never shown as the page's error. */
export const todayQuery = queryOptions({ queryKey: keys.today, queryFn: () => api.today(), retry: false });
export const attentionQuery = queryOptions({ queryKey: keys.attention, queryFn: () => api.attention() });
/** What the box offers (D34): the standing actions for the role and the recent conversations, kept a minute. */
export const completionsQuery = queryOptions({
  queryKey: keys.completions,
  queryFn: () => api.completions(),
  staleTime: 60_000,
  retry: false,
});
export const assistantQuery = queryOptions({
  queryKey: keys.assistant,
  queryFn: () => api.assistantStatus(),
  retry: false,
});
export const chatServicesQuery = queryOptions({
  queryKey: keys.chatServices,
  queryFn: () => api.chatServices(),
  retry: false,
  refetchInterval: 10_000,
});
export const chatServiceQuery = (id: string, deliveryId?: string) =>
  queryOptions({
    queryKey: keys.chatService(id, deliveryId),
    queryFn: () => api.chatService(id, deliveryId),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
export const calendarWeekQuery = (week: string) =>
  queryOptions({ queryKey: keys.calendar(week), queryFn: () => api.calendar(week) });
export const membersQuery = queryOptions({
  queryKey: keys.members,
  queryFn: () => api.members(),
  staleTime: 5 * 60_000,
});
export const roomsQuery = queryOptions({ queryKey: keys.rooms, queryFn: () => api.rooms(), staleTime: 5 * 60_000 });
/** The picker's rows (D29), read once a minute for the whole page so every card shows the same times. */
export const snoozePresetsQuery = queryOptions({
  queryKey: keys.snoozePresets,
  queryFn: () => api.snoozePresets(),
  staleTime: 60_000,
});
export const verbsQuery = (threadId: string) =>
  queryOptions({ queryKey: keys.verbs(threadId), queryFn: () => api.verbs(threadId) });

const parseInput = (json: string | null): unknown => {
  if (!json) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
};
/** A view in the panel, addressed by `open` and `open-input` in the address of the page it is beside (D50). */
export const viewQuery = (capability: string, inputJson: string | null) =>
  queryOptions({
    queryKey: keys.view(capability, inputJson),
    queryFn: () => api.capability(capability, parseInput(inputJson)),
  });
/**
 * A card action opened as a view (`open-card` and `open-action` in the address). The call is a POST, so it is de-duplicated, never retried
 * and never refetched on its own: within the session a revisit replays the answer, which is right for a read action.
 */
/** One item's document for the review flow (D70): read once per visit, never retried on its own (the dialog offers Försök igen). */
export const previewQuery = (threadId: string, ref: string, revision?: string) =>
  queryOptions({
    queryKey: keys.preview(threadId, ref, revision),
    queryFn: () => api.preview(threadId, ref),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
/** Original bytes live only while open. Every mount and retry rechecks current access and the exact revision. */
export const documentQuery = (request: DocumentRequest) =>
  queryOptions({
    queryKey: keys.document(request),
    queryFn: ({ signal }) => api.document(request, signal),
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
export const cardViewQuery = (threadId: string, actionId: string) =>
  queryOptions({
    queryKey: keys.cardView(threadId, actionId),
    queryFn: () => api.act(threadId, actionId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

/** Administration (D23). The detail read keeps its 400 for the page to turn into "Anslutningen finns inte". */
/** The shared header (D88): what the person's header connector lists for them, read once per visit. */
export const headerQuery = queryOptions({ queryKey: keys.header, queryFn: () => api.header(), staleTime: Infinity });
export const adminQueries = {
  connectors: queryOptions({ queryKey: keys.admin.connectors, queryFn: () => api.admin.connectors() }),
  units: queryOptions({ queryKey: keys.admin.units, queryFn: () => api.admin.units() }),
  groups: queryOptions({ queryKey: keys.admin.groups, queryFn: () => api.admin.groups() }),
  users: queryOptions({ queryKey: keys.admin.users, queryFn: () => api.admin.users() }),
  connector: (id: string) =>
    queryOptions({ queryKey: keys.admin.connector(id), queryFn: () => api.admin.connector(id) }),
  preview: (id: string, role: Role) =>
    queryOptions({ queryKey: keys.admin.preview(id, role), queryFn: () => api.admin.preview(id, role) }),
  /** Modeller (D24): the list, one model, one provider. A 400 on a detail is "finns inte", as for a connector. */
  models: queryOptions({ queryKey: keys.admin.models, queryFn: () => api.admin.models() }),
  model: (id: string) => queryOptions({ queryKey: keys.admin.model(id), queryFn: () => api.admin.model(id) }),
  provider: (id: string) => queryOptions({ queryKey: keys.admin.provider(id), queryFn: () => api.admin.provider(id) }),
  /** What a provider's endpoint lists, for "Lägg till modell": the same check as "Testa", asked once a minute at most and never retried. */
  listed: (id: string) =>
    queryOptions({
      queryKey: keys.admin.listed(id),
      queryFn: () => api.admin.testProvider(id),
      staleTime: 60_000,
      retry: false,
    }),
};
/** The manifest reference (D60): one document, read once a visit. */
export const manifestReferenceQuery = queryOptions({
  queryKey: keys.manifestReference,
  queryFn: () => api.manifestReference(),
  staleTime: Infinity,
});
