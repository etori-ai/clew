import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { OrganisationPerson, OrganisationUnit, SessionUser, StaffPerson } from '@clew/contracts';
import {
  Avatar,
  AvatarGroup,
  AvatarGroupOverflow,
  Badge,
  Banner,
  BottomSheet,
  Button,
  Card,
  ClickableCard,
  Drawer,
  EmptyState,
  Heading,
  HStack,
  Icon,
  IconButton,
  Layout,
  LayoutContent,
  LayoutHeader,
  Link,
  List,
  ListItem,
  StackItem,
  Text,
  TreeList,
  VisuallyHidden,
  VStack,
  useAnnounce,
  useMediaQuery,
  type TreeListItemData,
} from '@clew/ui';
import { ApiError } from '../../api';
import { DOT } from '../../dot';
import { PersonNameLink } from '../../components/people/person-name-link';
import { adminQueries } from '../../queries';
import { errorMessage } from '../../query-policy';
import { usePageTitle } from '../../page-title';
import { AsyncContent, ContentSkeleton } from '../../components/shell/loading';
import { mobileQuery, shortQuery } from '../../components/shell/shell';
import { AdminShell } from './shell';

/**
 * "Organisation" (D99, D124): the organisation tree as the catalogue pushed it, read only, as Användare is. Each unit is
 * a row of an Astryx `TreeList` under the unit above it, with who leads it as avatars and a mark for what an import left
 * wrong. On a wide screen the tree is a ledger: the unit's own count and its branch's stand in a column at the row's end,
 * in words, so the sizes are read down the tree; a phone keeps them in the sentence under the name. What a push left
 * wrong is one card above the tree, "Att rätta i katalogen", a row per problem: people with no unit, people who report
 * to nobody, units with people that nobody leads, units people are on that the catalogue never named. The units it
 * names open the overlay.
 *
 * Three facts are kept apart (D147): a person is placed on a unit, a person leads a unit, and a person reports to the
 * people their employments name. The tree shows the first two. Whom a person reports to is said on the person's own row
 * in the overlay and is never read from the tree, so a unit without managers is led by nobody, whatever stands above it.
 *
 * A row opens the unit as a focused overlay over the tree (D83): an end `Drawer` on a desktop, a `BottomSheet` on a
 * phone, at `/admin/organisation?unit=<unitId>`. The overlay is walked (D124 items 1 to 3): "Ingår i …" steps to the
 * unit above, a unit listed under "Enheter under" steps down and a unit named in "Rapporterar till …" steps to it
 * wherever it stands in the tree, each without closing the overlay and without a new entry in the history, so Back
 * still closes it. It walks before it lists: the step up, the status line, who leads the unit, who reports to them from
 * other units, the units below that no reporting row names, and last the others placed on the unit. A step moves the
 * focus to the unit's heading and says "Visar <enhet>". Closing gives the focus back to what opened the overlay when no
 * step was taken; after a step it goes to the tree's row for the unit shown, with the tree open down to it.
 *
 * Nothing here is edited: the tree is the catalogue's, and the page shows what the last import made of it. A unit the
 * server says does not exist (400) is said so without a retry, which cannot help; while a unit is not known, by the tree
 * or by its own read, the overlay is named for "Enheten", so a read that failed for another reason is never taken for a
 * unit that is gone.
 */
const PATH = '/admin/organisation';
const UNIT_PARAM = 'unit';
const PEOPLE_WIDTH = 480;
/** The ledger's count column: wide enough for "250 med enheterna under" on one line. */
const COUNTS_WIDTH = 176;
/** The problem card's first column, as wide as its longest mark ("Saknar enhetsgrupp"). */
const MARK_WIDTH = 136;
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
/** A press that the browser should keep for itself: a new tab, a new window, a download. */
const leavesThePage = (e: MouseEvent) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
/** The units above a unit, nearest first; the walk ends at a root, and at the tree's size if a chain were ever a ring. */
const ancestorsOf = (units: ReadonlyMap<string, OrganisationUnit>, unitId: string | null) => {
  const above: OrganisationUnit[] = [];
  for (let at = unitId ? units.get(unitId) : undefined; at?.parentId && above.length < units.size;) {
    at = units.get(at.parentId);
    if (at) above.push(at);
  }
  return above;
};
/** "Chef: Karin Berg", "Chefer: Karin Berg och Omar Ali": managers by name, as a unit's row and a person's row say it. */
const managersText = (managers: ReadonlyArray<{ name: string }>) =>
  `${managers.length === 1 ? 'Chef' : 'Chefer'}: ${names.format(managers.map(m => m.name))}`;
