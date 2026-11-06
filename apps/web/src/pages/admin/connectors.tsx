import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConnectorSummary, SessionUser } from '@clew/contracts';
import {
  Button,
  Card,
  EmptyState,
  HStack,
  Link,
  List,
  ListItem,
  Section,
  SegmentedControl,
  SegmentedControlItem,
  StatusDot,
  Switch,
  SystemSwatch,
  Table,
  Text,
  Timestamp,
  Toolbar,
  VStack,
  pixel,
  proportional,
  useMediaQuery,
  useToast,
} from '@clew/ui';
import { api } from '../../api';
import { adminQueries } from '../../queries';
import { keys } from '../../query-keys';
import { errorMessage } from '../../query-policy';
import { usePageTitle } from '../../page-title';
import { AddConnectorDialog } from './add';
import { audienceLabel, kindLabel, statusOf } from './labels';
import { AdminShell, PageLead } from './shell';

/**
 * "Anslutna system" (D23): every connector, bundled and remote, with its status, its audience and an on/off switch, in
 * the order the systems were registered with each one's colour beside its name (D71).
 */
type Filter = 'alla' | 'pa' | 'av' | 'problem';
const filters: Array<{ value: Filter; label: string }> = [
  { value: 'alla', label: 'Alla' },
  { value: 'pa', label: 'På' },
  { value: 'problem', label: 'Problem' },
  { value: 'av', label: 'Av' },
];
const matches = (c: ConnectorSummary, f: Filter) =>
  f === 'alla' ||
  (f === 'pa'
    ? c.state === 'enabled'
    : f === 'av'
      ? c.state !== 'enabled'
      : c.state === 'enabled' && !c.bundled && c.health.status !== 'ok');
/** How much a system can do, in words: what it can do at all on one line, what of that changes something or reaches the assistant on the other. */
const functions = (c: ConnectorSummary) =>
  `${c.counts.capabilities} ${c.counts.capabilities === 1 ? 'funktion' : 'funktioner'}`;
const reach = (c: ConnectorSummary) => `${c.counts.execute} utför · ${c.counts.tools} för assistenten`;
interface Row extends Record<string, unknown> {
  id: string;
  c: ConnectorSummary;
}
/** The list in registration order (D71), so the colours read from the top; Clew's own systems last, by name. */
const byOrdinal = (a: ConnectorSummary, b: ConnectorSummary) =>
  (a.ordinal ?? Infinity) - (b.ordinal ?? Infinity) || a.source.localeCompare(b.source, 'sv');
/** The words under a system's name: its id, and "Clews egen" on the house's rows. */
const idLine = (c: ConnectorSummary) => `${c.id}${c.ordinal === null ? ' · Clews egen' : ''}`;
const EMPTY_UNITS: Array<{ id: string; label: string }> = [];
const EMPTY_CONNECTORS: ConnectorSummary[] = [];

