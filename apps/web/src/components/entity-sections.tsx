import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  fieldTone,
  openRef,
  viewRows,
  type EntityAction,
  type EntityCard,
  type EntityDetail,
  type EntityKind,
  type EntitySection,
  type EntitySource,
  type View,
  type ViewField,
} from '@clew/contracts';
import {
  Button,
  Card,
  DropdownMenu,
  HStack,
  Heading,
  Link,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  Section,
  Skeleton,
  Text,
  VStack,
  useAnnounce,
} from '@clew/ui';
import { entitySectionQuery, viewQuery } from '../queries';
import { actionMenuItems, useEntityAction } from '../entity-actions';
import { withCard } from '../panel-address';
import { unitPageHref } from '../person-address';
import { compactField, groupFields, present, rowGroups, wholeRow, type FieldGroup } from '../view-fields';
import { DeclaredView, FieldCell, FieldValue, fieldText, isBadged } from './view';

/**
 * The opened person's or unit's content (D97 item 5, artboards C2, E and G): "Behöver dig" with the reader's cards about
 * them, then one section per source that is about them, each named with its source and each read on its own, so a slow
 * or silent source never holds the others. A source that answered without a row says nothing (no row means "none" or
 * "not allowed"); one that did not answer says so in its own place with a way to ask again. The person's page, the
 * unit's page and a person's cards listed beside Personal draw from the same pieces.
 */
type RowsView = Extract<View, { kind: 'table' | 'list' }>;
type Row = Record<string, unknown>;
/** One source's section and its answer for the opened person. */
export interface SectionAnswer {
  source: EntitySource;
  query: UseQueryResult<EntitySection, Error>;
}
/** The value Behöver dig takes in the address (`?section=`): never a capability's name, which always has a dot. */
export const NEEDS_YOU = 'needs-you';
const rowsView = (view: View): RowsView | null => (view.kind === 'table' || view.kind === 'list' ? view : null);
/** The source answered, and had no row for this person: the section is left out. */
export const rowless = (a: SectionAnswer) => a.query.data?.status === 'ok' && !a.query.data.row;
/** The source did not answer (or not in time), or the request failed. */
export const unanswered = (a: SectionAnswer) => a.query.isError || (!!a.query.data && a.query.data.status !== 'ok');
/** The row this source answered for the person, once it has. */
export const rowOf = (a: SectionAnswer): Row | undefined =>
  a.query.data?.status === 'ok' ? a.query.data.row : undefined;
/** The sections that are drawn: every one but those that answered without a row. */
export const drawnSections = (answers: SectionAnswer[]) => answers.filter(a => !rowless(a));
/** Whose a source is, as a section names it (D97, artboards B and C): Clew's own domain as Clew, any other by its name. */
export const sourceCaption = (source: Pick<EntitySource, 'source' | 'own'>) => (source.own ? 'Clew' : source.source);

/**
 * The line under a person's name (artboards C, C2 and D): their role and unit as the directory says it, the unit a link
 * to the unit's page (D97) with the page they were opened from as its way back, but only for a unit the reader may open:
 * one they manage (`managed`) or their own (`self`). A colleague's unit is plain text.
 */
export function PersonLine({
  entity,
  relation,
  from,
}: {
  entity: EntityDetail['entity'];
  relation: EntityDetail['relation'];
  from?: string | null;
}) {
  const { detail, unit } = entity;
  if (!unit || (relation !== 'managed' && relation !== 'self'))
    return detail || unit ? <>{detail ?? unit?.label}</> : null;
  const link = (
    <Link href={unitPageHref(unit.id, { from: from ?? null })} hasUnderline>
      {unit.label}
    </Link>
  );
  const suffix = ` · ${unit.label}`;
  const before =
    !detail || detail === unit.label ? '' : detail.endsWith(suffix) ? detail.slice(0, -suffix.length) : detail;
  return before ? (
    <>
      {before}
      {' · '}
      {link}
    </>
  ) : (
    link
  );
}

/**
 * Every source's answer for the person, each its own read (artboard C: "Kompetenssystemet svarade inte" while the
 * rest stand). A source that does not answer is said aloud once per answer, as the section's text says it (4.1.3).
 */
