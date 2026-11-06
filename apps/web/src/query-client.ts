import { QueryClient } from '@tanstack/react-query';
import { retryPolicy } from './query-policy';

/**
 * One client per confirmed session (D33), created by `Protected` under the `SessionBoundary` and cleared when the boundary
 * ends. Memory only: nothing is persisted or broadcast. A read older than 15 s is refetched when the tab becomes visible
 * again or the network returns; nothing polls. Mutations never retry: confirm sends invitations, act executes in a source
 * system, remind starts a workflow.
 */
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: retryPolicy,
        retryDelay: 1_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: { retry: false },
    },
  });
