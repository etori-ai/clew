import { useCallback, useEffect, useState } from 'react';
import type { ConnectorSummary, SessionUser } from '@clew/contracts';
import { Badge, Button, Card, EmptyState, HStack, Link, List, ListItem, Section, SegmentedControl, SegmentedControlItem, StatusDot, Switch, Table, Text, Timestamp, Toolbar, VStack, pixel, proportional, useMediaQuery, useToast } from '@clew/ui';
import { api, ApiError } from '../../api';
import { usePageTitle } from '../../page-title';
import { AddConnectorDialog } from './add';
import { audienceLabel, kindLabel, statusOf } from './labels';
import { AdminShell, PageLead } from './shell';

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
    { key: 'system', header: 'System', width: proportional(1, { minWidth: 200 }), renderCell: (r: Row) => <VStack gap={0}><Link href={`/admin/anslutningar/${r.c.id}`} weight="semibold">{r.c.source}</Link><Text type="supporting">{r.c.id}{r.c.bundled ? ' · inbyggd' : ''}</Text></VStack> },
    { key: 'status', header: 'Status', width: pixel(150), renderCell: (r: Row) => statusText(r.c) },
    { key: 'audience', header: 'Vem ser det', width: proportional(1, { minWidth: 120 }), renderCell: (r: Row) => <Text>{audienceLabel(r.c.audience)}</Text> },
    { key: 'caps', header: 'Förmågor', width: proportional(1, { minWidth: 240 }), renderCell: (r: Row) => <Text type="supporting">{counts(r.c)}</Text> },
    { key: 'seen', header: 'Senast kontakt', width: pixel(160), renderCell: (r: Row) => r.c.bundled ? <Text type="supporting">I processen</Text> : <Timestamp value={r.c.health.at} format="auto" /> },
    { key: 'on', header: 'På', width: pixel(72), renderCell: (r: Row) => toggle(r.c) },
  ];
  // The lead counts: what is on, what is off, what needs a hand. Tiles are KPI widgets, so Cards (structure guide); the filter stays in the toolbar.
  const all = connectors ?? [];
  const tiles = [
    { label: 'På', value: all.filter(c => c.state === 'enabled' && (c.bundled || c.health.status === 'ok')).length },
    { label: 'Problem', value: all.filter(c => matches(c, 'problem')).length },
    { label: 'Avstängda', value: all.filter(c => c.state === 'disabled').length },
    { label: 'Utkast', value: all.filter(c => c.state === 'draft').length },
  ];
  return <AdminShell user={user} crumbs={[{ label: 'Anslutna system' }]}>
    <PageLead title="Anslutna system" lead="Systemen Startsidan läser från och agerar i. Här avgör du vem som ser en anslutning; vad var och en får göra avgör systemet självt."
      actions={<Button variant="primary" label="Anslut system" onClick={() => setAdding(true)} />} />
    {connectors !== null && all.length > 0 && <HStack gap={3} wrap="wrap" as="section" aria-label="Läget">
      {tiles.map(t => <Card key={t.label} variant={t.label === 'Problem' && t.value > 0 ? 'yellow' : 'muted'} padding={3} width={mobile ? 140 : 180}>
        <VStack gap={0}><Text type="supporting">{t.label}</Text><Text type="large" weight="semibold">{t.value}</Text></VStack>
      </Card>)}
    </HStack>}
    {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    {connectors === null && <Text type="supporting" role="status">Läser anslutningarna …</Text>}
    {/* A Section with padding 0 bleeds over the page's gutters (it is edge-to-edge by definition); the bordered box is a Card. */}
    {connectors !== null && <Card padding={0}>
      <Toolbar label="Anslutningar" size="sm" dividers={['bottom']} startContent={<SegmentedControl label="Visa" size="sm" value={filter} onChange={v => setFilter(v as Filter)}>{filters.map(f => <SegmentedControlItem key={f.value} value={f.value} label={f.label} />)}</SegmentedControl>}
        endContent={<Text type="supporting">{shown.length === all.length ? `${all.length} anslutningar` : `${shown.length} av ${all.length}`}</Text>} />
      {shown.length === 0 && <Section variant="transparent" padding={6}><EmptyState isCompact title={filter === 'alla' ? 'Inga anslutningar ännu' : 'Inget att visa'} description={filter === 'alla' ? 'Anslut det första systemet så får det en rad här.' : 'Inga anslutningar matchar filtret.'} actions={filter === 'alla' ? <Button label="Anslut system" onClick={() => setAdding(true)} /> : undefined} /></Section>}
      {shown.length > 0 && (mobile
        ? <List aria-label="Anslutningar" hasDividers>
          {shown.map(c => <ListItem key={c.id} href={`/admin/anslutningar/${c.id}`} label={name(c)} description={<VStack gap={0}><HStack gap={1} vAlign="center">{status(c)}<Text type="supporting">{statusOf(c).label} · {audienceLabel(c.audience)}</Text></HStack><Text type="supporting">{counts(c)}</Text></VStack>} endContent={toggle(c)} />)}
        </List>
        : <Table<Row> data={shown.map(c => ({ id: c.id, c }))} idKey="id" columns={columns} density="balanced" hasHover />)}
    </Card>}
    <AddConnectorDialog isOpen={adding} units={units} onClose={added => { setAdding(false); if (added) void load(); }} />
  </AdminShell>;
}