export function useSectionAnswers(
  key: string | undefined,
  sources: EntitySource[],
  kind: EntityKind = 'person',
): SectionAnswer[] {
  const queries = useQueries({
    queries: sources.map(s => ({ ...entitySectionQuery(kind, key ?? '', s.capability), enabled: !!key })),
  });
  const answers = sources.map((source, i) => ({ source, query: queries[i]! }));
  const announce = useAnnounce();
  const said = useRef(new Map<string, number>());
  useEffect(() => {
    for (const a of answers) {
      if (!unanswered(a) || a.query.isFetching) continue;
      const at = Math.max(a.query.dataUpdatedAt, a.query.errorUpdatedAt);
      const id = `${key}:${a.source.capability}`;
      if (said.current.get(id) === at) continue;
      said.current.set(id, at);
      announce(`${a.source.source} svarade inte.`);
    }
  });
  return answers;
}

/**
 * One cell of a section's row (D97): its first value as ordinary text or its badge, then what the view puts beside it on
 * the same line ("Bokat" and "tors 12 nov kl. 09:00", "3 öppna" and "2 försenade").
 */
function SectionCell({ group, row }: { group: FieldGroup; row: Row }) {
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
 * One source's row for the person, drawn by the source's declared view (D38, D97): the whole row, so the compact field
 * is left out and a field beside another shares its line. A title that is a state stands first as a line of its own
 * (artboard C, Utvecklingssamtal: "Bokat" and its time); every other cell is a labelled fact (Frånvaro: "I dag" and
 * "Kommande"; Kontakt).
 */
export function SectionRow({ source, row }: { source: EntitySource; row: Row }) {
  const view = rowsView(source.view);
  if (!view) return null;
  const groups = rowGroups(view.fields).filter(g => groupFields(g).some(f => present(row[f.key])));
  if (groups.length === 0) return <Text type="supporting">Inget att visa.</Text>;
  const state = groups.find(g => g.lead.key === view.title && g.lead.format === 'status');
  const facts = groups.filter(g => g !== state);
  return (
    <VStack gap={3}>
      {/* In a row of its own the state is as wide as its badge and its time, not the section's width. */}
      {state && (
        <HStack>
          <SectionCell group={state} row={row} />
        </HStack>
      )}
      {facts.length > 0 && (
        <MetadataList label={{ position: 'start', width: 140 }}>
          {facts.map(g => (
            <MetadataListItem key={g.lead.key} label={g.lead.label}>
              <SectionCell group={g} row={row} />
            </MetadataListItem>
          ))}
        </MetadataList>
      )}
    </VStack>
  );
}

/**
 * One line about a section, for the list of sections (artboards C2 and D): the row's state, the row in one value where
 * the view declares one (D97: "tors 12 nov"), and every other value with a tone ("2 försenade"), each once.
 */
export function SectionSummary({ source, row }: { source: EntitySource; row: Row }) {
  const view = rowsView(source.view);
  if (!view) return null;
  const title = view.fields.find(f => f.key === view.title);
  const toned = view.fields.filter(f => f.format === 'status' && fieldTone(f, row[f.key]) !== 'none');
  const shown = [title, compactField(view.fields), ...toned]
    .filter((f): f is ViewField => !!f && present(row[f.key]))
    .filter((f, i, all) => all.findIndex(x => x.key === f.key) === i);
  if (shown.length === 0) return <Text type="supporting">Inget att visa.</Text>;
  // The line sits in a row that is itself a link: an address, a number or a link out is said as text there.
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      {shown.map(f =>
        f.format === 'email' || f.format === 'phone' || f.format === 'link' ? (
          <Text key={f.key}>{String(row[f.key])}</Text>
        ) : (
          <FieldValue key={f.key} field={f} value={row[f.key]} text="ordinary" />
        ),
      )}
    </HStack>
  );
}

/** "1 att agera på · 1 till kännedom": what Behöver dig holds, for the list of sections. */
export function cardsSummary(cards: EntityCard[]): string {
  const fyi = cards.filter(c => c.kind === 'fyi').length;
  const act = cards.length - fyi;
  return [act ? `${act} att agera på` : '', fyi ? `${fyi} till kännedom` : ''].filter(Boolean).join(' · ');
}

/** A source's page in Clew, with the person's key and Clew's id filled in; none when the page needs an id Clew does not have. */
export function pageHref(source: EntitySource, key: string, id: string | undefined): string | null {
  if (!source.page) return null;
  if (source.page.href.includes('{id}') && !id) return null;
  return source.page.href.replaceAll('{key}', encodeURIComponent(key)).replaceAll('{id}', encodeURIComponent(id ?? ''));
}

/** The source's fuller read for this person (its view's `open`), as the row says how to ask for it. */
export function openOf(source: EntitySource, row: Row | undefined) {
  const view = rowsView(source.view);
  return view?.open && row ? openRef(view.open, row, source.source) : undefined;
}

/**
 * The fuller read under a section (artboard C: the action points under the talk), or in full on the person's page:
 * fetched through the one view path (`/api/cap/<name>?input=`) and drawn by the one renderer (D38).
 */
