import { createElement, useCallback, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Thread } from '@clew/contracts';
import { CompletionFeedback, useToast } from '@clew/ui';
import { applyThread, previewThread } from './thread-cache';
import { atRest } from './optimistic';
import { errorMessage } from './query-policy';
import { keys } from './query-keys';

type Action<T> = () => Promise<T>;
type QueryKey = readonly unknown[];

export type RunOptions = {
  /** The thread as the person's action leaves it, drawn before the server answers (D64); the answer replaces it and a failed request restores the card. */
  optimistic?: Thread;
  /** The answer may not be at rest (a decision the source has not confirmed, a timer not yet taken): the card keeps showing the action as on its way for a moment (D64). */
  settle?: boolean;
};
export type RunAction = (fn: Action<Thread | void>, options?: RunOptions) => Promise<void>;
type Vars = RunOptions & { fn: Action<Thread | void> };

/**
 * How long a card keeps showing the person's action as on its way after an answer that is not at rest. The change stream
 * (D46) is polled every two seconds on the server, so the resting state normally arrives within that; a source that
 * takes longer is shown as what it is, with Kontrollera status.
 */
export const SETTLE_MS = 4_000;
const holds = new Map<string, number>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
/** The card is held in its in-progress look until `until`, shared by every component that draws the thread. */
export function holdSettling(id: string, until: number): void {
  holds.set(id, until);
  notify();
  setTimeout(
    () => {
      if (holds.get(id) !== until) return;
      holds.delete(id);
      notify();
    },
    Math.max(0, until - Date.now()),
  );
}
export const settlingUntil = (id: string): number => holds.get(id) ?? 0;
/** Whether the card still shows the person's action as on its way: held after an answer that was not at rest, until the state rests or the window ends. */
export function useSettling(thread: Pick<Thread, 'id' | 'execution' | 'timers'>): boolean {
  const until = useSyncExternalStore(subscribe, () => holds.get(thread.id) ?? 0);
  return until > 0 && !atRest(thread);
}

/**
 * Run a user action whose answer is a thread (D33). `run(fn)` returns a promise that always settles, so an Astryx
 * `clickAction` shows its pending state and never sees a rejection; the error is read from `error` as a Swedish string.
 * The in-flight flag is the re-entry guard (`isPending` flips only after the next render). Busy never disables the button
 * that holds focus (2.4.3): callers keep that rule. `onChange` runs before the cache write so the page can read the DOM
 * as it is (the focus hand-over); `apply` is the same path for a thread that arrived without a mutation. With
 * `optimistic` the predicted thread is written first (D64) and `onChange` runs for it, not again for the answer.
 */
export function useThreadAction({
  onChange,
  fallback = 'Något gick fel.',
}: { onChange?: (thread: Thread) => void; fallback?: string } = {}) {
  const client = useQueryClient();
  const toast = useToast();
  const latest = useRef(onChange);
  latest.current = onChange;
  const apply = useCallback(
    (thread: Thread) => {
      latest.current?.(thread);
      void applyThread(client, thread);
    },
    [client],
  );
  const mutation = useMutation<Thread | void, unknown, Vars>({
    mutationFn: vars => vars.fn(),
    onSuccess: (thread, vars) => {
      if (!thread) return;
      if (!vars.optimistic) latest.current?.(thread);
      void applyThread(client, thread);
      if (vars.settle && !atRest(thread)) holdSettling(thread.id, Date.now() + SETTLE_MS);
    },
  });
  const inFlight = useRef(false);
  const { mutateAsync } = mutation;
  const run = useCallback<RunAction>(
    async (fn, options = {}) => {
      if (inFlight.current) return;
      inFlight.current = true;
      let restore: (() => void) | undefined;
      try {
        if (options.optimistic) {
          latest.current?.(options.optimistic);
          restore = await previewThread(client, options.optimistic);
        }
        await mutateAsync({ fn, ...options });
      } catch (error) {
        // The error is in the mutation's state. A card drawn as gone has left the page with that state, so the preview goes
        // back where it still stands and the reason is a toast, which outlives the card's component.
        restore?.();
        if (options.optimistic)
          toast({ type: 'error', body: errorMessage(error, fallback), uniqueID: 'failed:' + options.optimistic.id });
      } finally {
        inFlight.current = false;
      }
    },
    [client, mutateAsync, toast, fallback],
  );
  return {
    run,
    apply,
    busy: mutation.isPending,
    error: mutation.isError ? errorMessage(mutation.error, fallback) : null,
    reset: mutation.reset,
  };
}

