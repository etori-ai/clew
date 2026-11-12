import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  USERS_PAGE_SIZES,
  type OrganisationUnit,
  type OrganisationUnitPeople,
  type SessionUser,
  type StaffPerson,
} from '@clew/contracts';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  HStack,
  Heading,
  Link,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  Pagination,
  Section,
  Table,
  Text,
  TextInput,
  VStack,
  proportional,
  useMediaQuery,
} from '@clew/ui';
import { ApiError } from '../../api-error';
import { PersonNameLink } from '../../components/person-name-link';
import { PageHeader } from '../../components/page-header';
import { adminQueries } from '../../queries';
import { errorMessage } from '../../query-policy';
import { usePageTitle } from '../../page-title';
import { roleText } from './labels';
import {
  GROUPS,
  ORGANISATION_PATH,
  ancestorsOf,
  childrenOf,
  groupsOf,
  leadingUnitOf,
  marksOf,
  organisationUnitPath,
  pageOf,
  pageParam,
  pagingOf,
  placedLine,
  shownOf,
  wordsOf,
  type PeopleGroup,
} from './organisation-model';
import { useUnitShownForTheWayBack } from './organisation';
import { AdminShell } from './shell';

/**
 * A unit under Administration › Organisation (D99), as a page of its own at `/admin/organisation/<unitId>`: the product
 * owner, 2026-11-12, "should an organisation really open in a sidebar? An organisation might have hundreds of
 * employees. The sidebar needs to be for peeking or some kind of instant actions, otherwise a full route is needed."
 * The tree's row is the peek (who leads the unit, how many are on it); this page is where its people are read.
 *
 * The head says who leads the unit (each name leads to the person's page), how many are placed on it and in its branch,
 * the unit it is part of and the units directly below it, each a link to its own page, and what an import left wrong,
 * in the tree's words. The people are three groups, each a heading over a `Table` on a desktop and `List` rows on a
 * phone, as on Användare: who leads the unit, the others placed on it, and who reports to its managers from the units
 * below. One search box above them narrows all three. The unit's people are read whole (one unit, never the
 * organisation), so the search runs here and a group longer than a page is paged here; the page of each group and the
 * page size are in the address, so the way back from a person returns to the same rows. Nothing is edited here.
 */
export function AdminOrganisationUnitPage({ user }: { user: SessionUser }) {
  const { unitId = '' } = useParams();
  // Another unit is another page: its search, its pages and its focus start over.
  return <UnitPage key={unitId} user={user} unitId={unitId} />;
}

const MOBILE = '(max-width: 720px)';
/** How long the search waits after the last keystroke, so the count is said once and not after every letter. */
const TYPING_PAUSE_MS = 250;
const listed = new Intl.ListFormat('sv', { type: 'conjunction' });
/** Things named in a sentence, each drawn as given: "Hillevi Berg och Karin Åberg", every name a link. */
function Listed({ items }: { items: Array<{ key: string; label: string; node: ReactNode }> }) {
  let at = 0;
  return (
    <Text>
      {listed.formatToParts(items.map(i => i.label)).map((part, n) => {
        if (part.type !== 'element') return <Fragment key={`and-${n}`}>{part.value}</Fragment>;
        const item = items[at++]!;
        return <Fragment key={item.key}>{item.node}</Fragment>;
      })}
    </Text>
  );
}
const unitLink = (u: OrganisationUnit) => ({
  key: u.unitId,
  label: u.unitLabel,
  node: (
    <Link href={organisationUnitPath(u.unitId)} hasUnderline>
      {u.unitLabel}
    </Link>
  ),
});

