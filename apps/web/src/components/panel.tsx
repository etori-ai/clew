import { Drawer, DrawerHeader, Layout, LayoutContent, List, ListItem, Text, VStack } from '@clew/ui';
import { fieldLabel, fieldValue, hiddenFields } from './panel-labels';

type Props = { title: string | null; output: unknown; onClose: () => void };
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const scalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const rowTitle = ['name', 'title', 'label', 'supplier'];
/** Phase-one side panel: a Clew-rendered view of a read capability's output. Rows become a list; anything else becomes label/value pairs. */
export function PanelView({ title, output, onClose }: Props) {
  const rows = isRecord(output) && Array.isArray(output.rows) ? output.rows as Record<string, unknown>[] : null;
  const pairs = isRecord(output) ? Object.entries(output).filter(([k]) => k !== 'rows' && !hiddenFields.has(k)) : [];
  const close = (open: boolean) => { if (!open) onClose(); };
  return <Drawer isOpen={title !== null} onOpenChange={close} side="end" width={440} label={title ?? 'Vy'}>
    <Layout header={<DrawerHeader title={title} onOpenChange={close} />} content={<LayoutContent>
      <VStack gap={3}>
        {rows && <List hasDividers density="compact">{rows.map((r, i) => {
          const key = rowTitle.find(k => r[k] !== undefined);
          const detail = Object.entries(r).filter(([k, v]) => k !== key && !hiddenFields.has(k) && scalar(v)).map(([k, v]) => `${fieldLabel(k)}: ${fieldValue(v)}`).join(' · ');
          return <ListItem key={i} label={<Text>{key ? fieldValue(r[key]) : `Rad ${i + 1}`}</Text>} description={<Text type="supporting">{detail}</Text>} />;
        })}</List>}
        {pairs.length > 0 && <List density="compact">{pairs.map(([k, v]) => <ListItem key={k} label={<Text>{fieldLabel(k)}</Text>} description={<Text type="supporting">{fieldValue(v)}</Text>} />)}</List>}
        {!rows && !pairs.length && <Text type="supporting">Inget att visa.</Text>}
      </VStack>
    </LayoutContent>} />
  </Drawer>;
}
