import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { daysUntil, sameSubject, snoozeWhen, stockholmDate, type ItemEvent, type Thread } from '@clew/contracts';
import {
  ArrowLeftIcon,
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  CheckboxList,
  CheckboxListItem,
  Divider,
  DocumentTextIcon,
  Heading,
  HStack,
  Icon,
  IconButton,
  Layout,
  LayoutContent,
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
  useMediaQuery,
} from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { api } from '../api';
import { areasQuery, itemEventsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { executionStatus } from '../execution-status';
import { useMarks } from '../marks';
import { mobileQuery, shortQuery } from '../media';
import { readOf, withoutRead } from '../panel-address';
import { documentHref } from '../review-address';
import { canUndoReceipt, receiptComplete } from '../receipt-state';
import { entityHref } from '../person-address';
import { dueOf, fromClewItself, itemPageHref, noticeOf, rowsSaySomething, stateOf } from '../work-items';
import { readPageHref } from '../view-address';
import { useConversation } from './conversation-context';
import {
  ActionRow,
  ItemLabel,
  SystemLine,
  TimerNote,
  clock,
  leavingMark,
  reviewedAction,
  rowSystems,
  snoozedLabel,
  useMinutesLeft,
  useThreadActions,
  type Actions,
  type RowSystems,
} from './card';
import { StaleMark, useSilentSources } from './silent-sources';

/**
 * A thing, drawn once (D126 rules 1 and 2, boards Att göra and Ärende, `.claude/canvas/app/thing.tsx`): a work item is
 * the same parts wherever it is shown. Its page (`WorkItemPage`, `/items/<threadId>`, the `work-item-detail` template)
 * is the way back and the title, the buttons directly under the title, the read in the column and the facts in the end
 * `LayoutPanel` (above the read where the window is narrow). Att göra's reading pane (`WorkItem`, `place="pane"`) is the
 * source line, the title as the link to the page and the buttons, which never scroll out of view (the critique of
 * 2026-11-13 found an opened item showing its middle), then the facts, "Varför ser jag detta?", the rows and
 * "Händelser" under them. The same narrow item stands beside a conversation and in an answer. Nothing unfolds inside
 * the item (rule 3): each of its reads is a link to the read's own page. Every fact comes from the item itself or from
 * its audit rows (`/api/threads/<id>/events`); nothing is guessed, and a field with nothing behind it is not drawn.
 */

/** The template's own line for the facts (`work-item-detail`): in the end panel above it, above the read at and below it. */
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
/**
 * A due day as the title's badge says it (board Ärende: "Svara i dag"). A badge that only repeats the state's word
 * ("Påminnelse") is left out, as on the item's row.
 */
function dueBadge(thread: Thread, day: string) {
  const due = dueOf(thread, day);
  const state = stateOf(thread, new Date().toISOString(), day);
  if (!due || due.label === state.label) return null;
  const label =
    due.label === 'Försenad' || due.label === 'Påminnelse'
      ? due.label
      : `Svara ${due.label.toLocaleLowerCase('sv-SE')}`;
  return <Badge variant={due.variant} label={label} />;
}
/** The source line: the system and the area; an item from Clew itself names its area alone (`fromClewItself`). */
const sourceLine = (mark: { source: string; title: string }, own = false) =>
  [own ? '' : mark.source, mark.title].filter(Boolean).join(' · ');

/** Everything the parts of one work item share: its actions, its marks and where its reads lead. */
function useWorkItem(thread: Thread, onChange: (thread: Thread) => void) {
  const title = useRef<HTMLHeadingElement>(null);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const areas = useQuery(areasQuery).data;
  const views = areas?.views;
  // This page without a read from before D126 in its address: the way back from a read's page.
  const from = withoutRead(pathname, search);
  // A read inside Clew is a link to its own page (D116, D126 rule 3), with the page the item is on as the way back; a
  // read of Clew's own that declares the page its rows are worked on leads there instead (`declaredPage`).
  const readHref = (a: Thread['actions'][number]) =>
    a.kind === 'read' && a.target !== 'link' ? readPageHref(thread, a, from, views) : undefined;
  // An address from before D126 that unfolded one of this item's reads in it (`open-card`, `open-action`) leads to the
  // read's page in its place. Only a read is ever followed: an address never makes a decision.
  const unfolded = readOf(new URLSearchParams(search));
  const named =
    unfolded?.threadId === thread.id
      ? thread.actions.find(a => a.id === unfolded.actionId && a.kind === 'read' && a.target !== 'link')
      : undefined;
  const redirect = named && views !== undefined ? readPageHref(thread, named, from, views) : null;
  useLayoutEffect(() => {
    if (redirect) navigate(redirect, { replace: true });
  }, [redirect]);
  const actions = useThreadActions({ thread, onChange });
  const marks = useMarks();
  const mark = marks.ofThread(thread);
  const systems = rowSystems(thread, marks);
  // A notice leads with its text, and its link out stands after the text instead of among the buttons.
  const notice = noticeOf(thread);
  const omit = notice?.out ? [notice.out.id] : undefined;
  const own = fromClewItself(thread, areas?.systems);
  return { title, actions, mark, systems, own, from: pathname + search, readHref, notice, omit };
}
type ItemState = ReturnType<typeof useWorkItem>;

/** A section of the read: its heading and what it holds, named by the heading. */
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
    <VStack as="section" gap={2} aria-labelledby={id}>
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
            label={`${pending ? 'Ångra bekräftade' : 'Ångra'} · ${minutes} min kvar`}
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

/**
 * "Varför ser jag detta?" (board Ärende): the source's reason, where and when it came. The item's lead (its summary)
 * is the first paragraph of the read, above it (`Lead`).
 */
function Why({ thread }: { thread: Thread }) {
  return (
    <Text as="p">
      {thread.trigger.reason.replace(/\.$/, '')}. Ärendet kom från {thread.trigger.source} {whenWord(thread.trigger.at)}
      .
    </Text>
  );
}
/** The item's own words (board Ärende's first section): a notice's text, else its summary where it says more than the reason. */
function Lead({ thread, item }: { thread: Thread; item: ItemState }) {
  const notice = item.notice;
  if (notice) {
    const out = notice.out;
    if (!notice.paragraphs.length && !out) return null;
    // A notice (D112, amended 2026-11-12): what the person is asked to read, a paragraph per paragraph of the source's
    // text, and after it the item's link out to the whole of it, marked as leaving Clew (D111 rule 8).
    return (
      <VStack gap={3}>
        {notice.paragraphs.map((p, i) => (
          <Text key={i} as="p">
            {p}
          </Text>
        ))}
        {out && (
          <HStack>
            <Button
              variant="secondary"
              label={out.label}
              clickAction={() => item.actions.perform(out)}
              {...leavingMark(out)}
            />
          </HStack>
        )}
      </VStack>
    );
  }
  if (!thread.summary || thread.summary === thread.trigger.reason) return null;
  return <Text as="p">{thread.summary}</Text>;
}

/**
 * The rows (board Ärende's list in a card): Astryx's checkbox list where the rows are chosen for the item's action
 * (`selectable`, `selected`, `usesItems`), with how many are chosen; a plain list where they are not. A row that names a
 * person or a unit links to them (D97 item 6).
 */
function Rows({ thread, item }: { thread: Thread; item: ItemState }) {
  const conversation = useConversation();
  const open = thread.state === 'open';
  const { selected, setSelected, selectable } = item.actions;
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
      <Card padding={0}>
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
      </Card>
    </VStack>
  ) : (
    <Card padding={0}>
      <List density="balanced" hasDividers>
        {thread.items.map(i => (
          <ListItem
            key={i.ref}
            isSelected={conversation.chipped.includes(i.ref)}
            label={<ItemLabel item={i} from={item.from} />}
            description={describe(i.ref, i.detail)}
          />
        ))}
      </List>
    </Card>
  );
}