function UnitPage({ user, unitId }: { user: SessionUser; unitId: string }) {
  const location = useLocation();
  const tree = useQuery(adminQueries.organisation);
  const units = useMemo(() => tree.data?.units ?? [], [tree.data]);
  const byId = useMemo(() => new Map(units.map(u => [u.unitId, u])), [units]);
  const unit = byId.get(unitId);
  // Every unit the server answers for is in the tree, also one no unit group names, so one that is not does not exist.
  const missing = tree.data !== undefined && !unit;
  const read = useQuery({ ...adminQueries.organisationUnit(unitId), enabled: !!unit });
  useUnitShownForTheWayBack(unitId);
  const title = unit?.unitLabel ?? (missing ? 'Enheten finns inte' : tree.isError ? 'Enheten kunde inte läsas' : null);
  const pending = tree.isPending || (!!unit && read.isPending);
  // A page reached by a link is announced by its heading taking the focus (2.4.3); one the browser loaded starts at
  // its top, as any page does.
  const headingId = useId();
  usePageTitle(title, location.key === 'default' ? (title ?? false) : false);
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || pending || title === null) return;
    arrived.current = true;
    if (location.key !== 'default') document.getElementById(headingId)?.focus();
  }, [pending, title, headingId, location.key]);
  return (
    <AdminShell
      user={user}
      section="organisation"
      crumbs={[{ label: 'Organisation', href: ORGANISATION_PATH }, { label: title ?? 'Enhet' }]}
      pending={pending}
    >
      {unit ? (
        <UnitContent unit={unit} units={units} byId={byId} read={read} headingId={headingId} />
      ) : missing ? (
        <>
          <PageHeader
            title="Enheten finns inte"
            titleId={headingId}
            meta={
              <Text as="p" color="secondary">
                Det finns ingen enhet med den adressen i organisationen. Katalogen kan ha tagit bort den, eller så har
                adressen ändrats.
              </Text>
            }
          />
          <HStack>
            <Button label="Till Organisation" href={ORGANISATION_PATH} />
          </HStack>
        </>
      ) : tree.isError ? (
        <>
          <PageHeader title="Enheten kunde inte läsas" titleId={headingId} />
          <ReadFailed
            error={tree.error}
            fallback="Organisationen kunde inte läsas."
            busy={tree.isFetching}
            retry={() => void tree.refetch()}
          />
        </>
      ) : null}
    </AdminShell>
  );
}

/** A read that failed, with a second try unless the server said no to the person (a try would be told the same). */
function ReadFailed({
  error,
  fallback,
  busy,
  retry,
}: {
  error: unknown;
  fallback: string;
  busy: boolean;
  retry: () => void;
}) {
  const refused = error instanceof ApiError && error.status === 403;
  return (
    <Banner
      status="error"
      collapsible={false}
      title={errorMessage(error, fallback)}
      {...(refused
        ? {}
        : {
            endContent: <Button label="Försök igen" size="sm" variant="secondary" isLoading={busy} onClick={retry} />,
          })}
    />
  );
}

function UnitContent({
  unit,
  units,
  byId,
  read,
  headingId,
}: {
  unit: OrganisationUnit;
  units: OrganisationUnit[];
  byId: ReadonlyMap<string, OrganisationUnit>;
  read: UseQueryResult<OrganisationUnitPeople>;
  headingId: string;
}) {
  const mobile = useMediaQuery(MOBILE);
  const below = childrenOf(units, unit.unitId),
    parent = ancestorsOf(byId, unit.unitId)[0] ?? null,
    lead = unit.line === 'above' ? leadingUnitOf(byId, unit.unitId) : null,
    marks = marksOf(unit, below.length > 0),
    leaderless = unit.line === 'none' && unit.placed > 0;
  // Who leads the unit, by the people read when it is in: then each name leads to the person's page.
  const leaders = read.data?.people.filter(p => p.role === 'manager' && p.enabled);
  const toUsers = (
    <Button
      size="sm"
      variant="secondary"
      label="Till Användare"
      href={`/admin/users?unit=${encodeURIComponent(unit.unitId)}`}
    />
  );
  return (
    <>
      <PageHeader
        title={unit.unitLabel}
        titleId={headingId}
        {...(marks.length
          ? {
              meta: (
                <HStack gap={2} wrap="wrap">
                  {marks.map(m => (
                    <Badge key={m.label} variant={m.variant} label={m.label} />
                  ))}
                </HStack>
              ),
            }
          : {})}
      />
      {(leaderless || !unit.pushed) && (
        <VStack gap={3}>
          {leaderless && (
            <Banner
              status="warning"
              collapsible={false}
              title="Enheten har personer men ingen chef"
              description="Varken enheten eller någon enhet ovanför har en chef, så personerna här rapporterar inte till någon."
              endContent={toUsers}
            />
          )}
          {!unit.pushed && (
            <Banner
              status="warning"
              collapsible={false}
              title="Enheten saknar enhetsgrupp"
              description="Katalogen har fört in personer på enheten men inte enheten själv, så den har varken namn eller plats i trädet."
              endContent={toUsers}
            />
          )}
        </VStack>
      )}
      <MetadataList label={mobile ? { position: 'top' } : { position: 'start', width: 160 }}>
        {unit.managers.length ? (
          <MetadataListItem label={unit.managers.length === 1 ? 'Chef' : 'Chefer'}>
            <Listed
              items={
                leaders?.length
                  ? leaders.map(p => ({ key: p.id, label: p.name, node: <PersonNameLink person={p} /> }))
                  : unit.managers.map(m => ({ key: m.id, label: m.name, node: m.name }))
              }
            />
          </MetadataListItem>
        ) : lead ? (
          <MetadataListItem label="Leds från">
            <Listed items={[unitLink(lead)]} />
          </MetadataListItem>
        ) : (
          <MetadataListItem label="Chef">
            <Text>Ingen chef</Text>
          </MetadataListItem>
        )}
        <MetadataListItem label="Personer">
          <Text>
            {placedLine(unit.placed, read.data?.people.filter(p => !p.enabled).length ?? 0)}
            {unit.branch > unit.placed ? `, ${unit.branch} med enheterna under` : ''}
          </Text>
        </MetadataListItem>
        {parent && (
          <MetadataListItem label="Ingår i">
            <Listed items={[unitLink(parent)]} />
          </MetadataListItem>
        )}
        {below.length > 0 && (
          <MetadataListItem label={below.length === 1 ? 'Enhet under' : 'Enheter under'}>
            <Listed items={below.map(unitLink)} />
          </MetadataListItem>
        )}
      </MetadataList>
      {read.isError ? (
        <ReadFailed
          error={read.error}
          fallback="Personerna kunde inte hämtas."
          busy={read.isFetching}
          retry={() => void read.refetch()}
        />
      ) : read.data && read.data.people.length + read.data.reports.length === 0 ? (
        <Card>
          <EmptyState
            isCompact
            headingLevel={2}
            title="Ingen är placerad på enheten"
            description={
              unit.branch > 0
                ? 'Katalogen har inte fört in någon på just den här enheten, bara på enheterna under den.'
                : 'Katalogen har inte fört in någon på enheten.'
            }
          />
        </Card>
      ) : read.data ? (
        <People unit={unit} read={read.data} mobile={mobile} />
      ) : null}
    </>
  );
}

