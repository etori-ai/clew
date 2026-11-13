import { Fragment, useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { useLocation } from 'react-router';
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
import { FieldCell, FieldValue, badgeVariant, fieldText, fieldWord, isBadged } from '../components/view';
import type { EntityActionStart } from '../entity-actions';
import { pageOnly, withCard } from '../panel-address';
import { NEEDS_YOU, personPageFrom, personPageHref } from '../person-address';
import { sourcePageHref } from '../talk-address';
import { groupFields, present, rowGroups, type FieldGroup } from '../view-fields';
import {
  byNeed,
  cardLinkTexts,
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
 * unit's card on "Alla" and under a lens, and the sentence that says which system did not answer. `staff.tsx` reads the
 * API and puts them together.
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
 * card shows what it asks before anything is decided; one thing at a time, so it takes the place of what the panel
 * held). With several the link leads to the person's page at Behöver dig, with the list as its way back, where each
 * card opens beside that page (D111, amended 2026-11-11: the panel holds one opened thing, never a list of cards).
 */
export function cardLinks(
  list: EntityList,
  entity: EntityRef,
  here: { pathname: string; search: string },
): ReactNode[] {
  return cardLinkTexts(list, entity.key).map(link => (
    <Link
      key={link.kind}
      href={
        link.threadId
          ? withCard(here.pathname, pageOnly('', here.search), link.threadId)
          : personPageHref(entity.key, { section: NEEDS_YOU, from: pageOnly(here.pathname, here.search) })
      }
      hasUnderline
    >
      {link.text}
    </Link>
  ));
}

/** The person's name as the way to their page, with the list as its way back, and their initials before it. */
function Person({ entity, openers }: { entity: EntityRef; openers: Openers }) {
  const location = useLocation();
  return (
    <HStack gap={3} vAlign="center">
      <Avatar name={entity.name} size="sm" tooltip={false} aria-hidden />
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
 * One person as a row on a phone, and beside the panel where the table does not fit (the shape the page had before
 * D97): the initials and the name, which leads to their page, the states that are badges, the rest as one line of
 * words, and the row's menu at the end.
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
      startContent={<Avatar name={entity.name} size="md" tooltip={false} aria-hidden />}
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
 * The least width the whole list needs as a table, under a lens or on "Alla", as Astryx's Table works it out from its
 * columns' widths (below it the table scrolls sideways). With the panel open beside the list, a window that does not
 * keep this much for the list draws it as its rows instead, as a phone does: the page gives way to the panel, never
 * scrolls sideways for it, and the panel keeps the width and the line every page has.
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
 * and the row's menu. `narrow` (on a phone, and beside the panel where the table does not fit) the same people as rows:
 * the name, the columns' words and the marks, the menu.
 */
export function AllUnit({
  group,
  ctx,
  narrow,
  animatedLayout,
}: {
  group: Group;
  ctx: Context;
  narrow: boolean;
  animatedLayout: AnimatedLayout;
}) {
  const location = useLocation();
  return (
    <UnitCard group={group}>
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
            personColumn(ctx),
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
 * A unit under a lens (artboard B): Person, one column per cell of the lens's view (a field and what it puts beside it,
 * the compact one left out, D97), and the row's menu; the people sorted by need, those the source has no row for last
 * with nothing in its columns. `narrow` (on a phone, and beside the panel where the table does not fit) the same rows
 * with the badges and the words under the name.
 */
export function LensUnit({
  group,
  lens,
  ctx,
  narrow,
  animatedLayout,
}: {
  group: Group;
  lens: EntitySource;
  ctx: Context;
  narrow: boolean;
  animatedLayout: AnimatedLayout;
}) {
  const answer = ctx.answers.get(lens.capability);
  const groups = rowGroups(viewFields(lens.view));
  const people = byNeed(group.entities, lens, answer);
  return (
    <UnitCard group={group}>
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