/**
 * "Dokument" (board Ärende): the document behind each row the item reviews one at a time (D70), where its action names
 * a `preview` read. Each is a link to the review's page at that row, where the document is drawn with the decision (D73,
 * amended 2026-11-12), and Back gives the focus to the link again.
 */
function Documents({ thread }: { thread: Thread }) {
  const { pathname, search } = useLocation();
  const rows = thread.items.filter(i => i.selectable);
  return (
    <Card padding={0}>
      <List hasDividers>
        {rows.map((row, step) => (
          <ListItem
            key={row.ref}
            startContent={<Icon icon={DocumentTextIcon} color="secondary" />}
            label={
              <Link
                href={documentHref(thread.id, step, pathname + search)}
                color="primary"
                aria-label={`Öppna underlaget för ${row.label}`}
              >
                {row.label}
              </Link>
            }
            description={<Text type="supporting">{`Underlag från ${thread.trigger.source}`}</Text>}
          />
        ))}
      </List>
    </Card>
  );
}

/** What one event says, after who did it (board Ärende's Händelser). Facts the item holds; never a model's words. */
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
 * "Händelser" (board Ärende): what Clew and the person did to the item, newest first, with what Clew has planned at the
 * top (the person's reminder or the time a set-aside item comes back), each a row of a list in a card with when under
 * it. Read from the item's audit rows; the person is "Du", never by name, and nobody else is named.
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
      startContent={<Avatar name={by === 'you' ? 'Du' : 'Clew'} size="xsm" tooltip={false} aria-hidden />}
      // As Text, which wraps: a label given as a string is cut to one line, and what is cut cannot be read (1.4.10).
      label={<Text>{`${by === 'you' ? 'Du' : 'Clew'} ${words}`}</Text>}
      description={<Text type="supporting">{when}</Text>}
    />
  );
  return (
    <Card padding={0}>
      <List hasDividers aria-label="Händelser, de senaste först">
        {planned.map(p => row(p.key, 'clew', p.words, 'planerat'))}
        {events.data.events.map((e, i) => row(`${e.at}:${i}`, e.by, eventWords(e, thread), whenWord(e.at)))}
      </List>
    </Card>
  );
}
const hasEvents = (thread: Thread) => !!thread.timers?.some(t => t.state === 'scheduled') || thread.kind === 'pushed';

