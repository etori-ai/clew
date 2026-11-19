import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { isSnoozed, sameSubject, streamGroup, type Area, type SessionUser, type Thread } from '@clew/contracts';
import {
  Badge,
  BoardCard,
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  EmptyState,
  FigureRow,
  HStack,
  Icon,
  IconButton,
  InboxIcon,
  KeyFigure,
  LayoutPanel,
  Link,
  pixel,
  proportional,
  registerTable,
  ResizeHandle,
  SECTION_GAP,
  StatusMark,
  Tab,
  Table,
  type TableColumn,
  type TablePlugin,
  TabList,
  Text,
  TextInput,
  Token,
  percent,
  useAnnounce,
  useMediaQuery,
  useResizable,
  useTableRowStatus,
  useToast,
  VisuallyHidden,
  VStack,
  XMarkIcon,
} from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { areasQuery, threadsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { groupThreads } from '../stream';
import { useReceiptArrivals } from '../linger';
import { useMarks } from '../marks';
import { usePageTitle } from '../page-title';
import {
  doneOf,
  fromClewItself,
  itemPageHref,
  needsYouOf,
  openDeadline,
  rowFacts,
  sourcesNotice,
  tabOf,
  tabTitle,
  tabWord,
  todoHref,
  todoTabs,
  waitingOf,
  type RowFacts,
  type TodoTab,
} from '../work-items';
import { useNav } from '../components/shell/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell/shell';
import { silentLine, staleWhy, useSilentSources } from '../components/shell/silent-sources';
import { BriefSkeleton } from '../components/work/brief';
import { cardBody } from '../components/work/card-panel';
import { whenWord } from '../when-word';
import { DOT } from '../dot';
import { statusOf, type ItemStatus } from '../status-of';
import { reviewedAction } from '../components/work/card';
import { ReceiptNotice, receiptMessage } from '../components/work/receipt-notice';
import {
  PageTalk,
  itemPageSubject,
  pageSubject,
  usePageConversation,
} from '../components/conversation/page-conversation';
import { useModelConfigured } from '../components/conversation/conversation-context';
import { asksBeside } from '../panel-address';
import { PageFrame } from '../components/shell/page-frame';

const EMPTY_THREADS: Thread[] = [];
const EMPTY_AREAS: Area[] = [];
const ALL_SYSTEMS = 'all';
/** A field the person is typing in keeps the focus when the pane changes (the filter). */
const TYPING = 'input, textarea, [contenteditable="true"]';
/** What in a row is a control of its own: a press there is that control's, never the row's (the template's `isRowItself`). */
const INTERACTIVE_WITHIN_ROW =
  'a, button, input, select, textarea, [role="button"], [role="checkbox"], [role="menuitem"]';

/**
 * The `table-inbox` template's own widths. Below `SINGLE_SURFACE_BELOW` of room for the page the list and the pane do
 * not fit side by side, so there is no pane: a row leads to the item's page (D126 rule 2, board Att göra on a phone).
 * The pane may not be dragged narrower than `PANE_MIN` nor the list than `LIST_MIN`, and opens at `PANE_SHARE` of the
 * surface, as the board draws the list and the pane at about 45 and 55.
 */
const SINGLE_SURFACE_BELOW = 900;
const PANE_MIN = 440;
const LIST_MIN = 300;
const PANE_SHARE = 0.55;
/**
 * The conversation with the assistant under an item in the reading pane (D130 rule 5; the product owner, 2026-11-19: two
 * parts, as Kalender's pane has them): a part of its own at the pane's foot, its height the person's to drag with
 * Astryx's grip, never more than this share of the pane's height, so the head and the read keep the larger part, and
 * never lower than its box and a line or two over it need.
 */
const TALK = 260;
const TALK_MIN = 200;
const TALK_SHARE = 45;

/**
 * The width of the box the page was given, as the `table-inbox` template measures it (`useSurfaceWidth`, D112 gap 4):
 * The frame can replace that box when the reading pane opens or closes. Measure each new node before paint and
 * observe it until it is replaced.
 */
function useSurfaceWidth() {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!node) return;
    const { paddingInlineStart, paddingInlineEnd } = getComputedStyle(node);
    setWidth(node.offsetWidth - parseFloat(paddingInlineStart) - parseFloat(paddingInlineEnd));
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width] as const;
}

