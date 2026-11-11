import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { DayView, PanelViewSpec, SearchResult, TodayView, ViewRef, WeekView } from '@clew/contracts';
import {
  AreaLine,
  Badge,
  Button,
  DayStrip,
  Drawer,
  EventList,
  DrawerHeader,
  DropdownMenu,
  EmptyState,
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
  ResizeHandle,
  TabList,
  TabMenu,
  Text,
  VStack,
  agendaItems,
  useAnnounce,
  useLayer,
  useMediaQuery,
  useResizable,
  worstWord,
  type AgendaItem,
} from '@clew/ui';
import { dayLabel, timeRange } from '@clew/calendar/dates';
import { fieldLabel, fieldValue, hiddenFields, reviewLabel, staleLabel } from './panel-labels';
import { useConversation } from './conversation-context';
import { AddToConversation } from './add-to-conversation';
import { DeclaredView } from './view';
import { useMarks } from '../marks';
import { areasQuery } from '../queries';
import { entityHref } from '../person-address';

const plain = (address: string) => {
  try {
    return decodeURIComponent(address);
  } catch {
    return address;
  }
};
const sameAddress = (href: string | null, address: string) => !!href && plain(href) === plain(address);
type BodyProps = {
  output: unknown;
  onOpenItem?: (item: AgendaItem, dayItems: AgendaItem[]) => void;
  /** The capability's declared view (D38) and what it needs to be used: its input and how to change it, where a row's own view lives, and the way back from one. */
  view?: PanelViewSpec | undefined;
  source?: string | undefined;
  input?: Record<string, unknown>;
  onInput?: ((next: Record<string, unknown>) => void) | undefined;
  hrefFor?: (view: ViewRef) => string;
  onBack?: (() => void) | undefined;
  isLoading?: boolean;
  /** Beside the page, where the panel is as narrow as a phone: a table is drawn as its list. */
  inline?: boolean;
};
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** A day view (D32): the `calendar.day` capability's output, drawn as the day strip instead of rows. */
const isDayView = (v: unknown): v is DayView =>
  isRecord(v) && isoDate(v.from) && Array.isArray(v.events) && Array.isArray(v.proposals);
/** Today (`calendar.today`): the day's events and its free gaps, drawn as the day strip with the gaps named under it. */
const isTodayView = (v: unknown): v is TodayView =>
  isRecord(v) && isoDate(v.date) && Array.isArray(v.events) && Array.isArray(v.gaps);
/** A week (`calendar.week`): the events from a Monday, without proposals (those come with a day or the page's own week), drawn as the list with a heading per day. */
const isWeekView = (v: unknown): v is Omit<WeekView, 'proposals'> =>
  isRecord(v) && isoDate(v.from) && Array.isArray(v.events) && !Array.isArray(v.proposals);
/** The composite search's output (D26): hits with a connector and a staleness, plus every source's status. */
const isSearchResult = (v: unknown): v is SearchResult =>
  isRecord(v) &&
  Array.isArray(v.rows) &&
  Array.isArray(v.sources) &&
  v.rows.every(
    r => isRecord(r) && typeof r.ref === 'string' && typeof r.label === 'string' && typeof r.connector === 'string',
  );
const scalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const rowTitle = ['name', 'title', 'label', 'supplier'];
/** A media query that never matches: a table beside the page is always its list. */
const NEVER = 'not all';

/**
 * Found text as objects (D12, D26): every hit is numbered as the answer cites it, opens where it lives and can be added to
 * the conversation as a chip. The row itself is not interactive, so its two buttons are the only stops (Astryx's rule).
 * A hit about a person or a unit (D97 item 6, artboard P) leads to them instead of to one source's record: its name is
 * the link, and a hit several sources answered for names them all at the end of its line.
 */
