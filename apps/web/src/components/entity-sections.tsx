import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  fieldTone,
  openRef,
  type EntityCard,
  type EntitySection,
  type EntitySource,
  type View,
  type ViewField,
} from '@clew/contracts';
import {
  Button,
  Card,
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
  type AnimatedLayout,
} from '@clew/ui';
import { entitySectionQuery, viewQuery } from '../queries';
import { withCard } from '../panel-address';
import { DeclaredView, FieldValue } from './view';

/**
 * The opened person's content (D97 item 5, artboards C, C2, D and G): "Behöver dig" with the reader's cards about them,
 * then one section per source that is about a person, each named with its source and each read on its own, so a slow
 * or silent source never holds the others. A source that answered without a row for this person says nothing (no row
 * means "none" or "not allowed"); one that did not answer says so in its own place with a way to ask again. The
 * panel beside a list, the person's page and the phone draw from the same pieces.
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
const empty = (value: unknown) => value === undefined || value === null || value === '';
/** The source answered, and had no row for this person: the section is left out. */
export const rowless = (a: SectionAnswer) => a.query.data?.status === 'ok' && !a.query.data.row;
/** The source did not answer (or not in time), or the request failed. */
export const unanswered = (a: SectionAnswer) => a.query.isError || (!!a.query.data && a.query.data.status !== 'ok');
/** The row this source answered for the person, once it has. */
export const rowOf = (a: SectionAnswer): Row | undefined =>
  a.query.data?.status === 'ok' ? a.query.data.row : undefined;
/** The sections that are drawn: every one but those that answered without a row. */
export const drawnSections = (answers: SectionAnswer[]) => answers.filter(a => !rowless(a));

/**
 * Every source's answer for the person, each its own read (artboard C: "Kompetenssystemet svarade inte" while the
 * rest stand). A source that does not answer is said aloud once per answer, as the section's text says it (4.1.3).
 */
