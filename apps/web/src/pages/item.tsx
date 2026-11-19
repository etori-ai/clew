import { useCallback, useRef } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { isSnoozed, type SessionUser, type Thread } from '@clew/contracts';
import { Button, EmptyState, HStack, Text, VStack, useMediaQuery } from '@clew/ui';
import { ApiError } from '../api';
import { areasQuery, threadQuery, threadsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { insideClew, originOf, toolOf } from '../person-address';
import { todoHref } from '../work-items';
import { useShownForTheWayBack } from '../way-back';
import { useRail, type RailCurrent } from '../components/nav';
import { Shell, shortQuery } from '../components/shell';
import { ContentSkeleton } from '../components/loading';
import { WorkItemPage } from '../components/work-item';
import { cardBody } from '../components/card-panel';
import { itemSubject } from '../components/view-read';
import { AskClew } from '../components/thing-panel';
import { PageFrame } from '../components/page-frame';

/**
 * A work item as a page (D126 rule 1, board Ärende, `/items/<threadId>`): the item's own address, reached by its name
 * in every row and by its title in Att göra's reading pane, with `from` as the way back (the same
 * convention as a person's page, `person-address.ts`). The way back names the page it came from when Clew can name it,
 * else Att göra. The item comes from the stream every page shares (D33), so a decision here is the decision everywhere;
 * an item the stream no longer lists (handled long ago) is read on its own. An item the person may not see is the
 * page's own "finns inte", as the server answers 404 for both.
 *
 * When the item leaves the person's hands with its own button (Avfärda, Inte nu), the page leads back to where it came
 * from, as Att göra lets go of an item sent away; the toast keeps the way back to it.
 */
export function ItemPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const { threadId = '' } = useParams<{ threadId: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const short = useMediaQuery(shortQuery);
  const from = insideClew(search.get('from'));
  // Back, or the way back, gives the focus to the link that opened the item (its row, its title in the pane), 2.4.3.
  const location = useLocation();
  useShownForTheWayBack(location.pathname + location.search);
  const listQ = useQuery(threadsQuery);
  const listed = listQ.data?.threads.find(t => t.id === threadId);
  // Not in the stream (handled more than a week ago, or past its history): the item on its own, as the server reads it.
  const oneQ = useQuery({ ...threadQuery(threadId), enabled: !!listQ.data && !listed, retry: false });
  const thread: Thread | undefined = listed ?? oneQ.data;
  const missing =
    (oneQ.isError && oneQ.error instanceof ApiError && oneQ.error.status === 404) || (oneQ.isSuccess && !oneQ.data);
  const failed = (listQ.isError && !listQ.data) || (oneQ.isError && !missing);
  const origin = originOf(from, useQuery(areasQuery).data?.menu);
  // The way back names the place it leads to: a page Clew cannot name is "Tillbaka", never Att göra's name on it.
  const back = origin ?? (from ? { label: 'Tillbaka', href: from } : { label: 'Att göra', href: todoHref({}) });
  // The rail marks the place the item was opened from; without one, Att göra.
  const tool = toolOf(from);
  const current: RailCurrent = from?.startsWith('/staff')
    ? { surface: 'staff' }
    : from?.startsWith('/calendar')
      ? { surface: 'calendar' }
      : tool
        ? { surface: 'verktyg', view: tool }
        : from === '/' || from?.startsWith('/?') || from?.startsWith('/conversations')
          ? { surface: 'start' }
          : { surface: 'todo' };
  const nav = useRail({ current, admin, manager: user.role === 'manager' });
  usePageTitle(thread ? thread.title : missing ? 'Ärendet finns inte' : null);
  // Sent away by its own button, the item has nothing more to show here: back to where the person came from.
  const leaving = useRef(back.href);
  leaving.current = back.href;
  const onChange = useCallback(
    (t: Thread) => {
      if (t.id !== threadId) return;
      const sentAway = t.state === 'dismissed' || (t.state === 'open' && isSnoozed(t, new Date().toISOString()));
      // The queue it goes back to gives the focus to the row after it (2.4.3), by its id in the history's state.
      if (sentAway) navigate(leaving.current, { replace: true, state: { left: t.id } });
    },
    [threadId, navigate],
  );
  // "Fråga assistenten" (D126 rule 5): a new conversation with the item beside it.
  const ask = thread ? <AskClew subject={itemSubject(thread)} /> : null;
  let body;
  if (thread && !thread.proposals.length)
    body = <WorkItemPage thread={thread} back={back} onChange={onChange} ask={ask} />;
  // The calendar's proposals keep their own card (D27, D112 item 9), under the way back and the item's title.
  else if (thread)
    body = (
      <PageFrame ask={{ later: 'things' }} back={back} title={thread.title} actions={ask}>
        {cardBody(thread, { place: 'pane', level: 2, onChange })}
      </PageFrame>
    );
  else
    body = (
      <PageFrame ask={{ later: 'things' }}>
        {missing ? (
          <EmptyState
            headingLevel={1}
            title="Ärendet finns inte"
            description="Det finns inget sådant ärende bland dina, eller så har du inte längre tillgång till det. Adressen kan också ha ändrats."
            actions={<Button label="Till Att göra" href={todoHref({})} />}
          />
        ) : failed ? (
          <VStack gap={3}>
            <Text as="p" role="alert">
              {errorMessage(oneQ.error ?? listQ.error, 'Ärendet kunde inte hämtas just nu.')}
            </Text>
            <HStack>
              <Button
                size="sm"
                variant="secondary"
                label="Försök igen"
                onClick={() => void (listQ.isError ? listQ.refetch() : oneQ.refetch())}
              />
            </HStack>
          </VStack>
        ) : (
          <ContentSkeleton />
        )}
      </PageFrame>
    );
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {body}
    </Shell>
  );
}
