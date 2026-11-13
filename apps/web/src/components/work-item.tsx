import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { daysUntil, sameSubject, snoozeWhen, stockholmDate, type ItemEvent, type Thread } from '@clew/contracts';
import {
  AreaChip,
  Avatar,
  Badge,
  Banner,
  Button,
  CheckboxList,
  CheckboxListItem,
  ClickableCard,
  Dialog,
  DialogHeader,
  Divider,
  DocumentTextIcon,
  Heading,
  HStack,
  Icon,
  IconButton,
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  LayoutPanel,
  Link,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  ScrollableArea,
  Skeleton,
  StackItem,
  StatusDot,
  Text,
  VStack,
  useAnimatedLayout,
  useMediaQuery,
} from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { api } from '../api';
import { itemEventsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { executionStatus } from '../execution-status';
import { useMarks } from '../marks';
import { mobileQuery, shortQuery } from '../media';
import { readOf, withRead, withoutRead } from '../panel-address';
import { withReview } from '../review-address';
import { canUndoReceipt, receiptComplete } from '../receipt-state';
import { entityHref } from '../person-address';
import { dueOf, itemPageHref, stateOf } from '../work-items';
import { useConversation } from './conversation-context';
import {
  ActionRow,
  ItemLabel,
  SystemLine,
  TimerNote,
  clock,
  reviewedAction,
  rowSystems,
  snoozedLabel,
  useMinutesLeft,
  useThreadActions,
  type Actions,
  type RowSystems,
} from './card';
import { CardRead, unfoldsInCard, useCardRead } from './card-read';
import { useThingHead } from './thing-head';
import { Unfold } from './unfold';

/**
 * A work item (D112 item 4, the `work-item-detail` template, boards WorkItem, Inbox, PhoneItem and ActReceipt): one
 * shape at two widths. Narrow (`WorkItem`), in Att göra's reading pane, in the panel beside a page and in a
 * conversation's answer, it is the header (the source line, the title, the status, the badges and the buttons) and the
 * main column. As a page (`WorkItemPage`, `/items/<threadId>`) the same header and column get the details rail, which
 * moves behind an information button into a fullscreen dialog where the window is narrow, and on a phone the buttons
 * are pinned to the foot. The main column holds, each only when it has something to say: the receipt after a decision,
 * "Varför ser jag detta?", the rows, "Dokument" and "Händelser". Every fact comes from the item itself or from its
 * audit rows (`/api/threads/<id>/events`); nothing is guessed, and a field with nothing behind it is not drawn.
 */

/** The template's own line for the details rail (`work-item-detail`: a dialog at 1024 px and below). */
export const narrowItemQuery = '(max-width: 1024px)';

const outcomeDot = {
  done: { variant: 'success', label: 'Klart' },
  unknown: { variant: 'warning', label: 'Okänt' },
  failed: { variant: 'error', label: 'Misslyckades' },
  skipped: { variant: 'neutral', label: 'Inte skickad' },
} as const;

const longDate = (date: string) =>
  new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(date.slice(0, 10) + 'T12:00:00Z'),
  );
const capital = (s: string) => (s ? s[0]!.toLocaleUpperCase('sv-SE') + s.slice(1) : s);
/** An instant as a person says it beside today: "i dag 08.31", "i går 16.02", "i morgon 06:00", else "11 november 08.31". */
export function whenWord(instant: string, now = today()): string {
  const date = stockholmDate(instant);
  const days = daysUntil(date, now);
  const day = days === 0 ? 'i dag' : days === -1 ? 'i går' : days === 1 ? 'i morgon' : longDate(date);
  return `${day} ${clock(instant)}`;
}
/** A due day as the header's badge says it (board WorkItem: "Förfaller i dag"). */
function dueBadge(thread: Thread, now: string) {
  const due = dueOf(thread, now);
  if (!due) return null;
  const label =
    due.label === 'Försenad' || due.label === 'Påminnelse'
      ? due.label
      : `Förfaller ${due.label.toLocaleLowerCase('sv-SE')}`;
  return <Badge variant={due.variant} label={label} />;
}
/** The one entity the item's rows are about, when there is exactly one: the source's own word for it is its row's label. */
function aboutOne(thread: Thread) {
  const named = thread.items.filter(i => i.subject);
  const first = named[0];
  return first && named.every(i => sameSubject(i.subject!, first.subject!)) ? first : null;
}

