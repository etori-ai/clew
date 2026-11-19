import { Fragment, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { daysUntil, sameSubject, type ItemEvent, type ReceiptRow, type Thread, type ThreadItem } from '@clew/contracts';
import {
  AreaMark,
  Badge,
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
  Link,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  ScrollableArea,
  Skeleton,
  StackItem,
  StatusMark,
  Text,
  VStack,
  XMarkIcon,
  useMediaQuery,
} from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { areasQuery, itemEventsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { executionStatus } from '../execution-status';
import { useMarks } from '../marks';
import { shortQuery } from '../media';
import { readOf, withoutRead } from '../panel-address';
import { documentHref, reviewHref } from '../review-address';
import { entityHref } from '../person-address';
import { outcomeStatus, receiptRowsInOrder, type ItemStatus } from '../status-of';
import { dueOf, fromClewItself, itemPageHref, noticeOf, rowsSaySomething } from '../work-items';
import { readPageHref } from '../view-address';
import { whenWord } from '../when-word';
import { useConversation } from './conversation-context';
import {
  ActionRow,
  ItemLabel,
  SystemLine,
  TimerNote,
  leavingMark,
  reviewedAction,
  rowSystems,
  useThreadActions,
} from './card';
import { StaleMark, silentLine, useSilentSources } from './silent-sources';
import { PageFrame, narrowPageQuery } from './page-frame';
import { FoldedSection, ItemSection } from './item-section';

export { whenWord } from '../when-word';

/**
 * A thing, drawn once (D126 rules 1 and 2, boards Att göra, Ärende and StatusPanel, `.claude/canvas/app/thing.tsx`): a
 * work item is the same parts wherever it is shown. Its page (`WorkItemPage`, `/items/<threadId>`, the
 * `work-item-detail` template) is the way back and the title, the buttons or the status notice directly under the
 * title, the read in the column and the facts in the end `LayoutPanel` (above the read where the window is narrow). Att
 * göra's reading pane (`WorkItem`, `place="pane"`) is the source line, the title as the link to the page and the buttons
 * or the notice, which never scroll out of view (the critique of 2026-11-13 found an opened item showing its middle),
 * then the sections. The same narrow item stands beside a conversation and in an answer.
 *
 * The read is named sections in one order (D126 item 13), each under a rule with its count beside its name:
 * "Uppgifter" (the facts, in the pane and on a narrow page), what the item consists of (a notice's text, "Meddelandet";
 * the rows, "Rader", which for an item reviewed one row at a time are also its documents, so they are listed once), "Varför
 * ser jag detta?" (the source's reason and the item's own summary), and "Händelser", folded. The state is said once, in
 * the notice: no fact repeats it. Nothing unfolds inside the item but Händelser (rule 3): each of its reads is a link to
 * the read's own page. Every fact comes from the item itself or from its audit rows (`/api/threads/<id>/events`);
 * nothing is guessed, and a field with nothing behind it is not drawn.
 */

const longDate = (date: string) =>
  new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(date.slice(0, 10) + 'T12:00:00Z'),
  );
const capital = (s: string) => (s ? s[0]!.toLocaleUpperCase('sv-SE') + s.slice(1) : s);
/** The person has decided, or the item is no longer theirs: when it was due is a plain fact, never a red badge. */
const decided = (thread: Thread) => !!thread.execution || !!thread.receipt || thread.state !== 'open';
/**
 * A due day as the title's badge says it (board Ärende: "Svara i dag"), on a plain to-do only: once the person has
 * decided, the notice says where it stands and the day is a fact (D126 item 13). A badge that only repeats the row's
 * word ("Påminnelse") is left out, as on the item's row.
 */
function dueBadge(thread: Thread, day: string) {
  const due = decided(thread) ? null : dueOf(thread, day);
  if (!due || due.label === 'Påminnelse') return null;
  const label = due.label === 'Försenad' ? due.label : `Svara ${due.label.toLocaleLowerCase('sv-SE')}`;
  return <Badge variant={due.variant} label={label} />;
}
/** The source line: the system and the area; an item from Clew itself names its area alone (`fromClewItself`). */
const sourceLine = (mark: { source: string; title: string }, own = false) =>
  [own ? '' : mark.source, mark.title].filter(Boolean).join(' · ');

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
  const here = pathname + search;
  // Where the rows stand: the receipt's, read back, once there is one; else the item's own (`rowsSaySomething`).
  // The rows say something (`rowsSaySomething`), or the receipt read back more than one: a notice's one row, which is
  // the notice itself, is never a section of its own.
  const rowsShown = rowsSaySomething(thread) || (thread.receipt?.rows.length ?? 0) > 1;
  // Each row has a document behind it, read on the review's page (D70, D73 amended 2026-11-12).
  const documents = !!reviewedAction(thread)?.preview && thread.items.some(i => i.selectable);
  return { title, actions, mark, systems, own, from: here, readHref, notice, omit, rowsShown, documents };
}
type ItemState = ReturnType<typeof useWorkItem>;

