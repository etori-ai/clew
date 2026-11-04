import { useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Thread } from '@clew/contracts';
import { useToast } from '@clew/ui';
import { applyThread } from './thread-cache';
import { errorMessage } from './query-policy';
import { keys } from './query-keys';

type Action<T> = () => Promise<T>;
type QueryKey = readonly unknown[];

/**
 * Run a user action whose answer is a thread (D33). `run(fn)` returns a promise that always settles, so an Astryx
 * `clickAction` shows its pending state and never sees a rejection; the error is read from `error` as a Swedish string.
 * The in-flight flag is the re-entry guard (`isPending` flips only after the next render). Busy never disables the button
 * that holds focus (2.4.3): callers keep that rule. `onChange` runs before the cache write so the page can read the DOM
 * as it is (the focus hand-over); `apply` is the same path for a thread that arrived without a mutation.
 */
export function useThreadAction({ onChange, fallback = 'Något gick fel.' }: { onChange?: (thread: Thread) => void; fallback?: string } = {}) {
  const client = useQueryClient();
  const latest = useRef(onChange);
  latest.current = onChange;
  const apply = useCallback((thread: Thread) => { latest.current?.(thread); void applyThread(client, thread); }, [client]);
  const mutation = useMutation<Thread | void, unknown, Action<Thread | void>>({ mutationFn: fn => fn(), onSuccess: thread => { if (thread) apply(thread); } });
  const inFlight = useRef(false);
  const { mutateAsync } = mutation;
  const run = useCallback(async (fn: Action<Thread | void>): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    try { await mutateAsync(fn); } catch { /* the error is in the mutation's state */ } finally { inFlight.current = false; }
  }, [mutateAsync]);
  return { run, apply, busy: mutation.isPending, error: mutation.isError ? errorMessage(mutation.error, fallback) : null, reset: mutation.reset };
}

/**
 * Run an administration action (D23). On success the given keys are invalidated and awaited, so `busy` holds until the
 * page shows the new state (as the old `load()` did), then the message the action returned is the toast.
 */
export function useAdminAction({ fallback = 'Något gick fel.', invalidate = [keys.admin.all], toastId }: { fallback?: string; invalidate?: readonly QueryKey[]; toastId?: string } = {}) {
  const client = useQueryClient();
  const toast = useToast();
  const mutation = useMutation<string | void, unknown, Action<string | void>>({
    mutationFn: fn => fn(),
    onSuccess: async message => {
      await Promise.all(invalidate.map(queryKey => client.invalidateQueries({ queryKey })));
      if (message) toast({ body: message, ...(toastId ? { uniqueID: toastId } : {}) });
    },
  });
  const inFlight = useRef(false);
  const { mutateAsync } = mutation;
  const run = useCallback(async (fn: Action<string | void>): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    try { await mutateAsync(fn); } catch { /* the error is in the mutation's state */ } finally { inFlight.current = false; }
  }, [mutateAsync]);
  return { run, busy: mutation.isPending, error: mutation.isError ? errorMessage(mutation.error, fallback) : null, reset: mutation.reset };
}
