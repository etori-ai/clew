import { useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  COMPETENCE_LEVELS,
  COMPETENCE_SEARCH_PAGE_SIZES,
  COMPETENCE_TYPE_SEARCH_MAX,
  SKILL_KIND,
  type CompetenceSearchBody,
  type CompetenceSearchFileBody,
  type CompetenceSearchPage,
  type CompetenceSearchRow,
  type CompetenceKind,
  type SessionUser,
} from '@clew/contracts';
import {
  ArrowDownTrayIcon,
  Badge,
  Button,
  Card,
  EmptyState,
  HStack,
  Icon,
  Layout,
  LayoutContent,
  Link,
  List,
  ListItem,
  Pagination,
  Section,
  Selector,
  Table,
  Text,
  Typeahead,
  TypeaheadItem,
  VStack,
  pixel,
  proportional,
  resolveColumnWidths,
  useMediaQuery,
  useToast,
  type SearchSource,
  type SearchableItem,
} from '@clew/ui';
import { api } from '../api';
import { firstSearchPage, holdingsPageHref, searchHref, searchPageOf } from '../competence-address';
import { keepSearch, keptSearch, type SearchDraft } from '../competence-search-session';
import { useHeldRelations } from '../capabilities';
import { competenceMatrixQuery, competenceSearchOptionsQuery, competenceSearchQuery } from '../queries';
import { errorMessage, refused } from '../query-policy';
import { usePageTitle } from '../page-title';
import { useRail } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { usePagePanel } from '../components/page-panel';
import { panelBesideQuery } from '../components/panel';
import { levelLabel } from '../components/register-holding';
import { CompetenceHeader, cellDay, managesFrom } from './competence-parts';

/** The page's column at its widest: the width every page has (1216 px) less its padding on each side. */
const COLUMN = 1216 - 2 * 32;
const PADDING = 32;
const TITLE_ID = 'kompetenssokning-rubrik';
/** The columns of the result, as Användare sizes its own (D100). */
const COLUMNS = {
  person: proportional(2, { minWidth: 200 }),
  unit: proportional(2, { minWidth: 180 }),
  status: pixel(150),
  level: pixel(200),
  until: pixel(140),
};
/** The least width the result needs as a table, with or without the level's column. */
const tableMinWidth = (skill: boolean) =>
  resolveColumnWidths(
    Object.entries(COLUMNS)
      .filter(([key]) => skill || key !== 'level')
      .map(([key, width]) => ({ key, width })),
  ).tableMinWidth;
type TypeItem = SearchableItem<{ area: string; kind: CompetenceKind }>;
const count = new Intl.NumberFormat('sv-SE');
const people = (n: number) => `${count.format(n)} ${n === 1 ? 'person' : 'personer'}`;

/** Where a holding stands, in words, as the matrix says it: never by colour alone (1.4.1). */
function Status({ row }: { row: CompetenceSearchRow }) {
  return row.status === 'expired' ? (
    <Badge variant="error" label="Utgånget" />
  ) : row.status === 'expiring' ? (
    <Badge variant="warning" label="Går ut snart" />
  ) : (
    <Text>Giltigt</Text>
  );
}
/** A skill's level (D120), and "Egen bedömning" while no manager has confirmed it. */
function Level({ row }: { row: CompetenceSearchRow }) {
  if (row.level === undefined) return null;
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <Text>{levelLabel(row.level)}</Text>
      {row.validated === false && <Badge variant="neutral" label="Egen bedömning" />}
    </HStack>
  );
}
const until = (row: CompetenceSearchRow) => (row.expiresOn ? cellDay(row.expiresOn) : 'Inget slutdatum');
const unitsOf = (row: CompetenceSearchRow) => (row.units.length ? row.units.join(', ') : 'Ingen enhet');

/**
 * A file the server made, saved as a link to it would be saved: an anchor in the document for the moment of the press,
 * since a browser may ignore a press on one outside it, and the object's address let go of a minute later, once the
 * browser has begun to read it, never at once.
 */
