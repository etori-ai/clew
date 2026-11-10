import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { AnimatedLayout } from '@clew/ui';
import type { EntityCard, EntityColumn, EntityList, EntityRef, EntitySource, ViewField } from '@clew/contracts';
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
  useAnnounce,
} from '@clew/ui';
import { FieldValue, badgeVariant, fieldWord, isBadged } from '../components/view';
import { personHref } from '../components/person-panel';
import { useEntityAction } from '../entity-actions';
import {
  byNeed,
  columnValue,
  lensNeed,
  marksFor,
  pageHref,
  rowOf,
  silentText,
  titleField,
  viewFields,
  type Answer,
  type Silent,
} from './staff-model';

/**
 * The parts of Personal (D97, artboards A2, B, A3 and the left of C), each an Astryx composition: the Visa menu, the
 * row's menu, a unit's card on "Alla", under a lens and drawn compact beside an opened person, and the sentence that
 * says which system did not answer. `staff.tsx` reads the API and puts them together.
 */

type MenuItems = ComponentProps<typeof MoreMenu>['items'];
type Answers = ReadonlyMap<string, Answer>;
/** Each person's link to themselves, by Clew's id, so the talk's drawer can give the focus back after a reload. */
export type Openers = (id: string | undefined) => (el: HTMLElement | null) => void;
/** What every part needs from the page: the list as the API gave it, each source's answer, and the people's links. */
export interface Context {
  list: EntityList;
  answers: Answers;
  openers: Openers;
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
 * action starts as every standing action does (`useEntityAction`): nothing runs before the person confirms.
 */
export function RowMenu({ entity, list, lens }: { entity: EntityRef; list: EntityList; lens?: EntitySource }) {
  const start = useEntityAction();
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
    const href = s.page ? pageHref(s.page, entity, here) : null;
    if (s.page && href) add(s.source, { id: `page:${s.capability}`, label: s.page.title, href });
  }
  const items: MenuItems = [...sections]
    .filter(([, rows]) => rows.length > 0)
    .map(([title, rows]) => ({ type: 'section' as const, id: title, title, items: rows }) as MenuItems[number]);
  if (!items.length) return null;
  return <MoreMenu label={`Åtgärder för ${entity.name}`} alignment="end" presentation="adaptive" items={items} />;
}

/**
 * The person's cards as links in "Just nu" ("1 att agera på", "1 förslag", artboard A2). SEAM: the cards about a person
 * come with the slice that gives card rows a subject (D97 items 5 and 6); the list carries none yet, so this draws
 * nothing. It takes the cards as `EntityDetail.cards` gives them and returns their links.
 */
export function cardLinks(_cards: EntityCard[] | undefined): ReactNode[] {
  return [];
}

