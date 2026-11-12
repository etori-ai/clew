import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { OrganisationUnit, SessionUser } from '@clew/contracts';
import {
  Avatar,
  AvatarGroup,
  AvatarGroupOverflow,
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  HStack,
  Text,
  Toolbar,
  TreeList,
  VStack,
  type TreeListItemData,
} from '@clew/ui';
import { adminQueries } from '../../queries';
import { errorMessage } from '../../query-policy';
import { usePageTitle } from '../../page-title';
import { PageHeader } from '../../components/page-header';
import { AdminShell } from './shell';
import {
  ancestorsOf,
  describeUnit,
  fromUnitOverlay,
  marksOf,
  organisationUnitPath,
  people,
} from './organisation-model';

/**
 * "Organisation" (D99): the organisation tree as the catalogue pushed it, read only, as Användare is. Each unit is a
 * row of an Astryx `TreeList` under the unit above it, with who leads it as avatars, how many people are placed on it
 * and in its branch, and a mark for what an import left wrong: people with no manager on the unit or above it, a unit
 * nobody is placed on, a unit people are on that the catalogue never named. The row is the peek; it leads to the unit's
 * own page, `/admin/organisation/<unitId>` (`organisation-unit.tsx`), where its people are a table that holds hundreds
 * (the product owner, 2026-11-12: a panel is for peeking or an instant action, a list that can grow gets a full route).
 * Nothing here is edited: the tree is the catalogue's, and the page shows what the last import made of it.
 *
 * The overlay's address, `/admin/organisation?unit=<unitId>`, leads to the unit's page in its place in the history.
 */
export function AdminOrganisationPage({ user }: { user: SessionUser }) {
  const [search] = useSearchParams();
  const moved = fromUnitOverlay(search);
  return moved ? <Navigate to={moved} replace /> : <OrganisationTree user={user} />;
}

/**
 * The unit whose page was left for the tree: the tree opens down to it, marks its row and gives it the focus, so the
 * way back from a unit, by Back or by the trail, lands where the person was. The unit's page holds it while it is shown
 * and lets go when it gives way to anything else, so the tree reads it only on the way back from that page (it reads it
 * while it is drawn, before the page it replaces has let go). The tree's own opening and folding is held inside Astryx's
 * `TreeList`, which says nothing about it, so a branch opened by hand elsewhere is closed again on the way back.
 */
let leftUnit: string | null = null;
export function useUnitShownForTheWayBack(unitId: string) {
  useEffect(() => {
    leftUnit = unitId;
    return () => {
      if (leftUnit === unitId) leftUnit = null;
    };
  }, [unitId]);
}
/**
 * The unit's managers as avatars; a unit nobody leads has the plain figure, so the names line up down the tree. The
 * avatars are for the eye: the row's own text names the managers, so a screen reader is not told them twice and the
 * initials are not words a person would expect in the row's name.
 */
const leaders = (u: OrganisationUnit) =>
  u.managers.length > 1 ? (
    <AvatarGroup size="sm" aria-hidden>
      {u.managers.slice(0, 2).map(m => (
        <Avatar key={m.id} name={m.name} tooltip={false} aria-hidden />
      ))}
      {u.managers.length > 2 && <AvatarGroupOverflow count={u.managers.length - 2} />}
    </AvatarGroup>
  ) : (
    <Avatar size="sm" tooltip={false} aria-hidden {...(u.managers[0] ? { name: u.managers[0].name } : {})} />
  );

