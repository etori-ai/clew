import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { OrganisationUnit, SessionUser, StaffPerson } from '@clew/contracts';
import {
  Avatar,
  AvatarGroup,
  AvatarGroupOverflow,
  Badge,
  Banner,
  BottomSheet,
  Button,
  Card,
  Drawer,
  DrawerHeader,
  EmptyState,
  Heading,
  HStack,
  Icon,
  IconButton,
  Layout,
  LayoutContent,
  LayoutHeader,
  List,
  ListItem,
  StackItem,
  Text,
  Toolbar,
  TreeList,
  VStack,
  useMediaQuery,
  type TreeListItemData,
} from '@clew/ui';
import { adminQueries } from '../../queries';
import { errorMessage } from '../../query-policy';
import { usePageTitle } from '../../page-title';
import { AsyncContent, ContentSkeleton } from '../../components/loading';
import { PageHeader } from '../../components/page-header';
import { mobileQuery, shortQuery } from '../../components/shell';
import { roleText } from './labels';
import { AdminShell } from './shell';

/**
 * "Organisation" (D99): the organisation tree as the catalogue pushed it, read only, as Användare is. Each unit is a
 * row of an Astryx `TreeList` under the unit above it, with who leads it as avatars, how many people are placed on it
 * and in its branch, and a mark for what an import left wrong: people with no manager on the unit or above it, a unit
 * nobody is placed on, a unit people are on that the catalogue never named. A row opens the unit's people as a focused
 * overlay over the tree (D83): an end `Drawer` on a desktop, a `BottomSheet` on a phone, at
 * `/admin/organisation?unit=<unitId>`, composed as the talk on Personal is. The overlay says who leads the unit first,
 * then the others placed on it, then who reports to its managers from the units below, which is the reporting line an
 * administrator otherwise has to read out of the tree's indentation. Nothing here is edited: the tree is the
 * catalogue's, and the page shows what the last import made of it.
 */
