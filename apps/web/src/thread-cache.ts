import type { QueryClient } from '@tanstack/react-query';
import type { Thread } from '@clew/contracts';
import { keys } from './query-keys';

type ThreadList = { threads: Thread[] };

/** The stream's rule: a thread the list knows is replaced in place; a new one goes first, since the list is newest first. */
export const upsertThread = (list: Thread[], thread: Thread): Thread[] =>
  list.some(t => t.id === thread.id) ? list.map(t => t.id === thread.id ? thread : t) : [thread, ...list];

/**
 * A mutation returned a thread (D33): it is the truth for every screen that shows it. The list and the single-thread entry
 * are written in place; the counts beside them (areas, attention) are re-read; the loaded weeks are re-read only when the
 * thread carries proposals, since nothing else draws in a calendar. A list refetch that left before the mutation is
 * cancelled first, so an older answer cannot land afterwards and put the old thread back.
 */
export async function applyThread(client: QueryClient, thread: Thread): Promise<void> {
  if (client.getQueryState(keys.threads)?.data !== undefined) await client.cancelQueries({ queryKey: keys.threads, exact: true });
  client.setQueryData(keys.thread(thread.id), thread);
  client.setQueryData<ThreadList>(keys.threads, current => current ? { threads: upsertThread(current.threads, thread) } : current);
  void client.invalidateQueries({ queryKey: keys.areas });
  void client.invalidateQueries({ queryKey: keys.attention });
  if (thread.proposals.length > 0) void client.invalidateQueries({ queryKey: keys.calendarAll });
}

/** Something happened to the stream outside a mutation the page made (a reminder fired): read it and the counter again. */
export function invalidateStream(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: keys.threads });
  void client.invalidateQueries({ queryKey: keys.attention });
}

/** The proposal thread the calendar page sits beside: the open one, else the latest one on the topic. */
export const pickProposalThread = (list: Thread[]): Thread | null =>
  list.find(t => t.state === 'open' && t.topic === 'utvecklingssamtal') ?? list.find(t => t.topic === 'utvecklingssamtal') ?? null;