/**
 * The rows the queue drew last, in their order: an item's page that sends its item away (Avfärda, Inte nu) leads back
 * here naming it (`state.left`), and the row after it takes the focus (2.4.3), as when the pane let go of it.
 */
let drawnRows: string[] = [];

/** One row of the queue's table: the work item and what the row says about it. */
interface QueueRow extends Record<string, unknown> {
  id: string;
  thread: Thread;
  facts: RowFacts;
  /** Its state in the one vocabulary (D126 item 13): the word the item's own notice says. */
  status: ItemStatus;
  href: string;
}

/** The one person or unit the item's rows are about, when there is exactly one: whom the item is about. */
function aboutOf(thread: Thread): string | null {
  const named = thread.items.filter(i => i.subject);
  const first = named[0];
  return first && named.every(i => sameSubject(i.subject!, first.subject!)) ? first.label : null;
}

/**
 * Att göra (D126 rule 2, board Att göra, the `table-inbox` template): a queue that indexes a reading pane. The title
 * with how much needs the person and waits on others; the piles (Behöver dig, Väntar på andra, Klart) as tabs that are
 * links, so the address names the pile; a filter field and the system in the title's row narrow the rows. Astryx's
 * `Table`: the item's name is the row's link, in semibold while it is due now, with whom it is about under it; the
 * system as a token; when it is due as a badge, or for Klart when it was done. Choosing a row shows the work item in the
 * pane beside the list and puts it in the address as `item`, so Back, Forward and a reload show the same; the open row
 * is the current one (`aria-current`) with Astryx's row status in its gutter. The pane is the item at its narrow width
 * (`WorkItem`): the source line, its title as the link to its page and the buttons under it that never scroll away, then
 * the facts, "Varför ser jag detta?" and "Händelser". Where the pane does not fit beside the list (the template measures
 * the page's own box) there is no pane: a row leads to the item's page. With no item open, the corner's "Fråga AI"
 * opens the assistant's pane beside the queue (D130, D133), about the pile; an item opened takes the end slot
 * and the address lets go of the assistant's pane (`todoHref`), so closing the item leaves the queue as it was.
 */
