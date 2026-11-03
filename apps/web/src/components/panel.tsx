import { Drawer, List, ListItem, Text, VStack } from '@clew/ui';

type Props = { title: string | null; output: unknown; onClose: () => void };
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Phase-one side panel: a Clew-rendered view of a read capability's output. Rows become a list; anything else becomes label/value pairs. */
export function PanelView({ title, output, onClose }: Props) {
  const rows = isRecord(output) && Array.isArray(output.rows) ? output.rows as Record<string, unknown>[] : null;
  const pairs = isRecord(output) ? Object.entries(output).filter(([k]) => k !== 'rows') : [];
  return <Drawer isOpen={title !== null} onOpenChange={open => { if (!open) onClose(); }} side="end" width={440} label={title ?? 'Vy'} padding={4}>
    <VStack gap={3}>
      <Text type="large" weight="semibold">{title}</Text>
      {rows && <List hasDividers density="compact">{rows.map((r, i) => {
        const label = String(r.name ?? r.title ?? r.label ?? r.supplier ?? r.ref ?? i);
        const detail = Object.entries(r).filter(([k, v]) => !['name', 'title', 'label', 'ref'].includes(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')).map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
        return <ListItem key={i} label={label} description={detail} />;
      })}</List>}
      {pairs.length > 0 && <List density="compact">{pairs.map(([k, v]) => <ListItem key={k} label={k} description={Array.isArray(v) ? v.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(', ') : typeof v === 'object' && v ? JSON.stringify(v) : String(v)} />)}</List>}
      {!rows && !pairs.length && <Text type="supporting">Inget att visa.</Text>}
    </VStack>
  </Drawer>;
}
