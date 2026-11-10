import type { QueryClient } from '@tanstack/react-query';
import type { Thread } from '@clew/contracts';
import { keys } from './query-keys';

type ThreadList = { threads: Thread[] };

/** The stream's rule: a thread the list knows is replaced in place; a new one goes first, since the list is newest first. */
export const upsertThread = (list: Thread[], thread: Thread): Thread[] =>
  list.some(t => t.id === thread.id) ? list.map(t => (t.id === thread.id ? thread : t)) : [thread, ...list];

/** A refetch of a key that already has data is cancelled, so an older answer cannot land after the write; a first load is left alone. */
const settleFetches = async (client: QueryClient, id: string) => {
  if (client.getQueryState(keys.threads)?.data !== undefined)
    await client.cancelQueries({ queryKey: keys.threads, exact: true });
  if (client.getQueryState(keys.thread(id))?.data !== undefined)
    await client.cancelQueries({ queryKey: keys.thread(id), exact: true });
};
const writeThread = (client: QueryClient, thread: Thread) => {
  client.setQueryData(keys.thread(thread.id), thread);
  client.setQueryData<ThreadList>(keys.threads, current =>
    current ? { threads: upsertThread(current.threads, thread) } : current,
  );
};

/**
 * A mutation returned a thread (D33): it is the truth for every screen that shows it. The list and the single-thread entry
 * are written in place; the counts beside them (areas, attention) are re-read; the loaded weeks are re-read only when the
 * thread carries proposals, since nothing else draws in a calendar. A list refetch that left before the mutation is
 * cancelled first, so an older answer cannot land afterwards and put the old thread back.
 */
export async function applyThread(client: QueryClient, thread: Thread): Promise<void> {
  await settleFetches(client, thread.id);
  writeThread(client, thread);
  void client.invalidateQueries({ queryKey: keys.areas });
  void client.invalidateQueries({ queryKey: keys.attention });
  if (thread.proposals.length > 0) void client.invalidateQueries({ queryKey: keys.calendarAll });
}

/**
 * The person's action drawn before the server has answered (D64): the predicted thread goes into the list and the
 * single entry the way an answer does, but nothing beside them is re-read, since nothing is known yet. The function
 * returned puts the previous state back after a failed request, and only where the preview still stands: an answer
 * that landed meanwhile is newer and stays.
 */
export async function previewThread(client: QueryClient, thread: Thread): Promise<() => void> {
  await settleFetches(client, thread.id);
  const one = keys.thread(thread.id);
  const before = { list: client.getQueryData<ThreadList>(keys.threads), one: client.getQueryData<Thread>(one) };
  writeThread(client, thread);
  const written = {
    list: client.getQueryState(keys.threads)?.dataUpdatedAt,
    one: client.getQueryState(one)?.dataUpdatedAt,
  };
  return () => {
    if (client.getQueryState(one)?.dataUpdatedAt === written.one) {
      if (before.one) client.setQueryData(one, before.one);
      else client.removeQueries({ queryKey: one, exact: true });
    }
    if (before.list && client.getQueryState(keys.threads)?.dataUpdatedAt === written.list)
      client.setQueryData(keys.threads, before.list);
  };
}

/**
 * The change stream's notices (D46) against the person's own requests (D64). A notice says that something of the
 * person's has a new committed revision; while one of this client's mutations is in flight that is usually the
 * request itself, and a refetch now would draw the committed intermediate state over the preview or the answer. The
 * notice waits until the mutation cache is idle. Versioned documents and review snapshots stay fixed while open;
 * a changed work-item revision opens a new preview key. Policy changes still clear the entire protected tree.
 *
 * The stream reconnects every time the tab becomes visible, and a new connection always starts by saying the current
 * revision. A revision this tab has already seen is therefore no notice: the first one is what the page's own first
 * reads answered, and the same one again means nothing was committed while the tab was away.
 */
export function changeNotices(client: QueryClient): { arrived(revision?: string): void; stop(): void } {
  let held = false,
    seen: string | undefined;
  const refresh = () =>
    client.invalidateQueries({ predicate: q => q.queryKey[0] !== 'document' && q.queryKey[0] !== 'preview' });
  const flush = () => {
    if (!held || client.isMutating()) return;
    held = false;
    void refresh();
  };
  const unsubscribe = client.getMutationCache().subscribe(flush);
  return {
    arrived(revision) {
      if (revision !== undefined) {
        const known = seen;
        seen = revision;
        if (known === undefined || known === revision) return;
      }
      if (client.isMutating()) held = true;
      else void refresh();
    },
    stop: unsubscribe,
  };
}

/** Something happened to the stream outside a mutation the page made (a reminder fired): read it and the counter again. */
export function invalidateStream(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: keys.threads });
  void client.invalidateQueries({ queryKey: keys.attention });
}

/** The proposal thread the calendar page sits beside: the open one, else the latest one on the topic. */
export const pickProposalThread = (list: Thread[]): Thread | null =>
  list.find(t => t.state === 'open' && t.topic === 'utvecklingssamtal') ??
  list.find(t => t.topic === 'utvecklingssamtal') ??
  null;
