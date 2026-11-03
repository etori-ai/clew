import type { Area } from '@clew/contracts';
import { Badge, Button, HStack, List, ListItem, StatusDot, Text, VStack } from '@clew/ui';

const tone = { ok: 'success', warn: 'warning', alert: 'error', none: 'neutral' } as const;
type Props = { areas: Area[]; current: string | null; onSelect: (id: string | null) => void; compact?: boolean; handled: number };

/**
 * The sidebar as drawn on the canvas: Allt with its count, one row per area with the figure under the title and the
 * count on the right, then Kommande (the assistant's schedule) and Redan hanterat. A filter on one stream, not pages.
 * Astryx List rows: label, description, start/end content, selection.
 */
export function Areas({ areas, current, onSelect, compact = false, handled }: Props) {
  const total = areas.reduce((n, a) => n + a.needsYou, 0);
  if (compact) return <HStack gap={1} wrap="nowrap" aria-label="Områden">
    <Button size="sm" variant={current === null ? 'primary' : 'secondary'} label={`Allt${total ? ' · ' + total : ''}`} clickAction={() => onSelect(null)} />
    {areas.map(a => <Button key={a.id} size="sm" variant={current === a.id ? 'primary' : 'secondary'} label={`${a.title}${a.needsYou ? ' · ' + a.needsYou : ''}`} clickAction={() => onSelect(a.id)} />)}
    <Button size="sm" variant={current === 'hanterat' ? 'primary' : 'secondary'} label={`Redan hanterat${handled ? ' · ' + handled : ''}`} clickAction={() => onSelect('hanterat')} />
  </HStack>;
  const upcoming = areas.flatMap(a => a.schedules.map(s => ({ ...s, area: a.title }))).slice(0, 5);
  return <VStack gap={4} as="nav" aria-label="Områden">
    <List density="compact" aria-label="Områden">
      <ListItem label={<Text weight="semibold">Allt</Text>} isSelected={current === null} onClick={() => onSelect(null)} endContent={total ? <Badge variant="neutral" label={String(total)} /> : undefined} />
      {areas.map(a => <ListItem key={a.id} label={a.title} isSelected={current === a.id} onClick={() => onSelect(a.id)}
        description={a.figure ? <HStack gap={1} vAlign="center"><StatusDot variant={tone[a.figure.tone]} label={a.figure.label} /><Text type="supporting">{a.figure.label}</Text></HStack> : undefined}
        endContent={a.needsYou ? <Badge variant="neutral" label={String(a.needsYou)} /> : a.waiting ? <Text type="supporting">{a.waiting} pågår</Text> : undefined} />)}
    </List>
    <List density="compact" header={<Text type="supporting" weight="semibold">Kommande</Text>} aria-label="Kommande">
      {upcoming.map((s, i) => <ListItem key={i} label={s.when} description={s.label} endContent={<Text type="supporting">{s.area}</Text>} />)}
    </List>
    <List density="compact" aria-label="Historik">
      <ListItem label="Redan hanterat" isSelected={current === 'hanterat'} onClick={() => onSelect('hanterat')} endContent={<Text type="supporting">{handled} i dag</Text>} />
    </List>
  </VStack>;
}
