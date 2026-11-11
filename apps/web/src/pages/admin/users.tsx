import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  USERS_PAGE_SIZES,
  USER_STATUSES,
  isCapability,
  type Capability,
  type GroupCapability,
  type Role,
  type SessionUser,
  type UserAdminRow,
  type UserStatus,
  type UsersAdminOverview,
  type UsersAdminQueryType,
} from '@clew/contracts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  HStack,
  List,
  ListItem,
  Pagination,
  Section,
  Selector,
  Table,
  Text,
  TextInput,
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
 * Above the people, the catalogue's own state: each provisioner with when it last called, and a warning when it has
 * been silent for two days, because access a person has lost in the catalogue ends in Clew only when the push arrives.
 *
 * The people are read a page at a time (D100) and narrowed above the list: a search box, then one Selector per field
 * that is its own chip, the bare field name unset and the whole clause once set (Astryx's filter bar). Where a person
 * is placed and what they are there are two columns and two filters, since "everyone on this unit" and "every manager"
 * are different questions. The unit, role, status, capability, page and page size are in the address
 * (`/admin/users?unit=…&role=manager&page=2`), so a narrowed list can be linked and Back undoes a step; the typed
 * search is not, because it is a person's name.
 */
interface Row extends Record<string, unknown> {
  id: string;
  u: UserAdminRow;
}
interface MapRow extends Record<string, unknown> {
  id: string;
  m: GroupCapability;
}
const EMPTY: UsersAdminOverview = { groupCapabilities: [], groups: [], capabilities: [], units: [], provisioners: [] };
type ProvisionerRow = UsersAdminOverview['provisioners'][number];
const seenAt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  dateStyle: 'long',
  timeStyle: 'short',
});
/** When the catalogue last called (D68): the one sign on this page that people and groups are still being pushed in. */
const lastSeen = (p: ProvisionerRow) =>
  p.lastSeenAt ? `Senaste anrop ${seenAt.format(new Date(p.lastSeenAt))}` : 'Har aldrig anropat Clew';
const liveness = (p: ProvisionerRow) =>
  !p.silent
    ? { label: 'Läser in', variant: 'success' as const }
    : p.lastSeenAt
      ? { label: 'Tyst i över två dygn', variant: 'warning' as const }
      : { label: 'Inget anrop ännu', variant: 'warning' as const };
/** Every unit the person is placed on, the one they act as first: most people have one, and nobody's second is hidden. */
const placements = (u: UserAdminRow) =>
  [...u.assignments].sort((a, b) => Number(b.unitId === u.active?.unitId) - Number(a.unitId === u.active?.unitId) || 0);
const statusOf = (u: UserAdminRow): UserStatus =>
  !u.enabled ? 'disabled' : !u.active ? 'no-access' : u.bound ? 'signed-in' : 'not-signed-in';
const statusLabel: Record<UserStatus, { label: string; variant: 'success' | 'warning' | 'neutral' }> = {
  'signed-in': { label: 'Har loggat in', variant: 'success' },
  'not-signed-in': { label: 'Inte inloggad ännu', variant: 'neutral' },
  'no-access': { label: 'Ingen åtkomst', variant: 'warning' },
  disabled: { label: 'Avstängd', variant: 'neutral' },
};
const roles: Role[] = ['manager', 'employee'];
const count = new Intl.NumberFormat('sv-SE');
const people = (n: number) => `${count.format(n)} ${n === 1 ? 'person' : 'personer'}`;
/** How long the list waits after the last keystroke before it asks, so a name is one question and not eight. */
const TYPING_PAUSE_MS = 250;
/** What the address says the list is narrowed by (D43: English names and values). Anything it cannot mean is left out. */
function filterOf(params: URLSearchParams) {
  const role = params.get('role'),
    status = params.get('status'),
    capability = params.get('capability'),
    page = Number(params.get('page')),
    size = Number(params.get('size'));
  return {
    unitId: params.get('unit') || undefined,
    role: roles.find(r => r === role),
    status: USER_STATUSES.find(s => s === status),
    capability: capability && isCapability(capability) ? capability : undefined,
    page: Number.isInteger(page) && page > 1 ? page : 1,
    pageSize: USERS_PAGE_SIZES.find(n => n === size) ?? USERS_PAGE_SIZES[0],
  };
}

