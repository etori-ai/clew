import { useState } from 'react';
import type { Thread } from '@clew/contracts';
import { Button, DropdownMenu, Heading, HStack, Icon, List, ListItem, SegmentedControl, SegmentedControlItem, Text, VStack } from '@clew/ui';
import { api } from '../api';
import { useThreadAction } from '../mutations';

type Filter = 'idag' | 'veckan' | 'hanterade' | 'avfardade' | 'fragor';
const filters: { value: Filter; label: string }[] = [{ value: 'idag', label: 'I dag' }, { value: 'veckan', label: 'Veckan' }, { value: 'hanterade', label: 'Hanterade' }, { value: 'avfardade', label: 'Avfärdade' }, { value: 'fragor', label: 'Frågor' }];
const dayKey = (iso: string) => iso.slice(0, 10);
const dayHeading = (key: string) => new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(key + 'T12:00:00'));
const when = (t: Thread) => t.handledAt ?? t.updatedAt;

type RowProps = { thread: Thread; now: number; onChange: (thread: Thread) => void; conversationHref: (threadId: string) => string };
/** One row of the log with its one way back: Ångra while the window is open, Återöppna on a dismissed card. Its error sits under the row. */
function HandledRow({ thread: t, now, onChange, conversationHref }: RowProps) {
  const { run, error } = useThreadAction({ onChange });
  const last = [...t.messages].reverse().find(m => m.role === 'assistant');
  const undoUntil = t.proposals.map(p => p.undoUntil).filter((v): v is string => !!v).sort().at(-1);
  const undoOpen = !!undoUntil && Date.parse(undoUntil) > now && t.proposals.some(p => p.status === 'confirmed');
  const receiptUndo = !!t.receipt?.undoUntil && Date.parse(t.receipt.undoUntil) > now && !!t.receipt.undoCapability;
  const reopenable = t.state === 'dismissed' && !!t.handledAt && now - Date.parse(t.handledAt) <= 10 * 60_000;
  const question = t.kind === 'question';
  const icon = question ? <Icon icon="search" color="secondary" /> : t.state === 'dismissed' ? <Icon icon="close" color="secondary" /> : <Icon icon="check" color="success" />;
  const end = undoOpen ? <Button size="sm" label="Ångra" clickAction={() => run(() => api.undo(t.id))} />
    : receiptUndo ? <Button size="sm" label="Ångra" clickAction={() => run(() => api.undoReceipt(t.id))} />
    : reopenable ? <Button size="sm" label="Återöppna" clickAction={() => run(() => api.reopen(t.id))} />
    : <Text type="supporting">{t.state === 'dismissed' ? 'Avfärdad' : question ? 'Fråga' : 'Klart'}</Text>;
  return <ListItem startContent={icon} align="start" label={<Text>{question ? `Fråga: ${t.title}` : t.title}</Text>}
    description={<VStack gap={0}><Text type="supporting">{last?.body ?? t.trigger.reason}</Text>{error && <Text as="p" role="alert" color="accent">{error}</Text>}</VStack>}
    href={question ? conversationHref(t.id) : undefined} endContent={<HStack gap={2} vAlign="center"><Text type="supporting">{new Date(when(t)).toLocaleTimeString('sv-SE', { timeStyle: 'short' })}</Text>{end}</HStack>} />;
}

/**
 * Redan hanterat: the person's own log. Decisions, dismissals, undos and questions grouped by day, filterable, with
 * Ångra while the window is open, Återöppna on dismissed cards and the conversation reopening from a Fråga row.
 */
export function Handled({ threads, compact, onChange, conversationHref }: { threads: Thread[]; compact: boolean; onChange: (thread: Thread) => void; conversationHref: (threadId: string) => string }) {
  const [filter, setFilter] = useState<Filter>('idag');
  const now = Date.now();
  const keep = (t: Thread) => {
    const age = now - Date.parse(when(t));
    switch (filter) {
      case 'idag': return dayKey(when(t)) === dayKey(new Date().toISOString());
      case 'veckan': return age < 7 * 86400_000;
      case 'hanterade': return t.state === 'handled';
      case 'avfardade': return t.state === 'dismissed';
      case 'fragor': return t.kind === 'question';
    }
  };
  const shown = threads.filter(keep).sort((a, b) => when(b).localeCompare(when(a)));
  const days = [...new Set(shown.map(t => dayKey(when(t))))];
  return <VStack gap={3} as="section" aria-label="Redan hanterat">
    <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
      <Heading level={2} accessibilityLevel={1}>Redan hanterat</Heading>
      {/* Five segments do not fit a phone and SegmentedControl truncates them; there the same choice is one menu (1.4.10). */}
      {compact
        ? <DropdownMenu presentation="adaptive" button={{ label: `Visa: ${filters.find(f => f.value === filter)!.label}`, size: 'sm', variant: 'secondary' }} items={filters.map(f => ({ id: f.value, label: f.label, onClick: () => setFilter(f.value) }))} />
        : <SegmentedControl label="Filter" size="sm" value={filter} onChange={v => setFilter(v as Filter)}>{filters.map(f => <SegmentedControlItem key={f.value} value={f.value} label={f.label} />)}</SegmentedControl>}
    </HStack>
    {!shown.length && <Text type="supporting">Inget här ännu.</Text>}
    {days.map(day => <List key={day} hasDividers density="compact" header={<Text weight="semibold" type="supporting">{dayHeading(day)}</Text>}>
      {shown.filter(t => dayKey(when(t)) === day).map(t => <HandledRow key={t.id} thread={t} now={now} onChange={onChange} conversationHref={conversationHref} />)}
    </List>)}
  </VStack>;
}