function SearchRows({ result, hrefFor }: { result: SearchResult; hrefFor?: ((view: ViewRef) => string) | undefined }) {
  const talk = useConversation();
  const marks = useMarks();
  const { pathname, search } = useLocation();
  const missed = result.sources.filter(s => s.status !== 'ok');
  return (
    <VStack gap={3}>
      {result.rows.length === 0 && <Text type="supporting">Inget hittades i källorna du får söka i.</Text>}
      {result.rows.length > 0 && (
        <List hasDividers density="compact" aria-label="Källor">
          {result.rows.map((r, i) => {
            const ref = `document:${r.connector}:${r.ref}`;
            const inConversation = talk.chipped.includes(ref);
            // A review date is a document's business: a person or a room has none to miss. Only an old one is a badge;
            // a missing date is a word in the meta line (artboard 7).
            const reviewed = r.reviewedAt ?? r.updatedAt;
            const note = r.kind === 'document' ? staleLabel(r.stale, reviewed) : '';
            const mark = marks.ofObject(`document:${r.connector}:`);
            const title = `${r.label}${r.section ? ` · ${r.section}` : ''}`;
            // Every source that answered for the same entity, the hit's own first: said once, on the hit's line.
            const merged = r.sources?.map(s => s.source).join(' · ');
            const meta = [merged ? '' : r.source, r.owner, reviewLabel(reviewed), r.stale ? '' : note.toLowerCase()]
              .filter(Boolean)
              .join(' · ');
            return (
              <ListItem
                key={ref}
                align="start"
                startContent={<Badge variant="neutral" label={String(i + 1)} />}
                label={
                  r.subject || merged ? (
                    <HStack gap={2} justify="between" vAlign="center" wrap="wrap">
                      {r.subject ? (
                        <Link href={entityHref(r.subject, pathname + search)} weight="semibold" hasUnderline>
                          {title}
                        </Link>
                      ) : (
                        <Text weight="semibold">{title}</Text>
                      )}
                      {merged && <Text type="supporting">{merged}</Text>}
                    </HStack>
                  ) : (
                    <Text weight="semibold">{title}</Text>
                  )
                }
                description={
                  <VStack gap={1}>
                    <Text type="supporting">{r.snippet}</Text>
                    {/* The meta line starts with the source's glyph and word, so an answer from three systems shows where each hit came from. */}
                    {(meta || (r.stale && note)) && (
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        {merged ? (
                          meta && <Text type="supporting">{meta}</Text>
                        ) : (
                          <AreaLine {...(mark?.icon ? { icon: mark.icon } : {})}>{meta}</AreaLine>
                        )}
                        {r.stale && note && <Badge variant="warning" label={note} />}
                      </HStack>
                    )}
                    <HStack gap={1} wrap="wrap">
                      {/* A hit whose source declares its view (D38) opens here, drawn by Startsidan; the link still leads to the source. A hit about an entity leads to the entity instead. */}
                      {!r.subject && r.view && hrefFor && (
                        <Button size="sm" variant="secondary" label={r.view.title} href={hrefFor(r.view)} />
                      )}
                      {!r.subject && r.link && (
                        <Button
                          size="sm"
                          variant="secondary"
                          label={r.view ? `Öppna i ${r.source}` : 'Öppna'}
                          href={r.link}
                          target="_blank"
                        />
                      )}
                      <AddToConversation
                        added={inConversation}
                        onAdd={() => talk.addChip({ ref, kind: 'document', label: r.label })}
                      />
                    </HStack>
                  </VStack>
                }
              />
            );
          })}
        </List>
      )}
      {missed.length > 0 && (
        <Text type="supporting">
          {missed.map(s => s.source).join(', ')} svarade inte. Träffarna ovan är från de källor som svarade.
        </Text>
      )}
      <Text type="supporting">Hämtat som du, ur det du får se. Inget av texten sparas på Startsidan.</Text>
    </VStack>
  );
}
/**
 * A read capability's output as the panel draws it. A capability that declares its view (D38) is drawn as it says;
 * without a declaration rows become a list and anything else label/value pairs.
 */
