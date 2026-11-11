import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Thread } from '@clew/contracts';
import { Button, HStack, Text, VStack, useMediaQuery } from '@clew/ui';
import { cardViewQuery, threadsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { panelOf, withAction, withoutPanel } from '../panel-address';
import { GenericCard } from './card';
import { ThreadCard } from './thread';
import { PanelBody, type PanelFrame } from './panel';
import { mobileQuery } from './shell';

/** The card a page other than Hem holds beside it, as a frame for the page's one panel. */
export interface CardFrameSlot {
  /** What the panel draws in place of the page's own thing (a person) while a card is in the address; else null. */
  frame: PanelFrame | null;
  /** The card the address names, whether or not it has arrived. */
  threadId: string | undefined;
}

/**
 * A card beside the page it was opened from (D83 rule 1; the product owner, 2026-11-11: a link on Personal that led to
 * Hem took the list away, and the card arrived already attached to Hem's box). The address names it as on Hem
 * (`panel-address.ts`): `card` is the card, and `open-card` with `open-action` is one of its own reads, which lies over
 * it. The card is drawn by the components Hem draws it with, from the same cache (D33), so a decision made here is the
 * decision made on Hem: the same confirm, the same decision endpoint, the same receipt. Closing lets go of the top
 * layer only: the read leaves the card, the card leaves what the page had open under it.
 *
 * What stays Hem's: the review of a card's rows one at a time (D73) is a drawer over Hem, so "Granska N" leads there;
 * a done card offers no "Nästa som behöver dig", since the stream is not on this page; and a view a read's row links
 * to is not opened here.
 */
export function useCardFrame({ onChange }: { onChange?: (thread: Thread) => void } = {}): CardFrameSlot {
  const [search] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const mobile = useMediaQuery(mobileQuery);
  const panel = panelOf(search);
  const threadId = search.get('card') ?? undefined;
  const action = panel?.kind === 'action' ? panel : null;
  const wanted = threadId ?? action?.threadId;
  const threadsQ = useQuery({ ...threadsQuery, enabled: !!wanted });
  const threads = threadsQ.data?.threads;
  const thread = threadId ? threads?.find(t => t.id === threadId) : undefined;
  // Only a read is asked for from the address: a decision is made with the card's button, never by opening a link.
  const read = action
    ? threads?.find(t => t.id === action.threadId)?.actions.find(a => a.id === action.actionId && a.kind === 'read')
    : undefined;
  const cardView = useQuery({
    ...cardViewQuery(action?.threadId ?? '', action?.actionId ?? ''),
    enabled: !!read,
  });
  // A read that answers a link opens it once per answer (StrictMode replays effects), as on Hem.
  const opened = useRef<unknown>(null);
  const result = cardView.data?.kind === 'read' ? cardView.data : undefined;
  const url =
    result && typeof (result.output as { url?: string }).url === 'string'
      ? (result.output as { url: string }).url
      : null;
  useEffect(() => {
    if (!result || !url || opened.current === result) return;
    opened.current = result;
    window.open(url, '_blank', 'noopener');
  }, [result, url]);
  const changed = useCallback((t: Thread) => onChange?.(t), [onChange]);
  if (!wanted) return { frame: null, threadId };

  const here = search.toString() ? `${pathname}?${search.toString()}` : pathname;
  const close = () => navigate(withoutPanel(pathname, search));
  const openCardView = (id: string, actionId: string) => navigate(withAction(pathname, search, id, actionId));
  if (read && result && !url)
    return {
      threadId,
      frame: {
        id: `action:${action!.threadId}:${action!.actionId}`,
        title: read.label,
        address: here,
        wide: result.view?.kind === 'table',
        onClose: close,
        body: inline => <PanelBody output={result.output} view={result.view} inline={inline} />,
      },
    };
  if (read && cardView.isError)
    return {
      threadId,
      frame: {
        id: `action:${action!.threadId}:${action!.actionId}`,
        title: read.label,
        onClose: close,
        body: () => (
          <VStack gap={3}>
            <Text as="p">{errorMessage(cardView.error, 'Kunde inte hämta.')}</Text>
            <HStack>
              <Button
                size="sm"
                variant="secondary"
                label="Försök igen"
                isLoading={cardView.isFetching}
                onClick={() => void cardView.refetch()}
              />
            </HStack>
          </VStack>
        ),
      },
    };
  if (!threadId) return { frame: null, threadId };
  if (thread)
    return {
      threadId,
      frame: {
        id: `card:${thread.id}`,
        kind: 'card',
        title: 'Kort',
        tab: thread.title,
        address: here,
        onClose: close,
        // The card's buttons, Inte nu among them, are the card's own: the header holds what is open and ✕ (D66).
        body: () =>
          thread.proposals.length ? (
            <ThreadCard thread={thread} compact headingLevel={3} beside onChange={changed} />
          ) : (
            <GenericCard
              thread={thread}
              headingLevel={3}
              beside
              sheet={mobile}
              onChange={changed}
              onOpenCardView={openCardView}
            />
          ),
      },
    };
  // The stream has answered and has no such card, or did not answer: said in the card's place, as a person is.
  if (threadsQ.isError)
    return {
      threadId,
      frame: {
        id: `card:${threadId}`,
        kind: 'card',
        title: 'Kort',
        onClose: close,
        body: () => (
          <VStack gap={3}>
            <Text as="p">{errorMessage(threadsQ.error, 'Kortet kunde inte hämtas just nu.')}</Text>
            <HStack>
              <Button
                size="sm"
                variant="secondary"
                label="Försök igen"
                isLoading={threadsQ.isFetching}
                onClick={() => void threadsQ.refetch()}
              />
            </HStack>
          </VStack>
        ),
      },
    };
  if (threads)
    return {
      threadId,
      frame: {
        id: `card:${threadId}`,
        kind: 'card',
        title: 'Kort',
        onClose: close,
        body: () => <Text as="p">Kortet finns inte längre bland dina kort.</Text>,
      },
    };
  return { frame: null, threadId };
}