function OrganisationTree({ user }: { user: SessionUser }) {
  const query = useQuery(adminQueries.organisation);
  usePageTitle('Organisation');
  const units = useMemo(() => query.data?.units ?? [], [query.data]);
  const error = query.isError ? errorMessage(query.error, 'Organisationen kunde inte läsas.') : null;
  const tree = useRef<HTMLDivElement>(null);
  // The unit the way back came from, read once as the tree is drawn.
  const [returned] = useState(() => leftUnit);
  // The units open from the start besides the roots: every unit above the one the way back came from. Kept once shown,
  // so the tree does not fold a branch away under the person; what they fold or open themselves is the tree's own.
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  const byId = useMemo(() => new Map(units.map(u => [u.unitId, u])), [units]);
  const above = ancestorsOf(byId, returned).map(u => u.unitId);
  if (above.some(id => !shown.has(id))) setShown(new Set([...shown, ...above]));
  const items = useMemo(() => {
    const below = new Map<string | null, OrganisationUnit[]>();
    for (const u of units) below.set(u.parentId, [...(below.get(u.parentId) ?? []), u]);
    // Open from the start: the roots, so the level under each is read without a click.
    const open = new Set([...(below.get(null) ?? []).map(u => u.unitId), ...shown]);
    const item = (u: OrganisationUnit): TreeListItemData => {
      const kids = below.get(u.unitId) ?? [],
        marks = marksOf(u, kids.length > 0);
      return {
        id: u.unitId,
        // One label holds the name, who leads the unit and what is wrong with it: the row is named by its label, so a
        // screen reader says all of it and every word a person sees on the row is in the row's name (2.5.3).
        label: (
          <VStack gap={0} hAlign="start">
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text weight="semibold">{u.unitLabel}</Text>
              {marks.map(m => (
                <Badge key={m.label} variant={m.variant} label={m.label} />
              ))}
            </HStack>
            <Text type="supporting">{describeUnit(u)}</Text>
          </VStack>
        ),
        startContent: leaders(u),
        // A link row: the whole row leads to the unit's page, and a modified click opens it in a new tab.
        href: organisationUnitPath(u.unitId),
        isSelected: u.unitId === returned,
        isExpanded: open.has(u.unitId),
        ...(kids.length ? { children: kids.map(item) } : {}),
      };
    };
    return (below.get(null) ?? []).map(item);
  }, [units, returned, shown]);
  // On the way back the unit's row takes the focus once it is drawn: the person is where they left the tree (2.4.3).
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || !returned || !items.length) return;
    const row = tree.current?.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]');
    if (!row) return;
    focused.current = true;
    row.focus();
  }, [items, returned]);
  const leaderless = units.filter(u => u.line === 'none' && u.placed > 0).length,
    unnamed = units.filter(u => !u.pushed).length,
    unplaced = query.data?.unplaced ?? 0;
  return (
    <AdminShell user={user} section="organisation" crumbs={[{ label: 'Organisation' }]} pending={query.isPending}>
      <PageHeader
        title="Organisation"
        meta={
          <Text as="p" color="secondary">
            Enheterna som katalogen har fört in, som de hänger ihop, med vem som leder varje enhet och hur många som
            finns på den. Trädet ändras i katalogen; här ser du vad den senaste inläsningen gav.
          </Text>
        }
      />
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      {query.data && (
        <VStack gap={3}>
          {unplaced > 0 && (
            <Banner
              status="warning"
              collapsible={false}
              title={`${people(unplaced)} saknar enhet`}
              description="De finns i Clew men kommer inte åt något förrän katalogen har placerat dem på en enhet. Under Användare står de med Ingen åtkomst."
              endContent={
                <Button size="sm" variant="secondary" label="Till Användare" href="/admin/users?status=no-access" />
              }
            />
          )}
          {leaderless > 0 && (
            <Banner
              status="warning"
              collapsible={false}
              title={`${leaderless} ${leaderless === 1 ? 'enhet har' : 'enheter har'} personer men ingen chef`}
              description="Varken enheten eller någon enhet ovanför har en chef, så personerna där rapporterar inte till någon. De är märkta Saknar chef i trädet."
            />
          )}
          {unnamed > 0 && (
            <Banner
              status="warning"
              collapsible={false}
              title={`${unnamed} ${unnamed === 1 ? 'enhet saknar' : 'enheter saknar'} enhetsgrupp`}
              description="Katalogen har fört in personer på enheten men inte enheten själv, så den har varken namn eller plats i trädet."
            />
          )}
        </VStack>
      )}
      {query.data && units.length === 0 && (
        <Card>
          <EmptyState
            isCompact
            title="Ingen organisation ännu"
            description="Katalogen har inte fört in några enheter. När provisionern har kört visas trädet här."
          />
        </Card>
      )}
      {units.length > 0 && (
        <Card padding={0}>
          <Toolbar
            label="Enheter"
            size="sm"
            dividers={['bottom']}
            startContent={
              <VStack gap={0}>
                <Text weight="semibold" role="status">
                  {units.length} {units.length === 1 ? 'enhet' : 'enheter'}
                </Text>
                <Text type="supporting">Välj en enhet för att se vilka som är placerade på den.</Text>
              </VStack>
            }
          />
          <TreeList ref={tree} aria-label="Organisationsträd" items={items} />
        </Card>
      )}
    </AdminShell>
  );
}