/** Who leads the unit: its own managers or nobody. The tree passes no line on from the unit above (D147). */
const ledBy = (u: OrganisationUnit) => (u.managers.length ? managersText(u.managers) : 'Ingen chef');
/**
 * Whom a person placed on a unit reports to, as their row says it (D147): the active people their employments name, or
 * why nobody. The words say the gap, so no colour has to. A deactivated person reports to nobody anyway and has no line.
 */
const reportsTo = (p: OrganisationPerson) => {
  if (!p.enabled) return null;
  if (p.gap === 'none') return 'Ingen chef angiven';
  if (p.gap === 'inactive') return 'Chefen är avstängd';
  // Each names the other as manager, so neither is the other's: the row names whom the ring is with.
  if (p.gap === 'round') return `Rapporterar i cirkel med ${names.format((p.circle ?? []).map(m => m.name))}`;
  return p.managers.length ? managersText(p.managers) : null;
};
/** "86 med enheterna under": the unit's branch, said only where it holds more than the unit itself. */
const branchOf = (u: OrganisationUnit) => (u.branch > u.placed ? `${u.branch} med enheterna under` : null);
/** "Chef: Karin Berg · 2 personer, 86 med enheterna under": who leads the unit and how many it holds, as one line. */
const describe = (u: OrganisationUnit) => {
  const branch = branchOf(u);
  return `${ledBy(u)}${DOT}${people(u.placed)}${branch ? `, ${branch}` : ''}`;
};
/**
 * The unit's managers as avatars; a unit nobody leads has the plain figure, so the names line up down the tree. The
 * avatars are for the eye: the row's own text names the managers, so a screen reader is not told them twice and the
 * initials are not words a person would expect in the row's name. 24 px in the tree, 36 px in a two-line row of the
 * overlay (D124 item 10).
 */
const leaders = (u: OrganisationUnit, size: 'sm' | 'md' = 'sm') =>
  u.managers.length > 1 ? (
    <AvatarGroup size={size} aria-hidden>
      {u.managers.slice(0, 2).map(m => (
        <Avatar key={m.id} name={m.name} tooltip={false} aria-hidden />
      ))}
      {u.managers.length > 2 && <AvatarGroupOverflow count={u.managers.length - 2} />}
    </AvatarGroup>
  ) : (
    <Avatar size={size} tooltip={false} aria-hidden {...(u.managers[0] ? { name: u.managers[0].name } : {})} />
  );
/**
 * What an import left wrong on a unit, as the tree marks it. A unit with units under it may well be empty. "Saknar chef"
 * is said of the unit, which has people and nobody who leads it; "2 personer utan chef" of the people placed on it who report to
 * nobody (D147). The two are different facts, and a unit may have either without the other.
 */
const marksOf = (u: OrganisationUnit, hasBelow: boolean) => [
  ...(!u.pushed ? [{ label: 'Saknar enhetsgrupp', variant: 'warning' as const }] : []),
  ...(u.line === 'none' && u.placed > 0 ? [{ label: 'Saknar chef', variant: 'warning' as const }] : []),
  ...(u.unmanaged > 0 ? [{ label: `${people(u.unmanaged)} utan chef`, variant: 'warning' as const }] : []),
  ...(u.placed === 0 && !hasBelow ? [{ label: 'Tom', variant: 'neutral' as const }] : []),
];
/** Swedish list punctuation between nodes: "A", "A och B", "A, B och C". */
const listed = (nodes: ReactNode[]) => {
  let at = 0;
  return names
    .formatToParts(nodes.map((_, i) => String(i)))
    .map((part, i) => (part.type === 'element' ? <span key={i}>{nodes[at++]}</span> : part.value));
};
/** A comma only assistive technology reads, so a row's parts are heard as one sentence and not as one long word. */
const pause = <VisuallyHidden>, </VisuallyHidden>;

