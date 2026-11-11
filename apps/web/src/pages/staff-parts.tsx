import { Fragment, useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { AnimatedLayout } from '@clew/ui';
import type { EntityColumn, EntityList, EntityRef, EntitySource, ViewField } from '@clew/contracts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  EmptyState,
  HStack,
  Link,
  List,
  ListItem,
  MoreMenu,
  Skeleton,
  Table,
  Text,
  Toolbar,
  VStack,
  VisuallyHidden,
  pixel,
  proportional,
  resolveColumnWidths,
  useAnnounce,
} from '@clew/ui';
import { ApiError } from '../api';
import { entityDetailQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { FieldCell, FieldValue, badgeVariant, fieldText, fieldWord, isBadged } from '../components/view';
import { CardList, SectionFrame } from '../components/entity-sections';
import type { PanelFrame } from '../components/panel';
import type { EntityActionStart } from '../entity-actions';
import { cardsOf, pageOnly, withCard, withCards, withoutPanel } from '../panel-address';
import { personPageFrom } from '../person-address';
import { sourcePageHref } from '../talk-address';
import { groupFields, present, rowGroups, type FieldGroup } from '../view-fields';
import {
  byNeed,
  cardLinkTexts,
  cardsListed,
  columnValue,
  lensNeed,
  marksFor,
  rowOf,
  silentText,
  viewFields,
  type Answer,
  type Row,
  type Silent,
} from './staff-model';

/**
 * The parts of Personal (D97, artboards A2, B and A3), each an Astryx composition: the Visa menu, the row's menu, a
 * unit's card on "Alla" and under a lens, one person's cards as a list in the page's panel, and the sentence that says
 * which system did not answer. `staff.tsx` reads the API and puts them together.
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

/** The value "Alla" has in the Visa menu; a lens's value is its capability, which always holds a dot. */
const ALL = 'all';
/**
 * "Visa: Alla" (artboard A2): the lens the list is drawn through, as a radio menu. "Alla" first, then under "Visa
 * medarbetarna efter" one row per lens, each with the number of its rows that need the reader in their tone. Two radio
 * groups share the one value, so the heading sits between them as the artboard draws it.
 */
export function ShowMenu({
  lenses,
  answers,
  lens,
  onChoose,
}: {
  lenses: EntitySource[];
  answers: Answers;
  lens: EntitySource | undefined;
  onChoose: (capability: string | null) => void;
}) {
  const value = lens?.capability ?? ALL;
  const choose = (next: string) => {
    if (next !== value) onChoose(next === ALL ? null : next);
  };
  return (
    <DropdownMenu button={{ label: `Visa: ${lens?.title ?? 'Alla'}`, variant: 'secondary' }} menuWidth={300}>
      <DropdownMenuRadioGroup label="Visa" value={value} onChange={choose}>
        <DropdownMenuRadioItem value={ALL} label="Alla" />
      </DropdownMenuRadioGroup>
      <DropdownMenuGroup title="Visa medarbetarna efter">
        <DropdownMenuRadioGroup label="Visa medarbetarna efter" value={value} onChange={choose}>
          {lenses.map(l => {
            const need = lensNeed(l, answers.get(l.capability));
            return (
              <DropdownMenuRadioItem
                key={l.capability}
                value={l.capability}
                label={l.title}
                endContent={
                  need ? (
                    <HStack gap={0} vAlign="center">
                      <Badge variant={badgeVariant(need.tone)} label={need.count} />
                      <VisuallyHidden> medarbetare behöver dig</VisuallyHidden>
                    </HStack>
                  ) : undefined
                }
              />
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
    </DropdownMenu>
  );
}

/**
 * One person's menu (artboard A3): every action about a person, one section per system with the system as its title,
 * and a source's page as a way in under that source ("Öppna samtalet"). Under a lens its own source comes first. An
 * action starts on the server without the model (`useEntityAction`) and opens its card; nothing reaches the source's
 * write before the person decides on the card. The menu holds what can be done about the person, never a choice of
 * where Clew shows them (the product owner, 2026-11-11).
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
    const href = s.page ? sourcePageHref(s.page, entity, here) : null;
    if (s.page && href) add(s.source, { id: `page:${s.capability}`, label: s.page.title, href });
  }
  const items: MenuItems = [...sections]
    .filter(([, rows]) => rows.length > 0)
    .map(([title, rows]) => ({ type: 'section' as const, id: title, title, items: rows }) as MenuItems[number]);
  if (!items.length) return null;
  return <MoreMenu label={`Åtgärder för ${entity.name}`} alignment="end" presentation="adaptive" items={items} />;
}

/**
 * The person's cards as links in "Just nu" (artboard A2, D97 item 5): "1 att agera på" and "1 förslag" (or "N …"), each
 * opening the card beside the list when the server named the one card there is (D83 rule 1: the list stays, and the
 * card shows what it asks before anything is decided), and otherwise the cards it counted as a list beside Personal
 * (D107 answer 6), so a count never leaves the page. Either takes the place of what the panel held: one thing at a time.
 */
export function cardLinks(
  list: EntityList,
  entity: EntityRef,
  here: { pathname: string; search: string },
): ReactNode[] {
  const listSearch = pageOnly('', here.search);
  return cardLinkTexts(list, entity.key).map(link => (
    <Link
      key={link.kind}
      href={
        link.threadId
          ? withCard(here.pathname, listSearch, link.threadId)
          : withCards(here.pathname, listSearch, entity.key, link.kind)
      }
      hasUnderline
    >
      {link.text}
    </Link>
  ));
}

/**
 * One person's cards as a list in Personal's panel (D107 answer 6): "N att agera på" or "N förslag" in "Just nu"
 * counted more than one card, so the list stays and those cards are listed beside it (`cards=<key>` with `cards-kind`,
 * the page panel's `under`). They are the person's own Behöver dig, from their entity detail, of the kind the link
 * counted. A title opens its card over the list in the same panel (`&card=`); closing the card leaves the list, with the
 * focus on that title, and closing the list leaves Personal with its lens. The panel is named for the person, with the
 * name the list already has, so its heading takes the focus at once while the cards arrive; it says so in the panel
 * when the person cannot be read or no such card is left (each was decided meanwhile). A decision on one of them reads
 * the list and the person again (`cardChanged` in `staff.tsx`).
 */
export function useCardsFrame(list: EntityList | undefined): PanelFrame | null {
  const [search] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const asked = cardsOf(search);
  const read = useQuery({ ...entityDetailQuery('person', asked?.key ?? ''), enabled: !!asked });
  if (!asked) return null;
  const same = (key: string) => key.toLowerCase() === asked.key.toLowerCase();
  const named = list?.groups.flatMap(g => g.entities).find(e => same(e.key))?.name;
  const detail = read.isError ? undefined : read.data;
  const base = {
    id: `cards:${asked.key}:${asked.kind ?? 'all'}`,
    // The address "Just nu" leads to, so the focus finds that link when the list closes and its opener is gone.
    address: withCards(pathname, search, asked.key, asked.kind),
    onClose: () => navigate(withoutPanel(pathname, search)),
  };
  if (read.isError && read.error instanceof ApiError && read.error.status === 404)
    return {
      ...base,
      title: 'Personen finns inte',
      body: () => (
        <Text as="p">Det finns ingen sådan person, eller så har du inte tillgång till uppgifterna om hen.</Text>
      ),
    };
  const name = detail?.entity.name ?? named;
  // Neither the list nor the person has arrived: nothing yet to name the panel by.
  if (!name) return read.isError ? { ...base, title: 'Personen kunde inte hämtas', body: () => retry(read) } : null;
  if (read.isError) return { ...base, title: name, body: () => retry(read) };
  const shown = detail ? cardsListed(detail.cards, asked.kind) : null;
  return {
    ...base,
    title: name,
    body: () =>
      !shown ? (
        <VStack gap={2}>
          <Skeleton height={20} width="60%" />
          <Skeleton height={20} width="40%" />
        </VStack>
      ) : shown.cards.length === 0 ? (
        <EmptyState isCompact headingLevel={3} title={shown.empty} />
      ) : (
        <SectionFrame title={shown.heading} caption="Clew">
          <CardList cards={shown.cards} />
        </SectionFrame>
      ),
  };
}
/** The person's cards could not be read: said in the list's place, with the one way to ask again. */
function retry(read: { error: unknown; isFetching: boolean; refetch: () => unknown }) {
  return (
    <VStack gap={3}>
      <Text as="p">{errorMessage(read.error, 'Korten kunde inte hämtas just nu.')}</Text>
      <HStack>
        <Button
          size="sm"
          variant="secondary"
          label="Försök igen"
          isLoading={read.isFetching}
          onClick={() => void read.refetch()}
        />
      </HStack>
    </VStack>
  );
}

/** The person's name as the way to their page, with the list as its way back, and their initials before it. */
function Person({ entity, openers }: { entity: EntityRef; openers: Openers }) {
  const location = useLocation();
  return (
    <HStack gap={3} vAlign="center">
      <Avatar name={entity.name} size={32} tooltip={false} />
      <Link
        ref={openers(entity.id)}
        href={personPageFrom(location.pathname, location.search, entity.key)}
        weight="semibold"
      >
        {entity.name}
      </Link>
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
  const marks = marksFor(ctx.list, ctx.answers, entity.key);
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
/** The unit's caption, as the card's toolbar: its name, and how many people it has. */
function UnitCard({ group, children }: { group: Group; children: ReactNode }) {
  return (
    <Card padding={0}>
      <Toolbar
        label={group.label}
        size="sm"
        dividers={['bottom']}
        startContent={
          <VStack gap={0}>
            <Text weight="semibold">{group.label}</Text>
            <Text type="supporting">{count(group.entities.length)}</Text>
          </VStack>
        }
      />
      {group.entities.length === 0 ? (
        <EmptyState
          isCompact
          title="Ingen medarbetare på enheten"
          description="Katalogen har inte fört in någon annan än dig på den här enheten."
        />
      ) : (
        children
      )}
    </Card>
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
 * One person as a row on a phone (the shape the page had before D97): the initials and the name, which leads to their page,
 * the states that are badges, the rest as one line of words, and the row's menu at the end.
 */
function PhoneRow({
  entity,
  ctx,
  badges,
  words,
  links = [],
  menu,
}: {
  entity: EntityRef;
  ctx: Context;
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
      startContent={<Avatar name={entity.name} size={32} tooltip={false} />}
      label={
        <Link
          ref={ctx.openers(entity.id)}
          href={personPageFrom(location.pathname, location.search, entity.key)}
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
                    {i > 0 && ' · '}
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
 * The least width the whole list needs as a table, under a lens or on "Alla", as Astryx's Table works it out from its
 * columns' widths (below it the table scrolls sideways). The page draws its panel beside the list only where the list
 * keeps this much, and as the drawer over it everywhere else, so opening a card never makes the list scroll sideways.
 */
export function listMinWidth(list: EntityList | undefined, lens: EntitySource | undefined): number {
  const widths = lens
    ? [PERSON_WIDTH, ...rowGroups(viewFields(lens.view)).map(cellWidth), MENU_WIDTH]
    : [PERSON_WIDTH, ...(list?.columns ?? []).map(() => VALUE_WIDTH), NOW_WIDTH, MENU_WIDTH];
  return resolveColumnWidths(widths.map((width, i) => ({ key: String(i), width }))).tableMinWidth;
}
const personColumn = (ctx: Context) => ({
  key: 'person',
  header: 'Person',
  width: PERSON_WIDTH,
  renderCell: (r: TableRow) => <Person entity={r.entity} openers={ctx.openers} />,
});
const menuColumn = (ctx: Context, lens?: EntitySource) => ({
  key: 'menu',
  header: <VisuallyHidden>Åtgärder</VisuallyHidden>,
  width: MENU_WIDTH,
  renderCell: (r: TableRow) => <RowMenu entity={r.entity} ctx={ctx} {...(lens ? { lens } : {})} />,
});

/**
 * A unit on "Alla" (artboard A2): Person, one column per field an administrator chose, each from its source, "Just nu"
 * and the row's menu. On a phone the same people as rows: the name, the columns' words and the marks, the menu.
 */
export function AllUnit({
  group,
  ctx,
  mobile,
  animatedLayout,
}: {
  group: Group;
  ctx: Context;
  mobile: boolean;
  animatedLayout: AnimatedLayout;
}) {
  const location = useLocation();
  return (
    <UnitCard group={group}>
      {mobile ? (
        <List aria-label={group.label} hasDividers animatedLayout={animatedLayout}>
          {group.entities.map(e => {
            const values = ctx.list.columns
              .map(c => ({ c, value: columnValue(c, ctx.answers, e.key) }))
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
                  ...marksFor(ctx.list, ctx.answers, e.key).map(m => (
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
            personColumn(ctx),
            ...ctx.list.columns.map(c => ({
              key: `column:${c.capability}:${c.field.key}`,
              header: columnHeader(c),
              width: VALUE_WIDTH,
              // A value without a tone is ordinary text, as the artboard draws "I tjänst" and "mån 16 nov".
              renderCell: (r: TableRow) => {
                const row = rowOf(ctx.answers.get(c.capability), r.entity.key);
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
 * A unit under a lens (artboard B): Person, one column per cell of the lens's view (a field and what it puts beside it,
 * the compact one left out, D97), and the row's menu; the people sorted by need, those the source has no row for last
 * with nothing in its columns. On a phone the same rows with the badges and the words under the name.
 */
export function LensUnit({
  group,
  lens,
  ctx,
  mobile,
  animatedLayout,
}: {
  group: Group;
  lens: EntitySource;
  ctx: Context;
  mobile: boolean;
  animatedLayout: AnimatedLayout;
}) {
  const answer = ctx.answers.get(lens.capability);
  const groups = rowGroups(viewFields(lens.view));
  const people = byNeed(group.entities, lens, answer);
  return (
    <UnitCard group={group}>
      {mobile ? (
        <List aria-label={group.label} hasDividers animatedLayout={animatedLayout}>
          {people.map(e => {
            const row = rowOf(answer, e.key);
            const parts = row ? phoneParts(groups, row) : { badges: [], words: [] };
            return (
              <PhoneRow
                key={e.key}
                entity={e}
                ctx={ctx}
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
            personColumn(ctx),
            ...groups.map(g => ({
              key: `field:${g.lead.key}`,
              header: g.lead.label,
              width: cellWidth(g),
              ...(g.lead.format === 'number' && !g.beside.length ? { align: 'end' as const } : {}),
              renderCell: (r: TableRow) => {
                const row = rowOf(answer, r.entity.key);
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