export function TodoPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const toast = useToast();
  const announce = useAnnounce();
  const marks = useMarks();
  const threadsQ = useQuery(threadsQuery);
  const areasQ = useQuery(areasQuery);
  const threads = threadsQ.data?.threads ?? EMPTY_THREADS;
  const areas = areasQ.data?.areas ?? EMPTY_AREAS;
  const loading = threadsQ.isPending && !threadsQ.isFetched;
  const itemId = search.get('item');
  const area = search.get('area');
  const filter = search.get('filter') ?? '';
  const now = new Date().toISOString();
  const todayDate = today();

  // A receipt that has just arrived (D70): the row keeps its place for a moment, and a toast says where the item went.
  const changedRef = useRef<(thread: Thread) => void>(() => {});
  const onChange = useCallback((thread: Thread) => changedRef.current(thread), []);
  const lingering = useReceiptArrivals(threads, thread => {
    const dismiss = toast({
      body: (
        <QueryClientProvider client={client}>
          <ReceiptNotice threadId={thread.id} onChange={onChange} dismiss={() => dismiss()} />
        </QueryClientProvider>
      ),
      isAutoHide: false,
      uniqueID: 'receipt:' + thread.id,
    });
    // Astryx says a toast from the text it can read in its body's elements, and the notice draws its words itself from
    // the item as it changes: they are said here, once, as the toast appears (4.1.3).
    if (thread.receipt) announce(receiptMessage({ ...thread, receipt: thread.receipt }));
  });
  const groups = useMemo(
    () => groupThreads(threads, now, todayDate, undefined, lingering),
    [threads, now.slice(0, 16), todayDate, lingering],
  );
  const piles = useMemo<Record<TodoTab, Thread[]>>(
    () => ({ 'needs-you': needsYouOf(groups), waiting: waitingOf(groups), done: doneOf(threads) }),
    [groups, threads],
  );
  const item = itemId ? (threads.find(t => t.id === itemId) ?? null) : null;
  // The pile the address names; an item opened by its address alone shows the pile it lies in.
  const pileOf = (t: Thread): TodoTab => todoTabs.find(p => piles[p].some(x => x.id === t.id)) ?? 'needs-you';
  const tab: TodoTab = search.has('tab') ? tabOf(search.get('tab')) : item ? pileOf(item) : 'needs-you';
  const words = filter.trim().toLocaleLowerCase('sv-SE');
  const inArea = (t: Thread) => !area || t.area === area;
  const matches = (t: Thread) =>
    inArea(t) &&
    (!words || `${t.title} ${t.trigger.reason} ${t.trigger.source}`.toLocaleLowerCase('sv-SE').includes(words));
  const rows = piles[tab].filter(matches);

  const nav = useNav({ current: { surface: 'todo' }, admin, manager: user.role === 'manager' });
  usePageTitle('Att göra');
  // Back from an item's page that sent its item away: the row after it, among the rows drawn before it went.
  const location = useLocation();
  const left = (location.state as { left?: string } | null)?.left ?? null;
  const [before] = useState(() => drawnRows);
  useEffect(() => {
    drawnRows = rows.map(t => t.id);
  });
  useEffect(() => {
    if (!left || !threadsQ.data) return;
    const at = before.indexOf(left);
    const here = new Set(rows.map(t => t.id));
    const next = [...before.slice(at + 1), ...before.slice(0, Math.max(at, 0)).reverse()].find(id => here.has(id));
    const frame = requestAnimationFrame(() =>
      (
        (next ? document.getElementById(`work-${next}`)?.querySelector<HTMLElement>('a[href]') : null) ??
        document.getElementById('att-gora')
      )?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [left, !!threadsQ.data]);

  // The template's measure: the page's own box decides whether the pane stands beside the list.
  const [surfaceRef, pageWidth] = useSurfaceWidth();
  // The list and the pane divide the page's measured content box.
  const surfaceWidth = pageWidth;
  const isMeasured = surfaceWidth > 0;
  const single = isMeasured ? surfaceWidth < SINGLE_SURFACE_BELOW : mobile;
  const moved = useRef(false),
    placing = useRef(false);
  const pane = useResizable({
    defaultSize: '55%',
    minSize: PANE_MIN,
    maxSize: isMeasured ? Math.max(PANE_MIN, surfaceWidth - LIST_MIN) : undefined,
    onSizeChange: () => {
      if (!placing.current) moved.current = true;
    },
  });
  const { resize } = pane;
  useLayoutEffect(() => {
    if (moved.current || !isMeasured) return;
    placing.current = true;
    resize(Math.round(surfaceWidth * PANE_SHARE));
    placing.current = false;
  }, [isMeasured, surfaceWidth, resize]);

  /** The same queue with something changed, keeping what else the address holds. */
  const href = (next: Parameters<typeof todoHref>[0]) => todoHref(next, search);
  const close = () => navigate(href({ item: null }));
  /** Where a row leads: the item in the pane beside the list, or its page where there is no pane. */
  const rowHref = (t: Thread) => (single ? itemPageHref(t.id, href({ item: null })) : href({ item: t.id }));
  // An item in the address where the pane does not fit (a link from a wider window, the bell on a phone) is its page,
  // with the queue as the way back, in the place of this address.
  const known = isMeasured || mobile;
  useLayoutEffect(() => {
    if (known && single && itemId) navigate(itemPageHref(itemId, href({ item: null })), { replace: true });
  }, [known, single, itemId]);
  // An item in the reading pane has the end slot (D130 rule 5). An address that also holds the assistant's pane (typed,
  // or kept from before) shows the item, and lets go of the pane in its place, so closing the item does not open it.
  const reading = !single && !!itemId;
  const asking = asksBeside(search);
  useLayoutEffect(() => {
    if (reading && asking) navigate(href({ item: itemId }), { replace: true });
  }, [reading, asking]);

  // The focus follows what the pane shows (2.4.3): the item's heading when one is chosen, the row that opened it when
  // it closes, or the row after it when the item left the pile with its own button (Avfärda, Inte nu).
  const paneRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  const after = useRef<string | null>(null);
  changedRef.current = (thread: Thread) => {
    const sentAway =
      thread.state === 'dismissed' || (thread.state === 'open' && isSnoozed(thread, new Date().toISOString()));
    if (!sentAway || thread.id !== itemId) return;
    const at = rows.findIndex(t => t.id === thread.id);
    after.current = (rows[at + 1] ?? rows[at - 1])?.id ?? '';
    navigate(href({ item: null }), { replace: true });
  };
  useEffect(() => {
    const was = shown.current;
    // An item opened by its address waits for the cards to arrive before anything takes the focus.
    if (itemId && !item && !threadsQ.data) return;
    shown.current = itemId;
    if (was === itemId) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (itemId) {
        if (active instanceof HTMLElement && active.matches(TYPING) && !paneRef.current?.contains(active)) return;
        // An item that is not there says so in the pane, whose ✕ then takes the focus.
        const heading = document.getElementById(`card-${itemId}-title`);
        (
          heading ??
          document.getElementById(`card-${itemId}`) ??
          paneRef.current?.querySelector<HTMLElement>('button')
        )?.focus();
        return;
      }
      const next = after.current;
      after.current = null;
      const row = (id: string | null) =>
        id ? document.getElementById(`work-${id}`)?.querySelector<HTMLElement>('a[href]') : null;
      (row(next) ?? row(was) ?? document.getElementById('att-gora'))?.focus();
    });
    if (itemId && was && item) announce(item.title);
    return () => cancelAnimationFrame(frame);
  }, [itemId, !!item, !!threadsQ.data]);

  // The rows change in place under the filter and the system: what is shown is said aloud (4.1.3), once typing rests.
  const said = useRef({ area, filter });
  useEffect(() => {
    if (said.current.area === area && said.current.filter === filter) return;
    const areaChanged = said.current.area !== area;
    said.current = { area, filter };
    const timer = setTimeout(
      () =>
        announce(
          areaChanged
            ? area
              ? `Visar ${marks.areaTitle(area)}: ${rows.length} ärenden`
              : `Visar alla system: ${rows.length} ärenden`
            : `${rows.length} ärenden`,
        ),
      areaChanged ? 0 : 600,
    );
    return () => clearTimeout(timer);
  }, [area, filter, rows.length]);

  const failed = threadsQ.isError && threadsQ.data === undefined;
  // A source not read yet is said over the rows, and an empty pile is then never said to be nothing (D8). One that does
  // not answer is said on its own rows, and in the empty pile by name (D116, amended 2026-11-12).
  const sourcesLine = sourcesNotice(threadsQ.data?.sources);
  const silent = useSilentSources();
  const silentWords = silent.list.length ? `${silent.list.map(silentLine).join('. ')}.` : null;
  // A source with a last successful read can contribute its saved work even during a failed refetch.
  const countsKnown = !!threadsQ.data && !threadsQ.data.sources?.some(s => !s.lastSuccess);
  const count = (t: TodoTab) => piles[t].filter(inArea).length;
  // The counts line under the title (board Att göra): what needs the person and what waits on others; what is done is
  // not a call to look.
  const countsLine = countsKnown ? `${count('needs-you')} behöver dig · ${count('waiting')} väntar på andra` : null;
  // On a phone the strip has the short words (board PhoneInbox: "Väntar"), so the three with their counts fit 320 px
  // under the text-spacing overrides (1.4.12).
  const tabBadge = (t: TodoTab) => {
    if (t === 'done' || !countsKnown) return undefined;
    const n = count(t);
    if (!n) return undefined;
    return (
      <Badge
        variant={t === 'needs-you' ? 'error' : 'neutral'}
        label={
          <>
            {n}
            <VisuallyHidden> ärenden</VisuallyHidden>
          </>
        }
      />
    );
  };

  const systemLabel = area ? marks.areaTitle(area) : 'Alla system';
  const filters = (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <TextInput
        type="search"
        label="Filtrera"
        isLabelHidden
        placeholder="Filtrera"
        startIcon="search"
        value={filter}
        hasClear
        width={mobile ? undefined : 240}
        onChange={value => navigate(href({ filter: value || null }), { replace: true })}
      />
      {areas.length > 0 && (
        <DropdownMenu button={{ label: systemLabel, variant: 'secondary' }}>
          <DropdownMenuRadioGroup
            label="System"
            value={area ?? ALL_SYSTEMS}
            onChange={value => navigate(href({ area: value && value !== ALL_SYSTEMS ? value : null }))}
          >
            <DropdownMenuRadioItem value={ALL_SYSTEMS} label="Alla system" />
            {areas.map(a => (
              <DropdownMenuRadioItem key={a.id} value={a.id} label={a.title} />
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenu>
      )}
    </HStack>
  );

  // The assistant's pane about the pile (D130 rule 4): a list is no thing beside the conversation, so it goes
  // as one chip, the read of Att göra (`clew.work`). A reference, not a copy of the rows: Clew reads the pile as it is
  // when it answers, however many items it holds (a chip per card took the first eight and dropped the rest). While an
  // item stands in the reading pane the page's own pane has the end slot (rule 5) and there is no subject: the box stands
  // under the item, and the corner's "Fråga AI" is not drawn (D133 item 5).
  const queueSubject = reading
    ? null
    : pageSubject({
        key: `todo:${tab}`,
        title: `Att göra · ${tabTitle[tab]}`,
        reads: [{ capability: 'clew.work', own: true, label: 'Att göra' }],
        views: areasQ.data?.views,
        named: 'ärendena',
      });

  const empty: Record<TodoTab, string> = {
    'needs-you': 'Inget behöver dig just nu.',
    waiting: 'Inget väntar. Det som väntar på andra, eller som du lagt åt sidan, kommer tillbaka av sig självt.',
    done: 'Inget är klart ännu.',
  };
  const tableRows: QueueRow[] = rows.map(t => {
    const quiet = silent.of(t.connector);
    return {
      id: t.id,
      thread: t,
      facts: rowFacts(t, now, todayDate),
      status: statusOf(t, {
        now,
        today: todayDate,
        when: instant => whenWord(instant),
        silent: quiet ? silentLine(quiet) : null,
        reviewed: !!reviewedAction(t),
      }),
      href: rowHref(t),
    };
  });
  /**
   * Under the name: whom it is about (board Att göra); in the other piles, and where it names nobody, why it is here,
   * what it waits on or what came of it ("Ledigheten är beviljad"). Where it stands is the Status column's word, the
   * word its notice says in the pane (D126 item 13), so the line never says it again.
   */
  const aboutLine = (r: QueueRow) => {
    const t = r.thread;
    const stale = t.state === 'open' && !!silent.of(t.connector);
    const about = aboutOf(t);
    const why = tab !== 'needs-you' || !about ? r.facts.why : null;
    const words = [about, why].filter(Boolean).join(DOT);
    return stale ? (words ? staleWhy(words) : 'Kan vara gammal') : words;
  };
  const columns: TableColumn<QueueRow>[] = [
    {
      key: 'title',
      header: <Text type="eyebrow">Ärende</Text>,
      width: proportional(3),
      renderCell: r => (
        <VStack gap={0.5}>
          <Link
            href={r.href}
            color="primary"
            weight={tab === 'needs-you' && streamGroup(r.thread, todayDate) === 'nu' ? 'semibold' : 'normal'}
            aria-current={r.id === itemId ? 'true' : undefined}
          >
            {r.thread.title}
          </Link>
          <Text type="supporting" color="secondary">
            {aboutLine(r)}
          </Text>
        </VStack>
      ),
    },
    {
      key: 'source',
      header: <Text type="eyebrow">Från</Text>,
      width: pixel(150),
      // An item from Clew itself names no system (`fromClewItself`): Clew is not a system the person goes to.
      renderCell: r =>
        fromClewItself(r.thread, areasQ.data?.systems) ? null : (
          <Token size="sm" label={marks.ofThread(r.thread).source} />
        ),
    },
    // Where it stands (board StatusPanel's queue): the state's mark and what it concerns ("Obekräftat · 1 av 3",
    // "Behöver dig · försenad", "Klart · i dag 08.13"), the same word the item's notice says in the pane. Under the tab
    // Behöver dig that word is the tab's name, so a row that needs the person shows only what it concerns ("försenad")
    // beside the dot, or the dot alone, whose name still says it in full.
    {
      key: 'status',
      header: <Text type="eyebrow">Status</Text>,
      // On a phone the mark wraps under its dot rather than push the table past the screen (1.4.10).
      width: pixel(mobile ? 120 : 180),
      renderCell: r => (
        <StatusMark
          kind={r.status.kind}
          detail={r.status.detail}
          isWordHidden={tab === 'needs-you' && r.status.kind === 'needs-you'}
        />
      ),
    },
  ];
  // Beside the pane, or on a phone, the system's column gives way (the template drops its tags while the pane is open).
  const shownColumns = single || (itemId && surfaceWidth < 1200) ? columns.filter(c => c.key !== 'source') : columns;
  // The row open in the pane (the template's `aria-current`), with Astryx's row status in the gutter that says it in
  // words; Astryx's Table has no styled state of its own for an open row (D126, Astryx gaps). A press anywhere on a row
  // follows its link, unless it was on a control of its own; the link stays the row's one tab stop.
  const openStatus = useTableRowStatus<QueueRow>({
    getStatus: useCallback(
      (r: QueueRow) => (r.id === itemId ? { color: 'accent', label: 'Visas bredvid' } : null),
      [itemId],
    ),
  });
  const rowPlugin = useMemo(
    (): TablePlugin<QueueRow> =>
      ({
        transformBodyRow: (props: any, r: QueueRow) => ({
          ...props,
          htmlProps: {
            ...props.htmlProps,
            id: `work-${r.id}`,
            'aria-current': r.id === itemId ? 'true' : undefined,
            onClick: (event: MouseEvent) => {
              const target = event.target as HTMLElement | null;
              if (target?.closest(INTERACTIVE_WITHIN_ROW) || event.defaultPrevented) return;
              navigate(r.href);
            },
          },
        }),
      }) as TablePlugin<QueueRow>,
    [itemId, navigate],
  );
  // Beside its reading pane the list stands in the frame's card and draws none of its own.
  const beside = !!itemId && !single;
  // Due today and overdue share a badge colour. Only an open item due before the Stockholm day is overdue.
  const overdue = piles['needs-you'].filter(t => inArea(t) && (openDeadline(t, todayDate)?.days ?? 0) < 0).length;
  /**
   * The piles as key figures over the list (D130 item 19), as the reference opens Mina aktiviteter: what needs the
   * person, how much of it is overdue, what waits on others and what is done, each leading to its pile. Not drawn
   * beside the reading pane, where the list and the item share the page.
   */
  const figures =
    !countsKnown || beside ? null : (
      <FigureRow>
        <KeyFigure
          label="Behöver dig"
          value={String(count('needs-you'))}
          href={href({ tab: 'needs-you', item: null })}
          name={`Behöver dig: ${count('needs-you')} ärenden`}
        />
        <KeyFigure
          label="Försenade"
          value={String(overdue)}
          tone={overdue ? 'error' : undefined}
          href={href({ tab: 'needs-you', item: null })}
          name={`Försenade: ${overdue} ärenden`}
        />
        <KeyFigure
          label="Väntar på andra"
          value={String(count('waiting'))}
          href={href({ tab: 'waiting', item: null })}
          name={`Väntar på andra: ${count('waiting')} ärenden`}
        />
        <KeyFigure
          label="Klart"
          value={String(count('done'))}
          tone={count('done') ? 'success' : undefined}
          href={href({ tab: 'done', item: null })}
          name={`Klart: ${count('done')} ärenden`}
        />
      </FigureRow>
    );
  /**
   * The pile as the reference draws a list (D130 item 19): one card with its heading inside, the pile's name and how
   * many it holds, the filters under the heading, and the table inside the card's inset.
   */
  const list = (
    <BoardCard
      id="todo-pile"
      title={tabTitle[tab]}
      count={rows.length}
      countLabel="ärenden"
      tools={filters}
      bare={beside}
      pending={loading}
      pendingLabel="Hämtar ärendena …"
    >
      {(sourcesLine && rows.length > 0) || failed || rows.length === 0 ? (
        <VStack gap={3}>
          {sourcesLine && rows.length > 0 && (
            <Text as="p" role="status">
              {sourcesLine}
            </Text>
          )}
          {failed ? (
            <Text as="p" role="alert" color="accent">
              {errorMessage(threadsQ.error, 'Sidan kunde inte läsas.')}
            </Text>
          ) : (
            rows.length === 0 && (
              <EmptyState
                isCompact
                headingLevel={2}
                icon={<Icon icon={InboxIcon} size="lg" />}
                title={
                  words || area
                    ? 'Inget som stämmer med valet'
                    : sourcesLine || silentWords
                      ? 'Inväntar källornas besked'
                      : 'Tomt här'
                }
                description={
                  words || area
                    ? 'Ändra filtret eller välj ett annat system.'
                    : (silentWords ?? sourcesLine ?? empty[tab])
                }
              />
            )
          )}
        </VStack>
      ) : null}
      {!failed && rows.length > 0 && (
        <Table<QueueRow>
          aria-label={tabTitle[tab]}
          data={tableRows}
          columns={shownColumns}
          idKey="id"
          {...registerTable}
          plugins={itemId && !single ? { open: openStatus, rows: rowPlugin } : { rows: rowPlugin }}
        />
      )}
    </BoardCard>
  );

  /** Esc inside a menu, a list or a dialog is theirs, and so is Esc on a button whose menu is open; a bare Esc lets go of the item. */
  const escape = (e: KeyboardEvent) => {
    if (
      e.key !== 'Escape' ||
      e.defaultPrevented ||
      (e.target as HTMLElement).closest('[role="menu"], [role="listbox"], dialog, [aria-expanded="true"]')
    )
      return;
    e.stopPropagation();
    close();
  };
  // The conversation about the item in the pane (D130 rules 5 and 6), held here so it stays while the item is read:
  // the person's latest conversation about the item is found again, and the next question continues it. Only where the
  // pane holds a work item and there is a model to ask; a calendar proposal keeps its own card (D27).
  const model = useModelConfigured();
  const talkAbout = model && reading && item && !item.proposals.length ? itemPageSubject(item) : null;
  const talk = usePageConversation(talkAbout);
  const talkRegion = useResizable({
    direction: 'vertical',
    defaultSize: TALK,
    minSize: TALK_MIN,
    maxSize: percent(TALK_SHARE, { min: pixel(TALK_MIN) }),
    // The share is of the pane, not of the window (Astryx resolves a percentage against the viewport without this): of
    // the panel itself, which has the pane's whole height from its first frame. What it holds does not, while the item
    // is on its way, and a share of that would clamp the height to its floor and keep it.
    containerRef: panelRef,
    autoSaveId: 'clew:todo-talk',
  });
  /**
   * The conversation and its box, the pane's second part (board AskAttGora's box at the pane's foot): Astryx's grip
   * draws the line between the read and it and takes the arrow keys. On a short screen the pane is one flow (1.4.10),
   * so the part keeps its least height under the read and has no grip.
   */
  const talkPart = !talkAbout ? undefined : short ? (
    <VStack height={TALK_MIN} paddingBlockStart={6}>
      <PageTalk talk={talk} />
    </VStack>
  ) : (
    <>
      <ResizeHandle
        direction="vertical"
        isReversed
        hasDivider
        resizable={talkRegion.props}
        label="Ändra samtalets höjd"
      />
      <VStack height={talkRegion.size} padding={6} paddingBlockStart={4}>
        <PageTalk talk={talk} />
      </VStack>
    </>
  );
  /** What the pane says when the item is not there: still on its way, unreadable, or gone. */
  const missing = threadsQ.isError ? (
    <Text as="p" role="alert">
      {errorMessage(threadsQ.error, 'Ärendet kunde inte hämtas just nu.')}
    </Text>
  ) : threadsQ.data ? (
    <EmptyState
      isCompact
      headingLevel={2}
      title="Ärendet finns inte längre"
      description="Det kan ha tagits bort i källsystemet."
    />
  ) : (
    <BriefSkeleton rows={1} compact />
  );
  const closeItem = (
    <HStack justify="end">
      <IconButton variant="ghost" label="Stäng ärendet" icon={<Icon icon={XMarkIcon} size="sm" />} onClick={close} />
    </HStack>
  );
  /**
   * The item beside the list (board Att göra): the work item at its narrow width, its ✕ in its own title row. A
   * calendar proposal keeps its own card (D27) with ✕ above it, as does an item that is not there.
   */
  const readingPane =
    item && !item.proposals.length ? (
      <VStack ref={paneRef} height={short ? undefined : '100%'} onKeyDown={escape}>
        {cardBody(item, {
          place: 'pane',
          level: 2,
          onChange,
          onClose: close,
          // The assistant is asked in the box under the item, so the item has no button for it here.
          ...(talkPart ? { under: talkPart } : {}),
        })}
      </VStack>
    ) : (
      <VStack ref={paneRef} gap={3} padding={6} onKeyDown={escape}>
        {closeItem}
        {item ? cardBody(item, { place: 'pane', level: 2, compact: true, onChange }) : missing}
      </VStack>
    );

  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      {/* The one page frame (D126): the title, its counts, the filters and the piles in the header, and the queue and
          its reading pane side by side inside the same column, the list in a card as Hem's lists are. */}
      <PageFrame
        ask={{ subject: queueSubject }}
        layoutRef={surfaceRef}
        cards
        title="Att göra"
        titleId="att-gora"
        meta={countsLine ?? undefined}
        tabs={
          <TabList hasDivider={false} isFullBleed value={tab} onChange={() => {}} aria-label="Urval">
            {todoTabs.map(t => {
              const badge = tabBadge(t);
              return (
                <Tab
                  key={t}
                  value={t}
                  label={mobile ? tabWord[t] : tabTitle[t]}
                  href={href({ tab: t, item: null })}
                  {...(badge ? { endContent: badge } : {})}
                />
              );
            })}
          </TabList>
        }
        label={tabTitle[tab]}
        end={
          !reading ? undefined : (
            <>
              {/* The handle comes before the pane, whose inline-start edge it drags; `hasDivider` is the handle's. */}
              <ResizeHandle
                direction="horizontal"
                isReversed
                hasDivider
                pillPlacement="end"
                resizable={pane.props}
                label="Ändra bredden på ärendet"
              />
              <LayoutPanel
                ref={panelRef}
                resizable={pane.props}
                padding={0}
                isScrollable={short || !item || !!item.proposals.length}
                role="complementary"
                label="Valt ärende"
              >
                {readingPane}
              </LayoutPanel>
            </>
          )
        }
      >
        <VStack gap={SECTION_GAP}>
          {figures}
          {list}
        </VStack>
      </PageFrame>
    </Shell>
  );
}