/** The person's name as the way to open them beside the list (D83 rule 1), with their initials before it. */
function Person({ entity, openers }: { entity: EntityRef; openers: Openers }) {
  const location = useLocation();
  return (
    <HStack gap={3} vAlign="center">
      <Avatar name={entity.name} size={32} tooltip={false} />
      <Link
        ref={openers(entity.id)}
        href={personHref(location.pathname, location.search, entity.key)}
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
/** "Just nu": the marks of every chosen source as badges with the source's words, then the person's cards. */
function Marks({ entity, ctx }: { entity: EntityRef; ctx: Context }) {
  const marks = marksFor(ctx.list, ctx.answers, entity.key);
  const links = cardLinks(undefined);
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
/** The unit's caption, as the card's toolbar: its name, and how many people it has unless the list is compact. */
function UnitCard({ group, compact, children }: { group: Group; compact?: boolean; children: ReactNode }) {
  return (
    <Card padding={0}>
      <Toolbar
        label={group.label}
        size="sm"
        dividers={['bottom']}
        startContent={
          <VStack gap={0}>
            <Text weight="semibold">{group.label}</Text>
            {!compact && <Text type="supporting">{count(group.entities.length)}</Text>}
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
const present = (value: unknown) => value !== undefined && value !== null && value !== '';
/**
 * One person as a row on a phone (the shape the page had before D97): the initials and the name, which opens them,
 * the states that are badges, the rest as one line of words, and the row's menu at the end.
 */
function PhoneRow({
  entity,
  ctx,
  badges,
  words,
  menu,
}: {
  entity: EntityRef;
  ctx: Context;
  badges: ReactNode[];
  words: string[];
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
          href={personHref(location.pathname, location.search, entity.key)}
          weight="semibold"
        >
          {entity.name}
        </Link>
      }
      description={
        badges.length || words.length ? (
          <VStack gap={1} hAlign="start">
            {badges.length > 0 && (
              <HStack gap={2} wrap="wrap">
                {badges}
              </HStack>
            )}
            {words.length > 0 && <Text type="supporting">{words.join(' · ')}</Text>}
          </VStack>
        ) : undefined
      }
      endContent={menu}
    />
  );
}
const personColumn = (ctx: Context) => ({
  key: 'person',
  header: 'Person',
  width: proportional(2, { minWidth: 220 }),
  renderCell: (r: TableRow) => <Person entity={r.entity} openers={ctx.openers} />,
});
const menuColumn = (ctx: Context, lens?: EntitySource) => ({
  key: 'menu',
  header: <VisuallyHidden>Åtgärder</VisuallyHidden>,
  width: pixel(60),
  renderCell: (r: TableRow) => <RowMenu entity={r.entity} list={ctx.list} {...(lens ? { lens } : {})} />,
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
                badges={[
                  ...toned.map(({ c, value }) => (
                    <FieldValue key={`${c.capability}:${c.field.key}`} field={c.field} value={value} />
                  )),
                  ...marksFor(ctx.list, ctx.answers, e.key).map(m => (
                    <Badge key={m.id} variant={badgeVariant(m.tone)} label={m.text} />
                  )),
                ]}
                words={values.filter(v => !toned.includes(v)).map(({ c, value }) => labelledWord(c.field, value))}
                menu={<RowMenu entity={e} list={ctx.list} />}
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
              width: proportional(1, { minWidth: 160 }),
              renderCell: (r: TableRow) => {
                const row = rowOf(ctx.answers.get(c.capability), r.entity.key);
                return row ? <FieldValue field={c.field} value={row[c.field.key]} /> : null;
              },
            })),
            {
              key: 'now',
              header: 'Just nu',
              width: proportional(2, { minWidth: 200 }),
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
 * A unit under a lens (artboard B): Person, one column per field of the lens's view drawn as the view says, and the
 * row's menu; the people sorted by need, those the source has no row for last with nothing in its columns. On a phone
 * the same rows with the badges and the words under the name.
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
  const fields = viewFields(lens.view);
  const people = byNeed(group.entities, lens, answer);
  return (
    <UnitCard group={group}>
      {mobile ? (
        <List aria-label={group.label} hasDividers animatedLayout={animatedLayout}>
          {people.map(e => {
            const row = rowOf(answer, e.key);
            const shown = row ? fields.filter(f => present(row[f.key])) : [];
            const toned = shown.filter(f => f.format === 'status' && isBadged(f, row![f.key]));
            return (
              <PhoneRow
                key={e.key}
                entity={e}
                ctx={ctx}
                badges={toned.map(f => (
                  <FieldValue key={f.key} field={f} value={row![f.key]} />
                ))}
                words={shown.filter(f => !toned.includes(f)).map(f => labelledWord(f, row![f.key]))}
                menu={<RowMenu entity={e} list={ctx.list} lens={lens} />}
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
            ...fields.map(f => ({
              key: `field:${f.key}`,
              header: f.label,
              // A moment with its time ("tors 12 nov. kl. 09:00") stays on one line.
              width: proportional(1, { minWidth: f.format === 'instant' ? 190 : 140 }),
              ...(f.format === 'number' ? { align: 'end' as const } : {}),
              renderCell: (r: TableRow) => {
                const row = rowOf(answer, r.entity.key);
                return row ? <FieldValue field={f} value={row[f.key]} /> : null;
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
 * The list drawn compact while a person is open beside it (artboard C, left): one row per person, the name the way to
 * open them, the opened one marked current, and under a lens the lens's state at the end, sorted as the lens sorts.
 */
export function CompactUnit({
  group,
  lens,
  ctx,
  opened,
  animatedLayout,
}: {
  group: Group;
  lens: EntitySource | undefined;
  ctx: Context;
  opened: string | undefined;
  animatedLayout: AnimatedLayout;
}) {
  const location = useLocation();
  const answer = lens ? ctx.answers.get(lens.capability) : undefined;
  const title = lens ? titleField(lens.view) : undefined;
  const people = lens ? byNeed(group.entities, lens, answer) : group.entities;
  return (
    <UnitCard group={group} compact>
      <List aria-label={group.label} hasDividers animatedLayout={animatedLayout}>
        {people.map(e => {
          const value = title ? rowOf(answer, e.key)?.[title.key] : undefined;
          return (
            <ListItem
              key={e.key}
              itemKey={e.key}
              label={e.name}
              href={personHref(location.pathname, location.search, e.key)}
              isSelected={!!opened && opened.toLowerCase() === e.key.toLowerCase()}
              endContent={
                title && value !== undefined && value !== null && value !== '' ? (
                  <FieldValue field={title} value={value} />
                ) : undefined
              }
            />
          );
        })}
      </List>
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