/** The read unfolded in the item, the actions and the marks: everything both widths share. */
function useWorkItem(thread: Thread, onChange: (thread: Thread) => void, idBase: string) {
  const root = useRef<HTMLDivElement>(null);
  /** The header with the buttons, where the narrow item draws it: in the article, or docked above a conversation. */
  const head = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const animatedLayout = useAnimatedLayout({ containerRef: root });
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  // One of the item's own reads unfolded in it (`open-card` and `open-action`, D111 amended 2026-11-11), wherever it is
  // drawn. The address is replaced, not pushed: unfolding is a change within the item, so Back never steps through it.
  const asked = readOf(new URLSearchParams(search));
  const unfolded = asked?.threadId === thread.id ? asked.actionId : null;
  const read = useCardRead(thread, unfolded);
  const readSection = `read-${idBase}-${thread.id}`;
  const openRead = read.action && !read.url && !(read.shown && !unfoldsInCard(read.shown.view)) ? read.action.id : null;
  const onRead = (a: Thread['actions'][number]) =>
    navigate(unfolded === a.id ? withoutRead(pathname, search) : withRead(pathname, search, thread.id, a.id), {
      replace: true,
    });
  /** Folded by the section's toggle the toggle is gone with it: the focus goes to the button that unfolded it, else the title. */
  const fold = (refocus: boolean) => {
    const opener = read.action
      ? (head.current ?? root.current)?.querySelector<HTMLElement>(`[data-read="${CSS.escape(read.action.id)}"]`)
      : null;
    navigate(withoutRead(pathname, search), { replace: true });
    if (refocus) requestAnimationFrame(() => (opener?.isConnected ? opener : title.current)?.focus());
  };
  const actions = useThreadActions({ thread, onChange, onRead });
  const marks = useMarks();
  const mark = marks.ofThread(thread);
  const systems = rowSystems(thread, marks);
  const from = pathname + search;
  const unfold = read.action ? (
    <CardRead action={read.action} read={read} id={readSection} animatedLayout={animatedLayout} onFold={fold} />
  ) : null;
  return { root, head, title, actions, mark, systems, from, openRead, readSection, unfold, animatedLayout };
}
type ItemState = ReturnType<typeof useWorkItem>;

/** The status (the state the queue's dot shows, as text with its dot) and the badges: when it is due, its area, what it is about. */
function StatusLine({ thread, item }: { thread: Thread; item: ItemState }) {
  const now = new Date().toISOString(),
    day = today();
  const state = stateOf(thread, now, day);
  const about = aboutOne(thread);
  const draft = thread.messages.at(-1)?.meta?.draft;
  const open = thread.state === 'open';
  const reminder = thread.timers?.find(t => t.kind === 'reminder' && t.state === 'scheduled');
  // What the state's word does not say by itself: when a set-aside item comes back, who it waits on and when Clew reminds.
  const detail =
    open && thread.snoozedUntil && state.label === 'Inte nu'
      ? snoozedLabel(thread.snoozedUntil)
      : open && thread.waitingOn
        ? [
            `Väntar på ${thread.waitingOn}`,
            reminder && !thread.waitingOn.startsWith('påminnelsen ')
              ? `påminner dig ${snoozeWhen(reminder.dueAt, now)}`
              : '',
          ]
            .filter(Boolean)
            .join('\u00a0· ')
        : '';
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <HStack gap={1.5} vAlign="center">
        <StatusDot variant={state.variant} label={state.label} />
        <Text weight="semibold">{state.label}</Text>
      </HStack>
      {detail && <Text type="supporting">{detail}</Text>}
      {dueBadge(thread, day)}
      <AreaChip ordinal={item.mark.ordinal} icon={item.mark.icon} label={item.mark.title} />
      {about && <Badge variant="neutral" label={about.label} />}
      {draft && open && <Badge variant="warning" icon={<Icon icon="warning" size="sm" />} label="Att bekräfta" />}
    </HStack>
  );
}