export function PanelBody({
  output,
  onOpenItem,
  view,
  source,
  input,
  onInput,
  hrefFor,
  onBack,
  isLoading,
  inline = false,
}: BodyProps) {
  const declared = view ?? null;
  const day = !declared && isDayView(output) ? output : null;
  const todayView = !declared && !day && isTodayView(output) ? output : null;
  const week = !declared && !day && !todayView && isWeekView(output) ? output : null;
  const calendar = day || todayView || week;
  const search = !declared && !calendar && isSearchResult(output) ? output : null;
  const dayItems = day
    ? agendaItems(day.events, day.proposals)
    : todayView
      ? agendaItems(todayView.events, [])
      : week
        ? agendaItems(week.events, [])
        : [];
  const rows =
    !declared && !calendar && !search && isRecord(output) && Array.isArray(output.rows)
      ? (output.rows as Record<string, unknown>[])
      : null;
  const pairs =
    !declared && !calendar && !search && isRecord(output)
      ? Object.entries(output).filter(([k]) => k !== 'rows' && !hiddenFields.has(k))
      : [];
  return (
    <VStack gap={3}>
      {onBack && (
        <HStack>
          <Button size="sm" variant="ghost" label="Tillbaka" onClick={onBack} />
        </HStack>
      )}
      {declared && (
        <DeclaredView
          view={declared}
          output={output}
          {...(input ? { input } : {})}
          {...(onInput ? { onInput } : {})}
          {...(hrefFor ? { hrefFor } : {})}
          isLoading={!!isLoading}
          {...(inline ? { tableQuery: NEVER } : {})}
        />
      )}
      {day && (
        <>
          <Text type="supporting">Du tittar på {dayLabel(day.from)} i din kalender.</Text>
          <DayStrip
            date={day.from}
            items={dayItems}
            dayHeadingLevel={3}
            accessiblePath="Retur på en post öppnar den."
            onItemClick={onOpenItem ? item => onOpenItem(item, dayItems) : undefined}
          />
        </>
      )}
      {todayView && (
        <>
          <Text type="supporting">Du tittar på {dayLabel(todayView.date)} i din kalender.</Text>
          <DayStrip
            date={todayView.date}
            items={dayItems}
            dayHeadingLevel={3}
            accessiblePath="Retur på en post öppnar den."
            onItemClick={onOpenItem ? item => onOpenItem(item, dayItems) : undefined}
          />
          <Text type="supporting">
            {todayView.gaps.length
              ? `Lediga luckor: ${todayView.gaps.map(g => timeRange(g.start, g.end)).join(', ')}.`
              : 'Inga lediga luckor i dag.'}
          </Text>
        </>
      )}
      {week && (
        <EventList
          from={week.from}
          days={5}
          items={dayItems}
          dayHeadingLevel={3}
          accessiblePath="Retur på en post öppnar den."
          onItemClick={onOpenItem ? item => onOpenItem(item, dayItems) : undefined}
        />
      )}
      {search && <SearchRows result={search} hrefFor={hrefFor} />}
      {rows && (
        <List hasDividers density="compact">
          {rows.map((r, i) => {
            const key = rowTitle.find(k => r[k] !== undefined);
            const detail = Object.entries(r)
              .filter(([k, v]) => k !== key && !hiddenFields.has(k) && scalar(v))
              .map(([k, v]) => `${fieldLabel(k)}: ${fieldValue(v)}`)
              .join(' · ');
            return (
              <ListItem
                key={i}
                label={<Text>{key ? fieldValue(r[key]) : `Rad ${i + 1}`}</Text>}
                description={<Text type="supporting">{detail}</Text>}
              />
            );
          })}
        </List>
      )}
      {pairs.length > 0 && (
        <List density="compact">
          {pairs.map(([k, v]) => (
            <ListItem
              key={k}
              label={<Text>{fieldLabel(k)}</Text>}
              description={<Text type="supporting">{fieldValue(v)}</Text>}
            />
          ))}
        </List>
      )}
      {!declared && !calendar && !search && !rows && !pairs.length && <Text type="supporting">Inget att visa.</Text>}
      {/* A declared view and the search name where they read from themselves; a plain read says it here. */}
      {source && (rows || pairs.length > 0) && (
        <Text type="supporting">Hämtat ur {source}. Inget av det sparas på Startsidan.</Text>
      )}
    </VStack>
  );
}