function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/**
 * The person's name, a link to their holdings (D121 item 4: the read `competence.holdings`, its page with the search as
 * the way back). Someone provisioned without a user name has no page, so their name is text.
 */
function PersonName({ row, from }: { row: CompetenceSearchRow; from: string }) {
  return row.key ? (
    <Link href={holdingsPageHref(row.key, from)} weight="semibold" hasUnderline>
      {row.name}
    </Link>
  ) : (
    <Text weight="semibold">{row.name}</Text>
  );
}

/**
 * Kompetenssökning at `/competence/search` (D121 items 4 and 5, D120 item 8), the third page of the place Kompetens, for
 * a reader who holds the relation `registrar` by grant: who in the organisation holds a type. Built as Administration ›
 * Användare is (D100, Astryx's filter bar over a table): a type field that asks the catalogue on the server as the
 * reader types, since a catalogue may hold thousands (Astryx's `Typeahead`); for a skill a least level; a unit, with
 * everything below it. The result is read a page at a time on the server, by name, its count a status that is read out
 * when it changes. What is searched for is asked in a request body and kept in memory for the session
 * (`competence-search-session.ts`), never in the address, which holds the page and its size; so a person opened from a
 * hit and Back find the search as it was. A name leads to that person's holdings, the read's own page (D116). The whole
 * result downloads as a file. Every search, every person opened and every file is logged on the server (D121 item 5),
 * and the page says so. A Table where it fits, its rows as a list on a phone and beside the panel, as the matrix does.
 * Anyone without the relation, or with the module off for them, is refused by the server and the page says why.
 */