/** One section of the main column: its heading and what it holds, named by the heading. */
function ItemSection({
  id,
  title,
  level,
  visual,
  children,
}: {
  id: string;
  title: string;
  level: number;
  visual: 2 | 3 | 4;
  children: ReactNode;
}) {
  return (
    <VStack as="section" gap={3} aria-labelledby={id}>
      <Heading id={id} level={visual} accessibilityLevel={level as 2 | 3 | 4 | 5}>
        {title}
      </Heading>
      {children}
    </VStack>
  );
}

/**
 * The receipt after a decision (D70, board ActReceipt): the source's headline, each row read back with its outcome and
 * the system that answered, and Ångra with the time left while the source allows it. Green only when every row was read back.
 */
function Receipt({ thread, actions, systems }: { thread: Thread; actions: Actions; systems: RowSystems }) {
  const receipt = thread.receipt!;
  const minutes = useMinutesLeft(receipt.undoUntil);
  const undoOpen = minutes !== null && canUndoReceipt(thread);
  const failed = receipt.rows.some(r => r.outcome === 'failed'),
    unknown = receipt.rows.some(r => r.outcome === 'unknown');
  const status = failed ? 'error' : unknown ? 'warning' : receiptComplete(receipt) ? 'success' : 'info';
  const pending = executionStatus(thread.execution);
  return (
    <Banner
      status={status}
      title={receipt.headline}
      collapsible={false}
      endContent={
        undoOpen ? (
          <Button
            size="sm"
            variant="secondary"
            label={`${pending ? 'Ångra bekräftade' : 'Ångra'}\u00a0· ${minutes} min kvar`}
            clickAction={() => actions.run(() => api.undoReceipt(thread.id))}
          />
        ) : undefined
      }
    >
      <List density="compact" hasDividers aria-label="Kvitto, rad för rad">
        {receipt.rows.map(r => (
          <ListItem
            key={r.ref}
            startContent={<StatusDot variant={outcomeDot[r.outcome].variant} label={outcomeDot[r.outcome].label} />}
            label={<Text weight="semibold">{r.label}</Text>}
            description={<Text type="supporting">{r.detail}</Text>}
            endContent={
              <Text type="supporting" textWrap="nowrap">
                {systems.of.get(r.ref)?.source ?? thread.trigger.source}
              </Text>
            }
          />
        ))}
      </List>
    </Banner>
  );
}

/** "Varför ser jag detta?" (board WorkItem), open: the source's reason, where and when it came, and the item's lead. */
function Why({ thread }: { thread: Thread }) {
  return (
    <VStack gap={2}>
      <Text as="p">
        {thread.trigger.reason.replace(/\.$/, '')}. Ärendet kom från {thread.trigger.source}{' '}
        {whenWord(thread.trigger.at)}.
      </Text>
      {thread.summary && thread.summary !== thread.trigger.reason && (
        <Text as="p" color="secondary">
          {thread.summary}
        </Text>
      )}
    </VStack>
  );
}

/**
 * The rows (board WorkItem's checklist): Astryx's checkbox list where the rows are chosen for the item's action
 * (`selectable`, `selected`, `usesItems`), with how many are chosen; a plain list where they are not. A row that names a
 * person or a unit links to them (D97 item 6).
 */
function Rows({ thread, actions, item }: { thread: Thread; actions: Actions; item: ItemState }) {
  const conversation = useConversation();
  const open = thread.state === 'open';
  const { selected, setSelected, selectable } = actions;
  const describe = (ref: string, detail: string) =>
    item.systems.multi ? (
      <SystemLine mark={item.systems.of.get(ref)} words={detail} />
    ) : (
      <Text type="supporting">{detail}</Text>
    );
  const choosable = thread.items.filter(i => i.selectable).length;
  return selectable ? (
    <VStack gap={2}>
      <Text type="supporting" color="secondary" hasTabularNumbers>
        {`${selected.length} av ${choosable} valda`}
      </Text>
      <CheckboxList
        label="Rader"
        isLabelHidden
        value={selected}
        onChange={setSelected}
        isReadOnly={!open || !!executionStatus(thread.execution)}
        density="balanced"
        hasDividers
      >
        {thread.items.map(i => (
          <CheckboxListItem
            key={i.ref}
            value={i.ref}
            align="start"
            label={<ItemLabel item={i} from={item.from} />}
            description={describe(i.ref, i.detail)}
          />
        ))}
      </CheckboxList>
    </VStack>
  ) : (
    <List density="balanced" hasDividers edge="flush">
      {thread.items.map(i => (
        <ListItem
          key={i.ref}
          isSelected={conversation.chipped.includes(i.ref)}
          label={<ItemLabel item={i} from={item.from} />}
          description={describe(i.ref, i.detail)}
        />
      ))}
    </List>
  );
}

