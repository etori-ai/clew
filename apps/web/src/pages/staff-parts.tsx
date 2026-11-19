import { Fragment, useCallback, useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { AnimatedLayout } from '@clew/ui';
import type { EntityColumn, EntityList, EntityRef, EntitySource, SessionUser, ViewField } from '@clew/contracts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  HStack,
  Heading,
  Link,
  List,
  ListItem,
  MoreMenu,
  Table,
  Text,
  VStack,
  VisuallyHidden,
  pixel,
  proportional,
  resolveColumnWidths,
  useAnnounce,
  useMediaQuery,
} from '@clew/ui';
import { FieldCell, FieldValue, badgeVariant, fieldText, fieldWord, isBadged } from '../components/view';
import { personTitle } from '../components/entity-sections';
import { useRail } from '../components/nav';
import { ThingTabs } from '../components/entity-page';
import { PageFrame } from '../components/page-frame';
import { Shell, shortQuery } from '../components/shell';
import type { EntityActionStart } from '../entity-actions';
import { pageOnly } from '../panel-address';
import { NEEDS_YOU, personPageHref, sourceWayHref, wayBack } from '../person-address';
import { itemPageHref } from '../work-items';
import { MATRIX_PATH, SEARCH_PATH } from '../competence-address';
import { BOARDING_PATH } from '../boarding-address';
import { areasQuery, entityListQuery, entityRowsQuery } from '../queries';
import { lensesOpening, type PeopleReads } from '../view-address';
import { useHeldRelations } from '../capabilities';
import { groupFields, present, rowGroups, type FieldGroup } from '../view-fields';
import {
  byNeed,
  cardLinkTexts,
  columnValue,
  lensNeed,
  marksFor,
  peopleLine,
  rowOf,
  silentText,
  viewFields,
  type Answer,
  type Row,
  type Silent,
} from './staff-model';

/**
 * The parts of Personal (D97; D126, board Personal), each an Astryx composition: the register's frame with its tabs,
 * the row's menu, a unit's table on "Medarbetare" and under a lens, and the sentence that says which system did not
 * answer. `staff.tsx` reads the API and puts them together; the competence and boarding pages draw their tab in the
 * same frame.
 */

type MenuItems = ComponentProps<typeof MoreMenu>['items'];
type Answers = ReadonlyMap<string, Answer>;
/** Each person's link to themselves, by Clew's id, so the talk's drawer can give the focus back after a reload. */
export type Openers = (id: string | undefined) => (el: HTMLElement | null) => void;
/**
 * What every part needs from the page: the list as the API gave it, each source's answer, the people's links, and the
 * page's one way to start an action (its refusal is shown once, at the top of the list).
 */
export interface Context {
  list: EntityList;
  answers: Answers;
  openers: Openers;
  start: EntityActionStart['start'];
}

/**
 * One person's menu (artboard A3, board Personal): every action about a person, one section per system with the system
 * as its title, and a source's way in under that source ("Öppna samtalet", which leads to the person's talk tab since
 * D126). Under a lens its own source comes first. A propose opens the action dialog and nothing is created before its
 * last button; an execute opens its work item with the decision over it (`useEntityAction`). The menu holds what can be
 * done about the person, never a choice of where Clew shows them (the product owner, 2026-11-11).
 */
export function RowMenu({ entity, ctx, lens }: { entity: EntityRef; ctx: Context; lens?: EntitySource }) {
  const { list, start } = ctx;
  const location = useLocation();
  const here = { pathname: location.pathname, search: location.search };
  const sections = new Map<string, Array<MenuItems[number]>>();
  const add = (source: string, item: MenuItems[number]) =>
    sections.set(source, [...(sections.get(source) ?? []), item]);
  if (lens) sections.set(lens.source, []);
  for (const a of list.actions)
    add(a.source, {
      id: `action:${a.capability}`,
      label: a.title,
      onClick: () => start(a, { key: entity.key, name: entity.name }),
    });
  for (const s of list.lenses) {
    const href = sourceWayHref(s, entity, here, wayBack(pageOnly(here.pathname, here.search)));
    if (s.page && href) add(s.source, { id: `page:${s.capability}`, label: s.page.title, href });
  }
  const items: MenuItems = [...sections]
    .filter(([, rows]) => rows.length > 0)
    .map(([title, rows]) => ({ type: 'section' as const, id: title, title, items: rows }) as MenuItems[number]);
  if (!items.length) return null;
  return (
    <MoreMenu size="sm" label={`Åtgärder för ${entity.name}`} alignment="end" presentation="adaptive" items={items} />
  );
}