export function AdminOrganisationPage({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const query = useQuery(adminQueries.organisation);
  usePageTitle('Organisation');
  const mobile = useMediaQuery(mobileQuery);
  const selected = unitOf(search);
  const units = useMemo(() => query.data?.units ?? [], [query.data]);
  const error = query.isError ? errorMessage(query.error, 'Organisationen kunde inte läsas.') : null;
  const tree = useRef<HTMLDivElement>(null);
  // The units the address has asked to have open: every unit above one it named. Kept once shown, so the tree does not
  // fold a branch away under the person when the overlay closes; what they fold or open themselves is the tree's own.
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  const byId = useMemo(() => new Map(units.map(u => [u.unitId, u])), [units]);
  const below = useMemo(() => {
    const kids = new Map<string | null, OrganisationUnit[]>();
    for (const u of units) kids.set(u.parentId, [...(kids.get(u.parentId) ?? []), u]);
    return kids;
  }, [units]);
  const above = ancestorsOf(byId, selected).map(u => u.unitId);
  if (above.some(id => !shown.has(id))) setShown(new Set([...shown, ...above]));
  const items = useMemo(() => {
    // Open from the start: the roots, so the level under each is read without a click.
    const open = new Set([...(below.get(null) ?? []).map(u => u.unitId), ...shown]);
    const item = (u: OrganisationUnit): TreeListItemData => {
      const kids = below.get(u.unitId) ?? [],
        marks = marksOf(u, kids.length > 0),
        branch = branchOf(u),
        href = unitHref(u.unitId, search);
      const name = (
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Text weight="semibold">{u.unitLabel}</Text>
          {marks.map(m => (
            <Badge key={m.label} variant={m.variant} label={m.label} />
          ))}
        </HStack>
      );
      return {
        id: u.unitId,
        // One label holds the name, who leads the unit, how many it holds and what is wrong with it: the row is named
        // by its label, so a screen reader says all of it and every word a person sees on the row is in the row's name
        // (2.5.3). A phone keeps the counts in the sentence under the name; a wider screen has them in a column of
        // their own at the row's end, the same width on every level, so they stand under each other down the tree.
        label: mobile ? (
          <VStack gap={0} hAlign="start">
            {name}
            <Text type="supporting">{describe(u)}</Text>
          </VStack>
        ) : (
          <HStack gap={4} vAlign="center">
            <StackItem size="fill">
              <VStack gap={0} hAlign="start">
                {name}
                <Text type="supporting">
                  {pause}
                  {ledBy(u)}
                </Text>
              </VStack>
            </StackItem>
            <VStack gap={0} hAlign="end" width={COUNTS_WIDTH}>
              <Text type="label" justify="end" hasTabularNumbers {...(u.placed ? {} : { color: 'secondary' as const })}>
                {pause}
                {people(u.placed)}
              </Text>
              {branch && (
                <Text type="supporting" justify="end" hasTabularNumbers>
                  {pause}
                  {branch}
                </Text>
              )}
            </VStack>
          </HStack>
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
  }, [below, selected, shown, search, navigate, mobile]);
  const leaderless = units.filter(u => u.line === 'none' && u.placed > 0),
    unnamed = units.filter(u => !u.pushed),
    unplaced = query.data?.unplaced ?? 0,
    // D147: how many people report to nobody, each once, and the units that hold them.
    unmanaged = query.data?.unmanaged ?? 0,
    gapped = units.filter(u => u.unmanaged > 0);
  /** Where the focus goes when the overlay closes and nothing opened it: the unit's own row, else the tree's first. */
  const focusTree = useCallback(() => {
    const rows = tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]');
    (tree.current?.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]') ?? rows?.[0])?.focus();
  }, []);
  // The tree's row for a unit, where the focus goes when the overlay closes after a step (D124 item 3). The units above
  // it are already asked to be open (`shown`), and the tree follows unless the person folded one of them by hand: that
  // choice is the tree's own and outlives what the page asks for, so the tree is then drawn anew, open down to the row.
  const [redrawn, setRedrawn] = useState(0);
  const standing = useRef<string | null>(null);
  const rowOf = (unitId: string) =>
    tree.current?.querySelector<HTMLElement>(`[role="treeitem"][data-tree-id="${CSS.escape(unitId)}"]`);
  const focusUnit = useCallback((unitId: string) => {
    const row = rowOf(unitId);
    if (row) return row.focus();
    standing.current = unitId;
    setRedrawn(n => n + 1);
  }, []);
  useEffect(() => {
    const unitId = standing.current;
    if (!unitId) return;
    standing.current = null;
    (rowOf(unitId) ?? tree.current?.querySelector<HTMLElement>('[role="treeitem"]'))?.focus();
  }, [redrawn]);
  /** A unit named in the problems card opens the overlay, as its row in the tree does, and is the overlay's opener. */
  const unitLink = (u: OrganisationUnit) => {
    const href = unitHref(u.unitId, search);
    return (
      <Link
        href={href}
        weight="semibold"
        hasUnderline
        onClick={(e: MouseEvent) => {
          if (leavesThePage(e)) return;
          e.preventDefault();
          navigate(href);
        }}
      >
        {u.unitLabel}
      </Link>
    );
  };
  const problems: Array<{ mark: string; title: ReactNode; text: string; action?: ReactNode }> = [
    ...(unplaced > 0
      ? [
          {
            mark: 'Ingen åtkomst',
            title: `${people(unplaced)} saknar enhet`,
            text: 'De finns i Clew men kommer inte åt något förrän katalogen har placerat dem på en enhet.',
            action: (
              <Button size="sm" variant="secondary" label="Till Användare" href="/admin/users?status=no-access" />
            ),
          },
        ]
      : []),
    ...(unmanaged > 0
      ? [
          {
            mark: 'Utan chef',
            title: (
              <>
                {`${people(unmanaged)} på ${gapped.length} ${gapped.length === 1 ? 'enhet' : 'enheter'} har ingen chef: `}
                {listed(gapped.map(unitLink))}
              </>
            ),
            text: 'Katalogen anger ingen aktiv chef på deras anställningar, så de står inte på någons lista i Personal och ingen kan agera som deras chef. Rätta chefen på anställningen i katalogen.',
          },
        ]
      : []),
    ...(leaderless.length > 0
      ? [
          {
            mark: 'Saknar chef',
            title: (
              <>
                {`${leaderless.length} ${leaderless.length === 1 ? 'enhet har' : 'enheter har'} personer men ingen chef: `}
                {listed(leaderless.map(unitLink))}
              </>
            ),
            text: 'Ingen leder enheten. Personerna där kan ändå ha en chef: vem de rapporterar till anges på deras anställningar.',
          },
        ]
      : []),
    ...(unnamed.length > 0
      ? [
          {
            mark: 'Saknar enhetsgrupp',
            title: (
              <>
                {`${unnamed.length} ${unnamed.length === 1 ? 'enhet saknar' : 'enheter saknar'} enhetsgrupp: `}
                {listed(unnamed.map(unitLink))}
              </>
            ),
            text: 'Katalogen har fört in personer på enheten men inte enheten själv, så den har varken namn eller plats i trädet.',
          },
        ]
      : []),
  ];
  const problemsId = useId(),
    unitsId = useId();
  return (
    <AdminShell
      user={user}
      section="organisation"
      title="Organisation"
      meta={
        <Text as="p" type="supporting" color="secondary">
          Enheterna som katalogen har fört in, som de hänger ihop, med vem som leder varje enhet och hur många som finns
          på den. Trädet ändras i katalogen; här ser du vad den senaste inläsningen gav.
        </Text>
      }
      pending={query.isPending}
    >
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      {problems.length > 0 && (
        <VStack as="section" gap={3} aria-labelledby={problemsId}>
          <Heading level={3} accessibilityLevel={2} id={problemsId}>
            Att rätta i katalogen
          </Heading>
          <Card padding={0}>
            <List aria-labelledby={problemsId} hasDividers>
              {problems.map(p => {
                const mark = <Badge variant="warning" label={p.mark} />;
                // A phone has the mark over the words and the way on under them; a wider row has three columns.
                return mobile ? (
                  <ListItem
                    key={p.mark}
                    label={
                      <VStack gap={1} hAlign="start">
                        {mark}
                        <Text weight="semibold">{p.title}</Text>
                      </VStack>
                    }
                    description={
                      <VStack gap={2} hAlign="start">
                        <Text type="supporting">{p.text}</Text>
                        {p.action}
                      </VStack>
                    }
                  />
                ) : (
                  <ListItem
                    key={p.mark}
                    startContent={<HStack width={MARK_WIDTH}>{mark}</HStack>}
                    label={<Text weight="semibold">{p.title}</Text>}
                    description={<Text type="supporting">{p.text}</Text>}
                    endContent={p.action}
                  />
                );
              })}
            </List>
          </Card>
        </VStack>
      )}
      {query.data && (
        <VStack as="section" gap={3} aria-labelledby={unitsId}>
          <VStack gap={1}>
            <HStack gap={4} vAlign="center" justify="between" wrap="wrap">
              <Heading level={3} accessibilityLevel={2} id={unitsId}>
                Enheter
              </Heading>
              {units.length > 0 && (
                <Text color="secondary" role="status">
                  {units.length} {units.length === 1 ? 'enhet' : 'enheter'}
                </Text>
              )}
            </HStack>
            {units.length > 0 && <Text type="supporting">Välj en enhet för att se vilka som är placerade på den.</Text>}
          </VStack>
          {units.length === 0 ? (
            <Card>
              <EmptyState
                isCompact
                headingLevel={3}
                title="Ingen organisation ännu"
                description="Katalogen har inte fört in några enheter. När provisionern har kört visas trädet här."
              />
            </Card>
          ) : (
            <Card padding={2}>
              <TreeList key={redrawn} ref={tree} aria-label="Organisationsträd" items={items} />
            </Card>
          )}
        </VStack>
      )}
      <UnitPeople
        units={byId}
        below={below}
        settled={query.data !== undefined || query.isError}
        focusBack={focusTree}
        focusUnit={focusUnit}
      />
    </AdminShell>
  );
}

/**
 * The unit the address names, over the tree. The unit shown is kept while the overlay slides away, so its content does
 * not blank mid-exit. Closing (✕, Esc) replaces the address with the tree's own. With no step taken Astryx gives the
 * focus back to what opened the overlay (a row of the tree, a unit named in the problems card), and after a reload, when
 * nothing did, the tree takes it. After a step the opener may be another unit's row, far from where the person now
 * stands, so the focus goes to the row of the unit shown (`focusUnit`, the one exception to rule 7 of the
 * interface-space rules, D124 item 3).
 */
function UnitPeople({
  units,
  below,
  settled,
  focusBack,
  focusUnit,
}: {
  units: ReadonlyMap<string, OrganisationUnit>;
  below: ReadonlyMap<string | null, OrganisationUnit[]>;
  settled: boolean;
  focusBack: () => void;
  focusUnit: (unitId: string) => void;
}) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const mobile = useMediaQuery(mobileQuery);
  const unitId = unitOf(search);
  const [shownId, setShownId] = useState<string | null>(unitId);
  if (unitId && unitId !== shownId) setShownId(unitId);
  const known = shownId ? units.get(shownId)?.unitLabel : undefined;
  // The unit's own read names it when the tree does not; the sheet tells the overlay, which is named for it.
  const [read, setRead] = useState<{ unitId: string; label: string } | null>(null);
  const named = known ?? (read && read.unitId === shownId ? read.label : undefined);
  const onOpenChange = (open: boolean) => {
    if (!open) navigate(withoutUnit(search), { replace: true });
  };
  // Whether a step was taken while the overlay has been open, and the unit it shows now.
  const walked = useRef(false);
  const step = (to: string) => {
    walked.current = true;
    navigate(unitHref(to, search), { replace: true });
  };
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const sheetPanel = useCallback((panel: HTMLDivElement | null) => setDialog(panel?.closest('dialog') ?? null), []);
  const openRef = useRef(unitId);
  openRef.current = unitId;
  const shownRef = useRef(shownId);
  shownRef.current = shownId;
  const focusRef = useRef({ focusBack, focusUnit });
  focusRef.current = { focusBack, focusUnit };
  useEffect(() => {
    if (!dialog) return;
    const closed = () => {
      const stood = walked.current ? shownRef.current : null;
      walked.current = false;
      if (!openRef.current) setShownId(null);
      requestAnimationFrame(() => {
        if (stood) return focusRef.current.focusUnit(stood);
        const active = document.activeElement;
        if (!active || active === document.body) focusRef.current.focusBack();
      });
    };
    dialog.addEventListener('close', closed);
    return () => dialog.removeEventListener('close', closed);
  }, [dialog]);
  const body = shownId ? (
    <UnitSheet
      unitId={shownId}
      units={units}
      below={below}
      onStep={step}
      onClose={() => onOpenChange(false)}
      onRead={setRead}
    />
  ) : null;
  const isOpen = !!unitId && settled;
  const label = named ? `Personer på ${named}` : 'Personer på enheten';
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

/** A group's heading in the overlay, with how many it holds at the end of its line. */
function GroupHeading({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <HStack gap={2} vAlign="center" justify="between">
      <Heading level={3} id={id}>
        {title}
      </Heading>
      {/* For the eye only: the list under the heading says how many rows it has. */}
      <Text type="supporting" hasTabularNumbers aria-hidden>
        {count}
      </Text>
    </HStack>
  );
}

/**
 * One group of people in the overlay: its heading and count, a line about what it holds when one is needed, and the
 * people as a list named by the heading and the unit. Rank shows by size (D124 item 2): the unit's own leaders at 48 px
 * with whom they report to and the e-mail under the name, the people who report to them from other units at 36 px with
 * the unit they lead as the step to it, the others at 24 px with whom they report to (D147). No row draws a user name.
 * A group nobody is in is not drawn.
 */
function PeopleGroup<P extends StaffPerson>({
  title,
  unitLabel,
  members,
  size,
  note,
  line,
  flag,
}: {
  title: string;
  unitLabel: string;
  members: P[];
  size: 'sm' | 'md' | 'lg';
  note?: string;
  /** The line under a name; a person it says nothing of has a row of one line. */
  line?: (p: P) => ReactNode;
  /** A warning at the row's end for an active person, so the few it is said of are found without reading every line. */
  flag?: (p: P) => string | undefined;
}) {
  const id = useId();
  if (members.length === 0) return null;
  return (
    <VStack as="section" gap={1} aria-labelledby={id}>
      <GroupHeading id={id} title={title} count={members.length} />
      {note && <Text type="supporting">{note}</Text>}
      <List aria-label={`${title}${DOT}${unitLabel}`} hasDividers edge="flush">
        {members.map(p => {
          const under = line?.(p),
            flagged = p.enabled ? flag?.(p) : undefined;
          return (
            <ListItem
              key={p.id}
              startContent={<Avatar name={p.name} size={size} tooltip={false} aria-hidden />}
              label={<PersonNameLink person={p} />}
              {...(under
                ? {
                    // A step under the name: the line may hold a link of its own (the unit a person leads), and two
                    // links one over the other need that much between them to be targets of their own (2.5.8).
                    description: (
                      <VStack paddingBlockStart={1}>
                        <Text type="supporting">{under}</Text>
                      </VStack>
                    ),
                  }
                : {})}
              endContent={
                !p.enabled ? (
                  <Badge variant="neutral" label="Avstängd" />
                ) : flagged ? (
                  <Badge variant="warning" label={flagged} />
                ) : undefined
              }
            />
          );
        })}
      </List>
    </VStack>
  );
}

/**
 * What the overlay holds about one unit, in the order it is walked (D124 item 2). It is drawn inside the overlay, so
 * what it announces is heard there: a modal hides the page's own live region.
 */
function UnitSheet({
  unitId,
  units,
  below,
  onStep,
  onClose,
  onRead,
}: {
  unitId: string;
  units: ReadonlyMap<string, OrganisationUnit>;
  below: ReadonlyMap<string | null, OrganisationUnit[]>;
  onStep: (unitId: string) => void;
  onClose: () => void;
  onRead: (read: { unitId: string; label: string }) => void;
}) {
  const [search] = useSearchParams();
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const announce = useAnnounce();
  const query = useQuery(adminQueries.organisationUnit(unitId));
  const unit = units.get(unitId);
  const readLabel = query.data?.unitLabel;
  useEffect(() => {
    if (readLabel) onRead({ unitId, label: readLabel });
  }, [unitId, readLabel, onRead]);
  const title = unit?.unitLabel ?? readLabel ?? 'Enheten';
  // The server's answer for a unit that is not there; another failure may pass, and is offered again.
  const gone = query.error instanceof ApiError && query.error.status === 400;
  // The units above, outermost first: where in the organisation the unit is.
  const path = ancestorsOf(units, unitId)
    .map(u => u.unitLabel)
    .reverse();
  const parent = unit?.parentId ? units.get(unit.parentId) : undefined;
  // A step shows another unit in the same overlay: its heading takes the focus and the unit is said aloud, since
  // nothing else tells a screen reader that what it was reading has been replaced.
  const heading = useRef<HTMLHeadingElement>(null);
  const stepping = useRef(false);
  const go = (to: string) => (e: MouseEvent) => {
    if (leavesThePage(e)) return;
    e.preventDefault();
    stepping.current = true;
    onStep(to);
  };
  useEffect(() => {
    if (!stepping.current) return;
    stepping.current = false;
    heading.current?.focus();
    announce(`Visar ${title}`);
    // Only a step to another unit runs this: the title follows the unit, and is read as it is then.
  }, [unitId]);
  const stepLink = (to: { unitId: string; unitLabel: string }) => (
    <Link href={unitHref(to.unitId, search)} type="supporting" color="primary" hasUnderline onClick={go(to.unitId)}>
      {to.unitLabel}
    </Link>
  );
  const placed = query.data?.people ?? [];
  const reports = query.data?.reports ?? [];
  // Counted as the tree's row counts them: deactivated people are listed, with their mark, but are not among the
  // placed, and neither is someone who leads the unit and is employed on another (D149).
  const belonging = placed.filter(p => !p.elsewhere),
    off = belonging.filter(p => !p.enabled).length;
  const leading = placed.filter(p => p.role === 'manager'),
    others = placed.filter(p => p.role !== 'manager'),
    leadingNames = leading.filter(p => p.enabled).map(p => p.name);
  // The units below that no reporting row names. A reporting row names the units its person leads or is employed on,
  // wherever they stand in the tree (D147); where one of them is a unit below, that row is the step down to it.
  const stepped = new Set(reports.flatMap(p => (p.below ?? []).map(b => b.unitId)));
  const under = (below.get(unitId) ?? []).filter(u => !stepped.has(u.unitId));
  const marks = unit ? marksOf(unit, (below.get(unitId) ?? []).length > 0).filter(m => m.variant === 'warning') : [];
  const note = !unit
    ? null
    : !unit.pushed
      ? 'Katalogen har fört in personer på enheten men inte enheten själv, så den har varken namn eller plats i trädet.'
      : unit.line === 'none' && unit.placed > 0
        ? 'Ingen leder enheten. Personerna här kan ändå ha en chef: vem de rapporterar till anges på deras anställningar.'
        : null;
  const underId = useId();
  const header = (
    <LayoutHeader>
      <VStack gap={1}>
        <HStack justify="between" vAlign="center" gap={2}>
          <StackItem size="fill">
            {/* Inline, so the ring the focus draws is around the words and not the header's width. */}
            <Heading level={2} display="inline" ref={heading} tabIndex={-1} data-autofocus>
              {title}
            </Heading>
          </StackItem>
          <IconButton variant="ghost" label="Stäng" icon={<Icon icon="close" />} onClick={onClose} />
        </HStack>
        {path.length > 0 && <Text type="supporting">{path.join(' › ')}</Text>}
      </VStack>
    </LayoutHeader>
  );
  const up = parent && (
    <ClickableCard
      // The name holds every word the card shows (2.5.3).
      label={`Ingår i ${parent.unitLabel}, ${ledBy(parent)}`}
      variant="muted"
      padding={2}
      onClick={go(parent.unitId)}
    >
      <HStack gap={2} vAlign="center">
        {leaders(parent, 'md')}
        <StackItem size="fill">
          <VStack gap={0}>
            <Text>
              <Text color="secondary">Ingår i </Text>
              <Text weight="semibold">{parent.unitLabel}</Text>
            </Text>
            <Text type="supporting">{ledBy(parent)}</Text>
          </VStack>
        </StackItem>
        <Icon icon="chevronRight" color="secondary" />
      </HStack>
    </ClickableCard>
  );
  const content = (
    <VStack gap={5}>
      {up}
      {query.isError ? (
        <Banner
          status="error"
          collapsible={false}
          title={errorMessage(query.error, 'Personerna kunde inte hämtas.')}
          endContent={
            gone ? undefined : (
              <Button
                label="Försök igen"
                size="sm"
                variant="secondary"
                isLoading={query.isFetching}
                onClick={() => void query.refetch()}
              />
            )
          }
        />
      ) : (
        <AsyncContent pending={query.isPending} fallback={<ContentSkeleton heading={false} />} gap={5}>
          {(placed.length > 0 || note) && (
            <VStack gap={1}>
              {placed.length > 0 && (
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Text color="secondary" role="status">
                    {`${people(belonging.length - off)} på enheten${off ? ` och ${off} ${off === 1 ? 'avstängd' : 'avstängda'}` : ''}`}
                  </Text>
                  {marks.map(m => (
                    <Badge key={m.label} variant={m.variant} label={m.label} />
                  ))}
                </HStack>
              )}
              {note && <Text type="supporting">{note}</Text>}
            </VStack>
          )}
          {placed.length === 0 && (
            <EmptyState
              isCompact
              headingLevel={3}
              title="Ingen är placerad på enheten"
              description="Katalogen har inte fört in någon på just den här enheten. Personerna kan finnas på enheterna under den."
            />
          )}
          <PeopleGroup
            title={leading.length === 1 ? 'Chef' : 'Chefer'}
            unitLabel={title}
            members={leading}
            size="lg"
            line={p =>
              [p.elsewhere ? 'Anställd på en annan enhet' : null, reportsTo(p), p.email].filter(Boolean).join(DOT)
            }
            flag={p => (p.gap ? 'Utan chef' : undefined)}
          />
          <PeopleGroup
            title={`Rapporterar till ${names.format(leadingNames)}`}
            unitLabel={title}
            members={reports}
            size="md"
            note={`Personer på andra enheter som enligt sin anställning rapporterar till ${leadingNames.length === 1 ? 'enhetens chef' : 'någon av enhetens chefer'}.`}
            line={p => {
              const led = (p.below ?? []).filter(b => b.role === 'manager'),
                steps = led.length ? led : (p.below ?? []);
              return (
                <>
                  {steps.length > 0 && (led.length ? 'Chef för ' : 'Medarbetare på ')}
                  {listed(steps.map(stepLink))}
                  {p.email ? `${steps.length ? DOT : ''}${p.email}` : ''}
                </>
              );
            }}
          />
          {under.length > 0 && (
            <VStack as="section" gap={1} aria-labelledby={underId}>
              <GroupHeading id={underId} title="Enheter under" count={under.length} />
              <List aria-label={`Enheter under${DOT}${title}`} edge="flush">
                {under.map(u => (
                  <ListItem
                    key={u.unitId}
                    startContent={leaders(u, 'md')}
                    label={
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        <Text weight="semibold">{u.unitLabel}</Text>
                        {marksOf(u, (below.get(u.unitId) ?? []).length > 0).map(m => (
                          <Badge key={m.label} variant={m.variant} label={m.label} />
                        ))}
                      </HStack>
                    }
                    description={<Text type="supporting">{describe(u)}</Text>}
                    endContent={<Icon icon="chevronRight" color="secondary" />}
                    onClick={go(u.unitId)}
                  />
                ))}
              </List>
            </VStack>
          )}
          <PeopleGroup
            title="Medarbetare"
            unitLabel={title}
            members={others}
            size="sm"
            line={reportsTo}
            flag={p => (p.gap ? 'Utan chef' : undefined)}
          />
        </AsyncContent>
      )}
    </VStack>
  );
  return (
    <Layout
      height={short ? 'auto' : 'fill'}
      header={header}
      // Drawn anew for each unit, so a step starts at the top of the unit it leads to.
      content={<LayoutContent key={unitId}>{content}</LayoutContent>}
    />
  );
}
