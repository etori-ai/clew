import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { isSnoozed, type Area, type SessionUser, type Thread } from '@clew/contracts';
import {
  Button,
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  EmptyState,
  HStack,
  Icon,
  IconButton,
  InboxIcon,
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutPanel,
  ResizeHandle,
  StackItem,
  Tab,
  TabList,
  Text,
  TextInput,
  VStack,
  useAnnounce,
  useMediaQuery,
  useResizable,
  useToast,
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
  needsYouOf,
  rowFacts,
  sourcesNotice,
  tabOf,
  tabTitle,
  tabWord,
  todoHref,
  todoTabs,
  waitingOf,
  type TodoTab,
} from '../work-items';
import { useRail } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { PageHeader } from '../components/page-header';
import { WorkList, WorkRow } from '../components/work-row';
import { silentLine, useSilentSources } from '../components/silent-sources';
import { BriefSkeleton } from '../components/brief';
import { AsyncContent } from '../components/loading';
import { cardBody } from '../components/card-panel';
import { WorkItemPage } from '../components/work-item';
import { ReceiptNotice, receiptMessage } from '../components/receipt-notice';
import { itemSubject, usePagePanel, type OwnThing } from '../components/page-panel';
import { AskClew, ThingWithConversation } from '../components/thing-panel';
import { useFocusThingBox, useModelConfigured, useThingConversation } from '../components/conversation-context';

const EMPTY_THREADS: Thread[] = [];
const EMPTY_AREAS: Area[] = [];
const ALL_SYSTEMS = 'all';
/** A field the person is typing in keeps the focus when the pane changes (the filter). */
const TYPING = 'input, textarea, [contenteditable="true"]';

/**
 * The `table-inbox` template's own widths. Below `SINGLE_SURFACE_BELOW` of room for the page the list and the pane do
 * not fit side by side, so a chosen item takes the whole surface and the list comes back when it closes, as every mail
 * client does on a phone. The pane may not be dragged narrower than `PANE_MIN` nor the list than `LIST_MIN`. The pane
 * opens at `PANE_SHARE` of the surface: the board draws the list and the pane at about 45 and 55.
 */
const SINGLE_SURFACE_BELOW = 900;
const PANE_MIN = 440;
const LIST_MIN = 300;
const PANE_SHARE = 0.55;

/**
 * The width of the box the page was given, as the `table-inbox` template measures it (`useSurfaceWidth`): every
 * decision here is about that box, not the window, which also holds the rail. The first read is synchronous, before
 * paint, and `offsetWidth` is the laid-out width as the observer reports it after that.
 */
function useSurfaceWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const { paddingInlineStart, paddingInlineEnd } = getComputedStyle(node);
    setWidth(node.offsetWidth - parseFloat(paddingInlineStart) - parseFloat(paddingInlineEnd));
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Att göra (D112 item 3, board Inbox, the `table-inbox` template): a queue that indexes a reading pane. The tabs are the
 * piles (Behöver dig, Väntar på andra, Klart) as links, so the address names the pile; a filter field and the system
 * narrow the rows. A row is one link: choosing it shows the work item in the pane beside the list and puts it in the
 * address as `item`, so Back, Forward and a reload show the same. The pane draws the work item at its narrow width
 * (D112 item 4, `WorkItem`), with "Öppna som sida". Where the pane does not fit beside the list (the template measures
 * the page's own box) the item takes the whole surface as its page draws it (`WorkItemPage`: the details behind an
 * information button, on a phone the buttons pinned to the foot), with the way back to the list.
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
  const matches = (t: Thread) =>
    (!area || t.area === area) &&
    (!words || `${t.title} ${t.trigger.reason} ${t.trigger.source}`.toLocaleLowerCase('sv-SE').includes(words));
  const rows = piles[tab].filter(matches);

  const nav = useRail({ current: { surface: 'todo' }, admin, manager: user.role === 'manager' });

  // The template's measure: the page's own box decides whether the pane stands beside the list.
  const [surfaceRef, surfaceWidth] = useSurfaceWidth();
  const isMeasured = surfaceWidth > 0;
  const single = isMeasured ? surfaceWidth < SINGLE_SURFACE_BELOW : mobile;
  const fullWidth = single && !!itemId;
  // The item alone on the surface is its page (D112 item 12): the tab names the item.
  usePageTitle(fullWidth && item ? item.title : 'Att göra');
  // The reading pane is the panel of an opened thing (D112 item 7): the work item on top, the conversation about it
  // under it and the box at the foot, while a model is configured (D8). Without one it is the item alone, as before.
  const model = useModelConfigured();
  const paneSubject = item && model && !single ? itemSubject(item) : null;
  const paneTalk = useThingConversation(paneSubject);
  const focusPaneBox = useFocusThingBox();
  // "Fråga Clew" (D112 item 7): without an item in the pane the queue is the thing, its rows what the box asks about;
  // an item the whole surface shows (the template's single surface) is the thing itself.
  const pageThing: OwnThing | null =
    item && single
      ? { id: `page:item:${item.id}`, title: item.title, subtitle: 'Ärendet på sidan', subject: itemSubject(item) }
      : !itemId
        ? {
            id: `page:todo:${tab}`,
            title: 'Att göra',
            subtitle: tabTitle[tab],
            subject: {
              key: `todo:${tab}`,
              label: 'ärendena',
              chips: rows
                .slice(0, 8)
                .map(t => ({ ref: 'thread:' + t.id, kind: 'thread' as const, label: t.title, threadId: t.id })),
              search: '',
            },
          }
        : null;
  // The page holds the panel (D50): beside the queue for what is opened from it, over the page while the reading pane
  // takes the end slot.
  const slot = usePagePanel({ overlayOnly: short || (!!itemId && !single), onChange, pageThing });
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

  // The focus follows what the pane shows (2.4.3): the item's heading when one is chosen, the row that opened it when
  // it closes, or the row after it when the item left the pile with its own button (Avfärda, Inte nu).
  const paneRef = useRef<HTMLDivElement>(null);
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
        const article = document.getElementById(`card-${itemId}`);
        // The item's title, also where its header stands above the conversation, outside the article (`useThingHead`).
        const heading =
          document.getElementById(`card-${itemId}-title`) ??
          article?.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"]');
        (heading?.tabIndex === -1 ? heading : (article ?? paneRef.current))?.focus();
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
  const silent = useSilentSources().list;
  const silentWords = silent.length ? `${silent.map(silentLine).join('. ')}.` : null;
  const count = (t: TodoTab) => piles[t].filter(x => !area || x.area === area).length;
  // Klart has no count (board Inbox): what is done is not a call to look. On a phone the strip has the short words
  // alone (board PhoneInbox): with the counts the three do not fit 320 px under the text-spacing overrides (1.4.12), and
  // a strip that scrolls sideways hides its last pile. How much needs the person stays on the rail's Att göra.
  const tabLabel = (t: TodoTab) => {
    if (mobile) return tabWord[t];
    return t === 'done' || loading ? tabTitle[t] : `${tabTitle[t]} · ${count(t)}`;
  };

  const systemLabel = area ? marks.areaTitle(area) : 'Alla system';
  const filters = (
    <HStack gap={2} vAlign="end" wrap="wrap">
      <StackItem size="fill">
        <TextInput
          type="search"
          label="Filtrera"
          isLabelHidden
          placeholder="Filtrera"
          startIcon="search"
          value={filter}
          hasClear
          onChange={value => navigate(href({ filter: value || null }), { replace: true })}
        />
      </StackItem>
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

  const empty: Record<TodoTab, string> = {
    'needs-you': 'Inget behöver dig just nu.',
    waiting: 'Inget väntar. Det som väntar på andra, eller som du lagt åt sidan, kommer tillbaka av sig självt.',
    done: 'Inget är klart ännu.',
  };
  const list = (
    <AsyncContent pending={loading} fallback={<BriefSkeleton compact={mobile} />}>
      {sourcesLine && rows.length > 0 && (
        <Text as="p" role="status">
          {sourcesLine}
        </Text>
      )}
      {failed ? (
        <Text as="p" role="alert" color="accent">
          {errorMessage(threadsQ.error, 'Sidan kunde inte läsas.')}
        </Text>
      ) : rows.length === 0 ? (
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
            words || area ? 'Ändra filtret eller välj ett annat system.' : (silentWords ?? sourcesLine ?? empty[tab])
          }
        />
      ) : (
        <WorkList label={tabTitle[tab]}>
          {rows.map(t => (
            <WorkRow
              key={t.id}
              thread={t}
              facts={rowFacts(t, now, todayDate)}
              // The system's name, as Hem names the same row (app critique, 2026-11-13); the area is the item's own.
              source={marks.ofThread(t).source}
              href={href({ item: t.id })}
              isSelected={t.id === itemId}
            />
          ))}
        </WorkList>
      )}
    </AsyncContent>
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
  /**
   * The item beside the list (board Inbox): ✕ lets go of it, and the work item at its narrow width. With a model the
   * pane is the thing's panel (D112 item 7): the conversation about the item under it, its facts folding while it runs,
   * and the box at the foot.
   */
  const closeItem = (
    <HStack justify="end">
      <IconButton variant="ghost" size="sm" label="Stäng ärendet" icon={<Icon icon="close" />} onClick={close} />
    </HStack>
  );
  const reading = paneSubject ? (
    <VStack ref={paneRef} height={short ? undefined : '100%'} onKeyDown={escape}>
      {/* A calendar proposal keeps its own card and ✕ above it; a work item's ✕ is in its own header row. */}
      {!!item?.proposals.length && (
        <VStack paddingInline={6} paddingBlockStart={6}>
          {closeItem}
        </VStack>
      )}
      {/* The pane's height, so the box docked at the foot stays on screen (2.4.11). */}
      <StackItem size="fill">
        <ThingWithConversation
          talk={paneTalk}
          subject={paneSubject}
          short={short}
          thing={cardBody(item!, {
            place: 'pane',
            level: 2,
            compact: true,
            onChange,
            folded: paneTalk.running,
            onClose: close,
          })}
        />
      </StackItem>
    </VStack>
  ) : (
    <VStack ref={paneRef} gap={3} onKeyDown={escape}>
      {(!item || !!item.proposals.length) && closeItem}
      {item ? cardBody(item, { place: 'pane', level: 2, compact: true, onChange, onClose: close }) : missing}
    </VStack>
  );
  /**
   * The item alone where the pane does not fit (D112 items 3 and 12): its page, the way back to the list as its trail.
   * An item that is not there says so under the way back.
   */
  const alone =
    item && !item.proposals.length ? (
      <VStack ref={paneRef} height="100%" onKeyDown={escape}>
        <WorkItemPage
          thread={item}
          back={{ label: 'Att göra', href: href({ item: null }) }}
          onChange={onChange}
          ask={<AskClew size="lg" />}
          panel={slot}
        />
      </VStack>
    ) : (
      <VStack ref={paneRef} gap={3} onKeyDown={escape}>
        <HStack>
          <Button variant="ghost" label="Att göra" icon={<Icon icon="chevronLeft" />} onClick={close} />
        </HStack>
        {item ? cardBody(item, { place: 'pane', level: 2, compact: true, onChange }) : missing}
      </VStack>
    );
  const page = fullWidth && !!item && !item.proposals.length;

  const gutter = mobile ? 3 : 8;
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      <Layout
        ref={surfaceRef}
        height={short ? 'auto' : 'fill'}
        padding={0}
        header={
          page ? undefined : (
            <LayoutHeader padding={0}>
              <VStack gap={4} paddingInline={gutter} paddingBlockStart={gutter} paddingBlockEnd={3}>
                <PageHeader
                  title="Att göra"
                  titleId="att-gora"
                  end={<AskClew {...(paneSubject ? { onAsk: focusPaneBox } : {})} />}
                />
                {/* Nothing here applies to one item, so where the item has the whole surface the piles and the filter go with the list (the template's full-width pane). */}
                {!fullWidth && (
                  <>
                    <TabList hasDivider value={tab} onChange={() => {}} aria-label="Urval">
                      {todoTabs.map(t => (
                        <Tab key={t} value={t} label={tabLabel(t)} href={href({ tab: t, item: null })} />
                      ))}
                    </TabList>
                    {filters}
                  </>
                )}
              </VStack>
            </LayoutHeader>
          )
        }
        content={
          page ? (
            // The item's page scrolls itself, with its header and, on a phone, its buttons pinned.
            <LayoutContent padding={0} isScrollable={false}>
              {alone}
            </LayoutContent>
          ) : (
            <LayoutContent padding={0} isScrollable={!short}>
              <VStack paddingInline={gutter} paddingBlockEnd={gutter}>
                {fullWidth ? alone : list}
              </VStack>
            </LayoutContent>
          )
        }
        end={
          single || !itemId ? (
            page ? undefined : (
              slot.end
            )
          ) : (
            <>
              <ResizeHandle
                direction="horizontal"
                isReversed
                hasDivider
                pillPlacement="end"
                resizable={pane.props}
                label="Ändra bredden på ärendet"
              />
              <LayoutPanel
                resizable={pane.props}
                padding={paneSubject ? 0 : 6}
                isScrollable={!paneSubject || short}
                role="complementary"
                label="Valt ärende"
              >
                {reading}
              </LayoutPanel>
            </>
          )
        }
      />
      {slot.overlay}
    </Shell>
  );
}
