import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BOARDING_EVENT_WORDS,
  BOARDING_IMPORT_COLUMNS,
  BOARDING_IMPORT_MAX_CHARS,
  BOARDING_IMPORT_ROWS_MAX,
  BOARDING_KIND_WORDS,
  BOARDING_OWNER_WORDS,
  boardingLayersOf,
  parseBoardingImport,
  type BoardingImportOutcome,
  type BoardingImportResult,
  type BoardingImportRow,
  type SessionUser,
} from '@clew/contracts';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  FileInput,
  HStack,
  List,
  ListItem,
  Pagination,
  Section,
  Table,
  Text,
  Toolbar,
  VStack,
  pixel,
  proportional,
  useMediaQuery,
} from '@clew/ui';
import { api } from '../../api';
import { ApiError } from '../../api-error';
import { BOARDING_ADMIN_PATH } from '../../boarding-address';
import { conditionWords, itemsWords } from '../../boarding';
import { boardingLayersQuery } from '../../queries';
import { keys } from '../../query-keys';
import { errorMessage } from '../../query-policy';
import { useAdminAction } from '../../mutations';
import { usePageTitle } from '../../page-title';
import { PageHeader } from '../../components/page-header';
import { mobileQuery } from '../../components/shell';
import { AdminShell } from './shell';

/**
 * "Importera från fil" under Administration › Introduktion och avslut (D124 item 10), on the pattern of the competence
 * catalogue's import: the file is read in the browser with the parser the server checks every row with again
 * (`parseBoardingImport`), and never leaves the page until it is imported. The page says how many rows and layers it
 * found and lists, row by row in Swedish, what cannot be read; the layers are previewed with whom each applies to and
 * how many items it holds, and the rows a page at a time. The import is sent whole, at most 2000 rows, and only for a
 * file with no problem: a layer is replaced by its event and name, so a file with a row left out would replace a layer
 * without it. The outcome says how many layers were added, replaced and left as they were; the same file twice changes
 * nothing. Refused while the module is off and to an administrator without `admin.boarding`.
 */
const PAGE = 50;
const MB = BOARDING_IMPORT_MAX_CHARS / 1_000_000;
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const rowsText = (n: number) => `${thousands(n)} ${n === 1 ? 'rad' : 'rader'}`;
const layersText = (n: number) => `${thousands(n)} lager`;
const outcomeText = ({ added, replaced, unchanged }: BoardingImportOutcome) =>
  `${layersText(added)} lades till, ${layersText(replaced)} ersattes och ${layersText(unchanged)} var oförändrade.`;
/** An item's day as the file counts it: "14 dagar före", "på dagen", "3 dagar efter". */
const offsetText = (days: number) =>
  days === 0
    ? 'På dagen'
    : `${Math.abs(days)} ${Math.abs(days) === 1 ? 'dag' : 'dagar'} ${days < 0 ? 'före' : 'efter'}`;
interface Row extends Record<string, unknown> {
  id: string;
  r: BoardingImportRow;
}

