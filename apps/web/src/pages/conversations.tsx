import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser, Thread } from '@clew/contracts';
import {
  Button,
  Card,
  EmptyState,
  HStack,
  Heading,
  Layout,
  LayoutContent,
  LayoutHeader,
  Link,
  List,
  StackItem,
  StatusDot,
  Table,
  Text,
  VStack,
  pixel,
  proportional,
  useMediaQuery,
  type TableColumn,
} from '@clew/ui';
import { addDays, displayDate, shortDayLabel, timeLabel, today } from '@clew/calendar/dates';
import { threadsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { groupThreads } from '../stream';
import { conversationState } from '../work-items';
import { DOT } from '../dot';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { useRail } from '../components/nav';
import { titled, useConversation } from '../components/conversation-context';
import { AsyncContent, ContentSkeleton } from '../components/loading';
import { LinkRow } from '../components/work-row';

type Row = { id: string; thread: Thread; state: ReturnType<typeof conversationState> };
const EMPTY: Thread[] = [];

/** When a conversation last changed: the time today, "i går" and the time, else the day and the time. */
function lastChanged(at: string, day: string) {
  const date = displayDate(at);
  if (date === day) return `i dag ${timeLabel(at)}`;
  return `${date === addDays(day, -1) ? 'i går' : shortDayLabel(date)} ${timeLabel(at)}`;
}

/**
 * Alla samtal (D126 rule 7, the `table-page` composition of board Personal): every conversation the person has had with
 * Clew, the newest first, where the rail's three latest end. The title is the row's link to the conversation (rule 4),
 * then when it last changed and, only where the data says something about it, its state (the answer being written, a
 * draft that waits for the person), as the rail's dot says it. On a phone the rows are a list, each one link. Nothing
 * is stored here: the list is the session's conversations from the same cache as the rail (D33).
 */
export function ConversationsPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const nav = useRail({ current: { surface: 'conversations' }, admin, manager: user.role === 'manager' });
  usePageTitle('Samtal');
  const talk = useConversation();
  const read = useQuery(threadsQuery);
  const threads = read.data?.threads ?? EMPTY;
  const day = today();
  const answering = talk.pending ? (talk.conversation?.id ?? null) : null;
  const rows = useMemo<Row[]>(
    () =>
      groupThreads(threads, new Date().toISOString(), day).questions.map(thread => ({
        id: thread.id,
        thread,
        state: conversationState(thread, threads, answering),
      })),
    [threads, day, answering],
  );
  const anyState = rows.some(r => r.state);
  const all: TableColumn<Row>[] = [
    {
      key: 'title',
      header: 'Samtal',
      width: proportional(3, { minWidth: 240 }),
      renderCell: r => (
        <Link href={`/conversations/${r.id}`} color="primary" weight="semibold">
          {titled(r.thread.title)}
        </Link>
      ),
    },
    {
      key: 'updated',
      header: 'Senast',
      width: pixel(160),
      renderCell: r => <Text hasTabularNumbers>{lastChanged(r.thread.updatedAt, day)}</Text>,
    },
    // Drawn only while some conversation has a state to say: a column of nothing says nothing.
    {
      key: 'state',
      header: 'Läge',
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
  const columns = all.filter(c => c.key !== 'state' || anyState);
  const failed = read.isError && !read.data;
  const list = failed ? (
    <VStack gap={2} padding={mobile ? 4 : 6}>
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
  ) : rows.length === 0 ? (
    <EmptyState
      headingLevel={2}
      title="Inga samtal än"
      description="När du frågar Clew något finns samtalet här."
      actions={<Button label="Ny fråga" href="/" />}
    />
  ) : mobile ? (
    <VStack padding={4}>
      <Card padding={0}>
        <List hasDividers aria-label="Samtal">
          {rows.map(r => (
            <LinkRow
              key={r.id}
              id={`samtal-${r.id}`}
              itemKey={r.id}
              href={`/conversations/${r.id}`}
              title={titled(r.thread.title)}
              description={[lastChanged(r.thread.updatedAt, day), r.state?.label].filter(Boolean).join(DOT)}
              descriptionLines={0}
            />
          ))}
        </List>
      </Card>
    </VStack>
  ) : (
    <Table<Row> data={rows} columns={columns} idKey="id" hasHover />
  );
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      <Layout
        height={short ? 'auto' : 'fill'}
        header={
          <LayoutHeader padding={0}>
            <HStack gap={3} vAlign="center" wrap="wrap" padding={mobile ? 4 : 6} paddingBlockEnd={3}>
              <StackItem size="fill">
                <VStack gap={0.5}>
                  <Heading level={1}>Samtal</Heading>
                  {read.data && (
                    <Text type="supporting" color="secondary">
                      {rows.length === 1 ? '1 samtal' : `${rows.length} samtal`}
                    </Text>
                  )}
                </VStack>
              </StackItem>
              <Button label="Ny fråga" variant="primary" href="/" />
            </HStack>
          </LayoutHeader>
        }
        content={
          <LayoutContent padding={0} isScrollable={!short}>
            <AsyncContent
              pending={read.isPending}
              fallback={
                <VStack padding={mobile ? 4 : 6}>
                  <ContentSkeleton label="Hämtar dina samtal …" rows={4} heading={false} />
                </VStack>
              }
            >
              {list}
            </AsyncContent>
          </LayoutContent>
        }
      />
    </Shell>
  );
}
