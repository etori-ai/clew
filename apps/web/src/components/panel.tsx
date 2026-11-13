import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { DayView, PanelViewSpec, SearchResult, TodayView, ViewRef, WeekView } from '@clew/contracts';
import {
  AreaLine,
  ArrowsPointingOutIcon,
  Badge,
  Button,
  DayStrip,
  Drawer,
  EventList,
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
  StackItem,
  Text,
  VStack,
  agendaItems,
  useAnnounce,
  useLayer,
  useMediaQuery,
  useResizable,
  type AgendaItem,
} from '@clew/ui';
import { dayLabel, timeRange } from '@clew/calendar/dates';
import { fieldLabel, fieldValue, hiddenFields, reviewLabel, staleLabel } from './panel-labels';
import { useConversation, useModelConfigured, useThingConversation, type ThingSubject } from './conversation-context';
import { AddToConversation } from './add-to-conversation';
import { DeclaredView } from './view';
import { ThingWithConversation } from './thing-panel';
import { useMarks } from '../marks';
import { entityHref } from '../person-address';
import { shortQuery } from '../media';

const plain = (address: string) => {
  try {
    return decodeURIComponent(address);
  } catch {
    return address;
  }
};
const sameAddress = (href: string | null, address: string) => !!href && plain(href) === plain(address);
/** The link on the page that leads to `address`, the way back to what it opened. */
const linkTo = (address: string) =>
  [...document.querySelectorAll<HTMLElement>('a[href]')].find(el => sameAddress(el.getAttribute('href'), address));
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
 * Found text as objects (D12, D26): every hit is numbered as the answer cites it, opens where it lives and, where the
 * page has a box, can be added to the conversation as a chip. The row itself is not interactive, so its buttons are the
 * only stops (Astryx's rule).
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
            // The entity's page, except on that page itself (`entityHref`): the name is then plain text.
            const entity = r.subject ? entityHref(r.subject, pathname + search) : null;
            // Every source that answered for the same entity, the hit's own first: said once, on the hit's line.
            const merged = r.sources?.map(s => s.source).join(' · ');
            const meta = [merged ? '' : r.source, r.owner, reviewLabel(reviewed), r.stale ? '' : note.toLowerCase()]
              .filter(Boolean)
              .join(' · ');
            // A hit whose source declares its view (D38) opens here, drawn by Startsidan; the link still leads to the
            // source, in a new tab and marked as leaving Clew with Astryx's external link (D111 rule 8). A hit about an
            // entity leads to the entity instead. "Lägg till i samtalet" only where the page has a box (D111 rule 6); a
            // hit with none of the three has no line of buttons.
            const viewHref = !r.subject && r.view && hrefFor ? hrefFor(r.view) : null;
            const link = !r.subject && r.link ? r.link : null;
            return (
              <ListItem
                key={ref}
                align="start"
                startContent={<Badge variant="neutral" label={String(i + 1)} />}
                label={
                  r.subject || merged ? (
                    <HStack gap={2} justify="between" vAlign="center" wrap="wrap">
                      {entity ? (
                        <Link href={entity} weight="semibold" hasUnderline>
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
                    {(viewHref || link || talk.hasBox) && (
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        {viewHref && r.view && (
                          <Button size="sm" variant="secondary" label={r.view.title} href={viewHref} />
                        )}
                        {link && (
                          <Link href={link} isExternalLink isStandalone>
                            {r.view ? `Öppna i ${r.source}` : 'Öppna'}
                          </Link>
                        )}
                        {talk.hasBox && (
                          <AddToConversation
                            added={inConversation}
                            onAdd={() => talk.addChip({ ref, kind: 'document', label: r.label })}
                          />
                        )}
                      </HStack>
                    )}
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
  /** What the thing is and where it is from, under its name in the header ("Möte · Kalendern", board Calendar). */
  subtitle?: string;
  /**
   * The content, told whether it is drawn beside the page (narrow, non-modal) or over it, and whether a conversation
   * about it runs, so its facts fold to the essentials and its buttons with "Visa allt" (D112 item 7).
   */
  body: (inline: boolean, folded: boolean) => ReactNode;
  onClose: () => void;
  /**
   * What the box under the thing asks about (D112 item 7). The box is drawn whenever the thing has one and a model is
   * configured; without a model, or a thing that is not asked about (a read that failed), the panel is the thing alone.
   */
  subject?: ThingSubject;
  /** The address of what is on screen, so focus finds the link that led away when the person comes back to it. */
  address?: string | undefined;
  /** A table: over the page it gets a wide drawer. */
  wide?: boolean;
  /** A card: its name is the small label over the card, as artboard E draws "KORT"; a view keeps its title as the heading. */
  kind?: 'card' | 'view';
  /** What is said aloud when this thing takes another's place in the panel: a card's own title, not "Kort"; a view says `title`. */
  spoken?: string;
}
/** The one body region, where the open thing is drawn. */
const BODY_ID = 'panel-body';
/** The rail and the panel as the shell draws them. */
export const RAIL = 260,
  PANEL = 440;
/** The least width a page's own column keeps beside the panel: Hem's rows with their day, their line and their one button. */
export const PAGE_MIN = 640;
/**
 * The one window width from which the panel stands beside the page, on every page that holds it (the product owner,
 * 2026-11-11, D111 amended): the rail, Hem's least column and the panel, 260 + 640 + 440 = 1340 px. Narrower, or short
 * (1.4.10), or on a phone, it is the drawer over the page. A page whose own layout needs more than 640 px does not move
 * this line: it gives way, drawing the narrow layout it already has while the panel is open beside it (its own
 * breakpoint shifted by the panel, `panelBesideQuery`).
 */
export const BESIDE_FROM = RAIL + PAGE_MIN + PANEL;
export const besideQuery = `(min-width: ${BESIDE_FROM}px)`;
/**
 * What stands on the panel's inner edge beside its width while it is shown: the 1 px resize handle, as measured in the
 * browser. The fold button floats over the page beside it (D63 item 14, revised 2026-11-10), so it takes no width of
 * its own.
 */
export const PANEL_EDGE = 1;
/** How far in from the panel's own edge the fold button stands: 20 px in from the handle, which is on that edge while the panel is shown. */
const FOLD_OFFSET = 20 + PANEL_EDGE;
/**
 * A page's own breakpoint while the panel stands beside it: the window width from which a column that needs `minMain`
 * px still has it beside the panel. Below it, with the panel open, the page draws its narrow layout; the panel's own
 * line is `BESIDE_FROM`.
 */
export const panelBesideQuery = (minMain: number, width: number = PANEL) => `(min-width: ${RAIL + minMain + width}px)`;
type Options = {
  /** Nothing is pinned on a short screen (1.4.10), nor beside a page that has no room for it: the panel is always a drawer there. */
  overlayOnly?: boolean;
  /**
   * The drawer over the page has closed and Astryx has given the focus back to what opened it. Until then the page
   * under it is inert; a page whose opener is gone (the row of a card that was sent away) sends the focus on from here.
   */
  onClosed?: () => void;
  /**
   * Whether the thing gets the box under it (D112 item 7). False on a conversation's own page, where the transcript is
   * the column and the panel is its artifact: the conversation's box is the one to ask in.
   */
  asks?: boolean;
};
/**
 * The panel (D50): the one place beside the page's column for what the person holds next to it, a view, a source or a
 * card, and nothing else: with nothing open there is no panel, and a page's own content (Hem's day) stays the page's
 * (D72). It holds one opened thing (D111, amended 2026-11-11, which withdrew D66's tabs): what is opened from the page
 * takes the place of what was open, on every page, and the link it was opened with is where the focus goes back to on
 * close. From the one width `BESIDE_FROM` it is a `LayoutPanel` in the page's `end` slot, non-modal, so the column stays
 * in use (the `ai-chat` template's artifact beside the transcript, composed as the calendar page composes its own
 * panel); in a narrower window, on a short screen and on a phone it is the drawer over the page. Both are drawn with
 * the same header, the same title and the same ✕ (the product owner, 2026-11-11: one sidebar, not two), so only the
 * page around it changes. Beside the page it is a named complementary region: opening it moves focus to its heading
 * (never away from a field the person is typing in: the box keeps the focus when a conversation brings its panel
 * along), Esc inside it closes it and gives focus back to what opened it, and one thing taking another's place is named
 * aloud (2.4.3, 4.1.3). Over the page the drawer gives the heading the focus and takes it back itself.
 */
const TYPING = 'input, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]';
export function usePanel(
  panel: PanelFrame | null,
  { overlayOnly = false, onClosed, asks = true }: Options,
): {
  end: ReactNode | undefined;
  overlay: ReactNode;
  /** Whether the panel takes width beside the page: something is open in it, or the person is looking at it empty. */
  occupied: boolean;
  /** Whether the panel stands beside the page (non-modal) rather than over it: the one rule, so a page never works it out again. */
  inline: boolean;
} {
  const fits = useMediaQuery(besideQuery);
  const inline = fits && !overlayOnly;
  // 1.4.10: on a short screen nothing is docked in the panel either; the thing, the transcript and the box scroll as one.
  const short = useMediaQuery(shortQuery);
  const announce = useAnnounce();
  // The thing and the conversation about it (D112 item 7): the box is there while a model is configured (D8) and the
  // thing is one that is asked about; the conversation is the thing's own, and folds its facts while it runs.
  const model = useModelConfigured();
  const subject = asks && model && panel?.subject ? panel.subject : null;
  const talk = useThingConversation(subject);
  const folded = !!subject && talk.running;
  const continueHref = subject && talk.conversation ? `/conversations/${talk.conversation.id}${subject.search}` : null;
  const region = useRef<HTMLDivElement>(null);
  /** The drawer's dialog, where the panel is drawn over the page. */
  const drawer = useRef<HTMLDialogElement>(null);
  /** The panel's start, where the focus lands: the heading of its one header. */
  const heading = useRef<HTMLHeadingElement>(null);
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
    // The shared panel's width, the same on every page (320 to 560 px), remembered in this browser.
    defaultSize: PANEL,
    minSize: 320,
    maxSize: 560,
    collapsible: true,
    autoSaveId: 'clew-panel-width',
    isCollapsed: collapsed,
    onCollapseChange: setCollapsed,
  });
  const expand = () => {
    resizable.expand();
    setCollapsed(false);
    announce('Panelen visas');
    requestAnimationFrame(() => heading.current?.focus());
  };
  // Folding hides and nothing more (D63 item 14, revised 2026-11-06 evening): what is open and the address stay, so
  // the row keeps saying "öppet bredvid", and the button keeps the focus, now saying the way back. Letting go of what
  // is open is ✕ in the header. (The afternoon's fold closed the card with it, which made a layout act a close.)
  const collapse = () => {
    resizable.collapse();
    setCollapsed(true);
    announce('Panelen är ihopfälld');
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
  /** The address of what was closed, while the page may still draw the link that opened it anew (see below). */
  const returnTo = useRef<string | null>(null);
  /** The address the drawer showed when it was let go of, until it has slid away. */
  const drawerFrom = useRef<string | null>(null);
  // Folded away after the last thing closed, the page draws its own layout again, the link that opened the panel with
  // it: the focus follows that link into the layout, so it is never left on what the page took away (2.4.3).
  useEffect(() => {
    const address = returnTo.current;
    returnTo.current = null;
    if (!address || !collapsed) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active.isConnected) return;
    linkTo(address)?.focus();
  }, [collapsed]);
  const id = panel?.id ?? null,
    address = panel?.address,
    spoken = panel?.spoken ?? panel?.title ?? null;
  // What the panel holds changed. Something opened shows the panel again, so it is seen; closing what it held folds the
  // panel away, and its button stays, saying the way back.
  const lastId = useRef<string | null>(null);
  useEffect(() => {
    const was = lastId.current;
    lastId.current = id;
    if (id !== null && collapsed) {
      resizable.expand();
      setCollapsed(false);
      // The heading mounts with the next paint, after the focus rule below has run. Never away from a field the
      // person is typing in: the box keeps the focus when a conversation brings its panel along.
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement && active.matches(TYPING))) heading.current?.focus();
      });
    } else if (id === null && was !== null) {
      resizable.collapse();
      setCollapsed(true);
    }
  }, [id]);
  useEffect(() => {
    const from = shown.current;
    shown.current = id === null ? null : { id, address };
    if (id === null) {
      // Closed: focus goes back to what opened the panel, when that is still on the page; a row's title drawn again
      // while its card was open (it says "öppet bredvid") is found by the address it leads to.
      const back = opener.current;
      opener.current = null;
      // Over the page Astryx's drawer gives the focus back itself, once it has slid away (`closed` below).
      drawerFrom.current = !inline ? (from?.address ?? null) : null;
      if (!from || !inline) return;
      const target = back?.isConnected ? back : from.address ? linkTo(from.address) : undefined;
      target?.focus();
      // The page gave way to the panel (Personal's rows, a person's drill-in, a tool's list): folded away, the panel
      // gives the page its own layout back on the next render, and the link that opened it is drawn anew there.
      returnTo.current = back?.isConnected ? null : (from.address ?? null);
      return;
    }
    returnTo.current = null;
    if (from?.id === id) return;
    // One thing at a time: a link on the page that opened another thing in its place is the new way back.
    if (from && inline) {
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
    // One thing took another's place in the open panel (another card, a row's own view, and back): nobody hears that,
    // and focus would stay on a link that is gone. Focus goes to the link that led away when the person comes back to
    // it, else to the panel's heading, and the new thing's name is spoken. The same beside the page and in the drawer,
    // whose header is the same.
    const root: ParentNode | null = inline ? region.current : drawer.current;
    const stops = [
      ...(root?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])') ?? []),
    ];
    const led = from.address ? stops.find(el => sameAddress(el.getAttribute('href'), from.address!)) : undefined;
    const target = led ?? heading.current;
    if (target) target.focus();
    else requestAnimationFrame(() => heading.current?.focus());
    if (spoken) announce(spoken);
  }, [id, inline]);
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
  // The drawer keeps the last thing's name while it slides away, so its heading is never empty (axe: empty-heading).
  const last = useRef<PanelFrame | null>(null);
  if (panel) last.current = panel;
  const named = panel ?? last.current;
  /**
   * The panel's one header, beside the page and in the drawer alike (the product owner, 2026-11-11: one sidebar): the
   * name of what is open and ✕, in the same place and at the same size either way. A card's name is the small label over
   * the card, as artboard E draws "KORT"; a view keeps its title as the heading. A heading and a button, not a toolbar:
   * the heading takes the focus when the panel opens (beside the page from `usePanel`'s effect, in the drawer by
   * Astryx's `data-autofocus`), and a toolbar would offer its arrow keys there. ✕ closes the panel and what it holds;
   * there is never a second thing in it to name or switch to (D111, amended 2026-11-11). Astryx's `DrawerHeader` is not
   * used in the drawer: its title is always a full-size h2 that takes no ref, so the same card would be named
   * differently in the two, which is what the product owner saw.
   */
  const header = named && (
    <LayoutHeader hasDivider={named.kind !== 'card'}>
      <HStack justify="between" vAlign="center" gap={2}>
        <StackItem size="fill">
          <VStack gap={0}>
            <Heading
              ref={heading}
              tabIndex={-1}
              data-autofocus=""
              level={named.kind === 'card' ? 4 : 2}
              accessibilityLevel={2}
              color={named.kind === 'card' ? 'secondary' : 'primary'}
            >
              {named.title}
            </Heading>
            {named.subtitle && (
              <Text type="supporting" color="secondary">
                {named.subtitle}
              </Text>
            )}
          </VStack>
        </StackItem>
        <HStack gap={1} vAlign="center">
          {/* A long exchange continues in the conversation view (D112 item 7, board Assistant): the transcript as the
              page's column and the thing as its artifact beside it. */}
          {continueHref && (
            <IconButton
              size="sm"
              variant="ghost"
              label="Fortsätt som samtal"
              tooltip="Fortsätt som samtal"
              icon={<Icon icon={ArrowsPointingOutIcon} />}
              href={continueHref}
            />
          )}
          <IconButton
            size="sm"
            variant="ghost"
            label="Stäng panelen"
            icon={<Icon icon="close" />}
            onClick={() => panel?.onClose()}
          />
        </HStack>
      </HStack>
    </LayoutHeader>
  );
  /**
   * The header and the body, laid out the same beside the page and in the drawer. With a box (D112 item 7) the body is
   * the thing with the conversation under it, docked by ChatLayout, which owns the scroll; without one it is the thing
   * alone in the content's own scroll, as before.
   */
  const framed = (frame: PanelFrame | null, inline: boolean) => {
    const thing = frame?.body(inline, folded);
    return (
      <Layout
        height="fill"
        padding={6}
        header={header}
        content={
          subject && frame ? (
            <LayoutContent isScrollable={short} padding={short ? 6 : 0}>
              <VStack id={BODY_ID} height={short ? undefined : '100%'}>
                <ThingWithConversation talk={talk} subject={subject} thing={thing} short={short} />
              </VStack>
            </LayoutContent>
          ) : (
            <LayoutContent>
              <VStack id={BODY_ID}>{thing}</VStack>
            </LayoutContent>
          )
        }
      />
    );
  };
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
            {framed(panel, true)}
          </VStack>
        )}
      </LayoutPanel>
    </>
  ) : undefined;
  const occupied = inline && (panel !== null || !collapsed);
  // The drawer's dialog fires `close` when it has slid away and left the top layer, after Astryx's own focus return:
  // the moment the page under it takes focus again, and so the one a consumer's listener is given the last word at.
  const closed = useRef(onClosed);
  closed.current = onClosed;
  useEffect(() => {
    const dialog = drawer.current;
    if (!dialog) return;
    const tell = () => {
      // The link that opened the drawer was drawn anew while it was open (a tool's row marked as shown beside, a row
      // that says "öppet bredvid"): Astryx's return found it gone and the focus fell to the page's body. It goes to the
      // link with the address the drawer showed, as beside the page (2.4.3).
      const address = drawerFrom.current;
      drawerFrom.current = null;
      const active = document.activeElement;
      if (address && (!active || active === document.body)) linkTo(address)?.focus();
      closed.current?.();
    };
    dialog.addEventListener('close', tell);
    return () => dialog.removeEventListener('close', tell);
  }, [inline]);
  // The drawer's own inset is the panel's: none of its own, the layout's 24 px, as beside the page.
  const overlay = inline ? null : (
    <Drawer
      ref={drawer}
      isOpen={panel !== null}
      onOpenChange={close}
      side="end"
      width={panel?.wide ? 'min(1100px, 100vw)' : PANEL}
      label={named?.title ?? 'Vy'}
      padding={0}
    >
      {framed(panel, false)}
    </Drawer>
  );
  return { end, overlay, occupied, inline };
}