export function AdminUsersPage({ user }: { user: SessionUser }) {
  const mobile = useMediaQuery('(max-width: 720px)');
  const client = useQueryClient();
  const toast = useToast();
  const query = useQuery(adminQueries.users);
  const [params, setParams] = useSearchParams();
  // The address as the last change left it: two changes in one event (a new page size also asks for page 1) build on
  // each other instead of each starting from the address as it was drawn.
  const address = useRef(params);
  address.current = params;
  const filter = filterOf(params);
  const [typed, setTyped] = useState('');
  const [text, setText] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setText(typed.trim()), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [typed]);
  const asked: UsersAdminQueryType = {
    ...(text ? { text } : {}),
    ...(filter.unitId ? { unitId: filter.unitId } : {}),
    ...(filter.role ? { role: filter.role } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.capability ? { capability: filter.capability } : {}),
    page: filter.page,
    pageSize: filter.pageSize,
  };
  // The page on screen stays while the next one is read, so the list never blinks empty between two answers.
  const listed = useQuery({ ...adminQueries.usersPage(asked), placeholderData: keepPreviousData });
  /** Changes the address. Anything but a step to another page starts again from the first one. */
  const show = (change: Record<string, string | number | null | undefined>) => {
    const next = new URLSearchParams(address.current);
    if (!('page' in change)) next.delete('page');
    for (const [name, value] of Object.entries(change))
      if (value === null || value === undefined || value === '' || (name === 'page' && value === 1)) next.delete(name);
      else next.set(name, String(value));
    address.current = next;
    setParams(next);
  };
  const search = (value: string) => {
    setTyped(value);
    if (address.current.has('page')) show({});
  };
  // A step to another page is taken at the foot of the list and read from its head, so the head comes back into view.
  // Focus stays on the pager, where the next step is taken.
  const head = useRef<HTMLSpanElement>(null);
  const turn = (next: number) => {
    show({ page: next });
    head.current?.scrollIntoView({ block: 'start' });
  };
  const narrowed = !!(typed.trim() || filter.unitId || filter.role || filter.status || filter.capability);
  const clear = () => {
    setTyped('');
    setText('');
    show({ unit: null, role: null, status: null, capability: null });
  };
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
      const next = await api.admin.addGroupCapability({ groupExternalId: group, capability: capability as Capability });
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
  const unmapIt = async (m: GroupCapability) => {
    try {
      const next = await api.admin.removeGroupCapability({
        groupExternalId: m.groupExternalId,
        capability: m.capability,
      });
      client.setQueryData(keys.admin.users, next);
      say(
        `Borttaget: ${m.groupLabel ?? m.groupExternalId} ger inte längre ${capabilityLabel[m.capability].toLowerCase()}.`,
        'map:' + m.groupExternalId,
      );
    } catch (e) {
      toast({ body: errorMessage(e, 'Något gick fel.'), isAutoHide: false, uniqueID: 'map:' + m.groupExternalId });
    } finally {
      await client.invalidateQueries({ queryKey: keys.admin.users });
    }
  };
  const status = (u: UserAdminRow) => {
    const a = statusLabel[statusOf(u)];
    return <Badge variant={a.variant} label={a.label} />;
  };
  // One line per unit in both cells, each held to its line, so a unit and the role on it stay beside each other.
  const lines = (u: UserAdminRow, text: (a: UserAdminRow['assignments'][number]) => string) =>
    u.assignments.length ? (
      <VStack gap={0} hAlign="start">
        {placements(u).map(a => (
          <Text key={a.unitId} maxLines={1}>
            {text(a)}
          </Text>
        ))}
      </VStack>
    ) : null;
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
      key: 'unit',
      header: 'Enhet',
      width: proportional(2, { minWidth: 180 }),
      renderCell: (r: Row) => lines(r.u, a => a.unitLabel) ?? <Text color="secondary">Ingen enhet</Text>,
    },
    {
      key: 'role',
      header: 'Roll',
      width: pixel(130),
      renderCell: (r: Row) => lines(r.u, a => roleOfOne[a.role]),
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
    { key: 'status', header: 'Status', width: pixel(160), renderCell: (r: Row) => status(r.u) },
  ];
  const mapColumns = [
    {
      key: 'group',
      header: 'Grupp',
      width: proportional(2, { minWidth: 200 }),
      renderCell: (r: MapRow) => (
        <VStack gap={0} hAlign="start">
          <Text weight="semibold">{r.m.groupLabel ?? 'Grupp som inte längre provisioneras'}</Text>
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
          aria-label={`Ta bort: ${r.m.groupLabel ?? r.m.groupExternalId} ger ${capabilityLabel[r.m.capability].toLowerCase()}`}
          onClick={() => unmapIt(r.m)}
        />
      ),
    },
  ];
  const page = listed.data;
  const users = page?.rows ?? [];
  const listError =
    !error && listed.isError && page === undefined ? errorMessage(listed.error, 'Listan kunde inte läsas.') : null;
  const unitName = (id: string) => data?.units.find(u => u.id === id)?.label ?? id;
  const groupCapabilities = data?.groupCapabilities ?? [];
  const groups = data?.groups ?? [];
  const provisioners = data?.provisioners ?? [];
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
      {query.data && (
        <Card padding={0}>
          <Toolbar
            label="Inläsning från katalogen"
            size="sm"
            dividers={['bottom']}
            startContent={
              <VStack gap={0}>
                <Text weight="semibold">Inläsning från katalogen</Text>
                <Text type="supporting">
                  Katalogen ska föra in ändringar minst en gång per dygn. Den som har slutat eller bytt enhet behåller
                  sin åtkomst i Clew tills nästa inläsning kommer.
                </Text>
              </VStack>
            }
          />
          {provisioners.length === 0 ? (
            <Section variant="transparent" padding={4}>
              <Text type="supporting">Ingen katalog har fått en nyckel till Clew ännu.</Text>
            </Section>
          ) : (
            <List aria-label="Inläsning från katalogen" hasDividers>
              {provisioners.map(p => (
                <ListItem
                  key={p.id}
                  label={<Text weight="semibold">{p.label}</Text>}
                  description={<Text type="supporting">{lastSeen(p)}</Text>}
                  endContent={<Badge variant={liveness(p).variant} label={liveness(p).label} />}
                />
              ))}
            </List>
          )}
        </Card>
      )}
      {listError && (
        <Text as="p" role="alert" color="accent">
          {listError}
        </Text>
      )}
      {page?.all === 0 && (
        <Card>
          <EmptyState
            isCompact
            headingLevel={2}
            title="Inga användare ännu"
            description="Ingen katalog har fört in några personer. När provisionern har kört visas de här."
          />
        </Card>
      )}
      {page && page.all > 0 && (
        <Card padding={0}>
          <Toolbar
            label="Personer"
            size="sm"
            dividers={['bottom']}
            startContent={
              // The one line that says what the filters did, read out when it changes (4.1.3).
              <Text weight="semibold" role="status" ref={head}>
                {page.total === page.all ? people(page.all) : `${count.format(page.total)} av ${people(page.all)}`}
              </Text>
            }
            endContent={
              narrowed ? <Button size="sm" variant="ghost" label="Rensa filter" onClick={clear} /> : undefined
            }
          />
          <Section variant="transparent" padding={3}>
            <HStack gap={2} wrap="wrap" vAlign="center" role="search" aria-label="Sök och filtrera personer">
              <TextInput
                label="Sök person"
                isLabelHidden
                type="search"
                size="sm"
                width={mobile ? '100%' : 280}
                placeholder="Sök namn, användarnamn eller e-post"
                startIcon="search"
                hasClear
                value={typed}
                onChange={search}
              />
              <Selector
                label="Enhet"
                isLabelHidden
                placeholder="Enhet"
                size="sm"
                presentation="adaptive"
                hasClear
                hasSearch
                searchPlaceholder="Sök enhet"
                emptyText="Katalogen har inte fört in några enheter."
                options={(data?.units ?? []).map(u => ({
                  value: u.id,
                  label: u.label,
                  ...(u.parentLabel ? { description: u.parentLabel } : {}),
                }))}
                value={filter.unitId ?? null}
                onChange={(unit: string | null) => show({ unit })}
                renderValue={() => `Enhet: ${unitName(filter.unitId ?? '')}`}
              />
              <Selector
                label="Roll"
                isLabelHidden
                placeholder="Roll"
                size="sm"
                presentation="adaptive"
                hasClear
                options={roles.map(r => ({ value: r, label: roleOfOne[r] }))}
                value={filter.role ?? null}
                onChange={(role: string | null) => show({ role })}
                renderValue={o => `Roll: ${o.label}`}
              />
              <Selector
                label="Status"
                isLabelHidden
                placeholder="Status"
                size="sm"
                presentation="adaptive"
                hasClear
                options={USER_STATUSES.map(s => ({ value: s, label: statusLabel[s].label }))}
                value={filter.status ?? null}
                onChange={(status: string | null) => show({ status })}
                renderValue={o => `Status: ${o.label}`}
              />
              <Selector
                label="Behörighet"
                isLabelHidden
                placeholder="Behörighet"
                size="sm"
                presentation="adaptive"
                hasClear
                options={(data?.capabilities ?? []).map(c => ({ value: c, label: capabilityLabel[c] }))}
                value={filter.capability ?? null}
                onChange={(capability: string | null) => show({ capability })}
                renderValue={o => `Behörighet: ${o.label}`}
              />
            </HStack>
          </Section>
          {users.length === 0 ? (
            <EmptyState
              isCompact
              headingLevel={2}
              title="Inga personer matchar"
              description="Ingen i katalogen stämmer med sökningen och filtren tillsammans."
              actions={<Button size="sm" label="Rensa filter" onClick={clear} />}
            />
          ) : mobile ? (
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
                      {u.assignments.length ? (
                        placements(u).map(a => (
                          <Text key={a.unitId} type="supporting">
                            {a.unitLabel} · {roleOfOne[a.role].toLowerCase()}
                          </Text>
                        ))
                      ) : (
                        <Text type="supporting">Ingen enhet</Text>
                      )}
                      {u.capabilities.length > 0 && (
                        <Text type="supporting">
                          {u.capabilities.map(c => capabilityLabel[c as Capability] ?? c).join(', ')}
                        </Text>
                      )}
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
              rowIndexStart={(page.page - 1) * page.pageSize + 1}
              rowCount={page.total}
            />
          )}
          {page.total > USERS_PAGE_SIZES[0] && (
            <Section variant="transparent" padding={3}>
              <HStack justify="center">
                <Pagination
                  label="Sidor med personer"
                  size="sm"
                  variant={mobile ? 'compact' : 'pages'}
                  page={page.page}
                  totalItems={page.total}
                  pageSize={page.pageSize}
                  onChange={turn}
                  {...(mobile
                    ? {}
                    : {
                        pageSizeOptions: [...USERS_PAGE_SIZES],
                        onPageSizeChange: (size: number) => show({ size: size === USERS_PAGE_SIZES[0] ? null : size }),
                      })}
                />
              </HStack>
            </Section>
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
          {groupCapabilities.length === 0 ? (
            <Section variant="transparent" padding={4}>
              <Text type="supporting">
                Ingen grupp ger någon behörighet ännu. Behörigheter kan också följa med katalogen som grupper med
                nyckeln capability.
              </Text>
            </Section>
          ) : mobile ? (
            <List aria-label="Behörigheter från grupper" hasDividers>
              {groupCapabilities.map(m => (
                <ListItem
                  key={m.groupExternalId + ':' + m.capability}
                  label={<Text weight="semibold">{m.groupLabel ?? m.groupExternalId}</Text>}
                  description={<Text type="supporting">{capabilityLabel[m.capability]}</Text>}
                  endContent={
                    <Button
                      size="sm"
                      variant="secondary"
                      label="Ta bort"
                      aria-label={`Ta bort: ${m.groupLabel ?? m.groupExternalId} ger ${capabilityLabel[m.capability].toLowerCase()}`}
                      onClick={() => unmapIt(m)}
                    />
                  }
                />
              ))}
            </List>
          ) : (
            <Table<MapRow>
              data={groupCapabilities.map(m => ({ id: m.groupExternalId + ':' + m.capability, m }))}
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
