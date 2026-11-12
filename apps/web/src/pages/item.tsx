import { useCallback, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { isSnoozed, type SessionUser, type Thread } from '@clew/contracts';
import { Button, EmptyState, HStack, Layout, LayoutContent, Link, Text, VStack, useMediaQuery } from '@clew/ui';
import { ApiError } from '../api';
import { areasQuery, threadQuery, threadsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { insideClew, originOf, toolOf } from '../person-address';
import { todoHref } from '../work-items';
import { useRail, type RailCurrent } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { ContentSkeleton } from '../components/loading';
import { WorkItemPage } from '../components/work-item';
import { cardBody } from '../components/card-panel';
import { itemSubject, usePagePanel, type OwnThing } from '../components/page-panel';
import { AskClew } from '../components/thing-panel';
import { PageHeader } from '../components/page-header';

/**
 * A work item as a page (D111 item 4, board WorkItem, `/items/<threadId>`): the item's own address, reached with "Öppna
 * som sida" from Att göra's reading pane and from the panel beside any page, with `from` as the way back (the same
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
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const from = insideClew(search.get('from'));
  const listQ = useQuery(threadsQuery);
  const listed = listQ.data?.threads.find(t => t.id === threadId);
  // Not in the stream (handled more than a week ago, or past its history): the item on its own, as the server reads it.
  const oneQ = useQuery({ ...threadQuery(threadId), enabled: !!listQ.data && !listed, retry: false });
  const thread: Thread | undefined = listed ?? oneQ.data;
  const missing =
    (oneQ.isError && oneQ.error instanceof ApiError && oneQ.error.status === 404) || (oneQ.isSuccess && !oneQ.data);
  const failed = (listQ.isError && !listQ.data) || (oneQ.isError && !missing);
  const origin = originOf(from, useQuery(areasQuery).data?.menu);
  const back = origin ?? { label: 'Att göra', href: from ?? todoHref({}) };
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
      if (sentAway) navigate(leaving.current, { replace: true });
    },
    [threadId, navigate],
  );
  // "Fråga Clew" (D111 item 7, board Assistant): the item on the page is the thing the panel asks about. Its facts and
  // buttons are the page's, so the panel holds only its name, the conversation and the box.
  const pageThing: OwnThing | null = thread
    ? { id: `page:item:${thread.id}`, title: thread.title, subtitle: 'Ärendet på sidan', subject: itemSubject(thread) }
    : null;
  const panel = usePagePanel({ overlayOnly: short, onChange, pageThing });
  let body;
  if (thread && !thread.proposals.length)
    body = <WorkItemPage thread={thread} back={back} onChange={onChange} ask={<AskClew size="lg" />} panel={panel} />;
  // The calendar's proposals keep their own card (D111 item 9), under the way back and the item's title.
  else if (thread)
    body = (
      <Layout
        height={short ? 'auto' : 'fill'}
        padding={mobile ? 3 : 8}
        end={panel.end}
        content={
          <LayoutContent isScrollable={!short}>
            <VStack gap={4}>
              <HStack>
                <Link href={back.href} type="supporting" color="secondary">
                  {back.label}
                </Link>
              </HStack>
              <PageHeader title={thread.title} end={<AskClew />} />
              {cardBody(thread, { place: 'panel', level: 2, onChange })}
            </VStack>
          </LayoutContent>
        }
      />
    );
  else
    body = (
      <Layout
        height={short ? 'auto' : 'fill'}
        padding={mobile ? 3 : 8}
        content={
          <LayoutContent isScrollable={!short}>
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
          </LayoutContent>
        }
      />
    );
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {body}
      {panel.overlay}
    </Shell>
  );
}
