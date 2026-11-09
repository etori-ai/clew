import { useQuery } from '@tanstack/react-query';
import type { SessionUser, StaffPerson, StaffUnit } from '@clew/contracts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  HStack,
  Layout,
  LayoutContent,
  List,
  ListItem,
  Table,
  Text,
  Toolbar,
  VStack,
  pixel,
  proportional,
  useMediaQuery,
} from '@clew/ui';
import { staffQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { useRail } from '../components/nav';
import { Shell, mobileQuery } from '../components/shell';
import { AsyncContent, ContentSkeleton } from '../components/loading';
import { PageHeader } from '../components/page-header';
import { roleOfOne } from './admin/labels';

/**
 * Personal (D94): the people on the units the signed-in manager manages, as the directory pushed them: name, user
 * name, role on the unit, address, and a mark when the directory has deactivated someone. One card per unit, a Table
 * on a desktop and List rows on a phone, as Användare (D85), in the same Layout as the administration (D74). Read
 * only; the scope is the server's, which answers 403 to anyone who manages no unit, and the page says so. Notes and
 * the utvecklingssamtal come later, on this page.
 */
interface Row extends Record<string, unknown> {
  id: string;
  p: StaffPerson;
}
const who = (p: StaffPerson) => (
  <HStack gap={2} vAlign="center">
    <Avatar name={p.name} size="sm" tooltip={false} />
    <VStack gap={0} hAlign="start">
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text weight="semibold">{p.name}</Text>
        {!p.enabled && <Badge variant="neutral" label="Avstängd" />}
      </HStack>
      <Text type="code" color="secondary">
        {p.userName ?? p.id}
      </Text>
    </VStack>
  </HStack>
);
const columns = [
  { key: 'person', header: 'Person', width: proportional(2, { minWidth: 240 }), renderCell: (r: Row) => who(r.p) },
  { key: 'role', header: 'Roll', width: pixel(140), renderCell: (r: Row) => <Text>{roleOfOne[r.p.role]}</Text> },
  {
    key: 'email',
    header: 'E-post',
    width: proportional(2, { minWidth: 200 }),
    renderCell: (r: Row) => (r.p.email ? <Text>{r.p.email}</Text> : <Text color="secondary">Saknas</Text>),
  },
];
function UnitCard({ unit, mobile }: { unit: StaffUnit; mobile: boolean }) {
  const n = unit.people.length;
  return (
    <Card padding={0}>
      <Toolbar
        label={unit.unitLabel}
        size="sm"
        dividers={['bottom']}
        startContent={
          <VStack gap={0}>
            <Text weight="semibold">{unit.unitLabel}</Text>
            <Text type="supporting">{n === 0 ? 'Ingen medarbetare' : `${n} medarbetare`}</Text>
          </VStack>
        }
      />
      {n === 0 ? (
        <EmptyState
          isCompact
          title="Ingen medarbetare på enheten"
          description="Katalogen har inte fört in någon annan än dig på den här enheten."
        />
      ) : mobile ? (
        <List aria-label={unit.unitLabel} hasDividers>
          {unit.people.map(p => (
            <ListItem
              key={p.id}
              startContent={<Avatar name={p.name} size="sm" tooltip={false} />}
              label={<Text weight="semibold">{p.name}</Text>}
              description={
                <VStack gap={0} hAlign="start">
                  <Text type="code" color="secondary">
                    {p.userName ?? p.id}
                  </Text>
                  <Text type="supporting">
                    {roleOfOne[p.role]}
                    {p.email ? ` · ${p.email}` : ''}
                  </Text>
                </VStack>
              }
              endContent={!p.enabled ? <Badge variant="neutral" label="Avstängd" /> : undefined}
            />
          ))}
        </List>
      ) : (
        <Table<Row>
          data={unit.people.map(p => ({ id: p.id, p }))}
          idKey="id"
          columns={columns}
          density="balanced"
          hasHover
        />
      )}
    </Card>
  );
}
export function StaffPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  const manager = user.role === 'manager';
  const nav = useRail({ current: { surface: 'staff' }, admin, manager });
  // Someone who is not a manager gets the page's own answer without a call the server would refuse anyway.
  const query = useQuery({ ...staffQuery, enabled: manager });
  usePageTitle('Personal');
  const refused = !manager || (query.isError && errorMessage(query.error, '').includes('chef'));
  const error = query.isError && !refused ? errorMessage(query.error, 'Listan kunde inte läsas.') : null;
  const units = query.data?.units ?? [];
  const people = units.reduce((sum, u) => sum + u.people.length, 0);
  return (
    <Shell user={user} nav={nav}>
      <Layout
        height="auto"
        contentWidth={1216}
        padding={mobile ? 3 : 8}
        content={
          <LayoutContent isScrollable={false}>
            <VStack gap={5}>
              <PageHeader
                title="Personal"
                meta={
                  <Text as="p" color="secondary">
                    Medarbetarna på enheterna du är chef för, med roll och kontaktuppgift, som katalogen har fört in
                    dem.
                  </Text>
                }
              />
              {refused ? (
                <Card>
                  <EmptyState
                    headingLevel={2}
                    title="Sidan Personal är för chefer"
                    description="Här ser den som är chef för en enhet medarbetarna på den. Katalogen avgör vem som är chef; be systemförvaltaren om det inte stämmer."
                    actions={<Button label="Till startsidan" href="/" />}
                  />
                </Card>
              ) : (
                <AsyncContent pending={query.isPending} fallback={<ContentSkeleton />} gap={5}>
                  {error && (
                    <Text as="p" role="alert" color="accent">
                      {error}
                    </Text>
                  )}
                  {query.data && (
                    <Text type="supporting" role="status">
                      {units.length === 1
                        ? `${people} medarbetare på ${units[0]!.unitLabel}`
                        : `${people} medarbetare på ${units.length} enheter`}
                    </Text>
                  )}
                  {units.map(u => (
                    <UnitCard key={u.unitId} unit={u} mobile={mobile} />
                  ))}
                </AsyncContent>
              )}
            </VStack>
          </LayoutContent>
        }
      />
    </Shell>
  );
}