/** What the panel holds right now: a name, what it is, and how to let go of it. */
export interface PanelFrame {
  /** What is shown, apart from its input: one view's search does not move focus, another view taking its place does. */
  id: string;
  title: string;
  /** The content, told whether it is drawn beside the page (narrow, non-modal) or over it. */
  body: (inline: boolean) => ReactNode;
  onClose: () => void;
  /** The address of what is on screen, so focus finds the link that led away when the person comes back to it. */
  address?: string | undefined;
  /** Beside the close button: "Öppna som sida" for a view that is also a tool. */
  actions?: ReactNode;
  /** A table: over the page it gets a wide drawer. */
  wide?: boolean;
  /** A card: its name is the small label over the card, as artboard E draws "KORT"; a view keeps its title as the heading. */
  kind?: 'card' | 'view';
  /** The thing's own name for its tab when several are open beside the page (D66): a card's title; a view keeps `title`. */
  tab?: string;
  /** What stands before the heading, as a person's avatar does (D97, artboard C); over the page, the drawer header's start. */
  lead?: ReactNode;
  /** One line under the heading, as a person's role and unit (D97, artboard C). */
  subtitle?: ReactNode;
}
/** One thing opened beside the page, waiting as a tab while another is current (D66). */
type OpenTab = { id: string; name: string; search: string };
/** The one body region, where the current thing is drawn. */
const BODY_ID = 'panel-body';
const searchOf = (address: string) => {
  const i = address.indexOf('?');
  return i < 0 ? '' : address.slice(i);
};
/** The rail and the panel as the shell draws them; with the page's own least width they decide when the panel fits beside it. */
export const RAIL = 256,
  PANEL = 440;
/**
 * What stands on the panel's inner edge beside its width while it is shown: the 1 px resize handle, as measured in the
 * browser. The fold button floats over the page beside it (D63 item 14, revised 2026-11-10), so it takes no width of
 * its own.
 */
export const PANEL_EDGE = 1;
/** How far in from the panel's own edge the fold button stands: 20 px in from the handle, which is on that edge while the panel is shown. */
const FOLD_OFFSET = 20 + PANEL_EDGE;
/** The window width from which the panel, `width` px wide, fits beside a column that needs `minMain` px. */
export const panelBesideQuery = (minMain: number, width: number = PANEL) => `(min-width: ${RAIL + minMain + width}px)`;
/**
 * A panel of its own width (D97: the opened person is drawn 520 to 600 px wide, artboard C): its width at first, the
 * narrowest and widest it can be dragged to, and the name its width is remembered under in this browser.
 */
export interface PanelSize {
  default: number;
  min: number;
  max: number;
  id: string;
}
/** What a transcript needs beside the panel: a conversation asked on a page brings the page along only where both fit (D50). */
export const CONVERSATION_MIN = 600;
type Options = {
  /** The least width the page's own column needs beside the panel. Narrower windows get the panel as a drawer over the page. */
  minMain: number;
  /** Nothing is pinned on a short screen (1.4.10): the panel is always a drawer there. */
  overlayOnly?: boolean;
  /** Whether a thing may stay open as a tab (D66): a card that left the stream (Inte nu, Avfärda, done) leaves the tabs too. The current one always stays. */
  isOpen?: (id: string) => boolean;
  /**
   * The drawer over the page has closed and Astryx has given the focus back to what opened it. Until then the page
   * under it is inert; a page whose opener is gone (the row of a card that was sent away) sends the focus on from here.
   */
  onClosed?: () => void;
  /** The panel's own width; without it the shared panel's 440 px (320 to 560), remembered for every page. */
  size?: PanelSize;
  /**
   * One thing at a time (D97: one person beside a list): what is opened from the page takes the place of what was open,
   * and the link it was opened with is where the focus goes back to on close. Without it the first opener keeps that role
   * while the others wait as tabs (D66).
   */
  replaces?: boolean;
};
/**
 * The panel (D50): the one place beside the page's column for what the person holds next to it, a view, a source or a
 * card, and nothing else: with nothing open there is no panel, and a page's own content (Hem's day) stays the page's
 * (D72). Where it fits it is a `LayoutPanel` in the page's `end` slot, non-modal, so the column stays in use (the
 * `ai-chat` template's artifact beside the transcript, composed as the calendar page composes its own panel); where it
 * does not fit, and on a phone, it is the drawer it always was. Beside the page it is a named complementary region:
 * opening it moves focus to its heading (never away from a field the person is typing in: the box keeps the focus
 * when a conversation brings its panel along), Esc inside it closes it and gives focus back to what opened it, and one
 * thing taking another's place is named aloud (2.4.3, 4.1.3). A drawer does all of that itself.
 */
