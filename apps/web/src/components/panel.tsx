import { useEffect, useRef } from 'react';
import type { DayView, PanelViewSpec, SearchResult, ViewRef } from '@clew/contracts';
import { Badge, Button, DayStrip, Drawer, DrawerHeader, HStack, Layout, LayoutContent, List, ListItem, Text, VStack, agendaItems, useAnnounce, type AgendaItem } from '@clew/ui';
import { dayLabel } from '@clew/calendar/dates';
import { fieldLabel, fieldValue, hiddenFields, reviewLabel, staleLabel } from './panel-labels';
import { useConversation } from './conversation-context';
import { AddToConversation } from './add-to-conversation';
import { DeclaredView } from './view';

const pathOf = (address: string) => address.split('?')[0];
const plain = (address: string) => { try { return decodeURIComponent(address); } catch { return address; } };
const sameAddress = (href: string | null, address: string) => !!href && plain(href) === plain(address);
type Props = {
  title: string | null; output: unknown; onClose: () => void; onOpenItem?: (item: AgendaItem, dayItems: AgendaItem[]) => void;
  /** The capability's declared view (D38) and what it needs to be used: its input and how to change it, where a row's own view lives, and the way back from one. */
  view?: PanelViewSpec | undefined; input?: Record<string, unknown>; onInput?: ((next: Record<string, unknown>) => void) | undefined;
  hrefFor?: (view: ViewRef) => string; onBack?: (() => void) | undefined; isLoading?: boolean;
  /** The address of the view on screen: when another view takes its place in the open panel, focus follows it. */
  address?: string | undefined;
};
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** A day view (D32): the `calendar.day` capability's output, drawn as the day strip instead of rows. */
const isDayView = (v: unknown): v is DayView => isRecord(v) && typeof v.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.from) && Array.isArray(v.events) && Array.isArray(v.proposals);
/** The composite search's output (D26): hits with a connector and a staleness, plus every source's status. */
const isSearchResult = (v: unknown): v is SearchResult => isRecord(v) && Array.isArray(v.rows) && Array.isArray(v.sources) && v.rows.every(r => isRecord(r) && typeof r.ref === 'string' && typeof r.label === 'string' && typeof r.connector === 'string');
const scalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const rowTitle = ['name', 'title', 'label', 'supplier'];

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
 * Phase-one side panel: a Clew-rendered view of a read capability's output. A capability that declares its view (D38) is
 * drawn as it says; without a declaration rows become a list and anything else label/value pairs. A table gets a wider
 * panel than a list or a record.
 */
export function PanelView({ title, output, onClose, onOpenItem, view, input, onInput, hrefFor, onBack, isLoading, address }: Props) {
  const declared = view ?? null;
  // One view replacing another inside the open panel (a row's contact card, and back) is a change of context nobody
  // hears and that would leave focus on a link that is gone (2.4.3, 4.1.3): the new view is named aloud, and focus goes
  // to the link that led away when the person comes back to it, else to the first control under the close button.
  const announce = useAnnounce();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const from = shown.current;
    shown.current = title === null ? null : address ?? null;
    if (!from || !address || title === null || pathOf(from) === pathOf(address)) return;
    const panel = document.querySelector<HTMLElement>('dialog[open]');
    const stops = [...(panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])') ?? [])];
    (stops.find(el => sameAddress(el.getAttribute('href'), from)) ?? stops[1] ?? stops[0])?.focus();
    announce(title);
  }, [address, title, announce]);
  const day = !declared && isDayView(output) ? output : null;
  const search = !declared && !day && isSearchResult(output) ? output : null;
  const dayItems = day ? agendaItems(day.events, day.proposals) : [];
  const rows = !declared && !day && !search && isRecord(output) && Array.isArray(output.rows) ? output.rows as Record<string, unknown>[] : null;
  const pairs = !declared && !day && !search && isRecord(output) ? Object.entries(output).filter(([k]) => k !== 'rows' && !hiddenFields.has(k)) : [];
  const close = (open: boolean) => { if (!open) onClose(); };
  return <Drawer isOpen={title !== null} onOpenChange={close} side="end" width={declared?.kind === 'table' ? 'min(1100px, 100vw)' : 440} label={title ?? 'Vy'}>
    <Layout header={<DrawerHeader title={title} onOpenChange={close} />} content={<LayoutContent>
      <VStack gap={3}>
        {onBack && <HStack><Button size="sm" variant="ghost" label="Tillbaka" onClick={onBack} /></HStack>}
        {declared && <DeclaredView view={declared} output={output} {...(input ? { input } : {})} {...(onInput ? { onInput } : {})} {...(hrefFor ? { hrefFor } : {})} isLoading={!!isLoading} />}
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
      </VStack>
    </LayoutContent>} />
  </Drawer>;
}