/**
 * "Varför ser jag detta?" (board Ärende): the source's reason, where and when it came, and the item's own summary where
 * it says more than the reason (the invoices' match): no sentence of the item's stands without a heading.
 */
function Why({ thread, item }: { thread: Thread; item: ItemState }) {
  const summary = !item.notice && thread.summary && thread.summary !== thread.trigger.reason ? thread.summary : null;
  return (
    <VStack gap={3}>
      <Text as="p">
        {thread.trigger.reason.replace(/\.$/, '')}. Ärendet kom från {thread.trigger.source}{' '}
        {whenWord(thread.trigger.at)}.
      </Text>
      {summary && <Text as="p">{summary}</Text>}
    </VStack>
  );
}
/**
 * A notice's text (D112, amended 2026-11-12): what the person is asked to read, a paragraph per paragraph of the
 * source's text, and after it the item's link out to the whole of it, marked as leaving Clew (D111 rule 8).
 */
function NoticeText({ item }: { item: ItemState }) {
  const notice = item.notice!;
  const out = notice.out;
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

/**
 * A row's name: for an item reviewed one row at a time with a document behind each row (D70, D73 amended 2026-11-12),
 * the link to the review's page at that row, where the document is drawn with the decision, so the rows and their
 * documents are one list (board StatusPanel's "Fakturor", D126 item 13) and Back gives the focus to the link again;
 * otherwise the row's own name (`ItemLabel`).
 */
function RowName({
  thread,
  item,
  row,
  semibold = false,
}: {
  thread: Thread;
  item: ItemState;
  row: { ref: string; label: string; subject?: ThreadItem['subject'] };
  semibold?: boolean;
}) {
  const step = item.documents ? thread.items.filter(i => i.selectable).findIndex(i => i.ref === row.ref) : -1;
  if (step >= 0)
    return (
      <Link
        href={documentHref(thread.id, step, item.from)}
        color="primary"
        weight={semibold ? 'semibold' : 'normal'}
        aria-label={`Öppna underlaget för ${row.label}`}
      >
        {row.label}
      </Link>
    );
  const own = thread.items.find(i => i.ref === row.ref);
  return own ? (
    <ItemLabel item={own} from={item.from} />
  ) : (
    <Text weight={semibold ? 'semibold' : 'normal'}>{row.label}</Text>
  );
}

/**
 * The rows as the item has them before a decision (board Ärende's list in a card): Astryx's checkbox list where the rows
 * are chosen for the item's action (`selectable`, `selected`, `usesItems`), with how many are chosen, a review begun on
 * its page laid over the ticks; a plain list where they are not. A row that names a person or a unit links to them (D97
 * item 6); a row with a document leads to it.
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
              label={<RowName thread={thread} item={item} row={i} />}
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
            {...(item.documents ? { startContent: <Icon icon={DocumentTextIcon} color="secondary" /> } : {})}
            label={<RowName thread={thread} item={item} row={i} />}
            description={describe(i.ref, i.detail)}
          />
        ))}
      </List>
    </Card>
  );
}

/** A receipt row's state: its mark in the vocabulary, or "Inte skickad" for a row that was never sent. */
function Outcome({ outcome }: { outcome: ReceiptRow['outcome'] }) {
  const kind = outcomeStatus(outcome);
  return kind ? (
    <StatusMark kind={kind} />
  ) : (
    <Text type="supporting" color="secondary">
      Inte skickad
    </Text>
  );
}
/**
 * The receipt's rows after a decision (D70, board StatusPanel's "Fakturor"): each row read back, the unresolved first
 * and in semibold, its state's mark at its end (D126 item 13), the system that answered under it when the rows come from
 * several, and its document a link away where it has one.
 */
function ReceiptRows({ thread, item }: { thread: Thread; item: ItemState }) {
  const rows = receiptRowsInOrder(thread.receipt!.rows);
  return (
    <Card padding={0}>
      <List density="balanced" hasDividers aria-label="Kvitto, rad för rad">
        {rows.map(r => {
          const unresolved = r.outcome === 'unknown' || r.outcome === 'failed';
          return (
            <ListItem
              key={r.ref}
              {...(item.documents ? { startContent: <Icon icon={DocumentTextIcon} color="secondary" /> } : {})}
              label={<RowName thread={thread} item={item} row={r} semibold={unresolved} />}
              description={
                item.systems.multi ? (
                  <SystemLine mark={item.systems.of.get(r.ref)} words={r.detail} />
                ) : (
                  <Text type="supporting">{r.detail}</Text>
                )
              }
              endContent={<Outcome outcome={r.outcome} />}
            />
          );
        })}
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
 * "Händelser" (boards Ärende and StatusPanel): what Clew and the person did to the item, newest first, with what Clew
 * has planned at the top (the person's reminder or the time a set-aside item comes back), each a row of a list in a card
 * with when under it. Read from the item's audit rows; the person is "Du", never by name, and nobody else is named.
 * Folded by default (D126 item 13), with how many beside its name once they are read.
 */
function Events({ thread, of }: { thread: Thread; of?: string | undefined }) {
  const events = useQuery(itemEventsQuery(thread.id, thread.updatedAt));
  const planned = (thread.timers ?? [])
    .filter(t => t.state === 'scheduled')
    .map(t => ({
      key: `${t.kind}:${t.dueAt}`,
      words: t.kind === 'reminder' ? `påminner dig ${whenWord(t.dueAt)}` : `tar upp ärendet igen ${whenWord(t.dueAt)}`,
    }));
  // Who did it is the first word of the row (board Ärende's Händelser), with no mark before it.
  const row = (key: string, by: 'you' | 'clew', words: string, when: string) => (
    <ListItem
      key={key}
      // As Text, which wraps: a label given as a string is cut to one line, and what is cut cannot be read (1.4.10).
      label={<Text>{`${by === 'you' ? 'Du' : 'Clew'} ${words}`}</Text>}
      description={<Text type="supporting">{when}</Text>}
    />
  );
  const body = events.isPending ? (
    <VStack gap={2} aria-busy="true">
      <Skeleton height={20} width="70%" />
      <Skeleton height={20} width="50%" />
    </VStack>
  ) : events.isError ? (
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
  ) : (
    <Card padding={0}>
      <List hasDividers aria-label="Händelser, de senaste först">
        {planned.map(p => row(p.key, 'clew', p.words, 'planerat'))}
        {events.data.events.map((e, i) => row(`${e.at}:${i}`, e.by, eventWords(e, thread), whenWord(e.at)))}
      </List>
    </Card>
  );
  return (
    <FoldedSection
      title="Händelser"
      countWord="händelser"
      of={of}
      count={events.data ? planned.length + events.data.events.length : undefined}
    >
      {body}
    </FoldedSection>
  );
}
const hasEvents = (thread: Thread) => !!thread.timers?.some(t => t.state === 'scheduled') || thread.kind === 'pushed';

/**
 * The facts (board StatusPanel's `MetadataList`, the page's end panel and the pane's "Uppgifter"): the people and units
 * the rows name as links to their pages, when it is due, the source and when it came. Only what the item really has.
 * Where the item stands, what it waits on, when it comes back and when it was done are the notice's (D126 item 13: the
 * state is said once). When it was due is a badge while it is the person's to decide, and a plain date once decided.
 */
function Facts({ thread, item, columns }: { thread: Thread; item: ItemState; columns?: number | 'multi' }) {
  const day = today();
  const subjects = thread.items.filter(
    (i, n, all) => i.subject && all.findIndex(j => j.subject && sameSubject(j.subject, i.subject!)) === n,
  );
  const due = decided(thread) ? null : dueOf(thread, day);
  const deadline = thread.deadline?.slice(0, 10);
  const days = deadline ? daysUntil(deadline, day) : null;
  return (
    <MetadataList {...(columns ? { columns } : {})}>
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
      {/* An item from Clew itself has no source to name (`fromClewItself`). */}
      {!item.own && (
        <MetadataListItem label="Källa">
          <Text>{sourceLine(item.mark)}</Text>
        </MetadataListItem>
      )}
      <MetadataListItem label="Kom">
        <Text>{capital(whenWord(thread.createdAt))}</Text>
      </MetadataListItem>
    </MetadataList>
  );
}

/**
 * The read, under the head in the pane and in the page's column: its sections in their order, each only where it has
 * something to say, the first without the rule the head already draws above it.
 */
function Read({
  thread,
  item,
  level,
  idBase,
  facts,
  gap = 6,
  named,
}: {
  thread: Thread;
  item: ItemState;
  /** The sections' heading level. */
  level: number;
  idBase: string;
  /** The facts, where they stand in the read's flow (the pane, a narrow page): the first section. */
  facts?: ReactNode;
  /** The space between the sections: the pane's step (board StatusPanel), or the page's wider one (board Ärende). */
  gap?: 6 | 8;
  /**
   * In an answer, where another item can stand beside the transcript or in another answer: each section is named by
   * its heading and the item's title, so no two regions on the page share a name.
   */
  named?: boolean;
}) {
  const receipt = thread.receipt;
  const status = item.actions.status;
  const id = (part: string) => `${idBase}-${thread.id}-${part}`;
  const of = named ? id('title') : undefined;
  const rowCount = receipt?.rows.length || thread.items.length;
  // The decided review is seen again from the end of the rows' heading (board StatusPanel: "Visa granskningen").
  const reviewLink = status.review ? (
    <Link href={reviewHref(thread.id, { from: item.from })}>Visa granskning</Link>
  ) : undefined;
  const sections: { key: string; draw: (divided: boolean) => ReactNode }[] = [];
  if (facts)
    sections.push({
      key: 'facts',
      draw: d => (
        <ItemSection divided={d} of={of} id={id('facts')} title="Uppgifter" level={level}>
          <Card variant="muted" padding={4}>
            {facts}
          </Card>
        </ItemSection>
      ),
    });
  if (item.notice && (item.notice.paragraphs.length || item.notice.out))
    sections.push({
      key: 'notice',
      draw: d => (
        <ItemSection divided={d} of={of} id={id('notice')} title="Meddelandet" level={level}>
          <NoticeText item={item} />
        </ItemSection>
      ),
    });
  if (item.rowsShown)
    sections.push({
      key: 'rows',
      draw: d => (
        <ItemSection divided={d} of={of} id={id('rows')} title="Rader" level={level} count={rowCount} end={reviewLink}>
          {receipt?.rows.length ? <ReceiptRows thread={thread} item={item} /> : <Rows thread={thread} item={item} />}
        </ItemSection>
      ),
    });
  // Also after a decision (board StatusPanel): why the item came still answers why it is here. Folded and in the body
  // size wherever an item is drawn (the product owner, 2026-11-16): it explains, and stood before what is acted on.
  sections.push({
    key: 'why',
    draw: () => (
      <FoldedSection title="Varför ser jag detta?" quiet of={of}>
        <Why thread={thread} item={item} />
      </FoldedSection>
    ),
  });
  return (
    <VStack gap={gap}>
      {sections.map((s, i) => (
        <Fragment key={s.key}>{s.draw(i > 0)}</Fragment>
      ))}
      {hasEvents(thread) && <Events thread={thread} of={of} />}
    </VStack>
  );
}

/**
 * What stands under the buttons or the notice when it applies: a reminder that could not be scheduled, a draft, a
 * refusal, a system that may be old (unless the notice already says it does not answer); and the confirmation and the
 * action dialog the buttons open.
 */
function Notes({ thread, item, status }: { thread: Thread; item: ItemState; status: ItemStatus }) {
  const draft = thread.messages.at(-1)?.meta?.draft;
  const silent = useSilentSources().of(thread.connector);
  const said = !!silent && !!status.notice?.description?.includes(silentLine(silent));
  return (
    <>
      <TimerNote thread={thread} />
      {draft && thread.state === 'open' && (
        <Text type="supporting" as="p">
          Utkast från samtalet. Inget är skickat förrän du trycker på knappen här.
        </Text>
      )}
      {silent && thread.state === 'open' && !said && <StaleMark silent={silent} />}
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

/** Where a work item is drawn at its narrow width: Att göra's reading pane, beside a conversation, in an answer. */
export type ItemPlace = 'pane' | 'answer';
/**
 * The work item at its narrow width (D126 rule 2, board StatusPanel's pane): the source line, the title as the link to
 * the item's page (the name is the way in; "Öppna som sida" is gone) with ✕ beside it where the item can be let go of,
 * the buttons or the status notice directly under the title, then a rule and the read with "Uppgifter" first. In the
 * reading pane the head stands still and the read scrolls under it, so the decision never leaves the screen; on a short
 * screen (1.4.10) and in an answer it all follows in one flow. An `article` named by its title.
 */
export function WorkItem({
  thread,
  place,
  headingLevel,
  onChange,
  onClose,
  ask,
  marked,
  tools,
}: {
  thread: Thread;
  place: ItemPlace;
  /** The title's level in the page's outline; the sections are one under it. */
  headingLevel: 2 | 3;
  onChange: (thread: Thread) => void;
  /** Let go of the item where it is open beside a list: its ✕, at the end of the title's row. */
  onClose?: () => void;
  /** "Fråga assistenten" among the buttons (`AskClew`); absent beside the conversation about the item and in its answers. */
  ask?: ReactNode;
  /** Beside a conversation: the area's mark at the start of the header, before the source line that says it in words. */
  marked?: boolean;
  /** Beside a conversation: what stands before ✕ at the end of the title's row (the menu over what the conversation has named). */
  tools?: ReactNode;
}) {
  const short = useMediaQuery(shortQuery);
  const idBase = place === 'answer' ? 'thread' : 'card';
  const item = useWorkItem(thread, onChange);
  const pinnedHead = place === 'pane' && !short;
  const inset = place === 'pane' ? 6 : 0;
  const head = (
    <VStack gap={4}>
      <HStack gap={3} vAlign="start">
        {marked && <AreaMark ordinal={item.mark.ordinal} icon={item.mark.icon} />}
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
          </VStack>
        </StackItem>
        {(tools || onClose) && (
          <HStack gap={1} vAlign="center">
            {tools}
            {onClose && (
              <IconButton
                variant="ghost"
                label="Stäng ärendet"
                icon={<Icon icon={XMarkIcon} size="sm" />}
                onClick={onClose}
              />
            )}
          </HStack>
        )}
      </HStack>
      <ActionRow
        thread={thread}
        actions={item.actions}
        readHref={item.readHref}
        omit={item.omit}
        ask={ask}
        titleRef={item.title}
        reviewShown={item.rowsShown}
        beside={place === 'pane'}
      />
      <Notes thread={thread} item={item} status={item.actions.status} />
    </VStack>
  );
  const read = (
    <Read
      thread={thread}
      item={item}
      level={headingLevel + 1}
      idBase={idBase}
      named={place === 'answer'}
      facts={<Facts thread={thread} item={item} columns={2} />}
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
        <VStack paddingInline={inset} paddingBlockStart={inset} paddingBlockEnd={6} gap={6}>
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
 * The work item as a page (D126 rule 1, `/items/<threadId>`, the `work-item-detail` template, boards Ärende and
 * StatusPanel): in the header the way back (to where the person came from when Clew can name it, else Att göra) with
 * the source beside it, the title as the page's heading with when it is due while it is the person's to decide, and the
 * buttons or the status notice directly under it; the read in the column; the facts under "Uppgifter" in the end panel,
 * 340 px beside the column, and as the read's first section at 1024 px and below. On a short screen nothing is pinned
 * and the page scrolls as one (1.4.10).
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
  /** "Fråga assistenten" (`AskClew`), after the decisions. */
  ask?: ReactNode;
}) {
  const narrow = useMediaQuery(narrowPageQuery);
  const item = useWorkItem(thread, onChange);
  // The page opens on its heading (2.4.3), once per item: what the person came for.
  useEffect(() => {
    const frame = requestAnimationFrame(() => item.title.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [thread.id]);
  const day = today();
  // The one page frame (D126): the way back with the source beside it, the title with when it is due, the buttons or
  // the notice directly under it, the read in the column and the facts in the end panel; at 1024 px and below the read
  // places the facts itself, first.
  return (
    <PageFrame
      ask={{ later: 'things' }}
      back={back}
      trail={
        <Text type="supporting" color="secondary">
          {sourceLine(item.mark, item.own)}
        </Text>
      }
      title={thread.title}
      titleRef={item.title}
      status={dueBadge(thread, day)}
      below={
        <VStack gap={4}>
          <ActionRow
            thread={thread}
            actions={item.actions}
            readHref={item.readHref}
            omit={item.omit}
            ask={ask}
            titleRef={item.title}
            reviewShown={item.rowsShown}
          />
          <Notes thread={thread} item={item} status={item.actions.status} />
        </VStack>
      }
      label="Ärendet"
      scrollTabStop
      facts={
        <VStack gap={4}>
          <Heading level={3} accessibilityLevel={2}>
            Uppgifter
          </Heading>
          <Facts thread={thread} item={item} />
        </VStack>
      }
      factsAbove={false}
    >
      {/* The sections are the page's second level, drawn at the size the board gives them (board Ärende). */}
      <Read
        thread={thread}
        item={item}
        level={2}
        gap={8}
        idBase="item"
        facts={narrow ? <Facts thread={thread} item={item} columns="multi" /> : undefined}
      />
    </PageFrame>
  );
}