/**
 * A decision sent from the action dialog (D111 item 10): the same path as `useThreadAction`'s `run` with `settle` (the
 * answer goes into the cache for every screen, `onChange` first, and an answer not at rest keeps the item on its way),
 * but the failure is the dialog's to place on the field it concerns, so `send` resolves the server's Swedish sentence
 * instead of keeping it in an `error` the item would also show. Null once it went through, or for a second send while
 * one is in flight.
 */
export function useDecisionSend({
  onChange,
  fallback = 'Något gick fel.',
}: { onChange?: (thread: Thread) => void; fallback?: string } = {}) {
  const client = useQueryClient();
  const latest = useRef(onChange);
  latest.current = onChange;
  const mutation = useMutation<Thread, unknown, Action<Thread>>({
    mutationFn: fn => fn(),
    onSuccess: thread => {
      latest.current?.(thread);
      void applyThread(client, thread);
      if (!atRest(thread)) holdSettling(thread.id, Date.now() + SETTLE_MS);
    },
  });
  const inFlight = useRef(false);
  const { mutateAsync } = mutation;
  const send = useCallback(
    async (fn: Action<Thread>): Promise<{ sent: true } | { error: string } | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      try {
        await mutateAsync(fn);
        return { sent: true };
      } catch (error) {
        return { error: errorMessage(error, fallback) };
      } finally {
        inFlight.current = false;
      }
    },
    [mutateAsync, fallback],
  );
  return { send, busy: mutation.isPending };
}

/**
 * Run an administration action (D23). On success the given keys are invalidated and awaited, so `busy` holds until the
 * page shows the new state (as the old `load()` did), then the message the action returned is the toast.
 */
export function useAdminAction({
  fallback = 'Något gick fel.',
  invalidate = [keys.admin.all],
  toastId,
}: { fallback?: string; invalidate?: readonly QueryKey[]; toastId?: string } = {}) {
  const client = useQueryClient();
  const toast = useToast();
  const mutation = useMutation<string | void, unknown, Action<string | void>>({
    mutationFn: fn => fn(),
    onSuccess: async message => {
      await Promise.all(invalidate.map(queryKey => client.invalidateQueries({ queryKey })));
      if (message)
        toast({
          // As children, so Astryx can read the words it announces (see CompletionFeedback).
          body: createElement(CompletionFeedback, null, message),
          ...(toastId ? { uniqueID: toastId } : {}),
        });
    },
  });
  const inFlight = useRef(false);
  const { mutateAsync } = mutation;
  const run = useCallback(
    async (fn: Action<string | void>): Promise<void> => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        await mutateAsync(fn);
      } catch {
        /* the error is in the mutation's state */
      } finally {
        inFlight.current = false;
      }
    },
    [mutateAsync],
  );
  return {
    run,
    busy: mutation.isPending,
    error: mutation.isError ? errorMessage(mutation.error, fallback) : null,
    reset: mutation.reset,
  };
}

/** What a talk write changes and is waited for before `busy` lets go: the round, every list of action points, Personal. */
const TALK_KEYS: readonly QueryKey[] = [keys.talks.all, keys.staff];
/**
 * What it changes beside them and is re-read without waiting (D96 item 5): the action point's card in the stream and the
 * counts and figure beside it, and what Clew's talks say about people and units (D97) on whichever page the talk lay
 * over (D110 rule 5): Personal's lens, column and "Just nu", the talks section on a person's page, a unit's section.
 */
const TALK_SIDE_KEYS: readonly QueryKey[] = [keys.threads, keys.attention, keys.areas, keys.entities.all];
/** What a caller may add to a talk write's completion toast. */
export type TalkToast = {
  /** An action at the toast's end, such as Ångra. The toast then stays until it is used or closed (2.2.1). */
  endContent?: ReactNode;
};
type TalkVars = { fn: Action<unknown>; done: string; toast: TalkToast };