/**
 * "Dokument": the document behind each row the item reviews one at a time (D70), where its action names a `preview`
 * read. Each opens the review over the page at that row, where the document is drawn beside the decision (D73).
 */
function Documents({ thread }: { thread: Thread }) {
  const { pathname, search } = useLocation();
  const rows = thread.items.filter(i => i.selectable);
  return (
    <VStack gap={1}>
      {rows.map((row, step) => (
        <ClickableCard
          key={row.ref}
          label={`Öppna underlaget för ${row.label}`}
          href={withReview(pathname, search, thread.id, step)}
          padding={3}
        >
          <HStack gap={3} vAlign="center">
            <Icon icon={DocumentTextIcon} size="lg" color="secondary" />
            <StackItem size="fill">
              <VStack gap={0}>
                <Text weight="semibold">{row.label}</Text>
                <Text type="supporting" color="secondary">
                  Underlag från {thread.trigger.source}
                </Text>
              </VStack>
            </StackItem>
          </HStack>
        </ClickableCard>
      ))}
    </VStack>
  );
}

/** What one event says, after who did it (board WorkItem's Händelser). Facts the item holds; never a model's words. */
function eventWords(e: ItemEvent, thread: Thread): string {
  const source = thread.trigger.source;
  switch (e.kind) {
    case 'created':
      return thread.remindedAt || e.by === 'you'
        ? 'skapade ärendet'
        : `skapade ärendet: ${thread.trigger.reason.replace(/\.$/, '')}`;
    case 'updated':
      return `läste in ändringar från ${source}`;
    case 'snoozed':
      return e.until ? `lade ärendet åt sidan till ${whenWord(e.until)}` : 'lade ärendet åt sidan';
    case 'woken':
      return e.reason === 'changed' ? `tog upp ärendet igen när ${source} ändrade det` : 'tog upp ärendet igen';
    case 'reminder-set':
      return e.until ? `bad om en påminnelse ${whenWord(e.until)}` : 'bad om en påminnelse';
    case 'reminder-cancelled':
      return 'ångrade påminnelsen';
    case 'reminded':
      return 'påminde dig';
    case 'reminder-stopped':
      return 'stoppade påminnelsen eftersom behörigheten har ändrats';
    case 'dismissed':
      return 'avfärdade ärendet';
    case 'reopened':
      return 'återöppnade ärendet';
    case 'decided':
      return e.action ? `beslutade: ${e.action}` : 'fattade ett beslut';
    case 'undo-decided':
      return 'bad om att ångra beslutet';
    case 'answered': {
      // The receipt on the item is the latest decision's: its headline goes with that answer, read back from the source.
      const headline =
        thread.receipt && e.execution && e.execution === thread.execution?.id
          ? `: ${thread.receipt.headline.replace(/\.$/, '')}`
          : '';
      if (e.outcome === 'succeeded') return `läste tillbaka svaret från ${source}${headline}`;
      if (e.outcome === 'partial') return `läste tillbaka ett delvis svar från ${source}${headline}`;
      if (e.outcome === 'failed') return `fick beskedet att det inte gick att genomföra i ${source}${headline}`;
      return `fick inget säkert besked från ${source}`;
    }
    case 'undo-closed':
      return 'tiden att ångra gick ut';
    case 'resolved':
      return `såg att ärendet inte längre är öppet i ${source}`;
  }
}
/**
 * "Händelser" (board WorkItem, ActReceipt): what Clew and the person did to the item, newest first, with what Clew has
 * planned at the top (the person's reminder or the time a set-aside item comes back). Read from the item's audit rows;
 * the person is "Du", never by name, and nobody else is named.
 */
