import { worstLevel, type Area, type AttentionLevel } from '@clew/contracts';
import { Badge, Button, HStack, Icon, List, ListItem, StatusDot, Text, VStack } from '@clew/ui';

const tone = { ok: 'success', warn: 'warning', alert: 'error', none: 'neutral' } as const;
/** The count takes the colour of the worst card in the area: red within three days, yellow within thirty, blue for notices. */
const countVariant: Record<AttentionLevel, 'error' | 'warning' | 'neutral' | 'info'> = { now: 'error', urgent: 'error', soon: 'warning', later: 'neutral', notice: 'info' };
const count = (n: number, level: AttentionLevel | null) => n ? <Badge variant={level ? countVariant[level] : 'neutral'} label={String(n)} /> : undefined;
type Props = { areas: Area[]; current: string | null; hrefFor: (id: string | null) => string; compact?: boolean; handled: number; chipped?: string[] };
/** A capability chip in the row (`capability:<connector>.<name>`) points at the area that owns it: the lens on that connector. */
const chippedArea = (a: Area, chipped: string[]) => chipped.some(ref => ref.startsWith('capability:') && (ref.startsWith(`capability:${a.connector}.`) || a.standing.some(s => 'capability:' + s.capability === ref)));
const inConversation = <Badge variant="neutral" icon={<Icon icon="checkDouble" size="sm" />} label="I samtalet" />;


/**
 * The sidebar as drawn on the canvas: Allt with its count, one row per area with the figure under the title and the
 * count on the right, then Kommande (the assistant's schedule) and Redan hanterat. A filter on one stream, not pages.
 * Astryx List rows: label, description, start/end content, selection.
 */
export function Areas({ areas, current, hrefFor, compact = false, handled, chipped = [] }: Props) {
  const total = areas.reduce((n, a) => n + a.needsYou, 0);
  const worst = worstLevel(areas.flatMap(a => a.urgency ? [a.urgency] : []));
  if (compact) return <HStack gap={1} wrap="wrap" as="nav" aria-label="Områden">
    <Button size="sm" variant={current === null ? 'primary' : 'secondary'} label={`Allt${total ? ' · ' + total : ''}`} href={hrefFor(null)} />
    {areas.map(a => <Button key={a.id} size="sm" variant={current === a.id ? 'primary' : 'secondary'} label={`${a.title}${a.needsYou ? ' · ' + a.needsYou : ''}${chippedArea(a, chipped) ? ' ✓' : ''}`} href={hrefFor(a.id)} />)}
    <Button size="sm" variant={current === 'hanterat' ? 'primary' : 'secondary'} label={`Redan hanterat${handled ? ' · ' + handled : ''}`} href={hrefFor('hanterat')} />
  </HStack>;
  const upcoming = areas.flatMap(a => a.schedules.map(s => ({ ...s, area: a.title }))).slice(0, 5);
  return <VStack gap={4} as="nav" aria-label="Områden">
    <List density="compact" aria-label="Områden">
      <ListItem label={<Text weight="semibold">Allt</Text>} isSelected={current === null} href={hrefFor(null)} endContent={count(total, worst)} />
      {areas.map(a => <ListItem key={a.id} label={chippedArea(a, chipped) ? <HStack gap={1} vAlign="center"><Text>{a.title}</Text>{inConversation}</HStack> : a.title} isSelected={current === a.id} href={hrefFor(a.id)}
        description={a.figure ? <HStack gap={1} vAlign="center"><StatusDot variant={tone[a.figure.tone]} label={a.figure.label} /><Text type="supporting">{a.figure.label}</Text></HStack> : undefined}
        endContent={a.needsYou ? count(a.needsYou, a.urgency) : a.waiting ? <Text type="supporting">{a.waiting} pågår</Text> : undefined} />)}
    </List>
    <List density="compact" header={<Text type="supporting" weight="semibold">Kommande</Text>} aria-label="Kommande">
      {upcoming.map((s, i) => <ListItem key={i} label={<Text>{s.when}</Text>} description={<Text type="supporting">{s.label}</Text>} endContent={<Text type="supporting">{s.area}</Text>} />)}
    </List>
    <List density="compact" aria-label="Historik">
      <ListItem label="Redan hanterat" isSelected={current === 'hanterat'} href={hrefFor('hanterat')} endContent={<Text type="supporting">{handled} i dag</Text>} />
    </List>
  </VStack>;
}
