import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { PanelViewSpec, Thread, ThreadAction, ViewRef } from '@clew/contracts';
import { Button, Card, Collapsible, HStack, Skeleton, Text, VStack, useAnnounce, type AnimatedLayout } from '@clew/ui';
import { areasQuery, cardViewQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { withoutRead } from '../panel-address';
import { viewOpenHref } from '../view-address';
import { PanelBody, answersWithRowsOf } from './panel';

/** What a card's read answered, as the card or the panel draws it. */
export interface ReadShown {
  output: unknown;
  view: PanelViewSpec | undefined;
}

/**
 * Whether a read's answer unfolds inside its card (D111, amended 2026-11-11): everything but rows. A read that answers
 * with a table or a list (`hr.leaveRequests` behind "Se i personalsystemet" on a leave request) is a page of its own
 * (D116): its button is a link there (`readPageHref`), and a read that turns out to answer with rows when it arrives
 * is sent on to its page.
 */
export const unfoldsInCard = (view: PanelViewSpec | undefined, output?: unknown): boolean =>
  !answersWithRowsOf(view, output);

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * One of a card's own reads, as the address names it (`open-card` and `open-action`), asked for once and shared by the
 * card that unfolds it and the panel that draws a table in its place (`cardViewQuery`, one request for both). Only a
 * read is ever asked for from the address: the request is the decision endpoint's (D45/D47), so an address that named
 * an execute would make the decision when the page loaded, with no button pressed and no confirm asked. A link out
 * (`target: 'link'`) is the card's own button's, never the address's.
 */
export function useCardRead(thread: Thread | undefined, actionId: string | null) {
  const action =
    thread && actionId
      ? thread.actions.find(a => a.id === actionId && a.kind === 'read' && a.target !== 'link')
      : undefined;
  const query = useQuery({ ...cardViewQuery(thread?.id ?? '', action?.id ?? ''), enabled: !!action });
  const answer = action ? query.data : undefined;
  const shown: ReadShown | null = !answer
    ? null
    : answer.kind === 'execute'
      ? { output: answer.thread.receipt, view: undefined }
      : { output: answer.output, view: answer.view };
  const url =
    answer && answer.kind !== 'execute' && isRecord(answer.output) && typeof answer.output.url === 'string'
      ? answer.output.url
      : null;
  return { action, query, shown, url };
}

/**
 * A card's read unfolded inside the card, under its buttons (the product owner, 2026-11-11): the same Astryx
 * composition as "Varför nu?", a Collapsible in its own Card gliding the card's content with `useAnimatedLayout`,
 * titled with the action's own words, so the card, its rows and its decision buttons stay in view. It is drawn only
 * while the address unfolds it; its toggle folds it (`onFold`), as the button that unfolded it does. While the read is
 * on its way the section holds its shape; a read that failed says so with Försök igen; what arrived is said aloud
 * (4.1.3) while the focus stays on the button that unfolded it. A read that answers with an address opens it in a new
 * tab once and unfolds nothing; one that answers with rows leads to its own page (`page`, D116), the address that
 * unfolded it let go of first so Back returns to the card as it was. A row's own view in the read is a link: a list to
 * its page, one thing beside the page in the card's place, ✕ back to the card.
 */
export function CardRead({
  action,
  read,
  id,
  animatedLayout,
  onFold,
  page,
}: {
  action: ThreadAction;
  read: ReturnType<typeof useCardRead>;
  /** The section's id, which the button that unfolded it names as what it controls. */
  id: string;
  animatedLayout: AnimatedLayout;
  /** Let go of the read; `refocus` when the section's own toggle did it, whose focus then needs a place to go. */
  onFold: (refocus: boolean) => void;
  /** The read's own page, where it goes when it answers with rows (D116). */
  page: string;
}) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const views = useQuery(areasQuery).data?.views;
  const announce = useAnnounce();
  const { query, shown, url } = read;
  // What arrived, and a read that failed, are said once per answer (StrictMode replays effects).
  const said = useRef<unknown>(null);
  useEffect(() => {
    const now = query.isError ? query.error : query.data;
    if (!now || said.current === now) return;
    said.current = now;
    if (query.isError) announce(errorMessage(query.error, 'Kunde inte hämta.'));
    else if (url) {
      // A read that answers with an address is a way out (D111 rule 8): the tab opens once, and nothing unfolds.
      window.open(url, '_blank', 'noopener');
      announce(`${action.label} öppnades i en ny flik.`);
      onFold(false);
    } else if (shown && !unfoldsInCard(shown.view, shown.output)) {
      // Rows are a page (D116): the unfolded read leaves the address it was put in, and the page is the next step.
      navigate(withoutRead(pathname, search), { replace: true });
      navigate(page);
    } else if (shown) announce(`${action.label} visas i ärendet.`);
  }, [query.data, query.error, query.isError]);
  if (url || (shown && !unfoldsInCard(shown.view, shown.output))) return null;
  /** Where a row's own view leads (`view.open`): a list to its page, one thing beside the page over the card. */
  const hrefFor = (v: ViewRef) => viewOpenHref(views, pathname, search, v);
  return (
    <Card padding={3}>
      <Collapsible
        id={id}
        isOpen
        onOpenChange={open => {
          if (!open) onFold(true);
        }}
        chevronPosition="start"
        animatedLayout={animatedLayout}
        trigger={<Text weight="semibold">{action.label}</Text>}
      >
        {query.isError ? (
          <VStack gap={3}>
            <Text as="p">{errorMessage(query.error, 'Kunde inte hämta.')}</Text>
            <HStack>
              <Button
                size="sm"
                variant="secondary"
                label="Försök igen"
                isLoading={query.isFetching}
                onClick={() => void query.refetch()}
              />
            </HStack>
          </VStack>
        ) : shown ? (
          <PanelBody output={shown.output} view={shown.view} input={{}} inline isLoading={false} hrefFor={hrefFor} />
        ) : (
          <VStack gap={2} aria-busy="true">
            <Skeleton height={20} width="60%" />
            <Skeleton height={20} width="40%" />
          </VStack>
        )}
      </Collapsible>
    </Card>
  );
}