export function OpenRead({
  source,
  row,
  limit,
  headingLevel = 3,
  tableQuery,
}: {
  source: EntitySource;
  row: Row;
  limit?: number;
  headingLevel?: 2 | 3;
  tableQuery?: string;
}) {
  const ref = openOf(source, row);
  const read = useQuery({
    ...viewQuery(ref?.capability ?? '', ref ? JSON.stringify(ref.input) : null),
    enabled: !!ref,
    retry: false,
  });
  if (!ref) return null;
  if (read.isPending) return <Skeleton height={64} width="100%" />;
  if (read.isError || !read.data.view)
    return (
      <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
        <Text>{source.source} svarade inte.</Text>
        <Button
          size="sm"
          variant="secondary"
          label="Försök igen"
          isLoading={read.isFetching}
          onClick={() => void read.refetch()}
        />
      </HStack>
    );
  return (
    <DeclaredView
      view={read.data.view}
      output={read.data.output}
      headingLevel={headingLevel}
      {...(limit ? { limit } : {})}
      {...(tableQuery ? { tableQuery } : {})}
    />
  );
}

/** At most this many of a source's fuller rows stand under its section (artboard C: three action points). */
const INLINE_ROWS = 5;
/**
 * The fuller read under a section (artboard C: the talk's action points under its state), as a plain short list: up to
 * five rows of a table or a list, each the row's title and, at the end of its line, what else the whole row draws in
 * supporting text with its badges (D97), and nothing around them: no header, no count, no footer. A read of any other
 * kind (a detail, a text) is not drawn here; the section's way in leads to it.
 */
export function InlineRead({ source, row }: { source: EntitySource; row: Row }) {
  const ref = openOf(source, row);
  const read = useQuery({
    ...viewQuery(ref?.capability ?? '', ref ? JSON.stringify(ref.input) : null),
    enabled: !!ref,
    retry: false,
  });
  if (!ref) return null;
  if (read.isPending) return <Skeleton height={48} width="100%" />;
  if (read.isError || !read.data.view)
    return (
      <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
        <Text>{source.source} svarade inte.</Text>
        <Button
          size="sm"
          variant="secondary"
          label="Försök igen"
          isLoading={read.isFetching}
          onClick={() => void read.refetch()}
        />
      </HStack>
    );
  const view = read.data.view;
  if (view.kind !== 'table' && view.kind !== 'list') return null;
  const rows = (viewRows(view, read.data.output) ?? []).slice(0, INLINE_ROWS);
  const title = view.fields.find(f => f.key === view.title);
  if (!rows.length || !title) return null;
  const rest = wholeRow(view.fields).filter(f => f.key !== view.title);
  return (
    <List density="compact" edge="flush" aria-label={ref.title}>
      {rows.map((r, i) => {
        const shown = rest.filter(f => present(r[f.key]));
        const badges = shown.filter(f => f.format === 'status' && isBadged(f, r[f.key]));
        const words = shown.filter(f => !badges.includes(f)).map(f => fieldText(f, r[f.key]));
        return (
          // The rest stands at the end of the line where there is room and under the text where there is not.
          <ListItem
            key={view.ref && typeof r[view.ref] === 'string' ? (r[view.ref] as string) : i}
            label={
              <HStack gap={2} vAlign="center" justify="between" wrap="wrap">
                <FieldValue field={title} value={r[title.key]} text="ordinary" />
                {(words.length > 0 || badges.length > 0) && (
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    {words.length > 0 && <Text type="supporting">{words.join(' · ')}</Text>}
                    {badges.map(f => (
                      <FieldValue key={f.key} field={f} value={r[f.key]} />
                    ))}
                  </HStack>
                )}
              </HStack>
            }
          />
        );
      })}
    </List>
  );
}

/** What a source that did not answer says in its own place (artboard C), with the one way to ask it again. */
export function Unanswered({ answer, short = false }: { answer: SectionAnswer; short?: boolean }) {
  return (
    <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
      <Text>{short ? 'Svarade inte.' : `${answer.source.source} svarade inte.`}</Text>
      <Button
        size="sm"
        variant="secondary"
        label="Försök igen"
        aria-label={`Försök igen med ${answer.source.title}`}
        isLoading={answer.query.isFetching}
        onClick={() => void answer.query.refetch()}
      />
    </HStack>
  );
}

/**
 * A section as the artboards draw it: a bordered box with the section's name as its heading and the source at the end
 * of the heading's line, the body under a divider. It is a named region of the page (`section` with its heading).
 */
