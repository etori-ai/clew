import type { DayView, SearchResult } from '@clew/contracts';
import { Badge, Button, DayStrip, Drawer, DrawerHeader, HStack, Layout, LayoutContent, List, ListItem, Text, VStack, agendaItems, type AgendaItem } from '@clew/ui';
import { dayLabel } from '@clew/calendar/dates';
import { fieldLabel, fieldValue, hiddenFields, reviewLabel, staleLabel } from './panel-labels';
import { useConversation } from './conversation-context';

type Props = { title: string | null; output: unknown; onClose: () => void; onOpenItem?: (item: AgendaItem, dayItems: AgendaItem[]) => void };
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
function SearchRows({ result }: { result: SearchResult }) {
  const talk = useConversation();
  const missed = result.sources.filter(s => s.status !== 'ok');
  return <VStack gap={3}>
    {result.rows.length === 0 && <Text type="supporting">Inget hittades i rutiner och dokument.</Text>}
    {result.rows.length > 0 && <List hasDividers density="compact" aria-label="Källor">{result.rows.map((r, i) => {
      const ref = `document:${r.connector}:${r.ref}`;
      const inConversation = talk.chipped.includes(ref);
      const stale = staleLabel(r.stale, r.reviewedAt ?? r.updatedAt);
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
            {r.link && <Button size="sm" variant="secondary" label="Öppna" href={r.link} target="_blank" />}
            <Button size="sm" variant="ghost" label={inConversation ? 'I samtalet ✓' : 'Lägg till i samtalet'} isDisabled={inConversation} onClick={() => talk.addChip({ ref, kind: 'document', label: r.label })} />
          </HStack>
        </VStack>} />;
    })}</List>}
    {missed.length > 0 && <Text type="supporting">{missed.map(s => s.source).join(', ')} svarade inte. Träffarna ovan är från de källor som svarade.</Text>}
    <Text type="supporting">Hämtat som du, ur det du får se. Inget av texten sparas på Startsidan.</Text>
  </VStack>;
}
/** Phase-one side panel: a Clew-rendered view of a read capability's output. Rows become a list; anything else becomes label/value pairs. */
export function PanelView({ title, output, onClose, onOpenItem }: Props) {
  const day = isDayView(output) ? output : null;
  const search = !day && isSearchResult(output) ? output : null;
  const dayItems = day ? agendaItems(day.events, day.proposals) : [];
  const rows = !day && !search && isRecord(output) && Array.isArray(output.rows) ? output.rows as Record<string, unknown>[] : null;
  const pairs = !day && !search && isRecord(output) ? Object.entries(output).filter(([k]) => k !== 'rows' && !hiddenFields.has(k)) : [];
  const close = (open: boolean) => { if (!open) onClose(); };
  return <Drawer isOpen={title !== null} onOpenChange={close} side="end" width={440} label={title ?? 'Vy'}>
    <Layout header={<DrawerHeader title={title} onOpenChange={close} />} content={<LayoutContent>
      <VStack gap={3}>
        {day && <>
          <Text type="supporting">Du tittar på {dayLabel(day.from)} i din kalender.</Text>
          <DayStrip date={day.from} items={dayItems} dayHeadingLevel={3} accessiblePath="Retur på en post öppnar den." onItemClick={onOpenItem ? item => onOpenItem(item, dayItems) : undefined} />
        </>}
        {search && <SearchRows result={search} />}
        {rows && <List hasDividers density="compact">{rows.map((r, i) => {
          const key = rowTitle.find(k => r[k] !== undefined);
          const detail = Object.entries(r).filter(([k, v]) => k !== key && !hiddenFields.has(k) && scalar(v)).map(([k, v]) => `${fieldLabel(k)}: ${fieldValue(v)}`).join(' · ');
          return <ListItem key={i} label={<Text>{key ? fieldValue(r[key]) : `Rad ${i + 1}`}</Text>} description={<Text type="supporting">{detail}</Text>} />;
        })}</List>}
        {pairs.length > 0 && <List density="compact">{pairs.map(([k, v]) => <ListItem key={k} label={<Text>{fieldLabel(k)}</Text>} description={<Text type="supporting">{fieldValue(v)}</Text>} />)}</List>}
        {!day && !search && !rows && !pairs.length && <Text type="supporting">Inget att visa.</Text>}
      </VStack>
    </LayoutContent>} />
  </Drawer>;
}
