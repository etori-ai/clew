import { useEffect, useRef } from 'react';
import { Drawer, DrawerHeader, Layout, LayoutContent, List, ListItem, Text, VStack } from '@clew/ui';
import type { ViewRef } from '@clew/contracts';
import { fieldLabel, fieldValue, hiddenFields, rowView } from './panel-labels';

type Props = { title: string | null; output: unknown; onClose: () => void; onOpenView?: (view: ViewRef) => void };
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const scalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const rowTitle = ['name', 'title', 'label', 'supplier'];
/** Phase-one side panel: a Clew-rendered view of a read capability's output. Rows become a list; anything else becomes label/value pairs. */
export function PanelView({ title, output, onClose, onOpenView }: Props) {
  const content = useRef<HTMLDivElement>(null);
  const previousTitle = useRef(title);
  useEffect(() => {
    // A drill-down removes the focused list row while the drawer stays open. Continue at the new view.
    if (title && previousTitle.current && title !== previousTitle.current) content.current?.focus();
    previousTitle.current = title;
  }, [title]);
  const rows = isRecord(output) && Array.isArray(output.rows) ? output.rows as Record<string, unknown>[] : null;
  const pairs = isRecord(output) ? Object.entries(output).filter(([k]) => k !== 'rows' && !hiddenFields.has(k)) : [];
  const close = (open: boolean) => { if (!open) onClose(); };
  return <Drawer isOpen={title !== null} onOpenChange={close} side="end" width={440} label={title ?? 'Vy'}>
    <Layout header={<DrawerHeader title={title} onOpenChange={close} />} content={<LayoutContent>
      <VStack gap={3} ref={content} role="group" aria-label={title ?? 'Vy'} tabIndex={-1}>
        {rows && <List hasDividers density="compact">{rows.map((r, i) => {
          const key = rowTitle.find(k => r[k] !== undefined);
          const view = rowView(r);
          const detail = Object.entries(r).filter(([k, v]) => k !== key && !hiddenFields.has(k) && scalar(v)).map(([k, v]) => `${fieldLabel(k)}: ${fieldValue(v)}`).join(' · ');
          return <ListItem key={i} onClick={view && onOpenView ? () => onOpenView(view) : undefined} label={<Text>{key ? fieldValue(r[key]) : `Rad ${i + 1}`}</Text>} description={<Text type="supporting">{detail}</Text>} />;
        })}</List>}
        {rows?.length === 0 && <Text type="supporting">Inga poster att visa.</Text>}
        {pairs.length > 0 && <List density="compact">{pairs.map(([k, v]) => <ListItem key={k} label={<Text>{fieldLabel(k)}</Text>} description={<Text type="supporting">{fieldValue(v)}</Text>} />)}</List>}
        {!rows && !pairs.length && <Text type="supporting">Inget att visa.</Text>}
      </VStack>
    </LayoutContent>} />
  </Drawer>;
}