function Events({ thread }: { thread: Thread }) {
  const events = useQuery(itemEventsQuery(thread.id, thread.updatedAt));
  const planned = (thread.timers ?? [])
    .filter(t => t.state === 'scheduled')
    .map(t => ({
      key: `${t.kind}:${t.dueAt}`,
      words: t.kind === 'reminder' ? `påminner dig ${whenWord(t.dueAt)}` : `tar upp ärendet igen ${whenWord(t.dueAt)}`,
    }));
  if (events.isPending)
    return (
      <VStack gap={2} aria-busy="true">
        <Skeleton height={20} width="70%" />
        <Skeleton height={20} width="50%" />
      </VStack>
    );
  if (events.isError)
    return (
      <VStack gap={2}>
        <Text as="p">{errorMessage(events.error, 'Händelserna kunde inte hämtas just nu.')}</Text>
        <HStack>
          <Button
            size="sm"
            variant="secondary"
            label="Försök igen"
            isLoading={events.isFetching}
            onClick={() => void events.refetch()}
          />
        </HStack>
      </VStack>
    );
  const row = (key: string, by: 'you' | 'clew', words: string, when: string) => (
    <ListItem
      key={key}
      align="first-line"
      startContent={<Avatar name={by === 'you' ? 'Du' : 'Clew'} size="sm" tooltip={false} aria-hidden />}
      label={
        <HStack gap={2} wrap="wrap" vAlign="center">
          <Text weight="semibold">{by === 'you' ? 'Du' : 'Clew'}</Text>
          <Text type="supporting" color="secondary">
            {words}
          </Text>
        </HStack>
      }
      endContent={
        <Text type="supporting" color="secondary" textWrap="nowrap">
          {when}
        </Text>
      }
    />
  );
  return (
    <List density="compact" aria-label="Händelser, de senaste först">
      {planned.map(p => row(p.key, 'clew', p.words, 'planerat'))}
      {events.data.events.map((e, i) => row(`${e.at}:${i}`, e.by, eventWords(e, thread), whenWord(e.at)))}
    </List>
  );
}
const hasEvents = (thread: Thread) => !!thread.timers?.some(t => t.state === 'scheduled') || thread.kind === 'pushed';

/** The main column, each section only where it has something to say, with a rule between them. */
function MainColumn({
  thread,
  item,
  level,
  visual,
  idBase,
}: {
  thread: Thread;
  item: ItemState;
  /** The sections' heading level. */
  level: number;
  visual: 2 | 3 | 4;
  idBase: string;
}) {
  const { actions } = item;
  const receipt = thread.receipt;
  const documents = reviewedAction(thread)?.preview ? thread.items.some(i => i.selectable) : false;
  const id = (part: string) => `${idBase}-${thread.id}-${part}`;
  const sections: ReactNode[] = [
    !receipt && (
      <ItemSection key="why" id={id('why')} title="Varför ser jag detta?" level={level} visual={visual}>
        <Why thread={thread} />
      </ItemSection>
    ),
    !receipt && thread.items.length > 0 && (
      <ItemSection key="rows" id={id('rows')} title="Rader" level={level} visual={visual}>
        <Rows thread={thread} actions={actions} item={item} />
      </ItemSection>
    ),
    documents && (
      <ItemSection key="documents" id={id('documents')} title="Dokument" level={level} visual={visual}>
        <Documents thread={thread} />
      </ItemSection>
    ),
    hasEvents(thread) && (
      <ItemSection key="events" id={id('events')} title="Händelser" level={level} visual={visual}>
        <Events thread={thread} />
      </ItemSection>
    ),
  ].filter(Boolean);
  return (
    <VStack gap={6}>
      {receipt && <Receipt thread={thread} actions={actions} systems={item.systems} />}
      {sections.map((section, i) => (
        <VStack key={i} gap={6}>
          {i > 0 && <Divider />}
          {section}
        </VStack>
      ))}
    </VStack>
  );
}

/** What stands under the buttons when it applies: a reminder that could not be scheduled, a draft, a refusal. */
function Notes({ thread, item }: { thread: Thread; item: ItemState }) {
  const draft = thread.messages.at(-1)?.meta?.draft;
  return (
    <>
      <TimerNote thread={thread} />
      {draft && thread.state === 'open' && (
        <Text type="supporting" as="p">
          Utkast från samtalet. Inget är skickat förrän du trycker på knappen här.
        </Text>
      )}
      {item.actions.error && (
        <Text as="p" role="alert" color="accent">
          {item.actions.error}
        </Text>
      )}
      {item.actions.confirmation}
      {item.actions.dialog}
    </>
  );
}