const TYPING = 'input, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]';
export function usePanel(
  panel: PanelFrame | null,
  { minMain, overlayOnly = false, isOpen, onClosed, size, replaces = false }: Options,
): {
  end: ReactNode | undefined;
  overlay: ReactNode;
  /** Whether the panel takes width beside the page: something is open in it, or the person is looking at it empty. */
  occupied: boolean;
  /** Whether the panel stands beside the page (non-modal) rather than over it: the one rule, so a page never works it out again. */
  inline: boolean;
} {
  const width = size?.default ?? PANEL;
  const fits = useMediaQuery(panelBesideQuery(minMain, width));
  const inline = fits && !overlayOnly;
  const announce = useAnnounce();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const region = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  /** Where focus lands at the panel's start: the heading, or the menu of open things, named by the current one, when several are open. */
  const start = () => heading.current ?? menu.current;
  // Everything opened beside the page since the panel was last empty, in the order it came (D66): the address holds
  // the current one, the others wait as tabs behind the menu. A ref mirrors the state so a close can tell a deliberate
  // clearing (Stäng alla) from the current tab leaving.
  const tabsRef = useRef<OpenTab[]>([]);
  const [tabs, setTabsState] = useState<OpenTab[]>([]);
  const setTabs = (next: OpenTab[]) => {
    tabsRef.current = next;
    setTabsState(next);
  };
  // Beside the page the panel is Astryx's resizable region: dragged by its handle, or folded away and brought back
  // with the one button that floats over the page on the panel's inner edge, at the top, so it rides that edge in and
  // out (the product owner, 2026-11-06: an icon in the top right corner, never a button among the page's own;
  // 2026-11-10: "float to the left of the sidebar", after the button's own column had stood the height of the page
  // beside the panel). It is an Astryx layer anchored to the panel's inner edge (`useLayer`: a manual popover, so no light
  // dismiss and no Esc), which takes no width from the page or the panel and is there when the panel has none. It
  // stands in the page's top right corner, inside the 32 px every page keeps free above its header (D74) and 20 px
  // in from the handle, so it lies over neither the page's content nor a scrollbar that takes space (15 to 17 px),
  // whether or not the page scrolls: Astryx has no way to ask how wide the page's scrollbar is. The layer is anchored
  // to the panel itself, which is in the layout at no width while it is folded; the handle is not (see `end`). The width is
  // remembered per browser; the fold is not, so a card opened later is seen. The button is there wherever the panel
  // fits beside the page, also while nothing is open (the product owner, 2026-11-10, revising D72 item 1): at rest
  // the panel is folded away, and shown it says that nothing is open.
  const [collapsed, setCollapsed] = useState(panel === null);
  const edge = useLayer({ mode: 'context' });
  const fold = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (inline) edge.show();
    else edge.hide();
  }, [inline]);
  const resizable = useResizable({
    defaultSize: width,
    minSize: size?.min ?? 320,
    maxSize: size?.max ?? 560,
    collapsible: true,
    autoSaveId: size?.id ?? 'clew-panel-width',
    isCollapsed: collapsed,
    onCollapseChange: setCollapsed,
  });
  const expand = () => {
    resizable.expand();
    setCollapsed(false);
    announce('Panelen visas');
    requestAnimationFrame(() => start()?.focus());
  };
  // Folding hides and nothing more (D63 item 14, revised 2026-11-06 evening): the tabs, the current thing and the
  // address stay, so the row keeps saying "öppet bredvid" and the box keeps its token, and the button keeps the focus,
  // now saying the way back. Letting go of everything is a decision of its own, Stäng alla in the header. (The
  // afternoon's fold closed the card with it, which made a layout act the only way to close all.)
  const collapse = () => {
    resizable.collapse();
    setCollapsed(true);
    announce('Panelen är ihopfälld');
  };
  /** Stäng alla: every tab dropped and the current thing closed, so the panel empties at once. */
  const closeAll = () => {
    setTabs([]);
    panel?.onClose();
  };
  /** The layer beside the handle, on the page's side: the button in the corner the page's own padding leaves free. */
  const toggle = edge.render(
    <VStack paddingBlockStart={1}>
      <IconButton
        ref={fold}
        size="sm"
        variant="ghost"
        label={collapsed ? 'Visa panelen' : 'Fäll ihop panelen'}
        tooltip={collapsed ? 'Visa panelen' : 'Fäll ihop panelen'}
        icon={<Icon icon={collapsed ? 'chevronsLeft' : 'chevronsRight'} />}
        onClick={collapsed ? expand : collapse}
      />
    </VStack>,
    { placement: 'start', alignment: 'start', offset: FOLD_OFFSET },
  );
  const opener = useRef<HTMLElement | null>(null);
  const shown = useRef<{ id: string; address: string | undefined } | null>(null);
  // A view whose area has a figure says the figure's word on its tab (D54, artboard 3): "Budget · lugnt".
  const areas = useQuery(areasQuery).data?.areas;
  const viewed = panel?.id.startsWith('view:') ? panel.id.slice('view:'.length) : null;
  const figured = viewed ? areas?.find(a => a.figure && a.standing.some(s => s.capability === viewed)) : undefined;
  const figureWord = figured ? worstWord([figured.figure])?.word : undefined;
  const id = panel?.id ?? null,
    address = panel?.address,
    title = panel?.title ?? null,
    name = panel?.tab ?? (title && figureWord ? `${title} · ${figureWord}` : title);
  // What the panel holds changed: it is shown again, so the thing just opened is seen. Not when a closed tab's
  // neighbour takes its place: nothing was opened, and a folded panel stays folded.
  const revealing = useRef(false);
  useEffect(() => {
    const reveal = revealing.current;
    revealing.current = false;
    if (id !== null && collapsed && !reveal) {
      resizable.expand();
      setCollapsed(false);
      // The heading mounts with the next paint, after the focus rule below has run. Never away from a field the
      // person is typing in: the box keeps the focus when a conversation brings its panel along.
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement && active.matches(TYPING))) start()?.focus();
      });
    }
  }, [id]);
  // The tabs follow the address (D66): what it names joins the row, or keeps its place with a fresh search; when the
  // address names nothing the current tab is closed, and the one before it (else the first) takes its place in the
  // address, so the panel empties only with its last tab.
  const lastId = useRef<string | null>(null);
  useEffect(() => {
    const was = lastId.current;
    lastId.current = id;
    if (id !== null) {
      // One thing at a time keeps no tabs: what is opened takes the place of what was open.
      if (!address || !name || replaces) return;
      const current = tabsRef.current;
      const search = searchOf(address);
      const i = current.findIndex(t => t.id === id);
      if (i < 0) setTabs([...current, { id, name, search }]);
      else if (current[i]!.search !== search || current[i]!.name !== name)
        setTabs(current.map(t => (t.id === id ? { id, name, search } : t)));
      return;
    }
    if (was === null) return;
    const current = tabsRef.current;
    const i = current.findIndex(t => t.id === was);
    const rest = current.filter(t => t.id !== was);
    setTabs(rest);
    const next = rest[Math.min(Math.max(i - 1, 0), rest.length - 1)];
    if (next) {
      revealing.current = true;
      navigate(pathname + next.search, { replace: true });
    } else {
      // The last thing was closed: the panel folds away and its button stays, saying the way back.
      resizable.collapse();
      setCollapsed(true);
    }
  }, [id, address, name]);
  // A thing that is no longer open beside the page (the page's word: a card snoozed, dismissed or done) leaves the row.
  useEffect(() => {
    if (!isOpen) return;
    const kept = tabsRef.current.filter(t => t.id === id || isOpen(t.id));
    if (kept.length !== tabsRef.current.length) setTabs(kept);
  });
  useEffect(() => {
    const from = shown.current;
    shown.current = id === null ? null : { id, address };
    if (id === null) {
      // Closed: focus goes back to what opened the panel, when that is still on the page; a row's title drawn again
      // while its card was open (it says "öppet bredvid") is found by the address it leads to.
      const back = opener.current;
      opener.current = null;
      if (!from || !inline) return;
      const target = back?.isConnected
        ? back
        : from.address
          ? [...document.querySelectorAll<HTMLElement>('a[href]')].find(el =>
              sameAddress(el.getAttribute('href'), from.address!),
            )
          : undefined;
      target?.focus();
      return;
    }
    if (from?.id === id) return;
    // One thing at a time: a link on the page that opened another thing in its place is the new way back.
    if (from && replaces && inline) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !region.current?.contains(active))
        opener.current = active;
    }
    if (!from) {
      const active = document.activeElement;
      if (!inline || (active instanceof HTMLElement && active.matches(TYPING))) return;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      heading.current?.focus();
      return;
    }
    // One thing took another's place in the open panel (a row's own view, and back): nobody hears that, and focus would
    // stay on a link that is gone. Focus goes to the link that led away when the person comes back to it, else to the
    // panel's start (the menu of open things, once it has been drawn), and the new name is spoken.
    const root: ParentNode | null = inline ? region.current : document.querySelector('dialog[open]');
    const stops = [
      ...(root?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])') ?? []),
    ];
    const led = from.address ? stops.find(el => sameAddress(el.getAttribute('href'), from.address!)) : undefined;
    // With several things open the heading gives way to the menu on the next render: the focus waits for it.
    const several = inline && tabsRef.current.length > 1;
    const target = led ?? (several ? null : inline ? heading.current : (stops[1] ?? stops[0]));
    if (target) target.focus();
    else if (inline) requestAnimationFrame(() => start()?.focus());
    if (name) announce(name);
  }, [id, inline]);
  /**
   * What is open beside the page when it is more than one thing (D66, revised 2026-11-06): Astryx's tab strip holding
   * one `TabMenu`, a button that reads the current thing's name and opens the list of the others, each leading to its
   * address. Not a row of `Tab`s: two card titles already overflow the panel, and a strip that scrolls shows neither
   * the whole current name nor what else is open. The strip is a nav landmark; the menu says how many are open.
   */
  const tabRow =
    tabs.length > 1 && panel ? (
      <TabList
        aria-label="Öppet bredvid"
        size="sm"
        value={panel.id}
        onChange={v => {
          const t = tabs.find(t => t.id === v);
          if (t) navigate(pathname + t.search);
        }}
      >
        <TabMenu
          ref={menu}
          label={`${tabs.length} öppna bredvid`}
          options={tabs.map(t => ({ value: t.id, label: t.name }))}
        />
      </TabList>
    ) : null;
  /** ✕ closes the current thing: the panel with one open, the current tab among several (D66 item 3). */
  const closeLabel = tabs.length > 1 && name ? `Stäng ${name}` : 'Stäng panelen';
  /** From two open, closing all is one choice in a menu beside ✕ (D66 item 3, revised): ✕ keeps closing the one it names. */
  const more =
    tabs.length > 1 ? (
      <DropdownMenu
        renderTrigger={trigger => (
          <IconButton
            {...trigger}
            size="sm"
            variant="ghost"
            label="Fler val för panelen"
            tooltip="Fler val för panelen"
            icon={<Icon icon="moreHorizontal" />}
          />
        )}
        alignment="end"
        items={[{ label: `Stäng alla (${tabs.length})`, onClick: closeAll }]}
      />
    ) : null;
  const close = (open: boolean) => {
    if (!open) panel?.onClose();
  };
  /**
   * With nothing open the panel says so, under the name the rows use for what is in it. Its button folds it; so does
   * Esc, which gives the focus to the button.
   */
  const rest = (
    <VStack
      height="100%"
      onKeyDown={e => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        collapse();
        fold.current?.focus();
      }}
    >
      <Layout
        height="fill"
        padding={6}
        header={
          <LayoutHeader>
            <Heading ref={heading} tabIndex={-1} level={4} accessibilityLevel={2} color="secondary">
              Öppet bredvid
            </Heading>
          </LayoutHeader>
        }
        content={
          <LayoutContent>
            <EmptyState title="Inget är öppet bredvid sidan" isCompact headingLevel={3} />
          </LayoutContent>
        }
      />
    </VStack>
  );
  const titleHeading = panel && (
    <Heading
      ref={heading}
      tabIndex={-1}
      level={panel.kind === 'card' ? 4 : 2}
      accessibilityLevel={2}
      color={panel.kind === 'card' ? 'secondary' : 'primary'}
    >
      {panel.title}
    </Heading>
  );
  // What stands before the heading and the line under it, when the frame has them (D97, artboard C): a person's avatar
  // beside their name, their role and unit under it.
  const titleBlock =
    panel && (panel.lead || panel.subtitle) ? (
      <HStack gap={3} vAlign="center">
        {panel.lead}
        <VStack gap={0}>
          {titleHeading}
          {panel.subtitle && <Text type="supporting">{panel.subtitle}</Text>}
        </VStack>
      </HStack>
    ) : (
      titleHeading
    );
  // The handle stands between the page and the panel only while the panel is shown, as Astryx's `ai-chat` template
  // mounts its handle with the open panel. A folded panel has no width to change, and its handle would stand on the
  // window's edge with half of its 16 px grab zone past it: Astryx keeps the whole zone for a folded region, the
  // shell's main area then scrolled sideways by those 8 px, and a scrollbar stood at the foot of every page with a
  // panel (the product owner, 2026-11-11). The fold button is the way back; it needs no second one on the edge.
  // Folded, the panel is a plain one of no width, there for the fold button's layer to stand beside: the region sizes
  // it only while its handle is there. Left to the region without the handle, the emptied panel kept its width over
  // the page for most of a second after a fold, and the button with it (measured).
  const end = inline ? (
    <>
      {toggle}
      {!collapsed && <ResizeHandle isReversed hasDivider resizable={resizable.props} label="Ändra panelens bredd" />}
      <LayoutPanel
        ref={edge.ref}
        hasDivider={false}
        // Folded away it has no width and nothing in it: not a landmark to land on.
        {...(collapsed
          ? { width: 0 }
          : {
              resizable: resizable.props,
              role: 'complementary' as const,
              label: panel?.title ?? 'Öppet bredvid',
            })}
        padding={0}
        isScrollable={false}
      >
        {!collapsed && !panel && rest}
        {!collapsed && panel && (
          <VStack
            ref={region}
            height="100%"
            onKeyDown={e => {
              // Esc inside a menu, a list or a dialog is theirs; a bare Esc lets go of the panel and never reaches the conversation behind it.
              if (
                e.key !== 'Escape' ||
                (e.target as HTMLElement).closest('[role="menu"], [role="listbox"], [role="dialog"], dialog')
              )
                return;
              e.stopPropagation();
              panel.onClose();
            }}
          >
            <Layout
              height="fill"
              padding={6}
              /* A heading and a button, not a toolbar: the heading takes the focus when the panel opens, and a toolbar would offer its arrow keys there. With several things open the menu of them stands where the heading stood, and ✕ beside it closes the one it names. */
              header={
                <LayoutHeader hasDivider={panel.kind !== 'card' || !!tabRow}>
                  <HStack justify="between" vAlign={panel.lead || panel.subtitle ? 'start' : 'center'} gap={2}>
                    {tabRow ?? titleBlock}
                    <HStack gap={1} vAlign="center">
                      {panel.actions}
                      {more}
                      <IconButton
                        size="sm"
                        variant="ghost"
                        label={closeLabel}
                        icon={<Icon icon="close" />}
                        onClick={panel.onClose}
                      />
                    </HStack>
                  </HStack>
                </LayoutHeader>
              }
              content={
                <LayoutContent>
                  <VStack id={BODY_ID}>{panel.body(true)}</VStack>
                </LayoutContent>
              }
            />
          </VStack>
        )}
      </LayoutPanel>
    </>
  ) : undefined;
  const occupied = inline && (panel !== null || !collapsed);
  // The drawer's dialog fires `close` when it has slid away and left the top layer, after Astryx's own focus return:
  // the moment the page under it takes focus again, and so the one a consumer's listener is given the last word at.
  const drawer = useRef<HTMLDialogElement>(null);
  const closed = useRef(onClosed);
  closed.current = onClosed;
  useEffect(() => {
    const dialog = drawer.current;
    if (!dialog) return;
    const tell = () => closed.current?.();
    dialog.addEventListener('close', tell);
    return () => dialog.removeEventListener('close', tell);
  }, [inline]);
  // The drawer keeps the last name while it slides away, so its heading is never empty (axe: empty-heading).
  const lastTitle = useRef<string | null>(null);
  if (panel) lastTitle.current = panel.title;
  const overlay = inline ? null : (
    <Drawer
      ref={drawer}
      isOpen={panel !== null}
      onOpenChange={close}
      side="end"
      width={panel?.wide ? 'min(1100px, 100vw)' : width}
      label={lastTitle.current ?? 'Vy'}
    >
      <Layout
        header={
          <DrawerHeader
            title={lastTitle.current ?? 'Vy'}
            onOpenChange={close}
            {...(panel?.lead ? { startContent: panel.lead } : {})}
            {...(panel?.subtitle ? { subtitle: panel.subtitle } : {})}
          />
        }
        content={
          <LayoutContent>
            <VStack gap={3}>
              {tabRow}
              {(panel?.actions || more) && (
                <HStack gap={1} wrap="wrap" vAlign="center">
                  {panel?.actions}
                  {more}
                </HStack>
              )}
              <VStack id={BODY_ID}>{panel?.body(false)}</VStack>
            </VStack>
          </LayoutContent>
        }
      />
    </Drawer>
  );
  return { end, overlay, occupied, inline };
}
