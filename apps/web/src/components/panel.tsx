import { useEffect, useRef, type ReactNode } from 'react';
import type { DayView, PanelViewSpec, SearchResult, ViewRef } from '@clew/contracts';
import { Badge, Button, DayStrip, Drawer, DrawerHeader, Heading, HStack, Icon, IconButton, Layout, LayoutContent, LayoutHeader, LayoutPanel, List, ListItem, Text, VStack, agendaItems, useAnnounce, useMediaQuery, type AgendaItem } from '@clew/ui';
import { dayLabel } from '@clew/calendar/dates';
import { fieldLabel, fieldValue, hiddenFields, reviewLabel, staleLabel } from './panel-labels';
import { useConversation } from './conversation-context';
import { AddToConversation } from './add-to-conversation';
import { DeclaredView } from './view';

const plain = (address: string) => { try { return decodeURIComponent(address); } catch { return address; } };
const sameAddress = (href: string | null, address: string) => !!href && plain(href) === plain(address);
type BodyProps = {
  output: unknown; onOpenItem?: (item: AgendaItem, dayItems: AgendaItem[]) => void;
  /** The capability's declared view (D38) and what it needs to be used: its input and how to change it, where a row's own view lives, and the way back from one. */
  view?: PanelViewSpec | undefined; source?: string | undefined; input?: Record<string, unknown>; onInput?: ((next: Record<string, unknown>) => void) | undefined;
  hrefFor?: (view: ViewRef) => string; onBack?: (() => void) | undefined; isLoading?: boolean;
  /** Beside the page, where the panel is as narrow as a phone: a table is drawn as its list. */
  inline?: boolean;
};
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** A day view (D32): the `calendar.day` capability's output, drawn as the day strip instead of rows. */
const isDayView = (v: unknown): v is DayView => isRecord(v) && typeof v.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.from) && Array.isArray(v.events) && Array.isArray(v.proposals);
/** The composite search's output (D26): hits with a connector and a staleness, plus every source's status. */
const isSearchResult = (v: unknown): v is SearchResult => isRecord(v) && Array.isArray(v.rows) && Array.isArray(v.sources) && v.rows.every(r => isRecord(r) && typeof r.ref === 'string' && typeof r.label === 'string' && typeof r.connector === 'string');
const scalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const rowTitle = ['name', 'title', 'label', 'supplier'];
/** A media query that never matches: a table beside the page is always its list. */
const NEVER = 'not all';

/**
 * Found text as objects (D12, D26): every hit is numbered as the answer cites it, opens where it lives and can be added to
 * the conversation as a chip. The row itself is not interactive, so its two buttons are the only stops (Astryx's rule).
 */
function SearchRows({ result, hrefFor }: { result: SearchResult; hrefFor?: ((view: ViewRef) => string) | undefined }) {
  const talk = useConversation();
  const missed = result.sources.filter(s => s.status !== 'ok');
  return <VStack gap={3}>
    {result.rows.length === 0 && <Text type="supporting">Inget hittades i källorna du får söka i.</Text>}
    {result.rows.length > 0 && <List hasDividers density="compact" aria-label="Källor">{result.rows.map((r, i) => {
      const ref = `document:${r.connector}:${r.ref}`;
      const inConversation = talk.chipped.includes(ref);
      // A review date is a document's business: a person or a room has none to miss.
      const stale = r.kind === 'document' ? staleLabel(r.stale, r.reviewedAt ?? r.updatedAt) : '';
      return <ListItem key={ref} align="start"
        startContent={<Badge variant="neutral" label={String(i + 1)} />}
        label={<Text weight="semibold">{r.label}{r.section ? ` · ${r.section}` : ''}</Text>}
        description={<VStack gap={1}>
          <Text type="supporting">{r.snippet}</Text>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text type="supporting">{[r.owner, reviewLabel(r.reviewedAt ?? r.updatedAt), r.source].filter(Boolean).join(' · ')}</Text>
            {stale && <Badge variant={r.stale ? 'warning' : 'neutral'} label={stale} />}
          </HStack>
          <HStack gap={1} wrap="wrap">
            {/* A hit whose source declares its view (D38) opens here, drawn by Startsidan; the link still leads to the source. */}
            {r.view && hrefFor && <Button size="sm" variant="secondary" label={r.view.title} href={hrefFor(r.view)} />}
            {r.link && <Button size="sm" variant="secondary" label={r.view ? `Öppna i ${r.source}` : 'Öppna'} href={r.link} target="_blank" />}
            <AddToConversation added={inConversation} onAdd={() => talk.addChip({ ref, kind: 'document', label: r.label })} />
          </HStack>
        </VStack>} />;
    })}</List>}
    {missed.length > 0 && <Text type="supporting">{missed.map(s => s.source).join(', ')} svarade inte. Träffarna ovan är från de källor som svarade.</Text>}
    <Text type="supporting">Hämtat som du, ur det du får se. Inget av texten sparas på Startsidan.</Text>
  </VStack>;
}
/**
 * A read capability's output as the panel draws it. A capability that declares its view (D38) is drawn as it says;
 * without a declaration rows become a list and anything else label/value pairs.
 */