/**
 * The person's work items as links in "Just nu" (artboard A2, D97 item 5): "1 att agera på" and "1 förslag" (or "N …"),
 * each leading to the work item's own page when the server named the one item there is (D126 rule 1), with the
 * register as its way back. With several the link leads to the person's page at Ärenden, where each is a row.
 */
export function cardLinks(
  list: EntityList,
  entity: EntityRef,
  here: { pathname: string; search: string },
): ReactNode[] {
  const from = pageOnly(here.pathname, here.search);
  return cardLinkTexts(list, entity.key).map(link => (
    <Link
      key={link.kind}
      href={
        link.threadId ? itemPageHref(link.threadId, from) : personPageHref(entity.key, { section: NEEDS_YOU, from })
      }
      hasUnderline
    >
      {link.text}
    </Link>
  ));
}

/**
 * Where a name in the register leads (D126 rule 1): the person's page with the register as its way back; under a lens,
 * at the lens's own tab of that page, which holds the same source's fuller read about them.
 */
const nameHref = (pathname: string, search: string, key: string, lens?: string) =>
  personPageHref(key, { ...(lens ? { section: lens } : {}), from: pageOnly(pathname, search) });

/** A person's title as the directory says it, without the unit the register already names ("Lärare 4–6"). */
const roleOf = (entity: EntityRef, unit: string) => personTitle({ ...entity, unit: { id: '', label: unit } });

/**
 * The person as the register's first cell (board Personal): their initials, their name as the link to their page with
 * the register as its way back, and their title under it where the directory knows one.
 */