export function AdminConnectorsPage({ user }: { user: SessionUser }) {
  const mobile = useMediaQuery('(max-width: 720px)');
  const client = useQueryClient();
  const list = useQuery(adminQueries.connectors);
  const units = useQuery(adminQueries.units).data?.units ?? EMPTY_UNITS;
  const [filter, setFilter] = useState<Filter>('alla');
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  usePageTitle('Anslutna system');
  // Null while the list is being read (the status line below); an empty list once the read failed, with the alert.
  const connectors = list.data?.connectors ?? (list.isError ? EMPTY_CONNECTORS : null);
  const error = list.isError && list.data === undefined ? errorMessage(list.error, 'Listan kunde inte läsas.') : null;
  // The switch is the one mutation on this page: on or off, applied live, announced through the toast, then every admin read is fresh again (D33).
  const flip = async (c: ConnectorSummary, on: boolean) => {
    try {
      await api.admin.update(c.id, { state: on ? 'enabled' : 'disabled' });
      toast({ body: `${c.source} ${on ? 'är på' : 'är avstängd'}.`, uniqueID: 'connector:' + c.id });
    } catch (e) {
      toast({ body: errorMessage(e, 'Något gick fel.'), isAutoHide: false, uniqueID: 'connector:' + c.id });
    }
    await client.invalidateQueries({ queryKey: keys.admin.all });
  };
  const shown = (connectors ?? []).filter(c => matches(c, filter)).sort(byOrdinal);
  const status = (c: ConnectorSummary) => {
    const s = statusOf(c);
    return <StatusDot variant={s.tone} label={s.label} />;
  };
  const statusText = (c: ConnectorSummary) => {
    const s = statusOf(c);
    return (
      <VStack gap={0}>
        <HStack gap={1} vAlign="center">
          {status(c)}
          <Text>{s.label}</Text>
        </HStack>
        <Text type="supporting">{c.bundled ? 'I processen' : <Timestamp value={c.health.at} format="auto" />}</Text>
      </VStack>
    );
  };
  const toggle = (c: ConnectorSummary) => (
    <Switch
      size="sm"
      label={`${c.source} på`}
      isLabelHidden
      value={c.state === 'enabled'}
      changeAction={on => flip(c, on)}
    />
  );
  // The system's colour beside its name (artboard 9): this list is where a person learns which colour is which system.
  const name = (c: ConnectorSummary) => (
    <HStack gap={2} vAlign="center">
      <SystemSwatch ordinal={c.ordinal} />
      <VStack gap={0}>
        <Text weight="semibold">{c.source}</Text>
        <Text type="supporting">
          {idLine(c)}
          {c.kind ? ` · ${kindLabel[c.kind].toLowerCase()}` : ''}
        </Text>
      </VStack>
    </HStack>
  );
  const columns = [
    {
      key: 'system',
      header: 'System',
      width: proportional(1, { minWidth: 200 }),
      renderCell: (r: Row) => (
        <HStack gap={2} vAlign="center">
          <SystemSwatch ordinal={r.c.ordinal} />
          <VStack gap={0}>
            <Link href={`/admin/connectors/${r.c.id}`} weight="semibold">
              {r.c.source}
            </Link>
            <Text type="supporting">{idLine(r.c)}</Text>
          </VStack>
        </HStack>
      ),
    },
    { key: 'status', header: 'Status', width: pixel(150), renderCell: (r: Row) => statusText(r.c) },
    {
      key: 'audience',
      header: 'Vem ser det',
      width: proportional(1, { minWidth: 120 }),
      renderCell: (r: Row) => <Text>{audienceLabel(r.c.audience)}</Text>,
    },
    {
      key: 'caps',
      header: 'Funktioner',
      width: proportional(1, { minWidth: 160 }),
      renderCell: (r: Row) => (
        <VStack gap={0}>
          <Text>{functions(r.c)}</Text>
          <Text type="supporting">{reach(r.c)}</Text>
        </VStack>
      ),
    },
    { key: 'on', header: 'På', width: pixel(72), renderCell: (r: Row) => toggle(r.c) },
  ];
  const all = connectors ?? [];
  return (
    <AdminShell user={user} crumbs={[{ label: 'Anslutna system' }]}>
      <PageLead
        title="Anslutna system"
        lead="Systemen Startsidan läser från och agerar i. Här avgör du vem som ser en anslutning; vad var och en får göra avgör systemet självt."
        actions={<Button variant="primary" label="Anslut system" onClick={() => setAdding(true)} />}
      />
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      {connectors === null && (
        <Text type="supporting" role="status">
          Läser anslutningarna …
        </Text>
      )}
      {/* What is on, what has a problem and what is off are the filter's own counts: one row that both says and does. A Section with padding 0 bleeds over the page's gutters (it is edge-to-edge by definition); the bordered box is a Card. */}
      {connectors !== null && (
        <Card padding={0}>
          <Toolbar
            label="Anslutningar"
            size="sm"
            dividers={['bottom']}
            startContent={
              <SegmentedControl label="Visa" size="sm" value={filter} onChange={v => setFilter(v as Filter)}>
                {filters.map(f => (
                  <SegmentedControlItem
                    key={f.value}
                    value={f.value}
                    label={`${f.label} ${all.filter(c => matches(c, f.value)).length}`}
                  />
                ))}
              </SegmentedControl>
            }
            endContent={
              <Text type="supporting">
                {shown.length === all.length ? `${all.length} anslutningar` : `${shown.length} av ${all.length}`}
              </Text>
            }
          />
          {shown.length === 0 && (
            <Section variant="transparent" padding={6}>
              <EmptyState
                isCompact
                title={filter === 'alla' ? 'Inga anslutningar ännu' : 'Inget att visa'}
                description={
                  filter === 'alla'
                    ? 'Anslut det första systemet så får det en rad här.'
                    : 'Inga anslutningar matchar filtret.'
                }
                actions={
                  filter === 'alla' ? <Button label="Anslut system" onClick={() => setAdding(true)} /> : undefined
                }
              />
            </Section>
          )}
          {shown.length > 0 &&
            (mobile ? (
              <List aria-label="Anslutningar" hasDividers>
                {shown.map(c => (
                  <ListItem
                    key={c.id}
                    href={`/admin/connectors/${c.id}`}
                    label={name(c)}
                    description={
                      <VStack gap={0}>
                        <HStack gap={1} vAlign="center">
                          {status(c)}
                          <Text type="supporting">
                            {statusOf(c).label} · {audienceLabel(c.audience)}
                          </Text>
                        </HStack>
                        <Text type="supporting">
                          {functions(c)} · {reach(c)}
                        </Text>
                      </VStack>
                    }
                    endContent={toggle(c)}
                  />
                ))}
              </List>
            ) : (
              <Table<Row>
                data={shown.map(c => ({ id: c.id, c }))}
                idKey="id"
                columns={columns}
                density="balanced"
                hasHover
              />
            ))}
        </Card>
      )}
      <AddConnectorDialog
        isOpen={adding}
        units={units}
        onClose={added => {
          setAdding(false);
          if (added) void client.invalidateQueries({ queryKey: keys.admin.all });
        }}
      />
    </AdminShell>
  );
}