export function useSectionAnswers(key: string | undefined, sources: EntitySource[]): SectionAnswer[] {
  const queries = useQueries({
    queries: sources.map(s => ({ ...entitySectionQuery('person', key ?? '', s.capability), enabled: !!key })),
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
 * Whether a source's row is a state with its time (artboard C, Utvecklingssamtal: "Bokat" and "tors 12 nov kl. 09:00"):
 * its view names a status as the row's title and has a time beside it. Any other row is a set of labelled facts
 * (Frånvaro, Kontakt), drawn as label and value.
 */
const isStateLine = (view: RowsView) =>
  view.fields.some(f => f.key === view.title && f.format === 'status') &&
  view.fields.some(f => f.key !== view.title && (f.format === 'instant' || f.format === 'date'));

/** One source's row for the person, drawn by the source's declared view (D38): the state line or the labelled facts. */
export function SectionRow({ source, row }: { source: EntitySource; row: Row }) {
  const view = rowsView(source.view);
  if (!view) return null;
  const present = view.fields.filter(f => !empty(row[f.key]));
  if (present.length === 0) return <Text type="supporting">Inget att visa.</Text>;
  if (isStateLine(view)) {
    const title = present.filter(f => f.key === view.title);
    const others = present.filter(f => f.key !== view.title);
    return (
      <HStack gap={2} vAlign="center" wrap="wrap">
        {[...title, ...others].map(f => (
          <FieldValue key={f.key} field={f} value={row[f.key]} />
        ))}
      </HStack>
    );
  }
  return (
    <MetadataList label={{ position: 'start', width: 140 }}>
      {present.map(f => (
        <MetadataListItem key={f.key} label={f.label}>
          <FieldValue field={f} value={row[f.key]} />
        </MetadataListItem>
      ))}
    </MetadataList>
  );
}

/** One line about a section, for the list of sections (artboards C2 and D): the row's title value and every value with a tone. */
export function SectionSummary({ source, row }: { source: EntitySource; row: Row }) {
  const view = rowsView(source.view);
  if (!view) return null;
  const said = (f: ViewField) =>
    !empty(row[f.key]) && (f.key === view.title || (f.format === 'status' && fieldTone(f, row[f.key]) !== 'none'));
  const shown = [...view.fields.filter(f => f.key === view.title), ...view.fields.filter(f => f.key !== view.title)]
    .filter(said)
    .filter((f, i, all) => all.findIndex(x => x.key === f.key) === i);
  if (shown.length === 0) return <Text type="supporting">Inget att visa.</Text>;
  // The line sits in a row that is itself a link: an address, a number or a link out is said as text there.
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      {shown.map(f =>
        f.format === 'email' || f.format === 'phone' || f.format === 'link' ? (
          <Text key={f.key} type="supporting">
            {String(row[f.key])}
          </Text>
        ) : (
          <FieldValue key={f.key} field={f} value={row[f.key]} />
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

/** The reader's cards about the person, each leading to the card on Hem, its source at the end of the line. */
export function CardList({ cards }: { cards: EntityCard[] }) {
  return (
    <List density="compact" hasDividers edge="flush">
      {cards.map(c => (
        <ListItem
          key={c.threadId}
          label={
            <Link href={withCard('/', '', c.threadId)} hasUnderline>
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

/** The ways into a source's fuller view: its `open` read on the person's page, and the source's own page in Clew. */
function WaysIn({
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
  const fuller =
    view?.open && openOf(answer.source, row) && fullerHref ? { title: view.open.title, href: fullerHref } : null;
  if (!fuller && !page) return null;
  return (
    <HStack gap={4} wrap="wrap" vAlign="center">
      {fuller && (
        <Link href={fuller.href} weight="semibold" isStandalone>
          {fuller.title}
        </Link>
      )}
      {page && answer.source.page && (
        <Link href={page} weight="semibold" isStandalone>
          {answer.source.page.title}
        </Link>
      )}
    </HStack>
  );
}

/** One source's section on the opened person: its row, the fuller read under it, and the ways in. */
export function SourceSection({
  answer,
  personKey,
  personId,
  fullerHref,
}: {
  answer: SectionAnswer;
  personKey: string;
  personId: string | undefined;
  /** The person's page with this section chosen. */
  fullerHref?: string;
}) {
  const row = rowOf(answer);
  return (
    <SectionFrame title={answer.source.title} caption={answer.source.source}>
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
          <OpenRead source={answer.source} row={row} limit={3} />
          <WaysIn
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

/** Behöver dig: the cards about the person, first, named after the place they come from (Clew). */
export function NeedsYouSection({ cards }: { cards: EntityCard[] }) {
  return (
    <SectionFrame title="Behöver dig" caption="Clew">
      <CardList cards={cards} />
    </SectionFrame>
  );
}

/**
 * Every section on the opened person, one after the other, as they arrive: a section that turns out to have nothing
 * for the person leaves the list, and the ones after it glide up (Astryx's animated layout) instead of jumping.
 */
export function PersonSections({
  cards,
  answers,
  personKey,
  personId,
  name,
  fullerHref,
  animatedLayout,
}: {
  cards: EntityCard[];
  answers: SectionAnswer[];
  personKey: string;
  personId: string | undefined;
  name: string;
  fullerHref: (capability: string) => string;
  animatedLayout: AnimatedLayout;
}) {
  const drawn = drawnSections(answers);
  return (
    <List aria-label={`Om ${name}`} density="compact" edge="flush" animatedLayout={animatedLayout}>
      {cards.length > 0 && <ListItem itemKey={NEEDS_YOU} label={<NeedsYouSection cards={cards} />} />}
      {drawn.map(a => (
        <ListItem
          key={a.source.capability}
          itemKey={a.source.capability}
          label={
            <SourceSection
              answer={a}
              personKey={personKey}
              personId={personId}
              fullerHref={fullerHref(a.source.capability)}
            />
          }
        />
      ))}
    </List>
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
      source: a.source.source,
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