function Person({
  entity,
  unit,
  lens,
  openers,
}: {
  entity: EntityRef;
  unit: string;
  lens?: string | undefined;
  openers: Openers;
}) {
  const location = useLocation();
  const role = roleOf(entity, unit);
  return (
    <HStack gap={3} vAlign="center">
      <Avatar name={entity.name} size="sm" tooltip={false} aria-hidden />
      <VStack gap={0}>
        <Link
          ref={openers(entity.id)}
          href={nameHref(location.pathname, location.search, entity.key, lens)}
          color="primary"
          weight="semibold"
        >
          {entity.name}
        </Link>
        {role && (
          <Text type="supporting" color="secondary">
            {role}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}
/** A column's heading in two lines (artboard A2): the field's label, and the system it comes from under it. */
const columnHeader = (column: EntityColumn) => (
  <VStack gap={0}>
    <Text weight="semibold">{column.field.label}</Text>
    <Text type="supporting" weight="normal">
      {column.source}
    </Text>
  </VStack>
);
/** "Just nu" (artboard A2): the person's cards as links, then the marks of every chosen source with the source's words. */
function Marks({ entity, ctx }: { entity: EntityRef; ctx: Context }) {
  const location = useLocation();
  const marks = marksFor(ctx.list, ctx.answers, entity.sourceKey);
  const links = cardLinks(ctx.list, entity, location);
  if (!marks.length && !links.length) return null;
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      {links}
      {marks.map(m => (
        <Badge key={m.id} variant={badgeVariant(m.tone)} label={m.text} />
      ))}
    </HStack>
  );
}

interface TableRow extends Record<string, unknown> {
  id: string;
  entity: EntityRef;
}
type Group = EntityList['groups'][number];
const count = (n: number) => (n === 0 ? 'Ingen medarbetare' : `${n} medarbetare`);
/**
 * A unit's people (board Personal): the table in a card in Hem's column, as Hem puts its lists (the product owner,
 * 2026-11-14: every page shares Hem's container); with several units, each card under its own heading with how many it
 * has. A unit with nobody else on it says so.
 */
function UnitCard({ group, single, children }: { group: Group; single: boolean; children: ReactNode }) {
  const body =
    group.entities.length === 0 ? (
      <EmptyState
        isCompact
        title="Ingen medarbetare på enheten"
        description="Katalogen har inte fört in någon annan än dig på den här enheten."
      />
    ) : (
      children
    );
  const card = <Card padding={0}>{body}</Card>;
  if (single) return card;
  return (
    <VStack as="section" gap={3} aria-label={group.label}>
      <HStack gap={3} vAlign="center" wrap="wrap">
        <Heading level={2}>{group.label}</Heading>
        <Text type="supporting" color="secondary">
          {count(group.entities.length)}
        </Text>
      </HStack>
      {card}
    </VStack>
  );
}
/**
 * A value as a phone row says it, with no column heading above it: the field's label first ("Nästa samtal: tors 12
 * nov"), unless the words already carry it or a yes or no is its own word.
 */
function labelledWord(f: ViewField, value: unknown): string {
  const word = fieldWord(f, value);
  return typeof value === 'boolean' || word.startsWith(`${f.label}: `) ? word : `${f.label}: ${word}`;
}
/**
 * A row under a lens as a phone says it (D97): each cell of the lens, the states that are badges as badges, the rest as
 * words, the cell's label before the first word ("Åtgärdspunkter: 3 öppna") and a word beside another after it without
 * one ("tors 12 nov. kl. 09:00").
 */
function phoneParts(groups: FieldGroup[], row: Row): { badges: ViewField[]; words: string[] } {
  const badges: ViewField[] = [],
    words: string[] = [];
  for (const g of groups) {
    const said: string[] = [];
    for (const f of groupFields(g)) {
      const value = row[f.key];
      if (!present(value)) continue;
      if (f.format === 'status' && isBadged(f, value)) badges.push(f);
      else said.push(f === g.lead ? labelledWord(f, value) : fieldText(f, value));
    }
    if (said.length) words.push(said.join(' '));
  }
  return { badges, words };
}
/**
 * One person as a row where the table does not fit, on a phone and in a window narrower than its columns (the shape the
 * page had before D97): the initials and the name, which leads to their page, the states that are badges, the rest as
 * one line of words, and the row's menu at the end.
 */
function PhoneRow({
  entity,
  ctx,
  lens,
  badges,
  words,
  links = [],
  menu,
}: {
  entity: EntityRef;
  ctx: Context;
  /** The lens the row is under: the name leads to the person's tab for it. */
  lens?: string | undefined;
  badges: ReactNode[];
  words: string[];
  /** "Just nu"'s links, at the end of the line of words: a link in a line of text, not a target beside the name. */
  links?: ReactNode[];
  menu: ReactNode;
}) {
  const location = useLocation();
  return (
    <ListItem
      itemKey={entity.key}
      align="start"
      startContent={<Avatar name={entity.name} size="md" tooltip={false} aria-hidden />}
      label={
        <Link
          ref={ctx.openers(entity.id)}
          href={nameHref(location.pathname, location.search, entity.key, lens)}
          color="primary"
          weight="semibold"
        >
          {entity.name}
        </Link>
      }
      description={
        badges.length || words.length || links.length ? (
          <VStack gap={1} hAlign="start">
            {badges.length > 0 && (
              <HStack gap={2} wrap="wrap">
                {badges}
              </HStack>
            )}
            {(words.length > 0 || links.length > 0) && (
              <Text type="supporting">
                {[...words, ...links].map((part, i) => (
                  <Fragment key={i}>
                    {i > 0 && '\u00a0· '}
                    {part}
                  </Fragment>
                ))}
              </Text>
            )}
          </VStack>
        ) : undefined
      }
      endContent={menu}
    />
  );
}
/** The widths of the list's columns: the name, a value on "Alla", Just nu and the menu. */
const PERSON_WIDTH = proportional(2, { minWidth: 220 }),
  VALUE_WIDTH = proportional(1, { minWidth: 160 }),
  NOW_WIDTH = proportional(2, { minWidth: 200 }),
  MENU_WIDTH = pixel(60);
/** A cell of a lens: a state with its moment ("Bokat", "tors 12 nov. kl. 09:00") has room for both on one line. */
const cellWidth = (g: FieldGroup) =>
  proportional(1, { minWidth: groupFields(g).some(f => f.format === 'instant') ? 240 : g.beside.length ? 200 : 140 });
/**
 * The least width the whole list needs as a table, under a lens or on "Medarbetare", as Astryx's Table works it out
 * from its columns' widths (below it the table scrolls sideways). A window that does not keep this much beside the rail
 * draws the list as its rows instead, as a phone does, so the page never scrolls sideways (1.4.10).
 */
export function listMinWidth(list: EntityList | undefined, lens: EntitySource | undefined): number {
  const widths = lens
    ? [PERSON_WIDTH, ...rowGroups(viewFields(lens.view)).map(cellWidth), MENU_WIDTH]
    : [PERSON_WIDTH, ...(list?.columns ?? []).map(() => VALUE_WIDTH), NOW_WIDTH, MENU_WIDTH];
  return resolveColumnWidths(widths.map((width, i) => ({ key: String(i), width }))).tableMinWidth;
}
const personColumn = (ctx: Context, unit: string, lens?: string) => ({
  key: 'person',
  header: 'Namn',
  width: PERSON_WIDTH,
  renderCell: (r: TableRow) => <Person entity={r.entity} unit={unit} lens={lens} openers={ctx.openers} />,
});
const menuColumn = (ctx: Context, lens?: EntitySource) => ({
  key: 'menu',
  header: <VisuallyHidden>Åtgärder</VisuallyHidden>,
  width: MENU_WIDTH,
  renderCell: (r: TableRow) => <RowMenu entity={r.entity} ctx={ctx} {...(lens ? { lens } : {})} />,
});

/**
 * A unit on "Medarbetare" (artboard A2, board Personal): Namn, one column per field an administrator chose, each from its
 * source, "Just nu" and the row's menu. `narrow` (on a phone, and where the table does not fit) the same people as rows:
 * the name, the columns' words and the marks, the menu.
 */
export function AllUnit({
  group,
  single,
  ctx,
  narrow,
  animatedLayout,
}: {
  group: Group;
  single: boolean;
  ctx: Context;
  narrow: boolean;
  animatedLayout: AnimatedLayout;
}) {
  const location = useLocation();
  return (
    <UnitCard group={group} single={single}>
      {narrow ? (
        <List aria-label={group.label} hasDividers animatedLayout={animatedLayout}>
          {group.entities.map(e => {
            const values = ctx.list.columns
              .map(c => ({ c, value: columnValue(c, ctx.answers, e.sourceKey) }))
              .filter(({ value }) => present(value));
            const toned = values.filter(({ c, value }) => c.field.format === 'status' && isBadged(c.field, value));
            return (
              <PhoneRow
                key={e.key}
                entity={e}
                ctx={ctx}
                links={cardLinks(ctx.list, e, location)}
                badges={[
                  ...toned.map(({ c, value }) => (
                    <FieldValue key={`${c.capability}:${c.field.key}`} field={c.field} value={value} />
                  )),
                  ...marksFor(ctx.list, ctx.answers, e.sourceKey).map(m => (
                    <Badge key={m.id} variant={badgeVariant(m.tone)} label={m.text} />
                  )),
                ]}
                words={values.filter(v => !toned.includes(v)).map(({ c, value }) => labelledWord(c.field, value))}
                menu={<RowMenu entity={e} ctx={ctx} />}
              />
            );
          })}
        </List>
      ) : (
        <Table<TableRow>
          data={group.entities.map(entity => ({ id: entity.key, entity }))}
          idKey="id"
          columns={[
            personColumn(ctx, group.label),
            ...ctx.list.columns.map(c => ({
              key: `column:${c.capability}:${c.field.key}`,
              header: columnHeader(c),
              width: VALUE_WIDTH,
              // A value without a tone is ordinary text, as the artboard draws "I tjänst" and "mån 16 nov".
              renderCell: (r: TableRow) => {
                const row = rowOf(ctx.answers.get(c.capability), r.entity.sourceKey);
                return row ? <FieldValue field={c.field} value={row[c.field.key]} text="ordinary" /> : null;
              },
            })),
            {
              key: 'now',
              header: 'Just nu',
              width: NOW_WIDTH,
              renderCell: (r: TableRow) => <Marks entity={r.entity} ctx={ctx} />,
            },
            menuColumn(ctx),
          ]}
          density="balanced"
          hasHover
        />
      )}
    </UnitCard>
  );
}

/**
 * One cell of a lens (artboard B): the cell's first value as ordinary text or its badge, and what the view puts beside
 * it after it, in supporting text unless it is a badge ("Bokat" and "tors 12 nov. kl. 09:00", "3 öppna" and "2
 * försenade").
 */
function LensCell({ group, row }: { group: FieldGroup; row: Row }) {
  const value = row[group.lead.key];
  return (
    <FieldCell
      group={group}
      row={row}
      {...(present(value) ? { lead: <FieldValue field={group.lead} value={value} text="ordinary" /> } : {})}
    />
  );
}

/**
 * A unit under a lens (artboard B, a tab of the register since D126): Namn, one column per cell of the lens's view (a
 * field and what it puts beside it, the compact one left out, D97), and the row's menu; the people sorted by need, those
 * the source has no row for last with nothing in its columns. `narrow` (on a phone, and where the table does not fit)
 * the same rows with the badges and the words under the name.
 */
export function LensUnit({
  group,
  single,
  lens,
  ctx,
  narrow,
  animatedLayout,
}: {
  group: Group;
  single: boolean;
  lens: EntitySource;
  ctx: Context;
  narrow: boolean;
  animatedLayout: AnimatedLayout;
}) {
  const answer = ctx.answers.get(lens.capability);
  const groups = rowGroups(viewFields(lens.view));
  const people = byNeed(group.entities, lens, answer);
  return (
    <UnitCard group={group} single={single}>
      {narrow ? (
        <List aria-label={group.label} hasDividers animatedLayout={animatedLayout}>
          {people.map(e => {
            const row = rowOf(answer, e.sourceKey);
            const parts = row ? phoneParts(groups, row) : { badges: [], words: [] };
            return (
              <PhoneRow
                key={e.key}
                entity={e}
                ctx={ctx}
                lens={lens.capability}
                badges={parts.badges.map(f => (
                  <FieldValue key={f.key} field={f} value={row![f.key]} />
                ))}
                words={parts.words}
                menu={<RowMenu entity={e} ctx={ctx} lens={lens} />}
              />
            );
          })}
        </List>
      ) : (
        <Table<TableRow>
          data={people.map(entity => ({ id: entity.key, entity }))}
          idKey="id"
          columns={[
            personColumn(ctx, group.label, lens.capability),
            ...groups.map(g => ({
              key: `field:${g.lead.key}`,
              header: g.lead.label,
              width: cellWidth(g),
              ...(g.lead.format === 'number' && !g.beside.length ? { align: 'end' as const } : {}),
              renderCell: (r: TableRow) => {
                const row = rowOf(answer, r.entity.sourceKey);
                return row ? <LensCell group={g} row={row} /> : null;
              },
            })),
            menuColumn(ctx, lens),
          ]}
          density="balanced"
          hasHover
        />
      )}
    </UnitCard>
  );
}

/**
 * The one sentence that says which system did not answer, with Försök igen (the in-section pattern of the errand list),
 * spoken once when it appears or changes (4.1.3).
 */
export function SilentSources({
  silent,
  retrying,
  onRetry,
}: {
  silent: Silent[];
  retrying: boolean;
  onRetry: () => void;
}) {
  const announce = useAnnounce();
  const text = silentText(silent);
  const said = useRef('');
  useEffect(() => {
    if (text && text !== said.current) announce(text);
    said.current = text;
  }, [text, announce]);
  if (!text) return null;
  return (
    <HStack gap={3} vAlign="center" wrap="wrap">
      <Text as="p">{text}</Text>
      <Button size="sm" variant="secondary" label="Försök igen" isLoading={retrying} onClick={onRetry} />
    </HStack>
  );
}

/** What a lens's tab carries (the Visa menu's count before D126): how many of its rows need the reader, in their tone. */
export function LensBadge({ lens, answer }: { lens: EntitySource; answer: Answer | undefined }) {
  const need = lensNeed(lens, answer);
  if (!need) return null;
  return (
    <HStack gap={0} vAlign="center">
      <Badge variant={badgeVariant(need.tone)} label={need.count} />
      <VisuallyHidden> medarbetare behöver dig</VisuallyHidden>
    </HStack>
  );
}

/** The register's own tabs that are not a lens (a lens's tab is its capability, which always holds a dot). */
export const ALL_TAB = 'all';
export const COMPETENCE_TAB = 'competence';
export const BOARDING_TAB = 'boarding';
/** Personal's address at a tab: "Medarbetare" without `show`, a lens with its capability as `show` (D43). */
export const SHOW = 'show';
export const lensHref = (capability: string | null) =>
  capability ? `/staff?${SHOW}=${encodeURIComponent(capability)}` : '/staff';
/** The register's heading, which takes the focus back where nothing else on the page can (D83 rule 7). */
export const PERSONAL_TITLE_ID = 'personal-rubrik';
/**
 * The tab pressed on the page before: a tab that is another route (Kompetens, Introduktion och avslut) draws a new page,
 * which would leave the focus nowhere, so the page it leads to gives the pressed tab the focus once drawn, as Att göra's
 * tabs leave it (the review of 2026-11-13). A tab of the same route keeps the focus by itself.
 */
let pressedTab: string | null = null;

/**
 * Personal as one register (D126 rule 8, board Personal, the `table-page` template): the title with the unit and the
 * count under it, the page's own controls at the end of the title's line (a search, at most one primary action), then
 * the views of the same people as tabs, each a link with its own address so Back and a reload land on it: Medarbetare
 * (`/staff`), one tab per lens an administrator offers (`/staff?show=<capability>`, D97 item 3: Frånvaro,
 * Utvecklingssamtal), Kompetens (the manager's matrix with what waits for approval, `/competence/matrix`, and the
 * registrar's search, `/competence/search`, D121) and Introduktion och avslut (`/boarding`, D124). A tab is drawn only
 * for someone the server would answer: the lenses and the competence matrix for a manager, the search for a registrar,
 * Kompetens and Introduktion och avslut while their module is visible to the person (D23). The rail marks Personal on
 * every tab. The content scrolls under the header; on a short screen nothing is pinned and the page scrolls as one
 * (1.4.10). Every tab sits in the one page frame (`PageFrame`, D126).
 */
export function PersonalFrame({
  user,
  admin,
  tab,
  end,
  badges,
  label,
  children,
}: {
  user: SessionUser;
  admin: boolean;
  /** The tab shown: `ALL_TAB`, a lens's capability, `COMPETENCE_TAB` or `BOARDING_TAB`. */
  tab: string;
  /** The page's own controls at the end of the title's line. */
  end?: ReactNode;
  /** What a lens's tab carries beside its name: how many need the reader (`lensNeed`), where the page knows it. */
  badges?: ReadonlyMap<string, ReactNode>;
  /** What the content is named while it scrolls. */
  label: string;
  children: ReactNode;
}) {
  const short = useMediaQuery(shortQuery);
  const manager = user.role === 'manager';
  const nav = useRail({ current: { surface: 'staff' }, admin, manager });
  const list = useQuery({ ...entityListQuery('person'), enabled: manager }).data;
  const systems = useQuery(areasQuery).data?.systems;
  // A place whose system the person cannot see is not drawn (D23); until `/api/areas` answers, the tab is drawn.
  const sees = (connector: string) => !systems || systems.some(s => s.connector === connector);
  const registrar = useHeldRelations().includes('registrar');
  const groups = list?.groups ?? [];
  const current = useCallback(
    (el: HTMLElement | null) => {
      if (!el || pressedTab !== tab) return;
      pressedTab = null;
      requestAnimationFrame(() => el.focus());
    },
    [tab],
  );
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      <PageFrame
        ask={{ later: 'registers' }}
        title="Personal"
        titleId={PERSONAL_TITLE_ID}
        meta={groups.length > 0 ? peopleLine(groups) : undefined}
        actions={end}
        label={label}
        tabs={
          <ThingTabs
            label="Personal"
            value={tab}
            onPress={value => {
              if (value !== tab) pressedTab = value;
            }}
            tabRef={current}
            tabs={[
              ...(manager ? [{ value: ALL_TAB, label: 'Medarbetare', href: lensHref(null) }] : []),
              ...(manager
                ? (list?.lenses ?? []).map(l => {
                    const badge = badges?.get(l.capability);
                    return {
                      value: l.capability,
                      label: l.title,
                      href: lensHref(l.capability),
                      ...(badge ? { badge } : {}),
                    };
                  })
                : []),
              ...(sees('competence') && (manager || registrar)
                ? [{ value: COMPETENCE_TAB, label: 'Kompetens', href: manager ? MATRIX_PATH : SEARCH_PATH }]
                : []),
              ...(sees('boarding') && manager
                ? [{ value: BOARDING_TAB, label: 'Introduktion och avslut', href: BOARDING_PATH }]
                : []),
            ]}
          />
        }
      >
        {children}
      </PageFrame>
    </Shell>
  );
}

/**
 * What Clew knows of the reader's people for `peopleReadHref` (`view-address.ts`): the lenses and the people from the
 * list, and the rows of each lens whose fuller read is `capability`, so a person's row can be found by what the read is
 * asked with. Null while the list is on its way; a manager's only, as the lenses are.
 */
export function usePeopleReads(capability: string | null, enabled: boolean): PeopleReads | null {
  const list = useQuery({ ...entityListQuery('person'), enabled }).data;
  const opening = list && capability ? lensesOpening(list, capability) : [];
  const rowsQs = useQueries({ queries: opening.map(l => ({ ...entityRowsQuery('person', l.capability), enabled })) });
  if (!list) return null;
  const rows = new Map(
    opening.map((l, i) => {
      const q = rowsQs[i];
      return [l.capability, q?.data ? (q.data.status === 'ok' ? q.data.rows : []) : q?.isError ? [] : undefined];
    }),
  );
  return { lenses: list.lenses, people: list.groups.flatMap(g => g.entities), rows: c => rows.get(c) };
}
