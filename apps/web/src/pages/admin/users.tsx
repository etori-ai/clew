import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Capability, CapabilityMapping, SessionUser, UserAdminRow, UsersAdminOverview } from '@clew/contracts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  HStack,
  List,
  ListItem,
  Section,
  Selector,
  Table,
  Text,
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
import { capabilityLabel, roleOfOne } from './labels';
import { AdminShell } from './shell';
import { PageHeader } from '../../components/page-header';

/**
 * "Användare" (D62, D68, D85): the people the provisioner pushed, read only, and the one thing an administrator decides
 * here: which provisioned group gives which capability. Identity, units and roles are the source's; this page shows
 * them and never edits them. A Table on a desktop, List rows on a phone, as the other administration pages (D23, D24).
 */
interface Row extends Record<string, unknown> {
  id: string;
  u: UserAdminRow;
}
interface MapRow extends Record<string, unknown> {
  id: string;
  m: CapabilityMapping;
}
const EMPTY: UsersAdminOverview = { users: [], mapping: [], groups: [], capabilities: [] };
const where = (u: UserAdminRow) =>
  u.active
    ? `${u.active.unitLabel} · ${roleOfOne[u.active.role].toLowerCase()}` +
      (u.assignments.length > 1 ? ` (+${u.assignments.length - 1})` : '')
    : 'Ingen enhet';
const access = (u: UserAdminRow) =>
  !u.enabled
    ? { label: 'Avstängd', variant: 'neutral' as const }
    : !u.active
      ? { label: 'Ingen åtkomst', variant: 'warning' as const }
      : u.bound
        ? { label: 'Har loggat in', variant: 'success' as const }
        : { label: 'Inte inloggad ännu', variant: 'neutral' as const };

