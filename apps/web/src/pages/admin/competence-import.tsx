import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COMPETENCE_IMPORT_AREA_MAX,
  COMPETENCE_IMPORT_KIND_WORDS,
  COMPETENCE_IMPORT_MAX_CHARS,
  COMPETENCE_IMPORT_REQUEST_MAX,
  COMPETENCE_IMPORT_ROWS_MAX,
  catalogueMatcher,
  importText,
  parseCompetenceImport,
  type CompetenceImportFormat,
  type CompetenceImportOutcome,
  type CompetenceImportResult,
  type CompetenceImportRow,
  type CompetenceType,
  type SessionUser,
} from '@clew/contracts';
import {
  Badge,
  Banner,
  Button,
  Card,
  CheckboxList,
  CheckboxListItem,
  EmptyState,
  FileInput,
  HStack,
  Link,
  List,
  ListItem,
  Pagination,
  ProgressBar,
  Section,
  Selector,
  Table,
  TableSelectionToolbar,
  Text,
  TextInput,
  Toolbar,
  VStack,
  pixel,
  proportional,
  useMediaQuery,
  useTableSelection,
} from '@clew/ui';
import { api } from '../../api';
import { ApiError } from '../../api-error';
import { competenceCatalogueQuery } from '../../queries';
import { keys } from '../../query-keys';
import { errorMessage } from '../../query-policy';
import { useAdminAction } from '../../mutations';
import { usePageTitle } from '../../page-title';
import { PageHeader } from '../../components/page-header';
import { mobileQuery } from '../../components/shell';
import { AdminShell } from './shell';

/**
 * "Importera" under Administration › Kompetens (D120 item 7): many types added to the catalogue at once from a file, on
 * the pattern of Utseende. The file is read in the browser with the parser the server checks every row with again
 * (`parseCompetenceImport`, `competenceImportRowProblem`): Clew's own CSV or ESCO's skills file, recognised by its first
 * row. The page says which format it found, how many rows, and what could not be read, then lists the rows a page at a
 * time (ESCO's file has about 14 000, which are never all drawn), searchable, with a checkbox each: the rows of the page,
 * or every row that matches the search, are chosen at once. A row the catalogue holds already, by its address or its
 * name, is marked and cannot be chosen. ESCO's rows go under one area the administrator chooses, an existing one or a
 * new one; a row of Clew's names its own, and an area that no type has yet comes into being with it. "Importera N"
 * sends the choice in parts of `COMPETENCE_IMPORT_REQUEST_MAX` and says how many were added and how many the catalogue
 * held already; a part sent again changes nothing. For an ESCO file the page prints the acknowledgement ESCO's terms ask
 * for. Like the catalogue it is refused while the module is off and to an administrator without `admin.competence`.
 */
export const IMPORT_PATH = '/admin/competence/import';
const PAGE = 50;
/** The Selector's value for "a new area", which no area's name can be: an area is one line with no control character. */
const NEW_AREA = '\n';
const MB = COMPETENCE_IMPORT_MAX_CHARS / 1_000_000;
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const rowsText = (n: number) => `${thousands(n)} ${n === 1 ? 'rad' : 'rader'}`;
const formatWord: Record<CompetenceImportFormat, string> = {
  clew: 'Clews format',
  esco: 'ESCO:s färdigheter',
};
/** ESCO's terms ask a service that uses the classification to say so (Commission Decision 2011/833/EU on reuse). */
const ESCO_ACKNOWLEDGEMENT =
  'Den här tjänsten använder ESCO-klassificeringen från Europeiska kommissionen. Klassificeringen återanvänds enligt kommissionens beslut 2011/833/EU om vidareutnyttjande av kommissionens handlingar.';
const outcomeText = ({ added, skipped }: CompetenceImportOutcome) =>
  `${thousands(added)} ${added === 1 ? 'kompetens lades' : 'kompetenser lades'} till i katalogen.${
    skipped ? ` ${thousands(skipped)} fanns redan.` : ''
  }`;