const PATH = '/admin/organisation';
const UNIT_PARAM = 'unit';
const PEOPLE_WIDTH = 480;
const unitOf = (search: URLSearchParams) => search.get(UNIT_PARAM) || null;
const address = (query: URLSearchParams) => (query.size ? `${PATH}?${query}` : PATH);
const unitHref = (unitId: string, search: URLSearchParams) => {
  const q = new URLSearchParams(search);
  q.set(UNIT_PARAM, unitId);
  return address(q);
};
const withoutUnit = (search: URLSearchParams) => {
  const q = new URLSearchParams(search);
  q.delete(UNIT_PARAM);
  return address(q);
};
const names = new Intl.ListFormat('sv', { type: 'conjunction' });
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'personer'}`;
/** The units above a unit, nearest first; the walk ends at a root, and at the tree's size if a chain were ever a ring. */
const ancestorsOf = (units: ReadonlyMap<string, OrganisationUnit>, unitId: string | null) => {
  const above: OrganisationUnit[] = [];
  for (let at = unitId ? units.get(unitId) : undefined; at?.parentId && above.length < units.size;) {
    at = units.get(at.parentId);
    if (at) above.push(at);
  }
  return above;
};
/** "Chef: Karin Berg · 2 personer, 86 med enheterna under": who leads the unit and how many it holds. */
const describe = (u: OrganisationUnit) => {
  const led = u.managers.length
    ? `${u.managers.length === 1 ? 'Chef' : 'Chefer'}: ${names.format(u.managers.map(m => m.name))}`
    : u.line === 'above'
      ? 'Leds från enheten ovanför'
      : 'Ingen chef';
  return `${led} · ${people(u.placed)}${u.branch > u.placed ? `, ${u.branch} med enheterna under` : ''}`;
};
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
/**
 * One group of people in the overlay: a heading, a line about what it holds when one is needed, and the people as a
 * list named by the heading and the unit. A group nobody is in is not drawn.
 */
const group = (heading: string, unitLabel: string, members: StaffPerson[], note?: string) =>
  members.length > 0 && (
    <VStack gap={1}>
      <Heading level={3}>{heading}</Heading>
      {note && <Text type="supporting">{note}</Text>}
      <List aria-label={`${heading} · ${unitLabel}`} hasDividers>
        {members.map(p => (
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
                  {roleText(p)}
                  {p.email ? ` · ${p.email}` : ''}
                </Text>
              </VStack>
            }
            endContent={!p.enabled ? <Badge variant="neutral" label="Avstängd" /> : undefined}
          />
        ))}
      </List>
    </VStack>
  );
/** What an import left wrong on a unit, as the tree marks it. A unit with units under it may well be empty. */
const marksOf = (u: OrganisationUnit, hasBelow: boolean) => [
  ...(!u.pushed ? [{ label: 'Saknar enhetsgrupp', variant: 'warning' as const }] : []),
  ...(u.line === 'none' && u.placed > 0 ? [{ label: 'Saknar chef', variant: 'warning' as const }] : []),
  ...(u.placed === 0 && !hasBelow ? [{ label: 'Tom', variant: 'neutral' as const }] : []),
];

export function AdminOrganisationPage({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const query = useQuery(adminQueries.organisation);
  usePageTitle('Organisation');
  const selected = unitOf(search);
  const units = useMemo(() => query.data?.units ?? [], [query.data]);
  const error = query.isError ? errorMessage(query.error, 'Organisationen kunde inte läsas.') : null;
  const tree = useRef<HTMLDivElement>(null);
  // The units the address has asked to have open: every unit above one it named. Kept once shown, so the tree does not
  // fold a branch away under the person when the overlay closes; what they fold or open themselves is the tree's own.
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  const byId = useMemo(() => new Map(units.map(u => [u.unitId, u])), [units]);
  const above = ancestorsOf(byId, selected).map(u => u.unitId);
  if (above.some(id => !shown.has(id))) setShown(new Set([...shown, ...above]));
  const items = useMemo(() => {
    const below = new Map<string | null, OrganisationUnit[]>();
    for (const u of units) below.set(u.parentId, [...(below.get(u.parentId) ?? []), u]);
    // Open from the start: the roots, so the level under each is read without a click.
    const open = new Set([...(below.get(null) ?? []).map(u => u.unitId), ...shown]);
    const item = (u: OrganisationUnit): TreeListItemData => {
      const kids = below.get(u.unitId) ?? [],
        marks = marksOf(u, kids.length > 0),
        href = unitHref(u.unitId, search);
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
            <Text type="supporting">{describe(u)}</Text>
          </VStack>
        ),
        startContent: leaders(u),
        href,
        // The address changes in place, so the tree keeps what the person has opened in it.
        onClick: e => {
          e.preventDefault();
          navigate(href);
        },
        isSelected: u.unitId === selected,
        isExpanded: open.has(u.unitId),
        ...(kids.length ? { children: kids.map(item) } : {}),
      };
    };
    return (below.get(null) ?? []).map(item);
  }, [units, selected, shown, search, navigate]);
  const leaderless = units.filter(u => u.line === 'none' && u.placed > 0).length,
    unnamed = units.filter(u => !u.pushed).length,
    unplaced = query.data?.unplaced ?? 0;
  /** Where the focus goes when the overlay closes and nothing opened it: the unit's own row, else the tree's first. */
  const focusTree = useCallback(() => {
    const rows = tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]');
    (tree.current?.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]') ?? rows?.[0])?.focus();
  }, []);
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
              endContent={<Button size="sm" variant="secondary" label="Till Användare" href="/admin/users" />}
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
      <UnitPeople units={byId} settled={query.data !== undefined || query.isError} focusBack={focusTree} />
    </AdminShell>
  );
}

/**
 * The people placed on the unit the address names, over the tree. The unit shown is kept while the overlay slides
 * away, so its content does not blank mid-exit. Closing (✕, Esc) replaces the address with the tree's own; Astryx gives
 * the focus back to the row that opened the overlay, and after a reload, when nothing did, the tree takes it.
 */
function UnitPeople({
  units,
  settled,
  focusBack,
}: {
  units: ReadonlyMap<string, OrganisationUnit>;
  settled: boolean;
  focusBack: () => void;
}) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const unitId = unitOf(search);
  const [shownId, setShownId] = useState<string | null>(unitId);
  if (unitId && unitId !== shownId) setShownId(unitId);
  const query = useQuery({ ...adminQueries.organisationUnit(shownId ?? ''), enabled: !!shownId });
  const unit = shownId ? units.get(shownId) : undefined;
  const title = unit?.unitLabel ?? query.data?.unitLabel ?? 'Enheten finns inte';
  // The units above, outermost first: where in the organisation the unit is.
  const path = ancestorsOf(units, shownId)
    .map(u => u.unitLabel)
    .reverse();
  const onOpenChange = (open: boolean) => {
    if (!open) navigate(withoutUnit(search), { replace: true });
  };
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const sheetPanel = useCallback((panel: HTMLDivElement | null) => setDialog(panel?.closest('dialog') ?? null), []);
  const openRef = useRef(unitId);
  openRef.current = unitId;
  const focusRef = useRef(focusBack);
  focusRef.current = focusBack;
  useEffect(() => {
    if (!dialog) return;
    const closed = () => {
      if (!openRef.current) setShownId(null);
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body) focusRef.current();
      });
    };
    dialog.addEventListener('close', closed);
    return () => dialog.removeEventListener('close', closed);
  }, [dialog]);
  const subtitle = path.length ? path.join(' › ') : undefined;
  const header = mobile ? (
    <LayoutHeader>
      <VStack gap={1}>
        <HStack justify="between" vAlign="center" gap={2}>
          <StackItem size="fill">
            <Heading level={2}>{title}</Heading>
          </StackItem>
          <IconButton variant="ghost" label="Stäng" icon={<Icon icon="close" />} onClick={() => onOpenChange(false)} />
        </HStack>
        {subtitle && <Text type="supporting">{subtitle}</Text>}
      </VStack>
    </LayoutHeader>
  ) : (
    <DrawerHeader title={title} {...(subtitle ? { subtitle } : {})} onOpenChange={onOpenChange} />
  );
  const placed = query.data?.people ?? [];
  // Counted as the tree's row counts them: deactivated people are listed, with their mark, but are not among the placed.
  const off = placed.filter(p => !p.enabled).length;
  // Who leads the unit first, then the others placed on it, then who reports to its managers from the units below.
  const leaders = placed.filter(p => p.role === 'manager'),
    others = placed.filter(p => p.role !== 'manager'),
    leading = leaders.filter(p => p.enabled).map(p => p.name);
  const content = query.isError ? (
    <Banner
      status="error"
      collapsible={false}
      title={errorMessage(query.error, 'Personerna kunde inte hämtas.')}
      endContent={
        <Button
          label="Försök igen"
          size="sm"
          variant="secondary"
          isLoading={query.isFetching}
          onClick={() => void query.refetch()}
        />
      }
    />
  ) : (
    <AsyncContent pending={query.isPending} fallback={<ContentSkeleton heading={false} />} gap={3}>
      {placed.length === 0 ? (
        <EmptyState
          isCompact
          headingLevel={3}
          title="Ingen är placerad på enheten"
          description="Katalogen har inte fört in någon på just den här enheten. Personerna kan finnas på enheterna under den."
        />
      ) : (
        <>
          <Text type="supporting" role="status">
            {`${people(placed.length - off)} på enheten${off ? `, ${off} ${off === 1 ? 'avstängd' : 'avstängda'}` : ''}`}
          </Text>
          {group(leaders.length === 1 ? 'Chef' : 'Chefer', title, leaders)}
          {group('Medarbetare', title, others)}
          {group(
            `Rapporterar till ${names.format(leading)}`,
            title,
            query.data?.reports ?? [],
            'Från enheterna under: cheferna närmast under, och de som är placerade på en enhet som ingen leder.',
          )}
        </>
      )}
    </AsyncContent>
  );
  const body = shownId ? (
    <Layout height={short ? 'auto' : 'fill'} header={header} content={<LayoutContent>{content}</LayoutContent>} />
  ) : null;
  const isOpen = !!unitId && settled;
  const label = `Personer på ${title}`;
  return mobile ? (
    <BottomSheet
      ref={sheetPanel}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label={label}
      height="tall"
      purpose="info"
    >
      {body}
    </BottomSheet>
  ) : (
    <Drawer
      ref={setDialog}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label={label}
      side="end"
      width={PEOPLE_WIDTH}
      purpose="info"
    >
      {body}
    </Drawer>
  );
}