export function AdminUsersPage({ user }: { user: SessionUser }) {
  const mobile = useMediaQuery('(max-width: 720px)');
  const client = useQueryClient();
  const toast = useToast();
  const query = useQuery(adminQueries.users);
  const [group, setGroup] = useState<string | undefined>();
  const [capability, setCapability] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  usePageTitle('Användare');
  const data = query.data ?? (query.isError ? EMPTY : null);
  const error =
    query.isError && query.data === undefined ? errorMessage(query.error, 'Listan kunde inte läsas.') : null;
  const groupLabel = (id: string) => data?.groups.find(g => g.id === id)?.label ?? id;
  const say = (body: string, id: string) => toast({ body, uniqueID: id });
  const mapIt = async () => {
    if (!group || !capability) return;
    setBusy(true);
    try {
      const next = await api.admin.mapCapability({ groupExternalId: group, capability: capability as Capability });
      client.setQueryData(keys.admin.users, next);
      say(
        `Sparat: ${groupLabel(group)} ger ${capabilityLabel[capability as Capability].toLowerCase()}.`,
        'map:' + group,
      );
      setGroup(undefined);
      setCapability(undefined);
    } catch (e) {
      toast({ body: errorMessage(e, 'Något gick fel.'), isAutoHide: false, uniqueID: 'map:' + group });
    } finally {
      setBusy(false);
      await client.invalidateQueries({ queryKey: keys.admin.users });
    }
  };
  const unmapIt = async (m: CapabilityMapping) => {
    try {
      const next = await api.admin.unmapCapability({ groupExternalId: m.groupExternalId, capability: m.capability });
      client.setQueryData(keys.admin.users, next);
      say(
        `Borttaget: ${m.displayName ?? m.groupExternalId} ger inte längre ${capabilityLabel[m.capability].toLowerCase()}.`,
        'map:' + m.groupExternalId,
      );
    } catch (e) {
      toast({ body: errorMessage(e, 'Något gick fel.'), isAutoHide: false, uniqueID: 'map:' + m.groupExternalId });
    } finally {
      await client.invalidateQueries({ queryKey: keys.admin.users });
    }
  };
  const status = (u: UserAdminRow) => {
    const a = access(u);
    return <Badge variant={a.variant} label={a.label} />;
  };
  const columns = [
    {
      key: 'person',
      header: 'Person',
      width: proportional(2, { minWidth: 220 }),
      renderCell: (r: Row) => (
        <VStack gap={0} hAlign="start">
          <Text weight="semibold">{r.u.name}</Text>
          <Text type="code" color="secondary">
            {r.u.userName ?? r.u.id}
          </Text>
        </VStack>
      ),
    },
    {
      key: 'where',
      header: 'Enhet och roll',
      width: proportional(2, { minWidth: 180 }),
      renderCell: (r: Row) => <Text>{where(r.u)}</Text>,
    },
    {
      key: 'capabilities',
      header: 'Behörigheter',
      width: proportional(2, { minWidth: 160 }),
      renderCell: (r: Row) =>
        r.u.capabilities.length ? (
          <HStack gap={1} wrap="wrap">
            {r.u.capabilities.map(c => (
              <Badge key={c} variant="neutral" label={capabilityLabel[c as Capability] ?? c} />
            ))}
          </HStack>
        ) : (
          <Text color="secondary">Inga</Text>
        ),
    },
    { key: 'groups', header: 'Grupper', width: pixel(90), renderCell: (r: Row) => <Text>{r.u.groups.length}</Text> },
    { key: 'status', header: 'Status', width: pixel(160), renderCell: (r: Row) => status(r.u) },
  ];
  const mapColumns = [
    {
      key: 'group',
      header: 'Grupp',
      width: proportional(2, { minWidth: 200 }),
      renderCell: (r: MapRow) => (
        <VStack gap={0} hAlign="start">
          <Text weight="semibold">{r.m.displayName ?? 'Grupp som inte längre provisioneras'}</Text>
          <Text type="code" color="secondary">
            {r.m.groupExternalId}
          </Text>
        </VStack>
      ),
    },
    {
      key: 'gives',
      header: 'Ger',
      width: proportional(2, { minWidth: 180 }),
      renderCell: (r: MapRow) => <Text>{capabilityLabel[r.m.capability]}</Text>,
    },
    {
      key: 'remove',
      header: 'Ta bort',
      width: pixel(110),
      renderCell: (r: MapRow) => (
        <Button
          size="sm"
          variant="secondary"
          label="Ta bort"
          aria-label={`Ta bort: ${r.m.displayName ?? r.m.groupExternalId} ger ${capabilityLabel[r.m.capability].toLowerCase()}`}
          onClick={() => unmapIt(r.m)}
        />
      ),
    },
  ];
  const users = data?.users ?? [];
  const mapping = data?.mapping ?? [];
  const groups = data?.groups ?? [];
  return (
    <AdminShell user={user} section="anvandare" crumbs={[{ label: 'Användare' }]} pending={query.isPending}>
      <PageHeader
        title="Användare"
        meta={
          <Text as="p" color="secondary">
            Personerna som katalogen har fört in i Clew, med enhet, roll och behörigheter. Vem som finns och var hen hör
            hemma bestäms i katalogen; här avgör du vilka grupper som ger en behörighet i Clew.
          </Text>
        }
      />
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      {data === null && (
        <Text type="supporting" role="status">
          Läser användarna …
        </Text>
      )}
      {data && users.length === 0 && (
        <Card>
          <EmptyState
            isCompact
            title="Inga användare ännu"
            description="Ingen katalog har fört in några personer. När provisionern har kört visas de här."
          />
        </Card>
      )}
      {users.length > 0 && (
        <Card padding={0}>
          <Toolbar
            label="Personer"
            size="sm"
            dividers={['bottom']}
            startContent={
              <Text weight="semibold">
                {users.length} {users.length === 1 ? 'person' : 'personer'}
              </Text>
            }
          />
          {mobile ? (
            <List aria-label="Personer" hasDividers>
              {users.map(u => (
                <ListItem
                  key={u.id}
                  label={<Text weight="semibold">{u.name}</Text>}
                  description={
                    <VStack gap={0} hAlign="start">
                      <Text type="code" color="secondary">
                        {u.userName ?? u.id}
                      </Text>
                      <Text type="supporting">
                        {where(u)}
                        {u.capabilities.length
                          ? ` · ${u.capabilities.map(c => capabilityLabel[c as Capability] ?? c).join(', ')}`
                          : ''}
                      </Text>
                    </VStack>
                  }
                  endContent={status(u)}
                />
              ))}
            </List>
          ) : (
            <Table<Row>
              data={users.map(u => ({ id: u.id, u }))}
              idKey="id"
              columns={columns}
              density="balanced"
              hasHover
            />
          )}
        </Card>
      )}
      {data && (
        <Card padding={0}>
          <Toolbar
            label="Behörigheter från grupper"
            size="sm"
            dividers={['bottom']}
            startContent={
              <VStack gap={0}>
                <Text weight="semibold">Behörigheter från grupper</Text>
                <Text type="supporting">
                  En grupp från katalogen ger sina medlemmar en behörighet i Clew. Ändringen gäller vid nästa anrop.
                </Text>
              </VStack>
            }
          />
          <Section variant="transparent" padding={4}>
            <VStack
              gap={3}
              as="form"
              aria-label="Lägg till behörighet från grupp"
              onSubmit={e => {
                e.preventDefault();
                void mapIt();
              }}
            >
              <HStack gap={3} wrap="wrap" vAlign="end">
                <Selector
                  label="Grupp"
                  placeholder={groups.length ? 'Välj grupp' : 'Inga grupper provisionerade'}
                  options={groups.map(g => ({ value: g.id, label: g.label }))}
                  value={group}
                  onChange={setGroup}
                  hasSearch={groups.length > 15}
                  isDisabled={!groups.length}
                  disabledMessage="Grupper visas när katalogen har provisionerat dem genom SCIM."
                />
                <Selector
                  label="Ger behörigheten"
                  placeholder="Välj behörighet"
                  options={(data.capabilities ?? []).map(c => ({ value: c, label: capabilityLabel[c] }))}
                  value={capability}
                  onChange={setCapability}
                />
                <Button type="submit" variant="primary" label="Lägg till" isDisabled={!group || !capability || busy} />
              </HStack>
            </VStack>
          </Section>
          {mapping.length === 0 ? (
            <Section variant="transparent" padding={4}>
              <Text type="supporting">
                Ingen grupp ger någon behörighet ännu. Behörigheter kan också följa med katalogen som grupper med
                nyckeln capability.
              </Text>
            </Section>
          ) : mobile ? (
            <List aria-label="Behörigheter från grupper" hasDividers>
              {mapping.map(m => (
                <ListItem
                  key={m.groupExternalId + ':' + m.capability}
                  label={<Text weight="semibold">{m.displayName ?? m.groupExternalId}</Text>}
                  description={<Text type="supporting">{capabilityLabel[m.capability]}</Text>}
                  endContent={
                    <Button
                      size="sm"
                      variant="secondary"
                      label="Ta bort"
                      aria-label={`Ta bort: ${m.displayName ?? m.groupExternalId} ger ${capabilityLabel[m.capability].toLowerCase()}`}
                      onClick={() => unmapIt(m)}
                    />
                  }
                />
              ))}
            </List>
          ) : (
            <Table<MapRow>
              data={mapping.map(m => ({ id: m.groupExternalId + ':' + m.capability, m }))}
              idKey="id"
              columns={mapColumns}
              density="balanced"
            />
          )}
        </Card>
      )}
    </AdminShell>
  );
}
