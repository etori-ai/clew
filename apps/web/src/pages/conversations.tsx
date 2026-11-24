import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { SessionUser, Thread } from '@clew/contracts';
import {
  BoardCard,
  Button,
  EmptyState,
  HStack,
  Link,
  List,
  Pagination,
  pixel,
  proportional,
  registerTable,
  StatusDot,
  Table,
  type TableColumn,
  Text,
  useMediaQuery,
  VStack,
} from '@clew/ui';
import { addDays, displayDate, shortDayLabel, timeLabel, today } from '@clew/calendar/dates';
import { conversationsQuery, threadsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { conversationState } from '../work-items';
import { aboutWords, storedAbout, talkingTo, withWords, type Recipient } from '../conversation-about';
import { DOT } from '../dot';
import { Shell, mobileQuery, shortQuery } from '../components/shell/shell';
import { useNav } from '../components/shell/nav';
import { titled, useConversation } from '../components/conversation/conversation-context';
import { AsyncContent, ContentSkeleton } from '../components/shell/loading';
import { LinkRow } from '../components/work/work-row';
import { PageFrame } from '../components/shell/page-frame';

type Row = {
  id: string;
  thread: Thread;
  state: ReturnType<typeof conversationState>;
  /** Another system's assistant the conversation is with now (D125), or null for Clew. */
  with: Recipient | null;
  /** What it is about, as the conversation keeps it: what its first question went with ("om Attestera 3 fakturor"). */
  about: string | null;
};
const EMPTY: Thread[] = [];

/** When a conversation last changed: the time today, "i går" and the time, else the day and the time. */
function lastChanged(at: string, day: string) {
  const date = displayDate(at);
  if (date === day) return `i dag ${timeLabel(at)}`;
  return `${date === addDays(day, -1) ? 'i går' : shortDayLabel(date)} ${timeLabel(at)}`;
}

/** The page of Alla samtal the address asks for (`?page=2`); the first is no parameter. */
const pageIn = (params: URLSearchParams) => {
  const n = Number(params.get('page'));
  return Number.isInteger(n) && n > 1 ? n : 1;
};

/**
 * Alla samtal (D126 rule 7, the `table-page` composition of board Personal): every conversation the person has had,
 * the latest activity first, where the rail's three latest end. The title is the row's link to the conversation (rule
 * 4), then whom it is with where that is another system's assistant (D125: its name and its system, as the
 * conversation's own header says it), when it last changed and, only where the data says something about it, its state
 * (the answer being written, a draft that waits for the person), as the rail's dot says it. On a phone the rows are a
 * list, each one link.
 *
 * The conversations are read from their own list, a page of 50 at a time (WD-L1): a person in a large organisation
 * has hundreds, and no work item is among them. The page is in the address (`?page=2`), so Back undoes a step and a
 * link opens the same page; Astryx's pager steps by the server's cursor and says the page it went to, and the number
 * of pages and of conversations is said once the last page is read. Nothing is stored here: the pages are the query
 * cache's, read again from the first on a change notice (D33, D46).
 */
export function ConversationsPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const nav = useNav({ current: { surface: 'conversations' }, admin, manager: user.role === 'manager' });
  usePageTitle('Samtal');
  const talk = useConversation();
  const read = useInfiniteQuery(conversationsQuery);
  // The stream says which drafts wait for the person (`conversationState`); the conversations come from their own list.
  const threads = useQuery(threadsQuery).data?.threads ?? EMPTY;
  const day = today();
  const answering = talk.pending ? (talk.conversation?.id ?? null) : null;
  const [params, setParams] = useSearchParams();
  const asked = pageIn(params);
  const pages = read.data?.pages;
  const loaded = pages?.length ?? 0;
  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } = read;
  // A page the address asks for that is not read yet (a step, a link, Back) is read in turn, from the cursor the last
  // one ended at. One that failed is read again when the person asks, not in a loop.
  const waiting = loaded > 0 && loaded < asked && !!hasNextPage;
  useEffect(() => {
    if (waiting && !isFetching && !isFetchNextPageError) void fetchNextPage();
  }, [waiting, loaded, isFetching, isFetchNextPageError, fetchNextPage]);
  // Past the last page (a link to a page that has since emptied) the last one is shown.
  const page = waiting ? asked : loaded ? Math.min(asked, loaded) : 1;
  const known = loaded > 0 && !hasNextPage;
  const total = known ? pages!.reduce((n, p) => n + p.conversations.length, 0) : null;
  const shown = waiting ? EMPTY : (pages?.[page - 1]?.conversations ?? EMPTY);
  const rows = useMemo<Row[]>(
    () =>
      shown.map(thread => ({
        id: thread.id,
        thread,
        state: conversationState(thread, threads, answering),
        with: talkingTo(thread),
        about: storedAbout(thread).join(', ') || null,
      })),
    [shown, threads, answering],
  );
  // A step to another page is taken at the foot of the list and read from its head, so the head comes back into view.
  // The focus stays on the pager, where the next step is taken, and the pager says the page it went to.
  const head = useRef<HTMLHeadingElement>(null);
  const turn = (next: number) => {
    const address = new URLSearchParams(params);
    if (next > 1) address.set('page', String(next));
    else address.delete('page');
    setParams(address);
    head.current?.scrollIntoView({ block: 'start' });
  };
  const paged = loaded > 1 || !!hasNextPage;
  const anyState = rows.some(r => r.state);
  const anyHanded = rows.some(r => r.with);
  const anyAbout = rows.some(r => r.about);
  const all: TableColumn<Row>[] = [
    {
      key: 'title',
      header: <Text type="eyebrow">Samtal</Text>,
      width: proportional(3, { minWidth: 240 }),
      renderCell: r => (
        <Link href={`/conversations/${r.id}`} color="primary" weight="semibold">
          {titled(r.thread.title)}
        </Link>
      ),
    },
    // What a conversation is about (the product owner, 2026-11-14), drawn only while some conversation keeps it: the
    // work item or the view its first question went with. A person or a unit is kept by nothing in the conversation.
    {
      key: 'about',
      header: <Text type="eyebrow">Om</Text>,
      width: proportional(2, { minWidth: 180 }),
      renderCell: r => (r.about ? <Text>{r.about}</Text> : null),
    },
    // Drawn only while some conversation is with another system's assistant: a column of "Clew" says nothing.
    {
      key: 'with',
      header: <Text type="eyebrow">Med</Text>,
      width: proportional(1, { minWidth: 160 }),
      renderCell: r => <Text>{withWords(r.with)}</Text>,
    },
    {
      key: 'updated',
      header: <Text type="eyebrow">Senast</Text>,
      width: pixel(160),
      renderCell: r => <Text hasTabularNumbers>{lastChanged(r.thread.updatedAt, day)}</Text>,
    },
    // Drawn only while some conversation has a state to say: a column of nothing says nothing.
    {
      key: 'state',
      header: <Text type="eyebrow">Läge</Text>,
      width: pixel(180),
      // The word beside the dot, so the state is never told by its colour alone (1.4.1); the dot is named by the word.
      renderCell: r =>
        r.state ? (
          <HStack gap={1.5} vAlign="center">
            <StatusDot variant={r.state.variant} label={r.state.label} aria-hidden />
            <Text>{r.state.label}</Text>
          </HStack>
        ) : null,
    },
  ];
  const columns = all.filter(
    c => (c.key !== 'state' || anyState) && (c.key !== 'with' || anyHanded) && (c.key !== 'about' || anyAbout),
  );
  const failed = read.isError && !read.data;
  const pager = paged ? (
    <HStack hAlign="center">
      <Pagination
        label="Sidor med samtal"
        size="sm"
        variant={mobile ? 'compact' : 'pages'}
        page={page}
        onChange={turn}
        {...(known ? { totalPages: loaded } : { hasMore: page < loaded || !!hasNextPage })}
      />
    </HStack>
  ) : null;
  const list = failed ? (
    <VStack gap={2}>
      <Text as="p" role="alert">
        {errorMessage(read.error, 'Samtalen kunde inte hämtas just nu.')}
      </Text>
      <HStack>
        <Button
          size="sm"
          variant="secondary"
          label="Försök igen"
          isLoading={read.isFetching}
          onClick={() => void read.refetch()}
        />
      </HStack>
    </VStack>
  ) : total === 0 ? (
    <EmptyState
      headingLevel={2}
      title="Inga samtal än"
      description="När du frågar Clew något finns samtalet här."
      actions={<Button label="Ny fråga" href="/conversations/new" />}
    />
  ) : (
    // The register as the reference draws one (D130 item 20): a card with its heading inside and how many it holds, on
    // a phone its rows as a list, wider the table inside the card's inset with the registers' rows.
    // The pager stays on the page while the next page is read, so the focus it holds is not lost (2.4.3).
    <VStack gap={4}>
      {waiting && isFetchNextPageError ? (
        <VStack gap={2}>
          <Text as="p" role="alert">
            {errorMessage(read.error, 'Samtalen kunde inte hämtas just nu.')}
          </Text>
          <HStack>
            <Button
              size="sm"
              variant="secondary"
              label="Försök igen"
              isLoading={isFetching}
              onClick={() => void fetchNextPage()}
            />
          </HStack>
        </VStack>
      ) : waiting ? (
        <ContentSkeleton label="Hämtar fler samtal …" rows={4} heading={false} />
      ) : (
        <BoardCard
          id="dina-samtal"
          title="Dina samtal"
          {...(total !== null ? { count: total, countLabel: 'samtal' } : {})}
          list={mobile}
        >
          {mobile ? (
            <List hasDividers aria-label="Samtal">
              {rows.map(r => (
                <LinkRow
                  key={r.id}
                  id={`samtal-${r.id}`}
                  itemKey={r.id}
                  href={`/conversations/${r.id}`}
                  title={titled(r.thread.title)}
                  description={[
                    r.about ? aboutWords(r.about) : null,
                    r.with ? `Med ${withWords(r.with)}` : null,
                    lastChanged(r.thread.updatedAt, day),
                    r.state?.label,
                  ]
                    .filter(Boolean)
                    .join(DOT)}
                  descriptionLines={0}
                />
              ))}
            </List>
          ) : (
            <Table<Row> data={rows} columns={columns} idKey="id" {...registerTable} />
          )}
        </BoardCard>
      )}
      {pager}
    </VStack>
  );
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      <PageFrame
        cards
        title="Samtal"
        meta={total === null ? undefined : total === 1 ? '1 samtal' : `${total} samtal`}
        titleRef={head}
        actions={<Button label="Ny fråga" variant="primary" href="/conversations/new" />}
        label="Samtal"
      >
        <AsyncContent
          pending={read.isPending}
          fallback={<ContentSkeleton label="Hämtar dina samtal …" rows={4} heading={false} />}
        >
          {list}
        </AsyncContent>
      </PageFrame>
    </Shell>
  );
}
