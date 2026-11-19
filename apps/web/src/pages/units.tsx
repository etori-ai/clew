import { Fragment } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { EntityList, EntitySection, EntitySource, SessionUser } from '@clew/contracts';
import {
  BoardCard,
  Card,
  EmptyState,
  Heading,
  HStack,
  Link,
  MetadataList,
  MetadataListItem,
  proportional,
  registerTable,
  SECTION_GAP,
  Skeleton,
  StackItem,
  StatusDot,
  Table,
  type TableColumn,
  Text,
  TONE_WORDS,
  useMediaQuery,
  useTableStickyColumns,
  VStack,
} from '@clew/ui';
import { areasQuery, entityDetailQuery, entityListQuery, entitySectionQuery } from '../queries';
import { usePageTitle } from '../page-title';
import { Shell, mobileQuery, shortQuery } from '../components/shell/shell';
import { useNav } from '../components/shell/nav';
import { AttentionSkeleton, UnitsSkeleton } from '../components/shell/loading';
import { Summary, measureOf, summaryOf, toneWeight } from '../components/people/unit-figures';
import { sourceWayHref, unitPageHref } from '../person-address';
import { errorMessage } from '../query-policy';
import { fieldText } from '../components/views/view';
import { DOT } from '../dot';
import { PageFrame } from '../components/shell/page-frame';
import { pageSubject, sourceReads } from '../components/conversation/page-conversation';

type Unit = EntityList['groups'][number]['entities'][number];
type Answer = { data?: EntitySection; isPending: boolean; isError: boolean };
type TableRow = { id: string; unit: Unit };
type UnitColumn = TableColumn<TableRow>;
const UNITS = '/units';
// Each column keeps the width its heading and a figure with its word need, so a narrow window scrolls the table sideways
// within itself (1.4.10's exception for a data table) instead of clipping the headings.
const UNIT_WIDTH = proportional(1.2, { minWidth: 180 }),
  SOURCE_WIDTH = proportional(1, { minWidth: 176 });

const silent = (a: Answer) => a.isError || (!!a.data && a.data.status !== 'ok');
const rowIn = (a: Answer) => (a.data?.status === 'ok' ? a.data.row : undefined);

/** One cell while its source answers, when it did not, and when it has nothing for the unit. */
function Cell({ answer, source }: { answer: Answer; source: EntitySource }) {
  if (answer.isPending) return <Skeleton height={16} width={72} />;
  if (silent(answer)) return <Text type="supporting">Svarade inte</Text>;
  const row = rowIn(answer);
  return row ? <Summary source={source} row={row} /> : <Text type="supporting">–</Text>;
}

/** A card's label on a phone, the column heading in one line: "Ekonomi · Avvikelse mot budget · Qlik". */
const cardLabel = (source: EntitySource) => {
  const measure = measureOf(source);
  return [source.title, measure === source.title ? null : measure, source.own ? 'Clew' : source.source]
    .filter(Boolean)
    .join(DOT);
};

/** A column's heading: what the figure is ("Avvikelse mot budget") under the source's title, and where it comes from. */
function SourceHeader({ source }: { source: EntitySource }) {
  const measure = measureOf(source);
  return (
    <VStack gap={0}>
      {/* In ordinary letters, not the registers' small capitals: a measure's name can be one long word
          ("Medarbetarengagemang"), which spaced capitals push out of its column. */}
      <Text weight="semibold">{source.title}</Text>
      <Text type="supporting" weight="normal">
        {measure === source.title ? '' : `${measure}${DOT}`}
        {source.own ? 'Clew' : source.source}
      </Text>
    </VStack>
  );
}

/**
 * One group's units as a table. The unit's name stays in view when a narrow window scrolls the figures sideways: a figure
 * is never read without knowing which unit it is (the responsive-table pattern; Astryx's own pinned column).
 */
function UnitTable({ rows, columns }: { rows: TableRow[]; columns: UnitColumn[] }) {
  const pinned = useTableStickyColumns<TableRow>({ startKeys: ['unit'] });
  // The table stands in its group's card (D130), inside the card's inset, with the registers' rows.
  return <Table<TableRow> data={rows} idKey="id" {...registerTable} plugins={{ pinned }} columns={columns} />;
}

