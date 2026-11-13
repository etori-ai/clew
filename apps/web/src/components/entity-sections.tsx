import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  openRef,
  viewRows,
  type EntityAction,
  type EntityCard,
  type EntityDetail,
  type EntityKind,
  type EntitySection,
  type EntitySource,
  type View,
} from '@clew/contracts';
import {
  AreaChip,
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
import { today } from '@clew/calendar/dates';
import { entitySectionQuery, threadsQuery, viewQuery } from '../queries';
import { actionMenuItems, useEntityAction } from '../entity-actions';
import { useMarks } from '../marks';
import { pageOnly, withCard } from '../panel-address';
import { wayBack } from '../person-address';
import { sourcePageHref } from '../talk-address';
import { rowFacts } from '../work-items';
import { DOT } from '../dot';
import { groupFields, present, rowGroups, wholeRow, type FieldGroup } from '../view-fields';
import { DeclaredView, FieldCell, FieldValue, fieldText, isBadged } from './view';
import { WorkList, WorkRow } from './work-row';

/**
 * The opened person's or unit's content (D97 item 5, D112 item 5, board Person): "Behöver dig" with the reader's work
 * items about them, then one section per source that is about them, each named with its source and each read on its
 * own, so a slow or silent source never holds the others. A source that answered without a row says nothing (no row
 * means "none" or "not allowed"); one that did not answer says so in its own place with a way to ask again. The person's
 * page and the unit's page draw from the same pieces, in the frame of `entity-page.tsx`.
 */
type RowsView = Extract<View, { kind: 'table' | 'list' }>;
type Row = Record<string, unknown>;
/** One source's section and its answer for the opened person. */
export interface SectionAnswer {
  source: EntitySource;
  query: UseQueryResult<EntitySection, Error>;
}
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
 * The label column of a section's facts: 140 px at the start, a longer label wrapping inside it. The person's profile
 * (D114) takes the same one, so on a page its values start where the sources' values do.
 */
export const SECTION_LABELS = { position: 'start', width: 140 } as const;

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
  // One row's facts on the person's page are read, not scanned: a day among them is long ("13 oktober 2026").
  return (
    <FieldCell
      group={group}
      row={row}
      day="long"
      {...(present(value) ? { lead: <FieldValue field={group.lead} value={value} text="ordinary" day="long" /> } : {})}
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
        <MetadataList label={SECTION_LABELS}>
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
  about,
}: {
  source: EntitySource;
  row: Row;
  limit?: number;
  headingLevel?: 2 | 3;
  tableQuery?: string;
  /** The name of the person or unit whose page the read stands on. */
  about?: string;
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
      // The section over it names the source (D124 item 6): the read has its own name as a small heading.
      section={{ title: ref.title, about }}
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
 * supporting text with its badges (D97), under a small heading with the read's own name (D124 item 6) and nothing else
 * around them: no source, no count, no footer. A read of any other kind (a detail, a text) is not drawn here; the
 * section's way in leads to it.
 */
export function InlineRead({ source, row }: { source: EntitySource; row: Row }) {
  const id = useId();
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
    <VStack gap={2}>
      <Heading level={4} accessibilityLevel={3} id={id}>
        {ref.title}
      </Heading>
      <List density="compact" edge="flush" aria-labelledby={id}>
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
                      {words.length > 0 && <Text type="supporting">{words.join(DOT)}</Text>}
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
    </VStack>
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
 * A person's title as the directory says it, without the unit their page names elsewhere: the line before " · <unit>"
 * ("Lärare 4–6"). None when the line is the unit alone, which is all a directory that knows no titles gives.
 */
export function personTitle(entity: EntityDetail['entity']): string | undefined {
  const { detail, unit } = entity;
  if (!detail) return undefined;
  if (!unit) return detail;
  if (detail === unit.label) return undefined;
  const suffix = ` · ${unit.label}`;
  return detail.endsWith(suffix) ? detail.slice(0, -suffix.length) : detail;
}

/** Whose a section is (board Person): the source's name as a badge in the system's hue, Clew's own domain as Clew. */
export function SourceBadge({ source }: { source: EntitySource }) {
  const ordinal = useMarks().system(source.connector)?.ordinal ?? null;
  return <AreaChip ordinal={source.own ? null : ordinal} label={sourceCaption(source)} />;
}

/**
 * A source's own page in Clew for the entity (D95, D111 rule 5: "Öppna samtalet" over the page, "Visa i Personal"), the
 * one way into it, at the end of its section's heading line. A link, never an action.
 */
export function SourceWay({
  source,
  entity,
}: {
  source: EntitySource;
  entity: { key: string; id?: string | undefined };
}) {
  const { pathname, search } = useLocation();
  const href = source.page
    ? sourcePageHref(source.page, entity, { pathname, search }, wayBack(pageOnly(pathname, search)))
    : null;
  return href && source.page ? (
    <Link href={href} weight="semibold" isStandalone>
      {source.page.title}
    </Link>
  ) : null;
}

/** A section's body while its source has not answered yet. */
function Pending() {
  return (
    <VStack gap={2}>
      <Skeleton height={20} width="60%" />
      <Skeleton height={20} width="40%" />
    </VStack>
  );
}

/**
 * One source's section body on a person's page (board Person): the source's row drawn by its declared view, then its
 * fuller read in full (`view.open`), as the chosen section drew them before the sections stood one under the other. A
 * source that did not answer says so with "Försök igen".
 */
export function PersonSourceBody({
  answer,
  tableQuery,
  about,
}: {
  answer: SectionAnswer;
  tableQuery: string;
  /** The person's name, which a record under their own section does not repeat. */
  about: string;
}) {
  const row = rowOf(answer);
  if (answer.query.isPending) return <Pending />;
  if (unanswered(answer) || !row) return <Unanswered answer={answer} />;
  return (
    <VStack gap={5}>
      <SectionRow source={answer.source} row={row} />
      {openOf(answer.source, row) && (
        <OpenRead source={answer.source} row={row} tableQuery={tableQuery} about={about} />
      )}
    </VStack>
  );
}

/**
 * One source's section body on a unit's page: its row, and its fuller read under it as a short list of at most five,
 * as the unit's sections have drawn them.
 */
export function UnitSourceBody({ answer }: { answer: SectionAnswer }) {
  const row = rowOf(answer);
  if (answer.query.isPending) return <Pending />;
  if (unanswered(answer) || !row) return <Unanswered answer={answer} />;
  return (
    <VStack gap={3}>
      <SectionRow source={answer.source} row={row} />
      <InlineRead source={answer.source} row={row} />
    </VStack>
  );
}

/**
 * "Behöver dig" on a person's or a unit's page (board Person): the reader's work items about them, each the one row a
 * work item has everywhere (`WorkRow`: its state, title, why, when it is due, its source), opening beside the page as a
 * card does (D111 rules 2 and 3), the page's address kept. The row of the item open beside the page is the current one.
 * An item the stream does not hold (not read yet, or past its history) keeps a plain row with its title and source.
 */
export function NeedsYouRows({ cards }: { cards: EntityCard[] }) {
  const { pathname, search } = useLocation();
  const threads = useQuery(threadsQuery);
  const marks = useMarks();
  if (threads.isPending)
    return (
      <VStack gap={2}>
        {cards.map(c => (
          <Skeleton key={c.threadId} height={48} width="100%" />
        ))}
      </VStack>
    );
  const now = new Date().toISOString(),
    day = today();
  const open = new URLSearchParams(search).get('card');
  return (
    <WorkList label="Behöver dig">
      {cards.map(c => {
        const thread = threads.data?.threads.find(t => t.id === c.threadId);
        const href = withCard(pathname, search, c.threadId);
        return thread ? (
          <WorkRow
            key={c.threadId}
            thread={thread}
            facts={rowFacts(thread, now, day)}
            source={marks.ofThread(thread).source}
            href={href}
            isSelected={open === c.threadId}
          />
        ) : (
          <ListItem
            key={c.threadId}
            isSelected={open === c.threadId}
            label={
              <Link href={href} weight="semibold" color="primary">
                {c.title}
              </Link>
            }
            endContent={
              <Text type="supporting" color="secondary" textWrap="nowrap">
                {c.source}
              </Text>
            }
          />
        );
      })}
    </WorkList>
  );
}

/**
 * The opened person's or unit's actions in the page's header (D112 item 5, board Person), every one of them: the first
 * two as buttons, the rest under "Fler" grouped by the system they act in, as the row menu on Personal is (artboard
 * A3). On a phone one button, "Åtgärder", the width of the column, holds them all. An action starts on the server and
 * its work item opens beside the page it was started on (`entity-actions.ts`); a source's refusal is said aloud and
 * stands under the buttons until the next action. They hold what can be done about the entity, never a choice of where
 * Clew shows it, and never a way into a source's page, which is a link in its section.
 */
export function EntityActions({ detail, mobile }: { detail: EntityDetail; mobile: boolean }) {
  const { start, error, dialog } = useEntityAction();
  const { kind, key, name } = detail.entity;
  const actions = detail.actions;
  const run = (a: EntityAction) => start(a, { kind, key, name });
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
        {dialog}
      </VStack>
    ) : null;
  const shown = actions.slice(0, 2),
    rest = actions.slice(2);
  if (shown.length === 0) return null;
  // One shape with or without a refusal, so the button that was pressed keeps the focus when the refusal appears.
  return (
    <VStack gap={2}>
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
      {refusal}
      {dialog}
    </VStack>
  );
}