/** A file that was read whole: its layers, its rows a page at a time, and the import. */
function FileCard({ result, mobile }: { result: BoardingImportResult; mobile: boolean }) {
  const { layers } = useMemo(() => boardingLayersOf(result.rows), [result]);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(result.rows.length / PAGE));
  const current = Math.min(page, pages);
  const shown = result.rows.slice((current - 1) * PAGE, current * PAGE);
  const action = useAdminAction({
    invalidate: [keys.boarding.all],
    toastId: 'boarding:import',
    fallback: 'Importen kunde inte sparas.',
  });
  const [outcome, setOutcome] = useState<BoardingImportOutcome | null>(null);
  const run = () => {
    if (action.busy) return;
    setOutcome(null);
    void action.run(async () => {
      const done = await api.boarding.importLayers({ rows: result.rows });
      setOutcome(done);
      return outcomeText(done);
    });
  };
  const layerColumns = [
    {
      key: 'name',
      header: 'Lager',
      width: proportional(2, { minWidth: 180 }),
      renderCell: (l: { id: string; layer: (typeof layers)[number] }) => <Text weight="semibold">{l.layer.name}</Text>,
    },
    {
      key: 'event',
      header: 'Händelse',
      width: pixel(130),
      renderCell: (l: { id: string; layer: (typeof layers)[number] }) => (
        <Text>{BOARDING_EVENT_WORDS[l.layer.event]}</Text>
      ),
    },
    {
      key: 'condition',
      header: 'Gäller',
      width: proportional(3, { minWidth: 200 }),
      renderCell: (l: { id: string; layer: (typeof layers)[number] }) => (
        <Text>{conditionWords(l.layer.condition, l.layer.value)}</Text>
      ),
    },
    {
      key: 'items',
      header: 'Punkter',
      width: pixel(110),
      renderCell: (l: { id: string; layer: (typeof layers)[number] }) => (
        <Text hasTabularNumbers>{l.layer.items.length}</Text>
      ),
    },
  ];
  const rowColumns = [
    { key: 'row', header: 'Rad', width: pixel(72), renderCell: (x: Row) => <Text color="secondary">{x.r.row}</Text> },
    {
      key: 'title',
      header: 'Punkt',
      width: proportional(3, { minWidth: 200 }),
      renderCell: (x: Row) => <Text weight="semibold">{x.r.title}</Text>,
    },
    {
      key: 'layer',
      header: 'Lager',
      width: proportional(2, { minWidth: 140 }),
      renderCell: (x: Row) => <Text>{x.r.layer}</Text>,
    },
    {
      key: 'kind',
      header: 'Typ',
      width: pixel(130),
      renderCell: (x: Row) => <Text>{BOARDING_KIND_WORDS[x.r.kind]}</Text>,
    },
    {
      key: 'owner',
      header: 'Ansvarig',
      width: pixel(140),
      renderCell: (x: Row) => <Text>{BOARDING_OWNER_WORDS[x.r.owner]}</Text>,
    },
    {
      key: 'offset',
      header: 'När',
      width: pixel(140),
      renderCell: (x: Row) => <Text>{offsetText(x.r.offsetDays)}</Text>,
    },
  ];
  return (
    <>
      <Card padding={0}>
        <Toolbar
          label="Lager i filen"
          size="sm"
          dividers={['bottom']}
          startContent={
            <VStack gap={0}>
              <Text weight="semibold">Lager i filen</Text>
              <Text type="supporting">{`${layersText(layers.length)} med ${rowsText(result.rows.length)} att importera.`}</Text>
            </VStack>
          }
        />
        {mobile ? (
          <List aria-label="Lagren i filen" hasDividers>
            {layers.map(l => (
              <ListItem
                key={`${l.event}:${l.name}`}
                label={<Text weight="semibold">{l.name}</Text>}
                description={
                  <Text type="supporting">{`${BOARDING_EVENT_WORDS[l.event]} · ${conditionWords(l.condition, l.value)} · ${itemsWords(l.items.length)}`}</Text>
                }
              />
            ))}
          </List>
        ) : (
          <Table
            aria-label="Lagren i filen"
            data={layers.map(l => ({ id: `${l.event}:${l.name}`, layer: l }))}
            idKey="id"
            columns={layerColumns}
            density="balanced"
          />
        )}
        <Section variant="transparent" padding={3}>
          <VStack gap={3}>
            {action.error && (
              <Banner
                status="error"
                container="card"
                collapsible={false}
                title={action.error}
                description="Ingenting sparades. Rätta filen och välj den igen."
              />
            )}
            {outcome && !action.error && (
              <Text as="p" type="supporting">
                {`Senaste importen: ${outcomeText(outcome)}`}
              </Text>
            )}
            <HStack gap={2} wrap="wrap">
              <Button
                variant="primary"
                label={`Importera ${layersText(layers.length)}`}
                onClick={run}
                isLoading={action.busy}
              />
            </HStack>
          </VStack>
        </Section>
      </Card>
      <Card padding={0}>
        <Toolbar
          label="Rader"
          size="sm"
          dividers={['bottom']}
          startContent={
            <VStack gap={0}>
              <Text weight="semibold">Rader</Text>
              <Text type="supporting">{`${rowsText(result.rows.length)} i filens ordning.`}</Text>
            </VStack>
          }
        />
        {mobile ? (
          <List aria-label="Raderna i filen" hasDividers>
            {shown.map(r => (
              <ListItem
                key={r.row}
                label={<Text weight="semibold">{r.title}</Text>}
                description={
                  <Text type="supporting">{`Rad ${r.row} · ${r.layer} · ${BOARDING_KIND_WORDS[r.kind]} · ${BOARDING_OWNER_WORDS[r.owner]} · ${offsetText(r.offsetDays)}`}</Text>
                }
              />
            ))}
          </List>
        ) : (
          <Table<Row>
            aria-label="Raderna i filen"
            data={shown.map(r => ({ id: String(r.row), r }))}
            idKey="id"
            columns={rowColumns}
            density="balanced"
            {...(result.rows.length > PAGE
              ? { rowIndexStart: (current - 1) * PAGE + 1, rowCount: result.rows.length }
              : {})}
          />
        )}
        {result.rows.length > PAGE && (
          <Section variant="transparent" padding={3}>
            <HStack justify="center">
              <Pagination
                label="Sidor med rader"
                size="sm"
                variant={mobile ? 'compact' : 'pages'}
                page={current}
                totalItems={result.rows.length}
                pageSize={PAGE}
                onChange={setPage}
              />
            </HStack>
          </Section>
        )}
      </Card>
    </>
  );
}

