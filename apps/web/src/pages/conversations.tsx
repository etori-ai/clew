import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser, Thread } from '@clew/contracts';
import {
  Button,
  Card,
  EmptyState,
  HStack,
  Link,
  List,
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
import { aboutWords, storedAbout, talkingTo, withWords, type Recipient } from '../conversation-about';
import { DOT } from '../dot';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { useRail } from '../components/nav';
import { titled, useConversation } from '../components/conversation-context';
import { AsyncContent, ContentSkeleton } from '../components/loading';
import { LinkRow } from '../components/work-row';
import { PageFrame } from '../components/page-frame';

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

/**
 * Alla samtal (D126 rule 7, the `table-page` composition of board Personal): every conversation the person has had,
 * the newest first, where the rail's three latest end. The title is the row's link to the conversation (rule 4), then
 * whom it is with where that is another system's assistant (D125: its name and its system, as the conversation's own
 * header says it), when it last changed and, only where the data says something about it, its state (the answer being
 * written, a draft that waits for the person), as the rail's dot says it. On a phone the rows are a list, each one
 * link. Nothing is stored here: the list is the session's conversations from the same cache as the rail (D33).
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
        with: talkingTo(thread),
        about: storedAbout(thread).join(', ') || null,
      })),
    [threads, day, answering],
  );
  const anyState = rows.some(r => r.state);
  const anyHanded = rows.some(r => r.with);
  const anyAbout = rows.some(r => r.about);
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
    // What a conversation is about (the product owner, 2026-11-14), drawn only while some conversation keeps it: the
    // work item or the view its first question went with. A person or a unit is kept by nothing in the conversation.
    {
      key: 'about',
      header: 'Om',
      width: proportional(2, { minWidth: 180 }),
      renderCell: r => (r.about ? <Text>{r.about}</Text> : null),
    },
    // Drawn only while some conversation is with another system's assistant: a column of "Clew" says nothing.
    {
      key: 'with',
      header: 'Med',
      width: proportional(1, { minWidth: 160 }),
      renderCell: r => <Text>{withWords(r.with)}</Text>,
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
  const columns = all.filter(
    c => (c.key !== 'state' || anyState) && (c.key !== 'with' || anyHanded) && (c.key !== 'about' || anyAbout),
  );
  const failed = read.isError && !read.data;
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
  ) : rows.length === 0 ? (
    <EmptyState
      headingLevel={2}
      title="Inga samtal än"
      description="När du frågar Clew något finns samtalet här."
      actions={<Button label="Ny fråga" href="/" />}
    />
  ) : mobile ? (
    <Card padding={0}>
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
    </Card>
  ) : (
    // In the page's column as Hem's lists are: the table in a card (the product owner, 2026-11-14: every page has
    // Hem's container).
    <Card padding={0}>
      <Table<Row> data={rows} columns={columns} idKey="id" hasHover />
    </Card>
  );
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      <PageFrame
        title="Samtal"
        meta={read.data ? (rows.length === 1 ? '1 samtal' : `${rows.length} samtal`) : undefined}
        actions={<Button label="Ny fråga" variant="primary" href="/" />}
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