export function PanelBody({ output, onOpenItem, view, source, input, onInput, hrefFor, onBack, isLoading, inline = false }: BodyProps) {
  const declared = view ?? null;
  const day = !declared && isDayView(output) ? output : null;
  const search = !declared && !day && isSearchResult(output) ? output : null;
  const dayItems = day ? agendaItems(day.events, day.proposals) : [];
  const rows = !declared && !day && !search && isRecord(output) && Array.isArray(output.rows) ? output.rows as Record<string, unknown>[] : null;
  const pairs = !declared && !day && !search && isRecord(output) ? Object.entries(output).filter(([k]) => k !== 'rows' && !hiddenFields.has(k)) : [];
  return <VStack gap={3}>
    {onBack && <HStack><Button size="sm" variant="ghost" label="Tillbaka" onClick={onBack} /></HStack>}
    {declared && <DeclaredView view={declared} output={output} {...(input ? { input } : {})} {...(onInput ? { onInput } : {})} {...(hrefFor ? { hrefFor } : {})} isLoading={!!isLoading} {...(inline ? { tableQuery: NEVER } : {})} />}
    {day && <>
      <Text type="supporting">Du tittar på {dayLabel(day.from)} i din kalender.</Text>
      <DayStrip date={day.from} items={dayItems} dayHeadingLevel={3} accessiblePath="Retur på en post öppnar den." onItemClick={onOpenItem ? item => onOpenItem(item, dayItems) : undefined} />
    </>}
    {search && <SearchRows result={search} hrefFor={hrefFor} />}
    {rows && <List hasDividers density="compact">{rows.map((r, i) => {
      const key = rowTitle.find(k => r[k] !== undefined);
      const detail = Object.entries(r).filter(([k, v]) => k !== key && !hiddenFields.has(k) && scalar(v)).map(([k, v]) => `${fieldLabel(k)}: ${fieldValue(v)}`).join(' · ');
      return <ListItem key={i} label={<Text>{key ? fieldValue(r[key]) : `Rad ${i + 1}`}</Text>} description={<Text type="supporting">{detail}</Text>} />;
    })}</List>}
    {pairs.length > 0 && <List density="compact">{pairs.map(([k, v]) => <ListItem key={k} label={<Text>{fieldLabel(k)}</Text>} description={<Text type="supporting">{fieldValue(v)}</Text>} />)}</List>}
    {!declared && !day && !search && !rows && !pairs.length && <Text type="supporting">Inget att visa.</Text>}
    {/* A declared view and the search name where they read from themselves; a plain read says it here. */}
    {source && (rows || pairs.length > 0) && <Text type="supporting">Hämtat ur {source}. Inget av det sparas på Startsidan.</Text>}
  </VStack>;
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
}
/** The rail and the panel as the shell draws them; with the page's own least width they decide when the panel fits beside it. */
const RAIL = 256, PANEL = 440;
/** The window width from which the panel fits beside a column that needs `minMain` px. */
export const panelBesideQuery = (minMain: number) => `(min-width: ${RAIL + minMain + PANEL}px)`;
/** What a transcript needs beside the panel: a conversation asked on a page brings the page along only where both fit (D50). */
export const CONVERSATION_MIN = 600;
type Options = {
  /** The least width the page's own column needs beside the panel. Narrower windows get the panel as a drawer over the page. */
  minMain: number;
  /** Nothing is pinned on a short screen (1.4.10): the panel is always a drawer there. */
  overlayOnly?: boolean;
};
/**
 * The panel (D50): the one place beside the page's column for what the person holds next to it, a view, a source or a
 * card. Where it fits it is a `LayoutPanel` in the page's `end` slot, non-modal, so the column stays in use (the
 * `ai-chat` template's artifact beside the transcript, composed as the calendar page composes its own panel); where it
 * does not fit, and on a phone, it is the drawer it always was. Beside the page it is a named complementary region:
 * opening it moves focus to its heading (never away from a field the person is typing in: the box keeps the focus
 * when a conversation brings its panel along), Esc inside it closes it and gives focus back to what opened it, and one
 * thing taking another's place is named aloud (2.4.3, 4.1.3). A drawer does all of that itself.
 */