/**
 * Läget's register (D117; D126 rule 8, the `table-page` template), `/units`, where the rail's Läget leads a manager who
 * follows up several units: the units the reader follows up side by side, their own and those of the managers who report to
 * them, in the groups the list of units gives ("Mina enheter", "Enheter under dig"). What needs a conversation comes
 * first: a line on top counts the units by the states that need action or watching, and within each group the units
 * with the most of those stand first. On a wide screen a table, one column per source about a unit that has something
 * for the group, each cell the source's row in short, its heading saying what the figure is and where it comes from; on
 * a phone a card per unit with the same figures one under the other. A unit's name opens its page with this one as the
 * way back. Each cell is its own read, so a source that does not answer says so in its own cells while the rest stand.
 * The corner's "Fråga AI" opens the assistant's pane beside the units (D130, D133), about what the columns show: each
 * column's source through the overview the assistant may make of it, and the pane says which it may not. While it
 * stands there the table scrolls sideways inside itself, the names pinned, and the page never does (1.4.10).
 */
export function UnitsPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const nav = useNav({ current: { surface: 'units' }, admin, manager: user.role === 'manager' });
  usePageTitle('Läget');
  const list = useQuery(entityListQuery('unit'));
  const groups = list.data?.groups.filter(g => g.entities.length) ?? [];
  const units = groups.flatMap(g => g.entities);
  // The sources about a unit are the same for every unit the reader follows up: read them off the first one's page.
  const first = units[0]?.key;
  const detail = useQuery({ ...entityDetailQuery('unit', first ?? ''), enabled: !!first });
  // The key figures first and Clew's own sources (the round of talks) after them: the figures are what the follow-up is for.
  const sources: EntitySource[] = [...(detail.data?.sections ?? [])].sort((a, b) => Number(!!a.own) - Number(!!b.own));
  const answers = useQueries({
    queries: units.flatMap(u => sources.map(s => entitySectionQuery('unit', u.key, s.capability))),
  });
  const indexOf = new Map(units.map((u, i) => [u.key, i]));
  const answerOf = (key: string, sourceIndex: number): Answer =>
    answers[indexOf.get(key)! * sources.length + sourceIndex]!;
  const settled = answers.every(a => !a.isPending);

  /** A unit's states that need action or watching, each with its source, for the order and the line on top. */
  const statesOf = (key: string) =>
    sources.flatMap((s, si) => {
      const row = rowIn(answerOf(key, si));
      if (!row) return [];
      const summary = summaryOf(s, row);
      return summary.state && toneWeight(summary.tone) > 0
        ? [{ source: s, tone: summary.tone, word: fieldText(summary.state, row[summary.state.key]) }]
        : [];
    });
  const weightOf = (key: string) => statesOf(key).reduce((sum, s) => sum + toneWeight(s.tone), 0);
  // Once every source has answered, the units with the most to talk about come first; until then, as the list gives them.
  const ordered = (entities: Unit[]) =>
    settled ? [...entities].sort((a, b) => weightOf(b.key) - weightOf(a.key)) : entities;

  // The line on top: per source and state, the units it holds ("Ekonomi · Mot underskott – Bergsåkers skola, Hagaskolan").
  const counts = new Map<string, { source: EntitySource; word: string; tone: 'alert' | 'warn'; units: Unit[] }>();
  if (settled)
    for (const u of units)
      for (const s of statesOf(u.key)) {
        const id = `${s.source.capability}:${s.word}`;
        const c = counts.get(id) ?? { source: s.source, word: s.word, tone: s.tone as 'alert' | 'warn', units: [] };
        c.units.push(u);
        counts.set(id, c);
      }
  const attention = [...counts.values()].sort(
    (a, b) => toneWeight(b.tone) - toneWeight(a.tone) || b.units.length - a.units.length,
  );
  /**
   * Where a line's unit leads: to the source's own tab of the unit's page when its way in is one (the dialogue, D126
   * rule 3), else the unit's page; either way with Läget's register as the way back.
   */
  const wayInto = (unit: Unit, source: EntitySource) => {
    const page = unitPageHref(unit.key, { from: UNITS });
    if (!source.page?.href.startsWith('?')) return page;
    return sourceWayHref(source, { kind: 'unit', key: unit.key }, { pathname: UNITS, search: '' }, UNITS) ?? page;
  };

  const unitLink = (unit: Unit) => (
    <Link href={unitPageHref(unit.key, { from: UNITS })} weight="semibold">
      {unit.name}
    </Link>
  );

  // Until every source has answered, the line on top keeps its place, so the tables do not jump down when it arrives.
  const summaryLine = !settled ? (
    <AttentionSkeleton />
  ) : attention.length ? (
    <BoardCard id="units-attention" title="Att ta upp">
      <VStack gap={1}>
        {attention.map(a => (
          <HStack key={`${a.source.capability}:${a.word}`} gap={2} vAlign="start">
            {/* The dot names the level in Clew's words (D54), the line the source's own word: a screen reader hears each once. */}
            <StatusDot
              variant={a.tone === 'alert' ? 'error' : 'warning'}
              label={a.tone === 'alert' ? TONE_WORDS.alert.word : TONE_WORDS.warn.word}
            />
            {/* The words take the room beside the dot and wrap within it, so the dot never stands alone on a line. */}
            <StackItem size="fill">
              <Text>
                {a.source.title}
                {DOT}
                {a.word} –{' '}
                {a.units.map((u, i) => (
                  <Fragment key={u.key}>
                    {i > 0 && ', '}
                    <Link href={wayInto(u, a.source)}>{u.name}</Link>
                  </Fragment>
                ))}
              </Text>
            </StackItem>
          </HStack>
        ))}
      </VStack>
    </BoardCard>
  ) : (
    <Text type="supporting" role="status">
      Inget av nyckeltalen behöver åtgärd eller bevakas just nu.
    </Text>
  );

  // Every group's table has the same columns at the same widths, so a figure stands under the same figure in "Mina
  // enheter" and "Enheter under dig" whatever each group has: a column is there when any unit has something in it, and
  // a unit without is "–".
  const sourceColumns = sources
    .map((s, si) => ({ s, si }))
    .filter(({ si }) => !settled || units.some(u => !!rowIn(answerOf(u.key, si)) || silent(answerOf(u.key, si))));
  const columns: UnitColumn[] = [
    { key: 'unit', header: 'Enhet', width: UNIT_WIDTH, renderCell: r => unitLink(r.unit) },
    ...sourceColumns.map(({ s, si }) => ({
      key: `source:${s.capability}`,
      header: <SourceHeader source={s} />,
      width: SOURCE_WIDTH,
      renderCell: (r: TableRow) => <Cell answer={answerOf(r.unit.key, si)} source={s} />,
    })),
  ];

  // What the pane beside the page is about (D130 rule 4): what the columns show, once the sources are known.
  const views = useQuery(areasQuery).data?.views;
  const subject =
    list.isPending || (first && detail.isPending)
      ? null
      : pageSubject({ key: 'units', title: 'Läget', reads: sourceColumns.flatMap(({ s }) => sourceReads(s)), views });

  const body = list.isError ? (
    <Text as="p" role="alert">
      {errorMessage(list.error, 'Enheterna kunde inte hämtas just nu.')}
    </Text>
  ) : list.isPending || (first && detail.isPending) ? (
    <UnitsSkeleton />
  ) : !units.length ? (
    <EmptyState headingLevel={2} title="Du följer inte upp någon enhet" description="Dialogstödet är för chefer." />
  ) : (
    <>
      {summaryLine}
      {groups.map(g => {
        // A source with nothing for any unit of the group (the round of talks for the units below) has no row on its card.
        const shown = sources
          .map((s, si) => ({ s, si }))
          .filter(
            ({ si }) => !settled || g.entities.some(u => !!rowIn(answerOf(u.key, si)) || silent(answerOf(u.key, si))),
          );
        const table = <UnitTable rows={ordered(g.entities).map(unit => ({ id: unit.key, unit }))} columns={columns} />;
        // On a wide window the group is a card with its heading inside and its table under it (D130 item 20). On a
        // phone a card per unit under the group's heading, the figures one under the other: a table would put them off
        // the screen, and a card in a card would frame them twice.
        return mobile ? (
          <VStack key={g.id} gap={3} as="section" aria-labelledby={`units-${g.id}`}>
            <Heading level={2} id={`units-${g.id}`}>
              {g.label}
            </Heading>
            <VStack gap={3}>
              {ordered(g.entities).map(unit => (
                <Card key={unit.key} padding={4}>
                  <VStack gap={3}>
                    {unitLink(unit)}
                    <MetadataList label={{ position: 'top' }}>
                      {shown.map(({ s, si }) => (
                        // The measure and its source as the table's heading names them: a figure is never bare.
                        <MetadataListItem key={s.capability} label={cardLabel(s)}>
                          <Cell answer={answerOf(unit.key, si)} source={s} />
                        </MetadataListItem>
                      ))}
                    </MetadataList>
                  </VStack>
                </Card>
              ))}
            </VStack>
          </VStack>
        ) : (
          <BoardCard key={g.id} id={`units-${g.id}`} title={g.label} count={g.entities.length} countLabel="enheter">
            {table}
          </BoardCard>
        );
      })}
    </>
  );

  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      <PageFrame
        ask={{ subject }}
        cards
        title="Läget"
        meta={units.length > 0 ? (units.length === 1 ? '1 enhet' : `${units.length} enheter`) : undefined}
        label="Enheter"
      >
        <VStack gap={SECTION_GAP}>{body}</VStack>
      </PageFrame>
    </Shell>
  );
}