export function SectionFrame({
  title,
  caption,
  headingLevel = 3,
  children,
}: {
  title: string;
  caption: string;
  headingLevel?: 2 | 3;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Card padding={0}>
      <VStack as="section" aria-labelledby={id}>
        <Section variant="transparent" paddingInline={4} paddingBlock={3} dividers={['bottom']}>
          <HStack gap={2} vAlign="center" justify="between" wrap="wrap">
            <Heading level={4} accessibilityLevel={headingLevel} id={id}>
              {title}
            </Heading>
            <Text type="supporting">{caption}</Text>
          </HStack>
        </Section>
        <Section variant="transparent" padding={4}>
          {children}
        </Section>
      </VStack>
    </Card>
  );
}

/**
 * The reader's cards about the person or the unit, each leading to the card, its source at the end of the line. A card
 * opens in the panel of the page it is listed on (D107 rules 2 and 3), with the page's address kept: beside the
 * person's or the unit's page with its section and its way back, and over a person's cards listed beside Personal,
 * which closing the card leaves.
 */
export function CardList({ cards }: { cards: EntityCard[] }) {
  const { pathname, search } = useLocation();
  return (
    <List density="compact" hasDividers edge="flush">
      {cards.map(c => (
        <ListItem
          key={c.threadId}
          label={
            <Link href={withCard(pathname, search, c.threadId)} hasUnderline>
              {c.title}
            </Link>
          }
          endContent={
            <Text type="supporting">
              {c.source}
              {c.kind === 'fyi' ? ' · till kännedom' : ''}
            </Text>
          }
        />
      ))}
    </List>
  );
}

/**
 * The opened person's or unit's actions (artboard C2): the first two as buttons, the rest under Fler grouped by the
 * system they act in, as the row menu on Personal is (artboard A3). On a phone one button, Åtgärder, the width of its
 * column, holds them all (artboard D). An action starts on the server and its card opens beside the page it was started
 * on (`entity-actions.ts`); a source's refusal is said aloud and stands under the buttons until the next action. They
 * hold what can be done about the entity, never a choice of where Clew shows it (D107 rule 7), and are the one place
 * the page draws them: a section shows only what its source read (D97, amended 2026-11-11).
 */
export function EntityActions({ detail, mobile }: { detail: EntityDetail; mobile: boolean }) {
  const { start, error } = useEntityAction();
  const { kind, key, name } = detail.entity;
  const run = (a: EntityAction) => start(a, { kind, key, name });
  const actions = detail.actions;
  const refusal = error ? <Text as="p">{error}</Text> : null;
  if (mobile)
    return actions.length > 0 ? (
      <VStack gap={2}>
        <DropdownMenu
          renderTrigger={trigger => (
            <Button
              {...trigger}
              variant="secondary"
              label="Åtgärder"
              aria-label={`Åtgärder för ${name}`}
              width="100%"
            />
          )}
          presentation="adaptive"
          items={actionMenuItems(actions, run)}
        />
        {refusal}
      </VStack>
    ) : null;
  const shown = actions.slice(0, 2),
    rest = actions.slice(2);
  if (shown.length === 0) return null;
  const buttons = (
    <HStack gap={2} wrap="wrap" vAlign="center">
      {shown.map(a => (
        <Button key={a.capability} variant="secondary" label={a.title} onClick={() => run(a)} />
      ))}
      {rest.length > 0 && (
        // The menu is named by its button, which says whose actions they are (Astryx's renderTrigger).
        <DropdownMenu
          renderTrigger={trigger => (
            <Button {...trigger} variant="secondary" label="Fler" aria-label={`Fler åtgärder för ${name}`} />
          )}
          presentation="adaptive"
          items={actionMenuItems(rest, run)}
        />
      )}
    </HStack>
  );
  // One shape with or without a refusal, so the button that was pressed keeps the focus when the refusal appears.
  return (
    <VStack gap={2}>
      {buttons}
      {refusal}
    </VStack>
  );
}

/**
 * The one way into a source's fuller view (artboard C: "Öppna samtalet"): the source's own page in Clew when it has one,
 * otherwise its `open` read, by that read's title, as the person's page with this section chosen. Never both.
 */
function WayIn({
  answer,
  row,
  fullerHref,
  page,
}: {
  answer: SectionAnswer;
  row: Row;
  fullerHref?: string;
  page: string | null;
}) {
  const view = rowsView(answer.source.view);
  const way =
    page && answer.source.page
      ? { title: answer.source.page.title, href: page }
      : view?.open && openOf(answer.source, row) && fullerHref
        ? { title: view.open.title, href: fullerHref }
        : null;
  if (!way) return null;
  return (
    <HStack>
      <Link href={way.href} weight="semibold" isStandalone>
        {way.title}
      </Link>
    </HStack>
  );
}