const TYPING = 'input, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]';
export function usePanel(panel: PanelFrame | null, { minMain, overlayOnly = false }: Options): { end: ReactNode | undefined; overlay: ReactNode } {
  const fits = useMediaQuery(panelBesideQuery(minMain));
  const inline = fits && !overlayOnly;
  const announce = useAnnounce();
  const region = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const shown = useRef<{ id: string; address: string | undefined } | null>(null);
  const id = panel?.id ?? null, address = panel?.address, title = panel?.title ?? null;
  useEffect(() => {
    const from = shown.current;
    shown.current = id === null ? null : { id, address };
    if (id === null) {
      // Closed: focus goes back to what opened the panel, when that is still on the page.
      const back = opener.current;
      opener.current = null;
      if (from && inline && back?.isConnected) back.focus();
      return;
    }
    if (from?.id === id) return;
    if (!from) {
      const active = document.activeElement;
      if (!inline || (active instanceof HTMLElement && active.matches(TYPING))) return;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      heading.current?.focus();
      return;
    }
    // One thing took another's place in the open panel (a row's own view, and back): nobody hears that, and focus would
    // stay on a link that is gone. Focus goes to the link that led away when the person comes back to it, else to the
    // panel's start, and the new name is spoken.
    const root: ParentNode | null = inline ? region.current : document.querySelector('dialog[open]');
    const stops = [...(root?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])') ?? [])];
    const led = from.address ? stops.find(el => sameAddress(el.getAttribute('href'), from.address!)) : undefined;
    (led ?? (inline ? heading.current : stops[1] ?? stops[0]))?.focus();
    if (title) announce(title);
  }, [id, inline]);
  const close = (open: boolean) => { if (!open) panel?.onClose(); };
  const end = inline && panel ? <LayoutPanel width={PANEL} hasDivider role="complementary" label={panel.title} padding={0} isScrollable={false}>
    <VStack ref={region} height="100%" onKeyDown={e => {
      // Esc inside a menu, a list or a dialog is theirs; a bare Esc lets go of the panel and never reaches the conversation behind it.
      if (e.key !== 'Escape' || (e.target as HTMLElement).closest('[role="menu"], [role="listbox"], [role="dialog"], dialog')) return;
      e.stopPropagation();
      panel.onClose();
    }}>
      <Layout height="fill" padding={3}
        /* A heading and two buttons, not a toolbar: the heading takes the focus when the panel opens, and a toolbar would offer its arrow keys there. */
        header={<LayoutHeader hasDivider><HStack justify="between" vAlign="center" gap={2}>
          <Heading ref={heading} tabIndex={-1} level={2}>{panel.title}</Heading>
          <HStack gap={1} vAlign="center">{panel.actions}<IconButton size="sm" variant="ghost" label="Stäng panelen" icon={<Icon icon="close" />} onClick={panel.onClose} /></HStack>
        </HStack></LayoutHeader>}
        content={<LayoutContent>{panel.body(true)}</LayoutContent>} />
    </VStack>
  </LayoutPanel> : undefined;
  const overlay = inline ? null : <Drawer isOpen={panel !== null} onOpenChange={close} side="end" width={panel?.wide ? 'min(1100px, 100vw)' : PANEL} label={panel?.title ?? 'Vy'}>
    <Layout header={<DrawerHeader title={panel?.title ?? null} onOpenChange={close} />} content={<LayoutContent>
      <VStack gap={3}>
        {panel?.actions && <HStack gap={1} wrap="wrap">{panel.actions}</HStack>}
        {panel?.body(false)}
      </VStack>
    </LayoutContent>} />
  </Drawer>;
  return { end, overlay };
}