export function AdminBoardingImportPage({ user }: { user: SessionUser }) {
  usePageTitle('Importera lager');
  const mobile = useMediaQuery(mobileQuery);
  // The layers are read for the refusal: while the module is off, or without the capability, the page says so.
  const query = useQuery(boardingLayersQuery);
  const refused = query.error instanceof ApiError && query.error.status === 403;
  const error = query.isError && !refused ? errorMessage(query.error, 'Lagren kunde inte läsas.') : null;
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BoardingImportResult | null>(null);
  const [reading, setReading] = useState(false);
  /** Each file read is a new preview: the file's card starts over. */
  const [readCount, setReadCount] = useState(0);
  const choose = async (value: File | File[] | null) => {
    const chosen = Array.isArray(value) ? (value[0] ?? null) : value;
    setFile(chosen);
    setResult(null);
    if (!chosen) return;
    setReading(true);
    try {
      // What became of the file is the field's status, which Astryx announces (4.1.3): nothing is said twice.
      setResult(parseBoardingImport(await chosen.text()));
      setReadCount(n => n + 1);
    } catch {
      setResult({
        rows: [],
        problems: [{ row: 0, message: 'Filen kunde inte läsas. Välj den igen.' }],
        problemCount: 1,
      });
    } finally {
      setReading(false);
    }
  };
  const whole = !!result && result.problemCount === 0 && result.rows.length > 0;
  const fileStatus =
    !file || !result
      ? undefined
      : whole
        ? ({ type: 'success', message: `${rowsText(result.rows.length)} att importera.` } as const)
        : ({
            type: 'error',
            message: result.problemCount
              ? `${result.problemCount} ${result.problemCount === 1 ? 'rad kan' : 'rader kan'} inte läsas in. Felen står under fältet.`
              : 'Filen har inga rader att importera.',
          } as const);
  const listed = result?.problems.slice(0, 20) ?? [];
  const more = (result?.problemCount ?? 0) - listed.length;
  return (
    <AdminShell
      user={user}
      section="introduktion"
      crumbs={[{ label: 'Introduktion och avslut', href: BOARDING_ADMIN_PATH }, { label: 'Importera' }]}
      pending={query.isPending}
    >
      <PageHeader
        title="Importera lager"
        meta={
          <Text as="p" color="secondary">
            Läs in lagren för introduktion och avslut från en fil. Ett lager som redan finns med samma händelse och namn
            ersätts om något i det har ändrats, så samma fil kan läsas in igen.
          </Text>
        }
      />
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      {refused && (
        <Card>
          <EmptyState
            headingLevel={2}
            title="Importen är inte tillgänglig för dig"
            description={`${errorMessage(query.error, 'Du saknar behörighet för åtgärden.')} Introduktion och avslut slås på under Anslutna system, och lagren kräver behörigheten Administrera introduktion och avslut.`}
            actions={<Button label="Till Anslutna system" href="/admin/connectors" />}
          />
        </Card>
      )}
      {query.data && (
        <Card padding={0}>
          <Toolbar
            label="Fil"
            size="sm"
            dividers={['bottom']}
            startContent={
              <VStack gap={0}>
                <Text weight="semibold">Fil</Text>
                <Text type="supporting">
                  En rad per punkt, med lagrets namn, händelse och villkor på varje rad. Filen skickas hel, och bara när
                  alla rader går att läsa.
                </Text>
              </VStack>
            }
          />
          <Section variant="transparent" padding={4}>
            <VStack gap={3}>
              <FileInput
                label="Fil med lager"
                value={file}
                onChange={v => void choose(v)}
                accept=".csv,text/csv"
                maxSize={BOARDING_IMPORT_MAX_CHARS}
                placeholder="Välj en fil"
                isLoading={reading}
                status={fileStatus}
                description={`En CSV-fil sparad som UTF-8, högst ${MB} MB och ${thousands(BOARDING_IMPORT_ROWS_MAX)} rader. Den första raden är ${BOARDING_IMPORT_COLUMNS.join(', ')}.`}
              />
              {result && result.problemCount > 0 && (
                <Banner
                  status="error"
                  container="card"
                  collapsible={false}
                  title={`${result.problemCount} ${result.problemCount === 1 ? 'rad kan' : 'rader kan'} inte läsas in`}
                  description="Inget har sparats. Rätta raderna nedan och välj filen igen: filen importeras bara hel."
                >
                  <List aria-label="Det som inte kan läsas in" hasDividers>
                    {listed.map((p, i) => (
                      <ListItem key={i} label={<Text>{p.row ? `Rad ${p.row}: ${p.message}` : p.message}</Text>} />
                    ))}
                    {more > 0 && <ListItem label={<Text>{`… och ${more} till.`}</Text>} />}
                  </List>
                </Banner>
              )}
            </VStack>
          </Section>
        </Card>
      )}
      {query.data && whole && <FileCard key={readCount} result={result} mobile={mobile} />}
    </AdminShell>
  );
}