/**
 * Run a talk write (D96: held, an action point added, ticked off or opened again). `run(fn, done)` settles, never
 * rejects, and resolves true once the write is through and the talk reads are fresh again, so a form can clear itself
 * and move the focus; then `done`, a Swedish sentence, is the completion toast, with `toast.endContent` at its end when
 * the caller passes one (shown once, already with its action). A failure resolves false and its Swedish
 * text is `error`. While the write is in flight the mutation cache is busy, so the change stream's notice for it waits
 * (`changeNotices`) as it does for every other mutation hook. A second `run` while one is in flight is ignored.
 */
export function useTalkAction({ fallback = 'Något gick fel.', toastId }: { fallback?: string; toastId?: string } = {}) {
  const client = useQueryClient();
  const toast = useToast();
  const mutation = useMutation<unknown, unknown, TalkVars>({
    mutationFn: vars => vars.fn(),
    onSuccess: async (_answer, vars) => {
      TALK_SIDE_KEYS.forEach(queryKey => void client.invalidateQueries({ queryKey }));
      await Promise.all(TALK_KEYS.map(queryKey => client.invalidateQueries({ queryKey })));
      toast({
        // As children, so Astryx can read the words it announces (see CompletionFeedback).
        body: createElement(CompletionFeedback, null, vars.done),
        ...(toastId ? { uniqueID: toastId } : {}),
        ...(vars.toast.endContent ? { endContent: vars.toast.endContent, isAutoHide: false } : {}),
      });
    },
  });
  const inFlight = useRef(false);
  const { mutateAsync } = mutation;
  const run = useCallback(
    async (fn: Action<unknown>, done: string, toast: TalkToast = {}): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      try {
        await mutateAsync({ fn, done, toast });
        return true;
      } catch {
        /* the error is in the mutation's state */
        return false;
      } finally {
        inFlight.current = false;
      }
    },
    [mutateAsync],
  );
  return {
    run,
    busy: mutation.isPending,
    error: mutation.isError ? errorMessage(mutation.error, fallback) : null,
    reset: mutation.reset,
  };
}

/** The entity an action is started on (D97): its kind and its key, for the reads that follow the new card. */
type EntityStart = { fn: Action<{ threadId: string }>; kind: string; key: string };
/** What starting an action gave: the new card, the Swedish sentence of a refusal, or nothing for a start while one runs. */
export type EntityStarted = { threadId: string } | { error: string } | null;
/**
 * Start an action from an entity's menu (D97, D8): the server makes the card the person decides on, without the model.
 * `start(fn, entity)` settles, never rejects: it resolves the new card's thread id, or the source's refusal in Swedish,
 * which also stays in `error` until the next start. The stream is read again before it resolves, so the page that opens
 * the card has it; the list's "Just nu" and the opened entity's Behöver dig follow without waiting. A second start while
 * one is in flight is ignored.
 */
export function useEntityStart({ fallback = 'Åtgärden kunde inte startas.' }: { fallback?: string } = {}) {
  const client = useQueryClient();
  const mutation = useMutation<{ threadId: string }, unknown, EntityStart>({
    mutationFn: vars => vars.fn(),
    onSuccess: async (_started, vars) => {
      void client.invalidateQueries({ queryKey: keys.entities.list(vars.kind) });
      void client.invalidateQueries({ queryKey: keys.entities.detail(vars.kind, vars.key), exact: true });
      await client.invalidateQueries({ queryKey: keys.threads, refetchType: 'all' });
    },
  });
  const inFlight = useRef(false);
  const { mutateAsync } = mutation;
  const start = useCallback(
    async (fn: Action<{ threadId: string }>, entity: { kind: string; key: string }): Promise<EntityStarted> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      try {
        return { threadId: (await mutateAsync({ fn, ...entity })).threadId };
      } catch (error) {
        return { error: errorMessage(error, fallback) };
      } finally {
        inFlight.current = false;
      }
    },
    [mutateAsync, fallback],
  );
  return {
    start,
    busy: mutation.isPending,
    error: mutation.isError ? errorMessage(mutation.error, fallback) : null,
    reset: mutation.reset,
  };
}