/** Where a work item is drawn at its narrow width: the reading pane, the panel beside a page, a conversation's answer. */
export type ItemPlace = 'pane' | 'panel' | 'answer';
/**
 * The work item at its narrow width (D112 item 4): the source line, the title with "Öppna som sida", the status and the
 * badges, the buttons and what one of its reads unfolded, then the main column. An `article` named by its title.
 */
export function WorkItem({
  thread,
  place,
  headingLevel,
  onChange,
  folded = false,
}: {
  thread: Thread;
  place: ItemPlace;
  /** The title's level in the page's outline; the sections are one under it. */
  headingLevel: 2 | 3;
  onChange: (thread: Thread) => void;
  /**
   * A conversation about the item runs under it in the panel (D112 item 7): the header stays, with the status, the
   * badges and the buttons, and the main column folds under "Visa allt".
   */
  folded?: boolean;
}) {
  const idBase = place === 'answer' ? 'thread' : 'card';
  const item = useWorkItem(thread, onChange, idBase);
  // Beside a conversation (the panel, the reading pane) the header stands above the transcript, out of its scroll, as
  // the item's page keeps it in its LayoutHeader; what one of its reads unfolded and the main column scroll under it.
  const dock = useThingHead();
  const head = (
    <>
      <VStack gap={1}>
        <Text type="supporting" color="secondary">
          {[item.mark.source, item.mark.title].filter(Boolean).join('\u00a0· ')}
        </Text>
        <HStack gap={3} vAlign="start" wrap="wrap">
          <StackItem size="fill">
            <Heading
              ref={item.title}
              id={`${idBase}-${thread.id}-title`}
              tabIndex={-1}
              level={2}
              accessibilityLevel={headingLevel}
            >
              {thread.title}
            </Heading>
          </StackItem>
          <Button size="sm" variant="secondary" label="Öppna som sida" href={itemPageHref(thread.id, item.from)} />
        </HStack>
      </VStack>
      <StatusLine thread={thread} item={item} />
      <Notes thread={thread} item={item} />
      <ActionRow thread={thread} actions={item.actions} openRead={item.openRead} readSection={item.readSection} />
    </>
  );
  return (
    <VStack
      ref={item.root}
      gap={6}
      as="article"
      tabIndex={-1}
      aria-label={`Ärende: ${thread.title}`}
      id={`${idBase}-${thread.id}`}
    >
      {dock ? (
        <>
          {dock(
            <VStack ref={item.head} gap={3}>
              {head}
            </VStack>,
          )}
          {item.unfold}
        </>
      ) : (
        <VStack ref={item.head} gap={3}>
          {head}
          {item.unfold}
        </VStack>
      )}
      <Unfold folded={folded} animatedLayout={item.animatedLayout}>
        <MainColumn thread={thread} item={item} level={headingLevel + 1} visual={3} idBase={idBase} />
      </Unfold>
    </VStack>
  );
}

/**
 * The details rail (board WorkItem): "Detaljer" as the facts the item really has, "Berör" as the people and units its
 * rows name, linked to their pages, and "Öppna i källan" as the item's own read that leads out of Clew (D111 rule 8).
 */