/**
 * The facts (board Ärende's `MetadataList`, the page's end panel and the pane under the buttons): the state with its
 * dot, the people and units the rows name as links to their pages, when it is due, what it waits on and when it comes
 * back, the source, when it came and when it was handled. Only what the item really has.
 */
function Facts({ thread, item }: { thread: Thread; item: ItemState }) {
  const now = new Date().toISOString(),
    day = today();
  const state = stateOf(thread, now, day);
  const subjects = thread.items.filter(
    (i, n, all) => i.subject && all.findIndex(j => j.subject && sameSubject(j.subject, i.subject!)) === n,
  );
  const due = dueOf(thread, day);
  const deadline = thread.deadline?.slice(0, 10);
  const days = deadline ? daysUntil(deadline, day) : null;
  return (
    <MetadataList>
      <MetadataListItem label="Status">
        <HStack gap={2} vAlign="center">
          <StatusDot variant={state.variant} label={state.label} aria-hidden />
          <Text>{state.label}</Text>
        </HStack>
      </MetadataListItem>
      {subjects.length > 0 && (
        <MetadataListItem label="Berör">
          <VStack gap={1} hAlign="start">
            {subjects.map(i => {
              const href = entityHref(i.subject!, item.from);
              return (
                // The row's own words: a source names the person or unit by key alone, so no face or name is guessed.
                href ? (
                  <Link key={i.ref} href={href}>
                    {i.label}
                  </Link>
                ) : (
                  <Text key={i.ref}>{i.label}</Text>
                )
              );
            })}
          </VStack>
        </MetadataListItem>
      )}
      {deadline && (
        <MetadataListItem label="Svara senast">
          <HStack gap={2} vAlign="center" wrap="wrap">
            {due ? <Badge variant={due.variant} label={due.label.toLocaleLowerCase('sv-SE')} /> : null}
            {(!due || days === null || days > 1) && <Text>{longDate(deadline)}</Text>}
          </HStack>
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
      {/* An item from Clew itself has no source to name (`fromClewItself`). */}
      {!item.own && (
        <MetadataListItem label="Källa">
          <Text>{sourceLine(item.mark)}</Text>
        </MetadataListItem>
      )}
      <MetadataListItem label="Kom">
        <Text>{capital(whenWord(thread.createdAt))}</Text>
      </MetadataListItem>
      {thread.handledAt && thread.state !== 'open' && (
        <MetadataListItem label={thread.state === 'dismissed' ? 'Avfärdat' : 'Klart'}>
          <Text>{capital(whenWord(thread.handledAt))}</Text>
        </MetadataListItem>
      )}
    </MetadataList>
  );
}

/**
 * The read, under the facts in the pane and in the page's column, each part only where it has something to say: the
 * receipt after a decision, the item's own words (a notice's text, its summary), "Varför ser jag detta?" (not after a
 * decision), the rows (not when their one row is the item itself, `rowsSaySomething`), "Dokument" and "Händelser".
 */
function Read({
  thread,
  item,
  level,
  visual,
  idBase,
  facts,
}: {
  thread: Thread;
  item: ItemState;
  /** The sections' heading level. */
  level: number;
  visual: 2 | 3;
  idBase: string;
  /** The facts, where they stand in the read's flow (the pane, a narrow page): first, with a rule under them. */
  facts?: ReactNode;
}) {
  const receipt = thread.receipt;
  const documents = reviewedAction(thread)?.preview ? thread.items.some(i => i.selectable) : false;
  const id = (part: string) => `${idBase}-${thread.id}-${part}`;
  return (
    <VStack gap={6}>
      {receipt && <Receipt thread={thread} actions={item.actions} systems={item.systems} />}
      {facts}
      <Lead thread={thread} item={item} />
      {!receipt && (
        <ItemSection id={id('why')} title="Varför ser jag detta?" level={level} visual={visual}>
          <Why thread={thread} />
        </ItemSection>
      )}
      {!receipt && rowsSaySomething(thread) && (
        <ItemSection id={id('rows')} title="Rader" level={level} visual={visual}>
          <Rows thread={thread} item={item} />
        </ItemSection>
      )}
      {documents && (
        <ItemSection id={id('documents')} title="Dokument" level={level} visual={visual}>
          <Documents thread={thread} />
        </ItemSection>
      )}
      {hasEvents(thread) && (
        <ItemSection id={id('events')} title="Händelser" level={level} visual={visual}>
          <Events thread={thread} />
        </ItemSection>
      )}
    </VStack>
  );
}

/**
 * What stands under the buttons when it applies: a reminder that could not be scheduled, a draft, a refusal, a system
 * that may be old; and the confirmation and the action dialog the buttons open.
 */
function Notes({ thread, item }: { thread: Thread; item: ItemState }) {
  const draft = thread.messages.at(-1)?.meta?.draft;
  const silent = useSilentSources().of(thread.connector);
  return (
    <>
      <TimerNote thread={thread} />
      {draft && thread.state === 'open' && (
        <Text type="supporting" as="p">
          Utkast från samtalet. Inget är skickat förrän du trycker på knappen här.
        </Text>
      )}
      {silent && thread.state === 'open' && <StaleMark silent={silent} />}
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
/** What the item's state does not say by itself, beside its title: set aside until when, or what it waits on. */
function waitWords(thread: Thread): string | null {
  if (thread.state !== 'open') return null;
  const now = new Date().toISOString();
  if (thread.snoozedUntil && Date.parse(thread.snoozedUntil) > Date.parse(now))
    return snoozedLabel(thread.snoozedUntil);
  const reminder = thread.timers?.find(t => t.kind === 'reminder' && t.state === 'scheduled');
  return thread.waitingOn && reminder && !thread.waitingOn.startsWith('påminnelsen ')
    ? `Påminner dig ${snoozeWhen(reminder.dueAt, now)}`
    : null;
}

/** Where a work item is drawn at its narrow width: Att göra's reading pane, beside a conversation, in an answer. */
export type ItemPlace = 'pane' | 'panel' | 'answer';
/**
 * The work item at its narrow width (D126 rule 2, board Att göra's pane): the source line, the title as the link to the
 * item's page (the name is the way in; "Öppna som sida" is gone) with ✕ beside it where the item can be let go of, the
 * buttons directly under the title, then a rule and the read with the facts first. In the reading pane the head stands
 * still and the read scrolls under it, so the decision never leaves the screen; on a short screen (1.4.10) and in an
 * answer it all follows in one flow. An `article` named by its title.
 */
export function WorkItem({
  thread,
  place,
  headingLevel,
  onChange,
  onClose,
  ask,
}: {
  thread: Thread;
  place: ItemPlace;
  /** The title's level in the page's outline; the sections are one under it. */
  headingLevel: 2 | 3;
  onChange: (thread: Thread) => void;
  /** Kept for the callers from before D126; nothing folds any more (rule 3). */
  folded?: boolean;
  /** Let go of the item where it is open beside a list: its ✕, at the end of the title's row. */
  onClose?: () => void;
  /** "Fråga Clew" among the buttons (`AskClew`); absent beside the conversation about the item and in its answers. */
  ask?: ReactNode;
}) {
  const short = useMediaQuery(shortQuery);
  const idBase = place === 'answer' ? 'thread' : 'card';
  const item = useWorkItem(thread, onChange);
  const pinnedHead = place === 'pane' && !short;
  const inset = place === 'pane' ? 6 : 0;
  const head = (
    <VStack gap={3}>
      <HStack gap={3} vAlign="start">
        <StackItem size="fill">
          <VStack gap={1}>
            <Text type="supporting" color="secondary">
              {sourceLine(item.mark, item.own)}
            </Text>
            <Heading
              ref={item.title}
              id={`${idBase}-${thread.id}-title`}
              tabIndex={-1}
              level={2}
              accessibilityLevel={headingLevel}
            >
              <Link href={itemPageHref(thread.id, item.from)} color="primary" type="inherit" weight="semibold">
                {thread.title}
              </Link>
            </Heading>
            {waitWords(thread) && <Text type="supporting">{waitWords(thread)}</Text>}
          </VStack>
        </StackItem>
        {onClose && (
          <IconButton variant="ghost" size="sm" label="Stäng ärendet" icon={<Icon icon="close" />} onClick={onClose} />
        )}
      </HStack>
      <ActionRow thread={thread} actions={item.actions} readHref={item.readHref} omit={item.omit} ask={ask} />
      <Notes thread={thread} item={item} />
    </VStack>
  );
  const read = (
    <Read
      thread={thread}
      item={item}
      level={headingLevel + 1}
      visual={3}
      idBase={idBase}
      facts={<Facts thread={thread} item={item} />}
    />
  );
  if (pinnedHead)
    return (
      <VStack
        as="article"
        height="100%"
        tabIndex={-1}
        aria-label={`Ärende: ${thread.title}`}
        id={`${idBase}-${thread.id}`}
      >
        <VStack paddingInline={inset} paddingBlockStart={inset} paddingBlockEnd={4} gap={4}>
          {head}
          <Divider />
        </VStack>
        <StackItem size="fill">
          <ScrollableArea label="Ärendet" height="100%" paddingInline={inset} paddingBlockEnd={inset}>
            {read}
          </ScrollableArea>
        </StackItem>
      </VStack>
    );
  return (
    <VStack
      as="article"
      gap={6}
      padding={inset}
      tabIndex={-1}
      aria-label={`Ärende: ${thread.title}`}
      id={`${idBase}-${thread.id}`}
    >
      {head}
      <Divider />
      {read}
    </VStack>
  );
}

/**
 * The work item as a page (D126 rule 1, `/items/<threadId>`, the `work-item-detail` template, board Ärende): in the
 * header the way back (to where the person came from when Clew can name it, else Att göra) with the source beside it,
 * the title as the page's heading with when it is due, and the buttons directly under it; the read in the column; the
 * facts under "Uppgifter" in the end panel, 340 px beside the column, and above the read at 1024 px and below. On a short
 * screen nothing is pinned and the page scrolls as one (1.4.10).
 */
export function WorkItemPage({
  thread,
  back,
  onChange,
  ask,
}: {
  thread: Thread;
  back: { label: string; href: string };
  onChange: (thread: Thread) => void;
  /** "Fråga Clew" (`AskClew`), after the decisions. */
  ask?: ReactNode;
  /** Kept for the callers from before D126: nothing stands beside the page any more (rule 3). */
  panel?: { end: ReactNode; occupied: boolean } | undefined;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const narrow = useMediaQuery(narrowItemQuery);
  const short = useMediaQuery(shortQuery);
  const item = useWorkItem(thread, onChange);
  // The page opens on its heading (2.4.3), once per item: what the person came for.
  useEffect(() => {
    const frame = requestAnimationFrame(() => item.title.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [thread.id]);
  const day = today();
  const header = (
    <LayoutHeader padding={mobile ? 4 : 6} hasDivider>
      <VStack gap={4}>
        <VStack gap={2}>
          <HStack gap={4} vAlign="center" wrap="wrap">
            <Link href={back.href} type="supporting" color="secondary">
              <HStack as="span" gap={1} vAlign="center">
                <Icon icon={ArrowLeftIcon} size="sm" />
                {back.label}
              </HStack>
            </Link>
            <Text type="supporting" color="secondary">
              {sourceLine(item.mark, item.own)}
            </Text>
          </HStack>
          <HStack gap={3} vAlign="center" wrap="wrap">
            <Heading ref={item.title} tabIndex={-1} level={1}>
              {thread.title}
            </Heading>
            {dueBadge(thread, day)}
          </HStack>
          {waitWords(thread) && <Text type="supporting">{waitWords(thread)}</Text>}
        </VStack>
        <ActionRow thread={thread} actions={item.actions} readHref={item.readHref} omit={item.omit} ask={ask} />
        <Notes thread={thread} item={item} />
      </VStack>
    </LayoutHeader>
  );
  const facts = <Facts thread={thread} item={item} />;
  const column = (
    <Read thread={thread} item={item} level={2} visual={2} idBase="item" facts={narrow ? facts : undefined} />
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
    <Layout
      height={short ? 'auto' : 'fill'}
      header={header}
      content={content}
      end={
        narrow ? undefined : (
          <LayoutPanel width={340} padding={6} role="complementary" label="Uppgifter" hasDivider isScrollable={!short}>
            <VStack gap={4}>
              <Heading level={3} accessibilityLevel={2}>
                Uppgifter
              </Heading>
              {facts}
            </VStack>
          </LayoutPanel>
        )
      }
    />
  );
}
