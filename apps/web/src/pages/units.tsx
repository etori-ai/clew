import { useQueries, useQuery } from '@tanstack/react-query';
import type { EntityList, EntitySection, EntitySource, SessionUser, View } from '@clew/contracts';
import {
  EmptyState,
  HStack,
  Heading,
  Layout,
  LayoutContent,
  Link,
  Skeleton,
  Table,
  Text,
  VStack,
  proportional,
  useMediaQuery,
} from '@clew/ui';
import { entityDetailQuery, entityListQuery, entitySectionQuery } from '../queries';
import { usePageTitle } from '../page-title';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { useRail } from '../components/nav';
import { PageHeader } from '../components/page-header';
import { ContentSkeleton } from '../components/loading';
import { FieldValue } from '../components/view';
import { present } from '../view-fields';
import { unitPageHref } from '../person-address';
import { errorMessage } from '../query-policy';

type Row = Record<string, unknown>;
type Unit = EntityList['groups'][number]['entities'][number];
type TableRow = { id: string; unit: Unit };
const UNITS = '/units';
// Each column keeps the width its heading and a figure with its word need, so a narrow window scrolls the table sideways
// within itself (1.4.10's exception for a data table) instead of clipping the headings.
const UNIT_WIDTH = proportional(1.2, { minWidth: 200 }),
  SOURCE_WIDTH = proportional(1, { minWidth: 190 });

/**
 * A source's row for one unit in one cell: its title value ("6,3 %", "−2,1 mnkr", "0 av 3 hållna") and beside it the
 * first state the view gives a tone ("Bevaka", "Mot underskott"), as the unit's page draws the same row in full.
 */
function Summary({ view, row }: { view: View; row: Row }) {
  if (view.kind !== 'table' && view.kind !== 'list') return null;
  const title = view.fields.find(f => f.key === view.title);
  const state = view.fields.find(f => f.format === 'status' && f.key !== view.title && present(row[f.key]));
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      {title && present(row[title.key]) && <FieldValue field={title} value={row[title.key]} text="ordinary" />}
      {state && <FieldValue field={state} value={row[state.key]} />}
    </HStack>
  );
}

/** One cell while its source answers, when it did not, and when it has nothing for the unit. */
function Cell({
  answer,
  view,
}: {
  answer: { data?: EntitySection; isPending: boolean; isError: boolean };
  view: View;
}) {
  if (answer.isPending) return <Skeleton height={16} width={72} />;
  if (answer.isError || (answer.data && answer.data.status !== 'ok'))
    return <Text type="supporting">Svarade inte</Text>;
  const row = answer.data?.row;
  return row ? <Summary view={view} row={row} /> : <Text type="supporting">–</Text>;
}

/**
 * Dialogstöd (D117): the units the reader follows up side by side, their own and those of the managers who report to
 * them, in the groups the list of units gives ("Mina enheter", "Enheter under dig"), one row per unit and one column per
 * source about a unit (the key figures, the round of talks), each cell the source's row in short. A unit's name opens its
 * page with this one as the way back. The sources are the ones the reader's first unit's page has; each cell is its own
 * read, so a source that does not answer says so in its own cells while the rest stand. Big-boss-board's start page,
 * which the plan for absorbing it carries over.
 */
export function UnitsPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const nav = useRail({ current: { surface: 'verktyg', view: null }, admin, manager: user.role === 'manager' });
  usePageTitle('Dialogstöd');
  const list = useQuery(entityListQuery('unit'));
  const groups = list.data?.groups.filter(g => g.entities.length) ?? [];
  const units = groups.flatMap(g => g.entities);
  // The sources about a unit are the same for every unit the reader follows up: read them off the first one's page.
  const first = units[0]?.key;
  const detail = useQuery({ ...entityDetailQuery('unit', first ?? ''), enabled: !!first });
  const sources: EntitySource[] = detail.data?.sections ?? [];
  const answers = useQueries({
    queries: units.flatMap(u => sources.map(s => entitySectionQuery('unit', u.key, s.capability))),
  });
  const answerOf = (unitIndex: number, sourceIndex: number) => answers[unitIndex * sources.length + sourceIndex]!;
  const indexOf = new Map(units.map((u, i) => [u.key, i]));

  const body = list.isError ? (
    <Text as="p" role="alert">
      {errorMessage(list.error, 'Enheterna kunde inte hämtas just nu.')}
    </Text>
  ) : list.isPending || (first && detail.isPending) ? (
    <ContentSkeleton heading={false} />
  ) : !units.length ? (
    <EmptyState headingLevel={2} title="Du följer inte upp någon enhet" description="Dialogstödet är för chefer." />
  ) : (
    groups.map(g => (
      <VStack key={g.id} gap={3} as="section" aria-labelledby={`units-${g.id}`}>
        <Heading level={2} id={`units-${g.id}`}>
          {g.label}
        </Heading>
        <Table<TableRow>
          data={g.entities.map(unit => ({ id: unit.key, unit }))}
          idKey="id"
          density="balanced"
          columns={[
            {
              key: 'unit',
              header: 'Enhet',
              width: UNIT_WIDTH,
              renderCell: (r: TableRow) => (
                <Link href={unitPageHref(r.unit.key, { from: UNITS })} weight="semibold">
                  {r.unit.name}
                </Link>
              ),
            },
            ...sources.map((s, si) => ({
              key: `source:${s.capability}`,
              header: s.title,
              width: SOURCE_WIDTH,
              renderCell: (r: TableRow) => <Cell answer={answerOf(indexOf.get(r.unit.key)!, si)} view={s.view} />,
            })),
          ]}
        />
      </VStack>
    ))
  );

  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      <Layout
        height={short ? 'auto' : 'fill'}
        padding={mobile ? 3 : 8}
        content={
          <LayoutContent padding={0}>
            <VStack
              paddingInline={mobile ? 3 : 8}
              paddingBlockStart={mobile ? 3 : 8}
              paddingBlockEnd={mobile ? 3 : 5}
              gap={6}
            >
              <VStack gap={1}>
                <PageHeader title="Dialogstöd" />
                <Text type="supporting">
                  Nyckeltalen för dina enheter och för enheterna vars chefer rapporterar till dig. Välj en enhet för att
                  gå igenom den.
                </Text>
              </VStack>
              {body}
            </VStack>
          </LayoutContent>
        }
      />
    </Shell>
  );
}
