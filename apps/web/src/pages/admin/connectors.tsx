import { useCallback, useEffect, useState } from 'react';
import type { ConnectorSummary, SessionUser } from '@clew/contracts';
import { Badge, Button, EmptyState, HStack, Heading, List, ListItem, SegmentedControl, SegmentedControlItem, StatusDot, Switch, Table, Text, Timestamp, Toolbar, VStack, useMediaQuery, useToast } from '@clew/ui';
import { api, ApiError } from '../../api';
import { usePageTitle } from '../../page-title';
import { AddConnectorDialog } from './add';
import { audienceLabel, kindLabel, statusOf } from './labels';
import { AdminShell } from './shell';

/** "Anslutna system" (D23): every connector, bundled and remote, with its status, its audience and an on/off switch. */
type Filter = 'alla' | 'pa' | 'av' | 'problem';
const filters: Array<{ value: Filter; label: string }> = [{ value: 'alla', label: 'Alla' }, { value: 'pa', label: 'På' }, { value: 'av', label: 'Av' }, { value: 'problem', label: 'Problem' }];
const matches = (c: ConnectorSummary, f: Filter) => f === 'alla' || (f === 'pa' ? c.state === 'enabled' : f === 'av' ? c.state !== 'enabled' : c.state === 'enabled' && !c.bundled && c.health.status !== 'ok');
const counts = (c: ConnectorSummary) => `${c.counts.capabilities} · ${c.counts.execute} ${c.counts.execute === 1 ? 'åtgärd' : 'åtgärder'} · ${c.counts.tools} till assistenten`;
interface Row extends Record<string, unknown> { id: string; c: ConnectorSummary }

export function AdminConnectorsPage({ user }: { user: SessionUser }) {
  const mobile = useMediaQuery('(max-width: 720px)');
  const [connectors, setConnectors] = useState<ConnectorSummary[] | null>(null);
  const [units, setUnits] = useState<Array<{ id: string; label: string }>>([]);
  const [filter, setFilter] = useState<Filter>('alla');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  usePageTitle('Anslutna system');
  const load = useCallback(async () => {
    try { const [c, u] = await Promise.all([api.admin.connectors(), api.admin.units().catch(() => ({ units: [] }))]); setConnectors(c.connectors); setUnits(u.units); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Listan kunde inte läsas.'); setConnectors([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // The switch is the one mutation on this page: on or off, applied live, announced through the toast.
  const flip = async (c: ConnectorSummary, on: boolean) => {
    try { await api.admin.update(c.id, { state: on ? 'enabled' : 'disabled' }); toast({ body: `${c.source} ${on ? 'är på' : 'är avstängd'}.`, uniqueID: 'connector:' + c.id }); }
    catch (e) { toast({ body: e instanceof ApiError ? e.message : 'Något gick fel.', isAutoHide: false, uniqueID: 'connector:' + c.id }); }
    await load();
  };
  const shown = (connectors ?? []).filter(c => matches(c, filter));
  const status = (c: ConnectorSummary) => { const s = statusOf(c); return <StatusDot variant={s.tone} label={s.label} />; };
  const statusText = (c: ConnectorSummary) => { const s = statusOf(c); return <HStack gap={1} vAlign="center">{status(c)}<Text>{s.label}</Text></HStack>; };
  const toggle = (c: ConnectorSummary) => <Switch size="sm" label={`${c.source} på`} isLabelHidden value={c.state === 'enabled'} changeAction={on => flip(c, on)} />;
  const name = (c: ConnectorSummary) => <VStack gap={0}><Text weight="semibold">{c.source}</Text><HStack gap={1} vAlign="center" wrap="wrap"><Text type="supporting">{c.id}</Text>{c.kind && <Badge variant="neutral" label={kindLabel[c.kind]} />}{c.bundled && <Badge variant="neutral" label="Inbyggd" />}</HStack></VStack>;
  const columns = [
    { key: 'system', header: 'System', renderCell: (r: Row) => <Button variant="ghost" size="sm" label={r.c.source} href={`/admin/anslutningar/${r.c.id}`} /> },
    { key: 'status', header: 'Status', renderCell: (r: Row) => statusText(r.c) },
    { key: 'audience', header: 'Vem ser det', renderCell: (r: Row) => <Text>{audienceLabel(r.c.audience)}</Text> },
    { key: 'caps', header: 'Förmågor', renderCell: (r: Row) => <Text type="supporting">{counts(r.c)}</Text> },
    { key: 'seen', header: 'Senast kontakt', renderCell: (r: Row) => r.c.bundled ? <Text type="supporting">I processen</Text> : <Timestamp value={r.c.health.at} format="auto" /> },
    { key: 'on', header: 'På', renderCell: (r: Row) => toggle(r.c) },
  ];
  return <AdminShell user={user} crumbs={[{ label: 'Anslutna system' }]}>
    <Heading level={1}>Anslutna system</Heading>
    <Toolbar label="Anslutningar" size="sm" startContent={<SegmentedControl label="Visa" size="sm" value={filter} onChange={v => setFilter(v as Filter)}>{filters.map(f => <SegmentedControlItem key={f.value} value={f.value} label={f.label} />)}</SegmentedControl>}
      endContent={<Button variant="primary" label="Anslut system" onClick={() => setAdding(true)} />} />
    {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    {connectors === null && <Text type="supporting" role="status">Läser anslutningarna …</Text>}
    {connectors !== null && shown.length === 0 && <EmptyState title={filter === 'alla' ? 'Inga anslutningar ännu' : 'Inget att visa'} description={filter === 'alla' ? 'Anslut det första systemet så får det en rad här.' : 'Inga anslutningar matchar filtret.'} actions={filter === 'alla' ? <Button label="Anslut system" onClick={() => setAdding(true)} /> : undefined} />}
    {shown.length > 0 && (mobile
      ? <List aria-label="Anslutningar">
        {shown.map(c => <ListItem key={c.id} href={`/admin/anslutningar/${c.id}`} label={name(c)} description={<VStack gap={0}><HStack gap={1} vAlign="center">{status(c)}<Text type="supporting">{statusOf(c).label} · {audienceLabel(c.audience)}</Text></HStack><Text type="supporting">{counts(c)}</Text></VStack>} endContent={toggle(c)} />)}
      </List>
      : <Table<Row> data={shown.map(c => ({ id: c.id, c }))} idKey="id" columns={columns} density="balanced" hasHover />)}
    <AddConnectorDialog isOpen={adding} units={units} onClose={added => { setAdding(false); if (added) void load(); }} />
  </AdminShell>;
}