/** Every group on its first page: what new words and a new page size start from. */
const firstPages = Object.fromEntries(GROUPS.map(key => [pageParam(key), null]));
/**
 * The unit's people: one search over three groups, each with its own heading, rows and pages. The count above says
 * what the search found and is read out when it changes (4.1.3), once the typing has paused.
 */
function People({ unit, read, mobile }: { unit: OrganisationUnit; read: OrganisationUnitPeople; mobile: boolean }) {
  const [params, setParams] = useSearchParams();
  // The address as the last change left it, so two changes in one event build on each other (as on Användare).
  const address = useRef(params);
  address.current = params;
  const paging = pagingOf(params);
  const [typed, setTyped] = useState('');
  const [words, setWords] = useState<string[]>([]);
  const pendingWords = wordsOf(typed).join(' ');
  const show = (change: Record<string, string | number | null>, replace = false) => {
    const next = new URLSearchParams(address.current);
    for (const [name, value] of Object.entries(change))
      if (value === null || value === 1) next.delete(name);
      else next.set(name, String(value));
    if (next.toString() === address.current.toString()) return;
    address.current = next;
    setParams(next, { replace });
  };
  // New words start every group from its first page; the pages left behind were pages of other rows, so the step
  // replaces the address rather than adding one Back would have to undo.
  const ask = useRef((_typed: string) => {});
  ask.current = value => {
    setWords(wordsOf(value));
    show(firstPages, true);
  };
  useEffect(() => {
    if (pendingWords === words.join(' ')) return;
    const timer = setTimeout(() => ask.current(pendingWords), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [pendingWords, words]);
  const groups = groupsOf(read, words);
  const all = groups.reduce((n, g) => n + g.all.length, 0),
    found = groups.reduce((n, g) => n + g.shown.length, 0);
  const searchBox = useRef<HTMLInputElement>(null);
  const clear = () => {
    setTyped('');
    ask.current('');
    searchBox.current?.focus();
  };
  return (
    <Card padding={0}>
      <Section variant="transparent" padding={3}>
        <HStack gap={3} wrap="wrap" vAlign="center">
          <HStack role="search" aria-label={`Sök bland personerna på ${unit.unitLabel}`} width={mobile ? '100%' : 280}>
            <TextInput
              label="Sök person"
              isLabelHidden
              type="search"
              size="sm"
              width="100%"
              placeholder="Namn, användarnamn, roll, e-post"
              startIcon="search"
              hasClear
              value={typed}
              onChange={setTyped}
              ref={searchBox}
            />
          </HStack>
          {/* What the search found, read out when it changes (4.1.3); nothing while nothing is searched for. */}
          <Text type="supporting" role="status">
            {words.length ? `${shownOf(found, all)} matchar sökningen` : ''}
          </Text>
        </HStack>
      </Section>
      {found === 0 ? (
        <EmptyState
          isCompact
          headingLevel={2}
          title="Inga personer matchar"
          description="Ingen på enheten eller under den stämmer med sökningen."
          actions={<Button size="sm" label="Rensa sökningen" onClick={clear} />}
        />
      ) : (
        groups
          .filter(g => g.shown.length > 0)
          .map(g => (
            <Group
              key={g.key}
              group={g}
              unitLabel={unit.unitLabel}
              mobile={mobile}
              page={paging.pages[g.key]}
              size={paging.size}
              onPage={page => show({ [pageParam(g.key)]: page })}
              onSize={size => show({ size: size === USERS_PAGE_SIZES[0] ? null : size, ...firstPages })}
            />
          ))
      )}
    </Card>
  );
}

interface Row extends Record<string, unknown> {
  id: string;
  p: StaffPerson;
}
const columns = [
  {
    key: 'person',
    header: 'Person',
    width: proportional(2, { minWidth: 220 }),
    renderCell: (r: Row) => (
      <VStack gap={0} hAlign="start">
        <HStack gap={2} vAlign="center" wrap="wrap">
          <PersonNameLink person={r.p} />
          {!r.p.enabled && <Badge variant="neutral" label="Avstängd" />}
        </HStack>
        <Text type="code" color="secondary">
          {r.p.userName ?? r.p.id}
        </Text>
      </VStack>
    ),
  },
  {
    key: 'role',
    header: 'Roll',
    width: proportional(2, { minWidth: 160 }),
    renderCell: (r: Row) => <Text>{roleText(r.p)}</Text>,
  },
  {
    key: 'email',
    header: 'E-post',
    width: proportional(2, { minWidth: 200 }),
    renderCell: (r: Row) => (r.p.email ? <Text>{r.p.email}</Text> : <Text color="secondary">Ingen e-post</Text>),
  },
];

/**
 * One group: its heading with how many it holds (and how many of them the search found), the note that says what it
 * is when that is not plain, its rows, and its pages when it holds more than one. The rows are named by the heading.
 * A step to another page is taken at the foot of the rows and read from their head, so the heading comes into view
 * while the focus stays on the pager, where the next step is taken.
 */
function Group({
  group,
  unitLabel,
  mobile,
  page,
  size,
  onPage,
  onSize,
}: {
  group: PeopleGroup;
  unitLabel: string;
  mobile: boolean;
  page: number;
  size: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}) {
  const headingId = useId();
  const head = useRef<HTMLDivElement>(null);
  const shown = pageOf(group.shown, page, size);
  const turn = (next: number) => {
    onPage(next);
    head.current?.scrollIntoView({ block: 'start' });
  };
  return (
    <>
      <Section variant="transparent" padding={3} dividers={['top']}>
        <VStack gap={0} ref={head}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Heading id={headingId} level={3} accessibilityLevel={2}>
              {group.heading}
            </Heading>
            <Text color="secondary">{shownOf(group.shown.length, group.all.length)}</Text>
          </HStack>
          {group.note && <Text type="supporting">{group.note}</Text>}
        </VStack>
      </Section>
      {mobile ? (
        <List aria-label={`${group.heading} · ${unitLabel}`} hasDividers>
          {shown.rows.map(p => (
            <ListItem
              key={p.id}
              label={<PersonNameLink person={p} />}
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
      ) : (
        <Table<Row>
          aria-labelledby={headingId}
          data={shown.rows.map(p => ({ id: p.id, p }))}
          idKey="id"
          columns={columns}
          density="balanced"
          hasHover
          rowIndexStart={shown.first}
          rowCount={group.shown.length}
        />
      )}
      {group.shown.length > USERS_PAGE_SIZES[0] && (
        <Section variant="transparent" padding={3}>
          <HStack justify="center">
            <Pagination
              label={`Sidor: ${group.heading}`}
              size="sm"
              variant={mobile ? 'compact' : 'pages'}
              page={shown.page}
              totalItems={group.shown.length}
              pageSize={size}
              onChange={turn}
              {...(mobile ? {} : { pageSizeOptions: [...USERS_PAGE_SIZES], onPageSizeChange: onSize })}
            />
          </HStack>
        </Section>
      )}
    </>
  );
}