export function CompetenceSearchPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  usePageTitle('Kompetenssökning');
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const nav = useRail({ current: { surface: 'competence' }, admin, manager: user.role === 'manager' });
  const panel = usePagePanel({ overlayOnly: short });
  const toast = useToast();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const searcher = useHeldRelations().includes('registrar');
  const options = useQuery(competenceSearchOptionsQuery);
  const off = options.isError && refused(options.error);
  // The matrix's tab follows the server's answer to its read, and the session's role until it answers, as on the
  // place's other pages (D99).
  const matrix = useQuery({ ...competenceMatrixQuery({}), enabled: !off });
  const manages = managesFrom(user, matrix);

  const [draft, setDraft] = useState<SearchDraft>(keptSearch);
  const change = (next: SearchDraft) => {
    keepSearch(next);
    setDraft(next);
    // A new search starts from the first page; a change that leaves the address as it is writes nothing.
    const first = firstSearchPage(params);
    if (first !== location.pathname + location.search) navigate(first);
  };
  const skill = draft.type?.kind === SKILL_KIND;
  const { page, pageSize } = searchPageOf(params);
  // What is searched for, as the file is asked for it; the page asks for one page of it.
  const asked: CompetenceSearchFileBody | null = draft.type
    ? {
        typeId: draft.type.id,
        ...(skill && draft.minLevel ? { minLevel: draft.minLevel } : {}),
        ...(draft.unitId ? { unitId: draft.unitId } : {}),
      }
    : null;
  const body: CompetenceSearchBody | null = asked ? { ...asked, page, pageSize } : null;
  const result = useQuery({
    ...competenceSearchQuery(body ?? { typeId: '' }),
    enabled: !!body && !off && options.isSuccess,
  });
  const data: CompetenceSearchPage | undefined = body ? result.data : undefined;
  const tableBeside = useMediaQuery(panelBesideQuery(tableMinWidth(skill) + 2 * PADDING));
  const narrow = mobile || (panel.occupied && !tableBeside);

  // The type field asks the server with what is typed, in a body (D121 item 4); a catalogue may hold thousands, so it
  // never holds them all. When more match than are shown, it says so under the list.
  const [more, setMore] = useState(false);
  const source = useRef<SearchSource<TypeItem>>({
    async search(query) {
      const found = await api.competence.findTypes({ text: query });
      setMore(found.more);
      return found.rows.map(t => ({ id: t.id, label: t.name, auxiliaryData: { area: t.area, kind: t.kind } }));
    },
    async bootstrap() {
      const found = await api.competence.findTypes({ text: '' });
      setMore(found.more);
      return found.rows.map(t => ({ id: t.id, label: t.name, auxiliaryData: { area: t.area, kind: t.kind } }));
    },
  }).current;
  const chosen: TypeItem | null = draft.type
    ? { id: draft.type.id, label: draft.type.label, auxiliaryData: { area: draft.type.area, kind: draft.type.kind } }
    : null;

  // A step to another page is taken at the foot of the result and read from its head, so the head comes back into
  // view; the focus stays on the pager, where the next step is taken (D100 item 7).
  const head = useRef<HTMLSpanElement>(null);
  const turn = (next: number) => {
    navigate(searchHref({ page: next }, params));
    head.current?.scrollIntoView({ block: 'start' });
  };

  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    if (!asked || downloading) return;
    setDownloading(true);
    try {
      // Said once the file is here, never before; a failure is said instead.
      const file = await api.competence.searchFile(asked);
      saveFile(file.blob, file.filename);
      toast({ body: `${file.filename} är hämtad.`, uniqueID: 'competence:search-file' });
    } catch (e) {
      toast({
        body: errorMessage(e, 'Filen kunde inte skapas.'),
        isAutoHide: false,
        uniqueID: 'competence:search-file',
      });
    } finally {
      setDownloading(false);
    }
  };

  const from = location.pathname + location.search;
  const rows = data?.rows ?? [];
  const units = options.data?.units ?? [];
  const typeName = data?.type.name ?? draft.type?.label ?? '';
  // What the result is of, said with its count: the type, and the least level and the unit where one narrows it, so a
  // new search is read out also when it finds as many as the one before.
  const narrowing =
    (skill && draft.minLevel ? `, minst ${levelLabel(draft.minLevel).toLocaleLowerCase('sv')}` : '') +
    (draft.unitId ? ` på ${units.find(u => u.id === draft.unitId)?.label ?? draft.unitId}` : '');
  const searching = !!body && result.isFetching && (result.isPlaceholderData || !result.data);
  const said = !body ? '' : searching ? 'Söker …' : data ? `${people(data.total)} med ${typeName}${narrowing}` : '';
  const listError =
    body && result.isError && !result.data ? errorMessage(result.error, 'Sökningen kunde inte göras.') : null;
  const columns = [
    {
      key: 'person',
      header: 'Person',
      width: COLUMNS.person,
      renderCell: (r: { row: CompetenceSearchRow }) => <PersonName row={r.row} from={from} />,
    },
    {
      key: 'unit',
      header: 'Enhet',
      width: COLUMNS.unit,
      renderCell: (r: { row: CompetenceSearchRow }) => <Text>{unitsOf(r.row)}</Text>,
    },
    {
      key: 'status',
      header: 'Status',
      width: COLUMNS.status,
      renderCell: (r: { row: CompetenceSearchRow }) => <Status row={r.row} />,
    },
    ...(skill
      ? [
          {
            key: 'level',
            header: 'Nivå',
            width: COLUMNS.level,
            renderCell: (r: { row: CompetenceSearchRow }) => <Level row={r.row} />,
          },
        ]
      : []),
    {
      key: 'until',
      header: 'Giltigt till',
      width: COLUMNS.until,
      renderCell: (r: { row: CompetenceSearchRow }) => <Text>{until(r.row)}</Text>,
    },
  ];

  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      <Layout
        height={short ? 'auto' : 'fill'}
        padding={mobile ? 3 : 8}
        end={panel.end}
        content={
          <LayoutContent isScrollable={!short}>
            <VStack hAlign="center">
              <VStack gap={5} width="100%" maxWidth={COLUMN}>
                <CompetenceHeader
                  title="Kompetenssökning"
                  titleId={TITLE_ID}
                  page="search"
                  hasTabs={manages && !off}
                  hasSearch={searcher && !off}
                />
                {off ? (
                  <Card>
                    <EmptyState
                      headingLevel={2}
                      title="Kompetenssökning visas inte för dig"
                      description={errorMessage(
                        options.error,
                        'Kompetenssökning är för den som har fått den genom en grupp.',
                      )}
                      actions={<Button label="Till Mina kompetenser" href="/competence" />}
                    />
                  </Card>
                ) : options.isError ? (
                  <VStack gap={2}>
                    <Text as="p" role="alert">
                      {errorMessage(options.error, 'Kompetenssökning kunde inte öppnas.')}
                    </Text>
                    <HStack>
                      <Button
                        size="sm"
                        variant="secondary"
                        label="Försök igen"
                        isLoading={options.isFetching}
                        onClick={() => void options.refetch()}
                      />
                    </HStack>
                  </VStack>
                ) : (
                  <Card padding={0}>
                    <Section variant="transparent" padding={3}>
                      <VStack gap={2}>
                        {/* The fields lead the row, and what the search found follows them, as Astryx's filter bar
                            places its result count: nothing is drawn for it before a search, and the fields stay where
                            they are when it comes. */}
                        <HStack gap={2} wrap="wrap" vAlign="end">
                          <HStack
                            gap={2}
                            wrap="wrap"
                            vAlign="end"
                            role="search"
                            aria-label="Sök vem som har en kompetens"
                          >
                            <Typeahead<TypeItem>
                              label="Kompetens"
                              placeholder="Sök på namn eller område"
                              searchSource={source}
                              value={chosen}
                              onChange={item =>
                                change({
                                  ...draft,
                                  type: item
                                    ? {
                                        id: item.id,
                                        label: item.label,
                                        area: item.auxiliaryData?.area ?? '',
                                        kind: item.auxiliaryData?.kind ?? 'certificate',
                                      }
                                    : null,
                                  minLevel: item?.auxiliaryData?.kind === SKILL_KIND ? draft.minLevel : null,
                                })
                              }
                              hasEntriesOnFocus
                              maxMenuItems={COMPETENCE_TYPE_SEARCH_MAX}
                              emptySearchText="Ingen kompetens i katalogen heter så"
                              renderItem={item => <TypeaheadItem item={item} description={item.auxiliaryData?.area} />}
                              menu={{
                                role: 'listbox',
                                render: ({ listbox, isEmptySearch }) => (
                                  <VStack gap={0}>
                                    {listbox}
                                    {more && !isEmptySearch && (
                                      <Section variant="transparent" padding={2}>
                                        <Text type="supporting">Fler kompetenser matchar. Skriv mer av namnet.</Text>
                                      </Section>
                                    )}
                                  </VStack>
                                ),
                              }}
                              width={mobile ? '100%' : 320}
                            />
                            {skill && (
                              <Selector
                                label="Lägsta nivå"
                                placeholder="Alla nivåer"
                                presentation="adaptive"
                                hasClear
                                options={COMPETENCE_LEVELS.map(l => ({ value: String(l), label: levelLabel(l) }))}
                                value={draft.minLevel ? String(draft.minLevel) : null}
                                onChange={(value: string | null) =>
                                  change({
                                    ...draft,
                                    minLevel: value ? (Number(value) as SearchDraft['minLevel']) : null,
                                  })
                                }
                              />
                            )}
                            <Selector
                              label="Enhet"
                              placeholder="Hela organisationen"
                              presentation="adaptive"
                              hasClear
                              hasSearch
                              searchPlaceholder="Sök enhet"
                              emptyText="Katalogen har inte fört in några enheter."
                              emptySearchText="Ingen enhet heter så"
                              options={units.map(u => ({
                                value: u.id,
                                label: u.label,
                                ...(u.parentLabel ? { description: u.parentLabel } : {}),
                              }))}
                              value={draft.unitId}
                              onChange={(unitId: string | null) => change({ ...draft, unitId: unitId || null })}
                            />
                          </HStack>
                          {/* The one line that says what the search found, read out when it changes (4.1.3): there from
                              the start and empty before a search, so it takes no room until it has something to say. */}
                          <Text weight="semibold" role="status" ref={head}>
                            {said}
                          </Text>
                          {data && data.total > 0 && (
                            <Button
                              size="sm"
                              variant="secondary"
                              label="Ladda ner som CSV"
                              icon={<Icon icon={ArrowDownTrayIcon} size="sm" />}
                              isLoading={downloading}
                              onClick={() => void download()}
                            />
                          )}
                        </HStack>
                        <Text type="supporting">
                          Varje sökning, nedladdning och öppnad person loggas med vem som läste och när.
                        </Text>
                      </VStack>
                    </Section>
                    {!body ? (
                      <EmptyState
                        isCompact
                        headingLevel={2}
                        title="Välj en kompetens"
                        description="Sök fram en kompetens, så visas alla i organisationen som har den, med var de står och när den går ut."
                      />
                    ) : listError ? (
                      <Section variant="transparent" padding={3}>
                        <VStack gap={2}>
                          <Text as="p" role="alert" color="accent">
                            {listError}
                          </Text>
                          <HStack>
                            <Button
                              size="sm"
                              variant="secondary"
                              label="Försök igen"
                              isLoading={result.isFetching}
                              onClick={() => void result.refetch()}
                            />
                          </HStack>
                        </VStack>
                      </Section>
                    ) : !data || (searching && !result.isPlaceholderData) ? (
                      <Section variant="transparent" padding={3}>
                        <Text type="supporting">Söker …</Text>
                      </Section>
                    ) : data.total === 0 ? (
                      <EmptyState
                        isCompact
                        headingLevel={2}
                        title="Ingen har den kompetensen"
                        description={
                          draft.unitId || draft.minLevel
                            ? 'Ingen på enheten, eller på den nivån, har den registrerad. Ta bort ett val för att se fler.'
                            : 'Ingen i organisationen har den registrerad.'
                        }
                      />
                    ) : (
                      <VStack gap={0} aria-busy={result.isPlaceholderData}>
                        {narrow ? (
                          <List aria-label={`Personer med ${typeName}`} hasDividers>
                            {rows.map(row => (
                              <ListItem
                                key={row.personId}
                                label={<PersonName row={row} from={from} />}
                                description={
                                  <VStack gap={1} hAlign="start">
                                    <Text type="supporting">{unitsOf(row)}</Text>
                                    <HStack gap={2} vAlign="center" wrap="wrap">
                                      <Status row={row} />
                                      <Level row={row} />
                                    </HStack>
                                    <Text type="supporting">{`Giltigt till: ${until(row)}`}</Text>
                                  </VStack>
                                }
                              />
                            ))}
                          </List>
                        ) : (
                          <Table<{ id: string; row: CompetenceSearchRow }>
                            data={rows.map(row => ({ id: row.personId, row }))}
                            idKey="id"
                            columns={columns}
                            density="balanced"
                            hasHover
                            rowIndexStart={(data.page - 1) * data.pageSize + 1}
                            rowCount={data.total}
                          />
                        )}
                      </VStack>
                    )}
                    {data && data.total > COMPETENCE_SEARCH_PAGE_SIZES[0] && (
                      <Section variant="transparent" padding={3}>
                        <HStack justify="center">
                          <Pagination
                            label="Sidor i sökresultatet"
                            size="sm"
                            variant={mobile ? 'compact' : 'pages'}
                            page={data.page}
                            totalItems={data.total}
                            pageSize={data.pageSize}
                            onChange={turn}
                            {...(mobile
                              ? {}
                              : {
                                  pageSizeOptions: [...COMPETENCE_SEARCH_PAGE_SIZES],
                                  onPageSizeChange: (size: number) => navigate(searchHref({ size }, params)),
                                })}
                          />
                        </HStack>
                      </Section>
                    )}
                  </Card>
                )}
              </VStack>
            </VStack>
          </LayoutContent>
        }
      />
      {panel.overlay}
    </Shell>
  );
}
