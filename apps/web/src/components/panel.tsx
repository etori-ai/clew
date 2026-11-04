import type { DayView } from '@clew/contracts';
import { DayStrip, Drawer, DrawerHeader, Layout, LayoutContent, List, ListItem, Text, VStack, agendaItems, type AgendaItem } from '@clew/ui';
import { dayLabel } from '@clew/calendar/dates';
import { fieldLabel, fieldValue, hiddenFields } from './panel-labels';

type Props = { title: string | null; output: unknown; onClose: () => void; onOpenItem?: (item: AgendaItem, dayItems: AgendaItem[]) => void };
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** A day view (D32): the `calendar.day` capability's output, drawn as the day strip instead of rows. */
const isDayView = (v: unknown): v is DayView => isRecord(v) && typeof v.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.from) && Array.isArray(v.events) && Array.isArray(v.proposals);
const scalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const rowTitle = ['name', 'title', 'label', 'supplier'];
/** Phase-one side panel: a Clew-rendered view of a read capability's output. Rows become a list; anything else becomes label/value pairs. */
export function PanelView({ title, output, onClose, onOpenItem }: Props) {
  const day = isDayView(output) ? output : null;
  const dayItems = day ? agendaItems(day.events, day.proposals) : [];
  const rows = !day && isRecord(output) && Array.isArray(output.rows) ? output.rows as Record<string, unknown>[] : null;
  const pairs = !day && isRecord(output) ? Object.entries(output).filter(([k]) => k !== 'rows' && !hiddenFields.has(k)) : [];
  const close = (open: boolean) => { if (!open) onClose(); };
  return <Drawer isOpen={title !== null} onOpenChange={close} side="end" width={440} label={title ?? 'Vy'}>
    <Layout header={<DrawerHeader title={title} onOpenChange={close} />} content={<LayoutContent>
      <VStack gap={3}>
        {day && <>
          <Text type="supporting">Du tittar på {dayLabel(day.from)} i din kalender.</Text>
          <DayStrip date={day.from} items={dayItems} dayHeadingLevel={3} accessiblePath="Retur på en post öppnar den." onItemClick={onOpenItem ? item => onOpenItem(item, dayItems) : undefined} />
        </>}
        {rows && <List hasDividers density="compact">{rows.map((r, i) => {
          const key = rowTitle.find(k => r[k] !== undefined);
          const detail = Object.entries(r).filter(([k, v]) => k !== key && !hiddenFields.has(k) && scalar(v)).map(([k, v]) => `${fieldLabel(k)}: ${fieldValue(v)}`).join(' · ');
          return <ListItem key={i} label={<Text>{key ? fieldValue(r[key]) : `Rad ${i + 1}`}</Text>} description={<Text type="supporting">{detail}</Text>} />;
        })}</List>}
        {pairs.length > 0 && <List density="compact">{pairs.map(([k, v]) => <ListItem key={k} label={<Text>{fieldLabel(k)}</Text>} description={<Text type="supporting">{fieldValue(v)}</Text>} />)}</List>}
        {!day && !rows && !pairs.length && <Text type="supporting">Inget att visa.</Text>}
      </VStack>
    </LayoutContent>} />
  </Drawer>;
}