function Details({ thread, item }: { thread: Thread; item: ItemState }) {
  const now = new Date().toISOString(),
    day = today();
  const state = stateOf(thread, now, day);
  const subjects = thread.items.filter(
    (i, n, all) => i.subject && all.findIndex(j => j.subject && sameSubject(j.subject, i.subject!)) === n,
  );
  const out = thread.actions.filter(a => a.kind === 'read' && a.target === 'link');
  const deadline = thread.deadline?.slice(0, 10);
  const days = deadline ? daysUntil(deadline, day) : null;
  return (
    <VStack gap={10}>
      <VStack gap={4}>
        <Heading level={3} accessibilityLevel={2}>
          Detaljer
        </Heading>
        <MetadataList>
          <MetadataListItem label="Status">
            <HStack gap={2} vAlign="center">
              <StatusDot variant={state.variant} label={state.label} />
              <Text>{state.label}</Text>
            </HStack>
          </MetadataListItem>
          <MetadataListItem label="Källa">
            <Text>{[item.mark.source, item.mark.title].filter(Boolean).join('\u00a0· ')}</Text>
          </MetadataListItem>
          {deadline && (
            <MetadataListItem label="Förfaller">
              <Text>
                {days === 0 ? 'I dag, ' : days === 1 ? 'I morgon, ' : ''}
                {longDate(deadline)}
              </Text>
            </MetadataListItem>
          )}
          {thread.waitingOn && thread.state === 'open' && (
            <MetadataListItem label="Väntar på">
              <Text>{capital(thread.waitingOn)}</Text>
            </MetadataListItem>
          )}
          {thread.snoozedUntil && thread.state === 'open' && (
            <MetadataListItem label="Tillbaka">
              <Text>{capital(whenWord(thread.snoozedUntil))}</Text>
            </MetadataListItem>
          )}
          <MetadataListItem label="Skapat">
            <Text>{capital(whenWord(thread.createdAt))}</Text>
          </MetadataListItem>
          {thread.handledAt && thread.state !== 'open' && (
            <MetadataListItem label={thread.state === 'dismissed' ? 'Avfärdat' : 'Klart'}>
              <Text>{capital(whenWord(thread.handledAt))}</Text>
            </MetadataListItem>
          )}
        </MetadataList>
      </VStack>
      {subjects.length > 0 && (
        <VStack gap={4}>
          <Heading level={3} accessibilityLevel={2}>
            Berör
          </Heading>
          <VStack gap={1}>
            {subjects.map(i => {
              const href = entityHref(i.subject!, item.from);
              const kind = i.subject!.entity === 'unit' ? 'Enhet' : 'Person';
              const body = (
                <VStack gap={0}>
                  <Text type="supporting" color="secondary">
                    {kind}
                  </Text>
                  <Text weight="semibold">{i.label}</Text>
                </VStack>
              );
              return href ? (
                <ClickableCard key={i.ref} label={`${kind}: ${i.label}`} href={href} padding={3}>
                  {body}
                </ClickableCard>
              ) : (
                <VStack key={i.ref}>{body}</VStack>
              );
            })}
          </VStack>
        </VStack>
      )}
      {out.length > 0 && (
        <VStack gap={4}>
          <Heading level={3} accessibilityLevel={2}>
            Öppna i källan
          </Heading>
          <VStack gap={2} hAlign="start">
            {out.map(a => (
              <Button
                key={a.id}
                variant="secondary"
                label={a.label}
                endContent={<Icon icon="externalLink" label="(öppnas i ny flik)" />}
                clickAction={() => item.actions.perform(a)}
              />
            ))}
          </VStack>
        </VStack>
      )}
    </VStack>
  );
}

/**
 * The work item as a page (D112 item 4, `/items/<threadId>`, the `work-item-detail` template): the trail back (to where
 * the person came from when Clew can name it, else Att göra) with the source, the title as the page's heading, the
 * status and badges and the buttons in the header; the main column; and the details rail, 340 px beside the column. At
 * 1024 px and below the rail's content is behind "Visa detaljer" in a fullscreen dialog, and on a phone the buttons are
 * pinned to the foot (board PhoneItem). On a short screen nothing is pinned and the page scrolls as one (1.4.10).
 */