/**
 * One source's section on the opened person or unit: its row, the fuller read under it as a short list, and the way in.
 * Its heading is level 2 on a page whose sections stand under its h1 (the unit's), level 3 under a heading of level 2.
 */
export function SourceSection({
  answer,
  personKey,
  personId,
  fullerHref,
  headingLevel = 3,
}: {
  answer: SectionAnswer;
  personKey: string;
  personId: string | undefined;
  /** The person's page with this section chosen, for a section drawn anywhere but on that page. */
  fullerHref?: string;
  headingLevel?: 2 | 3;
}) {
  const row = rowOf(answer);
  return (
    <SectionFrame title={answer.source.title} caption={sourceCaption(answer.source)} headingLevel={headingLevel}>
      {answer.query.isPending ? (
        <VStack gap={2}>
          <Skeleton height={20} width="60%" />
          <Skeleton height={20} width="40%" />
        </VStack>
      ) : unanswered(answer) || !row ? (
        <Unanswered answer={answer} />
      ) : (
        <VStack gap={3}>
          <SectionRow source={answer.source} row={row} />
          <InlineRead source={answer.source} row={row} />
          <WayIn
            answer={answer}
            row={row}
            page={pageHref(answer.source, personKey, personId)}
            {...(fullerHref ? { fullerHref } : {})}
          />
        </VStack>
      )}
    </SectionFrame>
  );
}

/** Behöver dig: the cards about the person or the unit, first, named after the place they come from (Clew). */
export function NeedsYouSection({ cards, headingLevel = 3 }: { cards: EntityCard[]; headingLevel?: 2 | 3 }) {
  return (
    <SectionFrame title="Behöver dig" caption="Clew" headingLevel={headingLevel}>
      <CardList cards={cards} />
    </SectionFrame>
  );
}

/** One row in the list of sections (artboards C2 and D): the section's name, its source, one line about it. */
export interface SectionNavRow {
  id: string;
  title: string;
  source: string;
  summary: ReactNode;
  href?: string;
  isSelected?: boolean;
  /** A control at the row's end, for a row that is not a link (a source that did not answer: Försök igen). */
  end?: ReactNode;
}
/** The list of sections: each row leads to its section, the chosen one marked as current. */
export function SectionNav({ rows, label }: { rows: SectionNavRow[]; label?: string }) {
  return (
    <List hasDividers {...(label ? { 'aria-label': label } : {})}>
      {rows.map(r => (
        <ListItem
          key={r.id}
          itemKey={r.id}
          align="start"
          label={
            <HStack gap={2} justify="between" vAlign="center" wrap="wrap">
              <Text weight="semibold">{r.title}</Text>
              <Text type="supporting">{r.source}</Text>
            </HStack>
          }
          description={r.summary}
          {...(r.href ? { href: r.href } : {})}
          {...(r.isSelected ? { isSelected: true } : {})}
          {...(r.end ? { endContent: r.end } : {})}
        />
      ))}
    </List>
  );
}
/** The rows of the list of sections for a person: Behöver dig when there are cards, then each source that has something. */
export function sectionNavRows(
  cards: EntityCard[],
  answers: SectionAnswer[],
  href: (id: string) => string,
  selected: string | undefined,
): SectionNavRow[] {
  const rows: SectionNavRow[] = [];
  if (cards.length > 0)
    rows.push({
      id: NEEDS_YOU,
      title: 'Behöver dig',
      source: 'Clew',
      summary: <Text type="supporting">{cardsSummary(cards)}</Text>,
      href: href(NEEDS_YOU),
      isSelected: selected === NEEDS_YOU,
    });
  for (const a of drawnSections(answers)) {
    const row = rowOf(a);
    const failed = unanswered(a);
    rows.push({
      id: a.source.capability,
      title: a.source.title,
      source: sourceCaption(a.source),
      summary: a.query.isPending ? (
        <Skeleton height={16} width={160} />
      ) : failed || !row ? (
        <Text type="supporting">Svarade inte.</Text>
      ) : (
        <SectionSummary source={a.source} row={row} />
      ),
      ...(failed
        ? {
            end: (
              <Button
                size="sm"
                variant="secondary"
                label="Försök igen"
                aria-label={`Försök igen med ${a.source.title}`}
                isLoading={a.query.isFetching}
                onClick={() => void a.query.refetch()}
              />
            ),
          }
        : { href: href(a.source.capability), isSelected: selected === a.source.capability }),
    });
  }
  return rows;
}
