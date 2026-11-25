import { useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PanelViewSpec, Thread } from '@clew/contracts';
import { viewQuery } from '../../queries';
import { viewSearch } from '../../panel-address';
import { searchKeyOf, viewInputChange, withSearchWords } from '../../view-address';
import type { ThingSubject } from '../conversation/conversation-context';

/**
 * A view read for an address and what "Fråga assistenten" asks about (D126 rules 1 and 5). Every read a page draws (a tool's
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

/**
 * The input a view's page reads and how its own controls change it (`viewInputChange`). A choice goes into the address;
 * what the person types into the search field stays with the page, never in the address: the read takes it in its body,
 * and the address leaves the search out from the first word typed. The words last while the page stands on the same
 * input in its address, so a reload, Back past the page or a link to another input forgets them, as D100 item 5
 * accepted for the people list's search.
 */
export function useViewInput(capability: string) {
  const location = useLocation();
  const navigate = useNavigate();
  const addressed = new URLSearchParams(location.search).get('input');
  const [typed, setTyped] = useState<{ capability: string; at: string | null; key: string; words: string } | null>(
    null,
  );
  const own = typed && typed.capability === capability && typed.at === addressed ? typed : null;
  const inputJson = own ? withSearchWords(addressed, own.key, own.words) : addressed;
  /** The view's controls changed its input; `spec` is the view drawn, whose search field is the one kept apart. */
  const onInput = (next: Record<string, unknown>, spec: PanelViewSpec | undefined) => {
    const key = searchKeyOf(spec);
    const change = viewInputChange(location.pathname, location.search, next, key);
    setTyped(key ? { capability, at: change.at, key, words: change.words } : null);
    // Compared as `withViewInput` writes an address, so an address that only spells the same query otherwise stays.
    const query = new URLSearchParams(location.search).toString();
    if (change.href !== location.pathname + (query ? '?' + query : '')) navigate(change.href, { replace: true });
  };
  return { inputJson, onInput };
}

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