export function WorkItemPage({
  thread,
  back,
  onChange,
  ask,
  panel,
}: {
  thread: Thread;
  back: { label: string; href: string };
  onChange: (thread: Thread) => void;
  /** "Fråga Clew" (D112 item 7, board Assistant), after the item's own buttons in the header. */
  ask?: ReactNode;
  /**
   * The page's panel (`usePagePanel`), in the end slot after the details rail. While it holds something beside the page
   * the details go behind "Visa detaljer", as they do in a narrow window, so the column keeps its width.
   */
  panel?: { end: ReactNode; occupied: boolean } | undefined;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const narrowWindow = useMediaQuery(narrowItemQuery);
  const narrow = narrowWindow || !!panel?.occupied;
  const short = useMediaQuery(shortQuery);
  const item = useWorkItem(thread, onChange, 'item');
  const [detailsOpen, setDetailsOpen] = useState(false);
  // The page opens on its heading (2.4.3), once per item: what the person came for.
  useEffect(() => {
    const frame = requestAnimationFrame(() => item.title.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [thread.id]);
  const pinned = mobile && !short && thread.state === 'open';
  const buttons = (
    <ActionRow
      thread={thread}
      actions={item.actions}
      pinned={pinned}
      openRead={item.openRead}
      readSection={item.readSection}
    />
  );
  const trail = (
    <HStack gap={3} wrap="wrap">
      <Link href={back.href} type="supporting" color="secondary">
        <HStack as="span" gap={1} vAlign="center">
          <Icon icon="chevronLeft" size="sm" />
          {back.label}
        </HStack>
      </Link>
      {!mobile && <Divider orientation="vertical" />}
      {!mobile && (
        <Text type="supporting" color="secondary">
          {[item.mark.source, item.mark.title].filter(Boolean).join('\u00a0· ')}
        </Text>
      )}
    </HStack>
  );
  const header = (
    <LayoutHeader padding={mobile ? 4 : 6} hasDivider>
      <VStack gap={mobile ? 3 : 4}>
        <HStack gap={2} vAlign="center" justify="between">
          {trail}
          {narrow && (
            <IconButton
              variant="secondary"
              label="Visa detaljer"
              tooltip="Visa detaljer"
              icon={<Icon icon="info" />}
              onClick={() => setDetailsOpen(true)}
            />
          )}
        </HStack>
        <VStack gap={2}>
          {mobile && (
            <Text type="supporting" color="secondary">
              {[item.mark.source, item.mark.title].filter(Boolean).join('\u00a0· ')}
            </Text>
          )}
          <HStack gap={4} vAlign="start" wrap="wrap">
            <StackItem size="fill">
              <Heading ref={item.title} tabIndex={-1} level={1}>
                {thread.title}
              </Heading>
            </StackItem>
            {!narrow && (
              <HStack gap={2} vAlign="center" wrap="wrap">
                {buttons}
                {ask}
              </HStack>
            )}
          </HStack>
        </VStack>
        <StatusLine thread={thread} item={item} />
        <Notes thread={thread} item={item} />
        {narrow && (!pinned || ask) && (
          <HStack gap={2} vAlign="center" wrap="wrap">
            {!pinned && buttons}
            {ask}
          </HStack>
        )}
      </VStack>
    </LayoutHeader>
  );
  const column = (
    <VStack gap={6}>
      {item.unfold}
      <MainColumn thread={thread} item={item} level={2} visual={2} idBase="item" />
    </VStack>
  );
  // The column scrolls in Astryx's ScrollableArea, which takes a tab stop while it scrolls, so an item whose column holds
  // nothing focusable can still be read by keyboard (axe: scrollable-region-focusable). On a short screen the page
  // scrolls as one instead (1.4.10).
  const content = short ? (
    <LayoutContent padding={mobile ? 4 : 6} isScrollable={false}>
      {column}
    </LayoutContent>
  ) : (
    <LayoutContent padding={0} isScrollable={false}>
      <ScrollableArea label="Ärendet" height="100%" padding={mobile ? 4 : 6}>
        {column}
      </ScrollableArea>
    </LayoutContent>
  );
  return (
    <>
      <Layout
        ref={item.root}
        height={short ? 'auto' : 'fill'}
        header={header}
        content={content}
        end={
          narrow ? (
            panel?.end
          ) : (
            <>
              <LayoutPanel
                width={340}
                padding={6}
                role="complementary"
                label="Detaljer"
                hasDivider
                isScrollable={!short}
              >
                <Details thread={thread} item={item} />
              </LayoutPanel>
              {panel?.end}
            </>
          )
        }
        footer={
          pinned ? (
            <LayoutFooter padding={3} hasDivider>
              {buttons}
            </LayoutFooter>
          ) : undefined
        }
      />
      <Dialog variant="fullscreen" isOpen={narrow && detailsOpen} onOpenChange={setDetailsOpen}>
        <Layout
          header={<DialogHeader title="Detaljer" onOpenChange={setDetailsOpen} />}
          content={
            <LayoutContent padding={4}>
              <Details thread={thread} item={item} />
            </LayoutContent>
          }
        />
      </Dialog>
    </>
  );
}
