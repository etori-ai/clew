import { useMemo, useRef } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PanelViewSpec, Thread } from '@clew/contracts';
import { viewQuery } from '../queries';
import { viewSearch } from '../panel-address';
import type { ThingSubject } from './conversation-context';

/**
 * A view read for an address and what "Fråga Clew" asks about (D126 rules 1 and 5). Every read a page draws (a tool's
 * page, the news, the thing beside a conversation) is read here, and a thing's subject is what the conversation about
 * it is about: a work item beside the transcript, a view beside it, or a list as its chip alone.
 */

/** A work item as what the box beside it asks about (D112 item 7): its chip, and its card beside the conversation's page. */
export const itemSubject = (thread: Pick<Thread, 'id' | 'title'>): ThingSubject => ({
  key: 'thread:' + thread.id,
  label: 'ärendet',
  chips: [{ ref: 'thread:' + thread.id, kind: 'thread', label: thread.title, threadId: thread.id }],
  search: '?card=' + encodeURIComponent(thread.id),
});
/**
 * A view as what the box beside it asks about: its capability as the chip, and one thing beside the conversation's page.
 * A list or a table is a page of its own (D116), never beside the conversation: the conversation about it continues
 * with the chip alone (`page`).
 */
export const viewSubject = (
  view: {
    capability: string;
    title: string;
    input: Record<string, unknown>;
  },
  page = false,
): ThingSubject => ({
  // A search typed in the view refines the same view: the conversation about it goes on.
  key: `view:${view.capability}`,
  label: view.title.toLocaleLowerCase('sv-SE'),
  chips: [{ ref: 'capability:' + view.capability, kind: 'capability', label: view.title }],
  search: page ? '' : viewSearch(view),
});
const parse = (json: string | null): Record<string, unknown> => {
  try {
    const v: unknown = json ? JSON.parse(json) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** A declared view on screen (D38): what it answered, and the address and input it answered for. */
export interface ShownView {
  capability: string;
  title: string;
  output: unknown;
  spec: PanelViewSpec | undefined;
  source: string | undefined;
  input: Record<string, unknown>;
  address: string;
}

/**
 * One view read for an address, a tool's page or the panel's. What is on screen stays until the next answer has
 * arrived: typing in a view's own field keeps its rows, and a view that takes another's place does so with its title,
 * in one step, so the panel stays open between a row and its contact card and focus can follow.
 */
export function useView(capability: string | null, inputJson: string | null, at: { title: string; address: string }) {
  const query = useQuery({
    ...viewQuery(capability ?? '', inputJson),
    enabled: !!capability,
    placeholderData: keepPreviousData,
  });
  const input = useMemo(() => parse(inputJson), [inputJson]);
  const shown = useRef<ShownView | null>(null);
  const arrived =
    query.data && (!query.isPlaceholderData || query.data.view?.capability === capability) ? query.data : undefined;
  if (!capability || query.isError) shown.current = null;
  else if (arrived)
    shown.current = {
      capability,
      title: at.title,
      output: arrived.output,
      spec: arrived.view,
      source: arrived.source,
      input,
      address: at.address,
    };
  return {
    shown: capability ? shown.current : null,
    isLoading: query.isFetching && query.isPlaceholderData,
    failed: query.isError ? query.error : null,
    retry: () => {
      void query.refetch();
    },
  };
}