const validityText = (months: number | null, kind: CompetenceImportRow['kind']) =>
  kind === 'skill' ? 'Går inte ut' : months ? `${months} månader` : 'Ingen regel';
interface Row extends Record<string, unknown> {
  id: string;
  r: CompetenceImportRow;
  /** The catalogue holds it already: marked, and not to be chosen. */
  held: boolean;
}

/** The rows of a file that was read: chosen a page or a search at a time, and imported. */
function RowsCard({
  result,
  format,
  catalogue,
  mobile,
}: {
  result: CompetenceImportResult;
  format: CompetenceImportFormat;
  catalogue: CompetenceType[];
  mobile: boolean;
}) {
  const client = useQueryClient();
  const esco = format === 'esco';
  const matcher = useMemo(
    () =>
      catalogueMatcher(
        catalogue.map(t => ({ name: t.name, uri: t.uri ?? null, archived: t.archived, merged: !!t.mergedInto })),
      ),
    [catalogue],
  );
  const rows: Row[] = useMemo(
    () => result.rows.map(r => ({ id: String(r.row), r, held: matcher(r) })),
    [result, matcher],
  );
  const held = useMemo(() => rows.filter(x => x.held).length, [rows]);
  const [typed, setTyped] = useState('');
  const words = importText(typed).toLowerCase();
  const matching = useMemo(
    () =>
      words
        ? rows.filter(x => x.r.name.toLowerCase().includes(words) || (x.r.area ?? '').toLowerCase().includes(words))
        : rows,
    [rows, words],
  );
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(matching.length / PAGE));
  const current = Math.min(page, pages);
  const shown = matching.slice((current - 1) * PAGE, current * PAGE);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  // A row that came to be in the catalogue (this import, another administrator's) leaves the choice.
  const chosen = useMemo(() => rows.filter(x => !x.held && picked.has(x.id)), [rows, picked]);
  const choose = (items: readonly Row[], on: boolean) =>
    setPicked(prev => {
      const next = new Set(prev);
      for (const x of items) if (!x.held) on ? next.add(x.id) : next.delete(x.id);
      return next;
    });
  const shownFree = shown.filter(x => !x.held);
  const matchingFree = useMemo(() => matching.filter(x => !x.held), [matching]);
  const allMatchingChosen = matchingFree.length > 0 && matchingFree.every(x => picked.has(x.id));
  const chooseAll = useRef<HTMLButtonElement>(null);
  const selection = useTableSelection<Row>({
    getIsItemSelected: x => !x.held && picked.has(x.id),
    onSelectItem: ({ item, isSelected }) => choose([item], isSelected),
    onSelectAll: ({ isAllSelected }) => choose(shownFree, isAllSelected),
    getIsAllSelected: () => shownFree.length > 0 && shownFree.every(x => picked.has(x.id)),
    getIsIndeterminate: () => shownFree.some(x => picked.has(x.id)) && !shownFree.every(x => picked.has(x.id)),
    getIsItemEnabled: x => !x.held,
    getRowLabel: x => x.r.name,
  });

  // The area ESCO's rows go under (Clew's rows name their own).
  const areas = useMemo(
    () => [...new Set(catalogue.filter(t => !t.archived).map(t => t.area))].sort((a, b) => a.localeCompare(b, 'sv')),
    [catalogue],
  );
  const [areaChoice, setAreaChoice] = useState<string | null>(null);
  const [newArea, setNewArea] = useState('');
  const [tried, setTried] = useState(false);
  const areaField = useRef<HTMLButtonElement>(null);
  const newAreaField = useRef<HTMLInputElement>(null);
  const area = areaChoice === NEW_AREA ? importText(newArea) : (areaChoice ?? '');
  const areaProblem = !esco
    ? null
    : areaChoice === null
      ? 'Välj ett område.'
      : !area
        ? 'Ange ett område.'
        : [...area].length > COMPETENCE_IMPORT_AREA_MAX
          ? `Högst ${COMPETENCE_IMPORT_AREA_MAX} tecken.`
          : null;
  const action = useAdminAction({
    invalidate: [keys.competenceAll],
    toastId: 'competence:import',
    fallback: 'Importen kunde inte sparas.',
  });
  /** How far a run of parts came; `failed` once a part was refused, so the page says how many were saved. */
  const [sending, setSending] = useState<{ sent: number; of: number; failed?: boolean } | null>(null);
  const [outcome, setOutcome] = useState<CompetenceImportOutcome | null>(null);
  const run = () => {
    if (action.busy || !chosen.length) return;
    if (areaProblem) {
      setTried(true);
      (areaChoice === NEW_AREA ? newAreaField : areaField).current?.focus();
      return;
    }
    const body = chosen.map(x => ({
      row: x.r.row,
      name: x.r.name,
      area: x.r.area ?? area,
      kind: x.r.kind,
      validityMonths: x.r.validityMonths,
      uri: x.r.uri,
    }));
    setOutcome(null);
    void action.run(async () => {
      const total = { added: 0, skipped: 0 };
      setSending({ sent: 0, of: body.length });
      try {
        // In parts: a part the server has saved stays saved, and sent again it is skipped.
        for (let i = 0; i < body.length; i += COMPETENCE_IMPORT_REQUEST_MAX) {
          const part = await api.competence.importTypes({
            format,
            rows: body.slice(i, i + COMPETENCE_IMPORT_REQUEST_MAX),
          });
          total.added += part.added;
          total.skipped += part.skipped;
          setSending({ sent: Math.min(body.length, i + COMPETENCE_IMPORT_REQUEST_MAX), of: body.length });
        }
      } catch (error) {
        // What was saved before the failure is in the catalogue: read it again, so those rows are marked.
        setSending(prev => prev && { ...prev, failed: true });
        void client.invalidateQueries({ queryKey: keys.competenceAll });
        throw error;
      }
      setSending(null);
      setPicked(new Set());
      setOutcome(total);
      return outcomeText(total);
    });
  };
  const status = (problem: string | null) =>
    tried && problem ? { status: { type: 'error' as const, message: problem } } : {};
  const columns = [
    {
      key: 'row',
      header: 'Rad',
      width: pixel(72),
      renderCell: (x: Row) => <Text color="secondary">{x.r.row}</Text>,
    },
    {
      key: 'name',
      header: 'Namn',
      width: proportional(3, { minWidth: 200 }),
      renderCell: (x: Row) => <Text weight="semibold">{x.r.name}</Text>,
    },
    ...(esco
      ? []
      : [
          {
            key: 'area',
            header: 'Område',
            width: proportional(2, { minWidth: 140 }),
            renderCell: (x: Row) => <Text>{x.r.area}</Text>,
          },
          {
            key: 'kind',
            header: 'Typ',
            width: pixel(120),
            renderCell: (x: Row) => <Text>{COMPETENCE_IMPORT_KIND_WORDS[x.r.kind]}</Text>,
          },
          {
            key: 'validity',
            header: 'Giltighet',
            width: pixel(140),
            renderCell: (x: Row) => (
              <Text color={x.r.validityMonths ? 'primary' : 'secondary'}>
                {validityText(x.r.validityMonths, x.r.kind)}
              </Text>
            ),
          },
        ]),
    {
      key: 'held',
      header: 'I katalogen',
      width: pixel(130),
      renderCell: (x: Row) =>
        x.held ? <Badge variant="neutral" label="Finns redan" /> : <Text color="secondary">Ny</Text>,
    },
  ];
  const sentShare = sending ? Math.round((sending.sent / Math.max(1, sending.of)) * 100) : 0;
  return (
    <Card padding={0}>
      <Toolbar
        label="Rader"
        size="sm"
        dividers={['bottom']}
        startContent={
          <VStack gap={0}>
            <Text weight="semibold">Rader</Text>
            <Text type="supporting">
              {`${rowsText(rows.length)} att välja bland${held ? `, varav ${thousands(held)} redan finns i katalogen` : ''}.`}
            </Text>
          </VStack>
        }
      />
      <Section variant="transparent" padding={3}>
        <VStack gap={3}>
          <HStack gap={3} wrap="wrap" vAlign="center">
            <HStack role="search" aria-label="Sök bland raderna" width={mobile ? '100%' : 280}>
              <TextInput
                label="Sök rad"
                isLabelHidden
                type="search"
                size="sm"
                width="100%"
                placeholder={esco ? 'Namn' : 'Namn eller område'}
                startIcon="search"
                hasClear
                value={typed}
                onChange={value => {
                  setTyped(value);
                  setPage(1);
                }}
              />
            </HStack>
            <Button
              ref={chooseAll}
              size="sm"
              variant="secondary"
              label={
                words
                  ? `Välj alla ${thousands(matchingFree.length)} som matchar`
                  : `Välj alla ${thousands(matchingFree.length)}`
              }
              isDisabled={allMatchingChosen || matchingFree.length === 0}
              onClick={() => choose(matchingFree, true)}
            />
            {mobile && (
              <Button
                size="sm"
                variant="secondary"
                label="Välj alla på sidan"
                isDisabled={shownFree.length === 0 || shownFree.every(x => picked.has(x.id))}
                onClick={() => choose(shownFree, true)}
              />
            )}
            {/* What the search found, read out when it changes (4.1.3); nothing while nothing is searched for. */}
            <Text type="supporting" role="status">
              {words ? `${thousands(matching.length)} av ${rowsText(rows.length)} matchar sökningen` : ''}
            </Text>
          </HStack>
          <TableSelectionToolbar
            label="Valda rader"
            selection={{
              selectedKeys: new Set(shown.filter(x => picked.has(x.id) && !x.held).map(x => x.id)),
              selectedCount: chosen.length,
              hasSelection: chosen.length > 0,
              clearSelection: () => {
                setPicked(new Set());
                // The toolbar goes with the choice: the focus goes to the choice's way back in.
                chooseAll.current?.focus();
              },
            }}
            renderSelectionLabel={n => `${thousands(n)} ${n === 1 ? 'vald' : 'valda'}`}
            clearLabel="Avmarkera alla"
          />
        </VStack>
      </Section>
      {matching.length === 0 ? (
        <EmptyState
          isCompact
          headingLevel={2}
          title="Ingen rad matchar"
          description="Ändra sökningen för att se fler rader."
        />
      ) : mobile ? (
        <Section variant="transparent" padding={3}>
          <CheckboxList
            label="Raderna på sidan"
            isLabelHidden
            hasDividers
            value={shown.filter(x => picked.has(x.id) && !x.held).map(x => x.id)}
            onChange={values => {
              const on = new Set(values);
              setPicked(prev => {
                const next = new Set(prev);
                for (const x of shownFree) on.has(x.id) ? next.add(x.id) : next.delete(x.id);
                return next;
              });
            }}
          >
            {shown.map(x => (
              <CheckboxListItem
                key={x.id}
                value={x.id}
                label={x.r.name}
                isDisabled={x.held}
                description={[
                  `Rad ${x.r.row}`,
                  ...(esco ? [] : [x.r.area ?? '', COMPETENCE_IMPORT_KIND_WORDS[x.r.kind]]),
                  ...(x.held ? ['Finns redan i katalogen'] : []),
                ].join(' · ')}
              />
            ))}
          </CheckboxList>
        </Section>
      ) : (
        <Table<Row>
          aria-label="Raderna i filen"
          data={shown}
          idKey="id"
          columns={columns}
          density="balanced"
          plugins={{ selection }}
          rowIndexStart={(current - 1) * PAGE + 1}
          rowCount={matching.length}
        />
      )}
      {matching.length > PAGE && (
        <Section variant="transparent" padding={3}>
          <HStack justify="center">
            <Pagination
              label="Sidor med rader"
              size="sm"
              variant={mobile ? 'compact' : 'pages'}
              page={current}
              totalItems={matching.length}
              pageSize={PAGE}
              onChange={setPage}
            />
          </HStack>
        </Section>
      )}
      <Section variant="transparent" padding={3}>
        <VStack gap={3}>
          {esco && (
            <VStack gap={2}>
              <Selector
                ref={areaField}
                label="Område"
                description="Raderna ur ESCO läggs under det här området i katalogen."
                placeholder="Välj område"
                options={[...areas.map(a => ({ value: a, label: a })), { value: NEW_AREA, label: 'Nytt område' }]}
                value={areaChoice ?? ''}
                onChange={value => setAreaChoice(value || null)}
                presentation="adaptive"
                isRequired
                {...(areaChoice === null ? status(areaProblem) : {})}
              />
              {areaChoice === NEW_AREA && (
                <TextInput
                  ref={newAreaField}
                  label="Det nya områdets namn"
                  description="Till exempel Digitala färdigheter."
                  value={newArea}
                  onChange={setNewArea}
                  autoComplete="off"
                  isRequired
                  {...status(areaProblem)}
                />
              )}
            </VStack>
          )}
          {sending && !sending.failed && (
            <ProgressBar
              label={`Importerar: ${rowsText(sending.sent)} av ${thousands(sending.of)} sparade`}
              value={sentShare}
              variant="neutral"
            />
          )}
          {action.error && (
            <Banner
              status="error"
              container="card"
              collapsible={false}
              title={action.error}
              description={
                sending && sending.sent > 0
                  ? `${rowsText(sending.sent)} av ${thousands(sending.of)} hann sparas. Försök igen: det som redan finns hoppas över.`
                  : 'Ingenting sparades. Försök igen.'
              }
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
              label={`Importera ${thousands(chosen.length)}`}
              onClick={run}
              isLoading={action.busy}
              isDisabled={chosen.length === 0}
              tooltip={chosen.length === 0 ? 'Välj de rader som ska läggas till först.' : undefined}
            />
          </HStack>
        </VStack>
      </Section>
    </Card>
  );
}

export function AdminCompetenceImportPage({ user }: { user: SessionUser }) {
  usePageTitle('Importera kompetenser');
  const mobile = useMediaQuery(mobileQuery);
  const query = useQuery(competenceCatalogueQuery);
  const refused = query.error instanceof ApiError && query.error.status === 403;
  const error = query.isError && !refused ? errorMessage(query.error, 'Katalogen kunde inte läsas.') : null;
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CompetenceImportResult | null>(null);
  const [reading, setReading] = useState(false);
  /** Each file read is a new choice: the rows' card starts over. */
  const [readCount, setReadCount] = useState(0);
  const choose = async (value: File | File[] | null) => {
    const chosen = Array.isArray(value) ? (value[0] ?? null) : value;
    setFile(chosen);
    setResult(null);
    if (!chosen) return;
    setReading(true);
    try {
      // What became of the file is the field's status, which Astryx announces (4.1.3): nothing is said twice.
      setResult(parseCompetenceImport(await chosen.text()));
      setReadCount(n => n + 1);
    } catch {
      setResult({
        format: null,
        rows: [],
        problems: [{ row: 0, message: 'Filen kunde inte läsas. Välj den igen.' }],
        problemCount: 1,
        notReleased: 0,
      });
    } finally {
      setReading(false);
    }
  };
  const fileStatus =
    !file || !result
      ? undefined
      : result.format
        ? ({
            type: result.problemCount ? 'warning' : 'success',
            message: `${formatWord[result.format]}: ${rowsText(result.rows.length)} att välja bland${
              result.problemCount ? `, ${result.problemCount} kan inte läsas in` : ''
            }.`,
          } as const)
        : ({ type: 'error', message: 'Filen kan inte läsas in. Felen står under fältet.' } as const);
  const listed = result?.problems.slice(0, 20) ?? [];
  const more = (result?.problemCount ?? 0) - listed.length;
  return (
    <AdminShell
      user={user}
      section="kompetens"
      crumbs={[{ label: 'Kompetens', href: '/admin/competence' }, { label: 'Importera' }]}
      pending={query.isPending}
    >
      <PageHeader
        title="Importera kompetenser"
        meta={
          <Text as="p" color="secondary">
            Lägg till många kompetenser i katalogen på en gång från en fil. Det som redan finns i katalogen hoppas över,
            så samma fil kan läsas in igen.
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
            description={`${errorMessage(query.error, 'Du saknar behörighet för åtgärden.')} Kompetens slås på under Anslutna system, och katalogen kräver behörigheten Administrera kompetenskatalogen.`}
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
                  Clews eget format eller ESCO:s fil med färdigheter, som du laddar ner från{' '}
                  <Link href="https://esco.ec.europa.eu/" isExternalLink>
                    ESCO:s webbplats
                  </Link>
                  . Ingen sådan fil följer med Clew.
                </Text>
              </VStack>
            }
          />
          <Section variant="transparent" padding={4}>
            <VStack gap={3}>
              <FileInput
                label="Fil med kompetenser"
                value={file}
                onChange={v => void choose(v)}
                accept=".csv,text/csv"
                maxSize={COMPETENCE_IMPORT_MAX_CHARS}
                placeholder="Välj en fil"
                isLoading={reading}
                status={fileStatus}
                description={`En CSV-fil sparad som UTF-8, högst ${MB} MB och ${thousands(COMPETENCE_IMPORT_ROWS_MAX)} rader. Clews format har den första raden name, area, kind, validityMonths, uri; ESCO:s fil känns igen på sina egna rubriker.`}
              />
              {result && result.problemCount > 0 && (
                <Banner
                  status={result.format ? 'warning' : 'error'}
                  container="card"
                  collapsible={false}
                  title={
                    result.format
                      ? `${result.problemCount} ${result.problemCount === 1 ? 'rad kan' : 'rader kan'} inte läsas in`
                      : 'Filen kan inte läsas in'
                  }
                  description={
                    result.format
                      ? 'De övriga raderna går att importera. Rätta filen och välj den igen för att få med de här.'
                      : 'Rätta det som står nedan och välj filen igen. Inget har sparats.'
                  }
                >
                  <List aria-label="Det som inte kan läsas in" hasDividers>
                    {listed.map((p, i) => (
                      <ListItem key={i} label={p.row ? `Rad ${p.row}: ${p.message}` : p.message} />
                    ))}
                    {more > 0 && <ListItem label={`… och ${more} till.`} />}
                  </List>
                </Banner>
              )}
              {result?.format === 'esco' && (
                <VStack gap={1}>
                  <Text as="p">{ESCO_ACKNOWLEDGEMENT}</Text>
                  {result.notReleased > 0 && (
                    <Text as="p" type="supporting">
                      {`${rowsText(result.notReleased)} i filen är inte ${result.notReleased === 1 ? 'publicerad' : 'publicerade'} i ESCO och visas inte.`}
                    </Text>
                  )}
                </VStack>
              )}
            </VStack>
          </Section>
        </Card>
      )}
      {query.data && result?.format && result.rows.length > 0 && (
        <RowsCard key={readCount} result={result} format={result.format} catalogue={query.data.rows} mobile={mobile} />
      )}
    </AdminShell>
  );
}
