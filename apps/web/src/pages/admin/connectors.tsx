import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConnectorSummary, SessionUser } from '@clew/contracts';
import {
  Button,
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
import { AdminShell } from './shell';
import { DOT } from '../../dot';

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
const reach = (c: ConnectorSummary) => `${c.counts.execute} utför\u00a0· ${c.counts.tools} för assistenten`;
interface Row extends Record<string, unknown> {
  id: string;
  c: ConnectorSummary;
}
/** The list in registration order (D71), so the colours read from the top; Clew's own systems last, by name. */
const byOrdinal = (a: ConnectorSummary, b: ConnectorSummary) =>
  (a.ordinal ?? Infinity) - (b.ordinal ?? Infinity) || a.source.localeCompare(b.source, 'sv');
/** The words under a system's name: its id, and "Clews egen" on the house's rows. */
const idLine = (c: ConnectorSummary) => `${c.id}${c.ordinal === null ? '\u00a0· Clews egen' : ''}`;
const EMPTY_CONNECTORS: ConnectorSummary[] = [];

export function AdminConnectorsPage({ user }: { user: SessionUser }) {
  const mobile = useMediaQuery('(max-width: 720px)');
  const client = useQueryClient();
  const list = useQuery(adminQueries.connectors);
  const units = useQuery(adminQueries.units);
  const groups = useQuery(adminQueries.groups);
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
  // The dot stands beside its own word in both layouts, so it is decoration and the state is heard once.
  const status = (c: ConnectorSummary) => {
    const s = statusOf(c);
    return <StatusDot variant={s.tone} label={s.label} aria-hidden />;
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
          {c.kind ? `\u00a0· ${kindLabel[c.kind].toLowerCase()}` : ''}
        </Text>
      </VStack>
    </HStack>
  );
  // The board's register (D126, board Admin): the name is the link to the system's page, then whom it shows to, its
  // state in words, when it was last checked and the switch. What a system can do is said on its page (Översikt), and on a
  // phone, which has no columns, under its name.
  const columns = [
    {
      key: 'system',
      header: 'System',
      width: proportional(2, { minWidth: 200 }),
      renderCell: (r: Row) => (
        <HStack gap={2} vAlign="center">
          <SystemSwatch ordinal={r.c.ordinal} />
          <VStack gap={0}>
            <Link href={`/admin/connectors/${r.c.id}`} color="primary" weight="semibold">
              {r.c.source}
            </Link>
            <Text type="supporting" color="secondary">
              {idLine(r.c)}
            </Text>
          </VStack>
        </HStack>
      ),
    },
    {
      key: 'audience',
      header: 'Syns för',
      width: pixel(160),
      renderCell: (r: Row) => <Text>{audienceLabel(r.c.audience)}</Text>,
    },
    {
      key: 'status',
      header: 'Läge',
      width: pixel(170),
      renderCell: (r: Row) => (
        <HStack gap={2} vAlign="center">
          {status(r.c)}
          <Text>{statusOf(r.c).label}</Text>
        </HStack>
      ),
    },
    {
      key: 'checked',
      header: 'Kontrollerad',
      width: pixel(140),
      renderCell: (r: Row) => (
        <Text color="secondary">{r.c.bundled ? 'I processen' : <Timestamp value={r.c.health.at} format="auto" />}</Text>
      ),
    },
    { key: 'on', header: 'Påslagen', width: pixel(100), align: 'end' as const, renderCell: (r: Row) => toggle(r.c) },
  ];
  const all = connectors ?? [];
  const problems = all.filter(c => matches(c, 'problem')).length;
  return (
    <AdminShell
      user={user}
      section="anslutningar"
      title="Anslutna system"
      meta={
        connectors === null ? undefined : `${all.length} system${problems ? `\u00a0· ${problems} med problem` : ''}`
      }
      action={<Button variant="primary" label="Anslut system" onClick={() => setAdding(true)} />}
      flush
      pending={list.isPending}
    >
      {(error || connectors === null) && (
        <VStack padding={mobile ? 4 : 6}>
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
        </VStack>
      )}
      {/* The register meets the frame's edges (board Admin). What is on, what has a problem and what is off are the
          filter's own counts, in a toolbar over it: one row that both says and does. */}
      {connectors !== null && (
        <>
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
                            {statusOf(c).label}
                            {DOT}
                            {audienceLabel(c.audience)}
                          </Text>
                        </HStack>
                        <Text type="supporting">
                          {functions(c)}
                          {DOT}
                          {reach(c)}
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
        </>
      )}
      <AddConnectorDialog
        isOpen={adding}
        units={units}
        groups={groups}
        onClose={added => {
          setAdding(false);
          if (added) void client.invalidateQueries({ queryKey: keys.admin.all });
        }}
      />
    </AdminShell>
  );
}
