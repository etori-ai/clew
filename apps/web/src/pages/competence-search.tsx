import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  COMPETENCE_LEVELS,
  COMPETENCE_SEARCH_PAGE_SIZES,
  COMPETENCE_SEARCH_STATUSES,
  COMPETENCE_SEARCH_TYPES_MAX,
  COMPETENCE_SEARCH_WINDOWS,
  COMPETENCE_TYPE_SEARCH_MAX,
  SKILL_KIND,
  type CompetenceKind,
  type CompetenceSearchHeld,
  type CompetenceSearchOrder,
  type CompetenceSearchPage,
  type CompetenceSearchRow,
  type CompetenceSearchSort,
  type CompetenceSearchStatus,
  type CompetenceSearchWindow,
  type SessionUser,
  statusLabel,
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
  MultiSelector,
  Pagination,
  Section,
  Selector,
  Table,
  Text,
  Tokenizer,
  TypeaheadItem,
  VStack,
  pixel,
  proportional,
  resolveColumnWidths,
  useMediaQuery,
  useTableSortable,
  useToast,
  type SearchSource,
  type SearchableItem,
  type TableColumn,
  type TableSortState,
  type TokenizerHandle,
} from '@clew/ui';
import { api } from '../api';
import {
  SEARCH_PATH,
  holdingsPageHref,
  noSearchHref,
  sameSearch,
  searchBodyOf,
  searchFileBodyOf,
  searchHref,
  searchOf,
  type SearchChange,
} from '../competence-address';
import { useHeldRelations } from '../capabilities';
import {
  competenceMatrixQuery,
  competenceSearchOptionsQuery,
  competenceSearchQuery,
  competenceTypesNamedQuery,
} from '../queries';
import { errorMessage, refused } from '../query-policy';
import { usePageTitle } from '../page-title';
import { useRail } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { usePagePanel } from '../components/page-panel';
import { panelBesideQuery } from '../components/panel';
import { levelLabel } from '../components/register-holding';
import { personPageFrom } from '../person-address';
import { CompetenceHeader, managesFrom, untilWords } from './competence-parts';

/** The page's column at its widest: the width every page has (1216 px) less its padding on each side. */
const COLUMN = 1216 - 2 * 32;
const PADDING = 32;
const TITLE_ID = 'kompetenssokning-rubrik';
/** The columns of the result, as Användare sizes its own (D100); with several types, one column each. */
const WIDTHS = {
  person: proportional(2, { minWidth: 200 }),
  unit: proportional(2, { minWidth: 160 }),
  status: pixel(150),
  level: pixel(200),
  until: pixel(140),
  // Fixed, so a type's column never asks the name and the unit to grow with it: five fit beside the rail.
  type: pixel(150),
  holdings: pixel(130),
};
type Row = { id: string; row: CompetenceSearchRow };
type TypeInfo = { id: string; name: string; area: string; kind: CompetenceKind };
type TypeItem = SearchableItem<{ area: string; kind: CompetenceKind }>;
const count = new Intl.NumberFormat('sv-SE');
const people = (n: number) => `${count.format(n)} ${n === 1 ? 'person' : 'personer'}`;
const rowsOf = (n: number) => `${count.format(n)} ${n === 1 ? 'rad' : 'rader'}`;
const and = new Intl.ListFormat('sv', { type: 'conjunction' });
const or = new Intl.ListFormat('sv', { type: 'disjunction' });
const isSkill = (t: Pick<TypeInfo, 'kind'> | undefined) => t?.kind === SKILL_KIND;
/** A status in the words every page of the register uses (`statusLabel`): "Giltigt", "Går ut snart", "Utgånget". */
const STATUS_LABEL: Record<CompetenceSearchStatus, string> = {
  valid: statusLabel('valid'),
  expiring: statusLabel('expiring'),
  expired: statusLabel('expired'),
};
const windowLabel = (days: CompetenceSearchWindow) => `Inom ${days} dagar`;
/**
 * The orders the result can be read in, as the "Sortera" field offers them and the count sentence says them. With
 * several types, the status is the worst of them, the day the earliest and the level the lowest (the contract's rule).
 */
const SORTS: Record<`${CompetenceSearchSort}:${CompetenceSearchOrder}`, { label: string; said: string }> = {
  'name:asc': { label: 'Namn, A–Ö', said: 'efter namn' },
  'name:desc': { label: 'Namn, Ö–A', said: 'efter namn, Ö–A' },
  'unit:asc': { label: 'Enhet, A–Ö', said: 'efter enhet' },
  'unit:desc': { label: 'Enhet, Ö–A', said: 'efter enhet, Ö–A' },
  'status:asc': { label: 'Utgånget först', said: 'utgånget först' },
  'status:desc': { label: 'Giltigt först', said: 'giltigt först' },
  'until:asc': { label: 'Tidigast slutdatum först', said: 'tidigast slutdatum först' },
  'until:desc': { label: 'Senast slutdatum först', said: 'senast slutdatum först' },
  'level:asc': { label: 'Lägst nivå först', said: 'lägst nivå först' },
  'level:desc': { label: 'Högst nivå först', said: 'högst nivå först' },
};

/** Where a holding stands, in words, as the matrix says it: never by colour alone (1.4.1). */
function Status({ held }: { held: CompetenceSearchHeld }) {
  return held.status === 'expired' ? (
    <Badge variant="error" label={STATUS_LABEL.expired} />
  ) : held.status === 'expiring' ? (
    <Badge variant="warning" label={STATUS_LABEL.expiring} />
  ) : (
    <Text>{STATUS_LABEL.valid}</Text>
  );
}
/** A skill's level (D120), and "Egen bedömning" while no manager has confirmed it. */
function Level({ held }: { held: CompetenceSearchHeld }) {
  if (held.level === undefined) return null;
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <Text>{levelLabel(held.level)}</Text>
      {held.validated === false && <Badge variant="neutral" label="Egen bedömning" />}
    </HStack>
  );
}
/** Until when, as a row of the register says it: the day short ("10 jan. 2027"), or "Tills vidare". */
const until = (held: CompetenceSearchHeld) => untilWords(held.expiresOn);
const unitsOf = (row: CompetenceSearchRow) => (row.units.length ? row.units.join(', ') : 'Ingen enhet');
/** One chosen type as a person holds it, where several are shown: the level of a skill, else the status over the day. */
function Held({ held, skill }: { held: CompetenceSearchHeld | undefined; skill: boolean }) {
  if (!held) return null;
  return skill ? (
    <Level held={held} />
  ) : (
    <VStack gap={0} hAlign="start">
      <Status held={held} />
      <Text type="supporting">{until(held)}</Text>
    </VStack>
  );
}

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
 * The person's name, a link to the person (`/people/<id>`, D122, with the search as the way back), as a name opens the
 * person on every list (`view.tsx`). There a registrar sees what a colleague sees (D121: only `competence.holdings`
 * admits the relation). Someone provisioned without a user name has no page, so their name is text.
 */
function PersonName({ row, href }: { row: CompetenceSearchRow; href: string | null }) {
  return href ? (
    <Link href={href} weight="semibold" hasUnderline>
      {row.name}
    </Link>
  ) : (
    <Text weight="semibold">{row.name}</Text>
  );
}
/**
 * The row's own read, a link of its own named for the read and the person: their holdings (D121 item 4, the read
 * `competence.holdings` on its own page with the search as the way back), the registrar's logged read. None without a
 * user name, which the read is asked by.
 */
function HoldingsLink({ row, from }: { row: CompetenceSearchRow; from: string }) {
  return row.key ? (
    <Link href={holdingsPageHref(row.key, from, row.personId)} isStandalone aria-label={`Kompetenser för ${row.name}`}>
      Kompetenser
    </Link>
  ) : null;
}

/**
 * Kompetenssökning at `/competence/search` (D121 items 4 and 5, D120 item 8), the third page of the place Kompetens, for
 * a reader who holds the relation `registrar` by grant: who in the organisation holds every one of up to five types.
 * Built as Administration › Användare is (D100, Astryx's filter bar over a table): the types chosen in a field that asks
 * the catalogue on the server as the reader types (Astryx's `Tokenizer`; a catalogue may hold thousands); a unit, with
 * everything below it; a status and a validity window for the types that can end; a least level for the skills. The
 * whole search is in the address (`competence-address.ts`, ids and codes only), so every change is one step Back undoes,
 * and a reload or a link reads it again. The result is sorted, filtered and read a page at a time on the server, its
 * headers Astryx's sortable ones, its count a status that is read out when it changes; the file holds what the screen
 * shows, every page of it. Every search, every person opened and every file is logged on the server (D121 item 5), a
 * search read once per address while the page is mounted, and the page says so. A Table where it fits, its rows as a
 * list on a phone, beside the panel and where the columns do not fit, with "Sortera" in place of the headers. Anyone
 * without the relation, or with the module off for them, is refused by the server, the page says why, and nothing is
 * searched or logged.
 */
export function CompetenceSearchPage({ user, admin }: { user: SessionUser; admin: boolean }) {
  usePageTitle('Kompetenssökning');
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const nav = useRail({ current: { surface: 'competence' }, admin, manager: user.role === 'manager' });
  const panel = usePagePanel({ overlayOnly: short });
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const searcher = useHeldRelations().includes('registrar');
  const options = useQuery(competenceSearchOptionsQuery);
  const off = options.isError && refused(options.error);
  // The matrix's tab follows the server's answer to its read, and the session's role until it answers, as on the
  // place's other pages (D99).
  const matrix = useQuery({ ...competenceMatrixQuery({}), enabled: !off });
  const manages = managesFrom(user, matrix);

  // The search is the address. A change is one step in the history, so Back undoes it; a change that leaves the search
  // as it is writes nothing. Two changes in one event (a new page size, then page 1 from the pager) build on each other.
  const asked = searchOf(location.search);
  const latest = useRef(location.search);
  latest.current = location.search;
  const show = (change: SearchChange) => {
    const next = searchHref(change, latest.current);
    if (next === sameSearch(latest.current)) return false;
    latest.current = next.slice(SEARCH_PATH.length);
    navigate(next);
    return true;
  };
  const body = searchBodyOf(asked);
  const result = useQuery({
    ...competenceSearchQuery(body ?? { typeIds: [] }),
    enabled: !!body && !off && options.isSuccess,
  });
  const data: CompetenceSearchPage | undefined = body ? result.data : undefined;

  // What the field knows of each type: the search's answer, what the catalogue answered as the reader typed, and, for
  // an address opened from a link or a reload, the catalogue asked by id (no log), which also tells an id it lacks.
  const learned = useRef(new Map<string, TypeInfo>());
  const remember = (t: TypeInfo) => learned.current.set(t.id, t);
  const answered = new Map((data?.types ?? []).map(t => [t.id, t]));
  const unnamed = asked.typeIds.filter(id => !answered.has(id) && !learned.current.has(id));
  const named = useQuery({
    ...competenceTypesNamedQuery(unnamed),
    enabled: unnamed.length > 0 && !off && options.isSuccess,
  });
  const byId = new Map((named.data?.rows ?? []).map(t => [t.id, t]));
  const infoOf = (id: string): TypeInfo | undefined => answered.get(id) ?? byId.get(id) ?? learned.current.get(id);
  const unknown = named.isSuccess ? unnamed.filter(id => !byId.has(id)) : [];
  const chosen = asked.typeIds.map(infoOf);
  const someSkill = chosen.some(isSkill);
  const allSkills = chosen.length > 0 && chosen.every(isSkill);

  // The type field asks the server with what is typed, in a body (D121 item 4); a catalogue may hold thousands, so it
  // never holds them all. When more match than are shown, it says so under the list.
  const [more, setMore] = useState(false);
  const field = useRef<TokenizerHandle>(null);
  const source = useRef<SearchSource<TypeItem>>({
    async search(query) {
      const found = await api.competence.findTypes({ text: query });
      setMore(found.more);
      return found.rows.map(t => {
        remember(t);
        return { id: t.id, label: t.name, auxiliaryData: { area: t.area, kind: t.kind } };
      });
    },
    async bootstrap() {
      const found = await api.competence.findTypes({ text: '' });
      setMore(found.more);
      return found.rows.map(t => {
        remember(t);
        return { id: t.id, label: t.name, auxiliaryData: { area: t.area, kind: t.kind } };
      });
    },
  }).current;
  // The chosen types as tokens, named by the server; one not yet named says so until it is, and one the catalogue does
  // not hold is left out of the field (the page says why below it).
  const tokens: TypeItem[] = asked.typeIds.flatMap(id => {
    const t = infoOf(id);
    if (t) return [{ id, label: t.name, auxiliaryData: { area: t.area, kind: t.kind } }];
    return unknown.includes(id) ? [] : [{ id, label: 'Läser …', auxiliaryData: { area: '', kind: 'certificate' } }];
  });
  // A new set of types keeps the filters that still apply: no least level without a skill, no status, window or order by
  // them without a type that can end, no order by level without a skill.
  const choose = (items: TypeItem[]) => {
    for (const item of items)
      if (item.auxiliaryData)
        remember({ id: item.id, name: item.label, area: item.auxiliaryData.area, kind: item.auxiliaryData.kind });
    // A type not yet named may be either, so nothing is dropped for it.
    const kinds = items.map(item => infoOf(item.id));
    const skill = kinds.some(t => t === undefined || isSkill(t));
    const ending = items.length === 0 || kinds.some(t => !isSkill(t));
    const sortGone =
      (asked.sort === 'level' && !skill) || ((asked.sort === 'status' || asked.sort === 'until') && !ending);
    show({
      typeIds: items.map(item => item.id),
      ...(skill ? {} : { minLevel: null }),
      ...(ending ? {} : { status: [], until: null }),
      ...(sortGone ? { sort: 'name' as const, order: 'asc' as const } : {}),
    });
  };

  // A step to another page is taken at the foot of the result and read from its head, so the head of the search, its
  // fields included, comes back into view; the focus stays on the pager, where the next step is taken (D100 item 7).
  const top = useRef<HTMLDivElement>(null);
  const turn = (next: number) => {
    if (show({ page: next })) top.current?.scrollIntoView({ block: 'start' });
  };
  const narrowed = !!(asked.unitId || asked.minLevel || asked.status.length || asked.until);
  // "Rensa filter" is gone once used, so the focus goes to the type field, the first thing to search by (2.4.3).
  const clear = () => {
    show({ unitId: null, minLevel: null, status: [], until: null });
    field.current?.focus();
  };

  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    if (!body || downloading) return;
    setDownloading(true);
    try {
      // Said once the file is here, never before; a failure is said instead.
      const file = await api.competence.searchFile(searchFileBodyOf(body));
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
  // A name opens the person, the search as the way back; the holdings are the row's own link (`HoldingsLink`).
  const personOf = (row: CompetenceSearchRow) =>
    row.key ? personPageFrom(location.pathname, location.search, row.personId) : null;
  const rows = data?.rows ?? [];
  const units = options.data?.units ?? [];
  const unitName = (id: string) => units.find(u => u.id === id)?.label ?? 'en enhet som inte finns';
  // The types the result on screen is of, in the order chosen: its columns and its sentence.
  const shown = data?.types ?? [];
  const several = shown.length > 1;
  const shownSkill = shown.some(isSkill);
  const shownEnding = shown.some(t => !isSkill(t));
  const names = and.format(shown.map(t => t.name));
  // What the result is of, said with its count: the types, the least level and the unit where one narrows it, the
  // status and the window where they filter it ("2 av 9"), and the order where it is not by name, so a new search, a
  // new filter and a new order are read out also when they find as many as the one before.
  const level = asked.minLevel && shownSkill ? `, minst ${levelLabel(asked.minLevel).toLocaleLowerCase('sv')}` : '';
  const place = asked.unitId ? ` på ${unitName(asked.unitId)}` : '';
  const statusSaid = asked.status.length
    ? `, status ${or.format(asked.status.map(s => STATUS_LABEL[s].toLocaleLowerCase('sv')))}`
    : '';
  const windowSaid = asked.until ? `, giltigt till inom ${asked.until} dagar` : '';
  const filtered = !!(asked.status.length || asked.until);
  const order = `${asked.sort}:${asked.order}` as const;
  const orderSaid = order === 'name:asc' ? '' : `, sorterat ${SORTS[order].said}`;
  const sentence = (d: CompetenceSearchPage) =>
    (filtered ? `${count.format(d.total)} av ${people(d.unfiltered)}` : people(d.total)) +
    ` med ${names}${level}${place}${statusSaid}${windowSaid}${orderSaid}`;
  const searching = !!body && result.isFetching && (result.isPlaceholderData || !result.data);
  const said = !body ? '' : searching ? 'Söker …' : data ? sentence(data) : '';
  const listError =
    body && result.isError && !result.data ? errorMessage(result.error, 'Sökningen kunde inte göras.') : null;
  // An empty result says which choice to loosen: the status or the window when they left nobody, else the unit or the
  // least level, and nothing when none narrows it.
  const loosen = (d: CompetenceSearchPage) => {
    const single = shown.length === 1;
    if (d.unfiltered > 0) {
      const what = and.format(
        [asked.status.length ? 'status' : '', asked.until ? 'giltighetstid' : ''].filter(Boolean),
      );
      const fields = or.format(
        [asked.status.length ? 'Status' : '', asked.until ? 'Giltigt till' : ''].filter(Boolean),
      );
      return d.unfiltered === 1
        ? `1 person har ${single ? 'den' : 'alla'}, men inte med vald ${what}. Ändra ${fields} för att se hen.`
        : `${people(d.unfiltered)} har ${single ? 'den' : 'alla'}, men ingen av dem med vald ${what}. Ändra ${fields} för att se dem.`;
    }
    const where = [
      asked.unitId ? `på ${unitName(asked.unitId)} och enheterna under den` : '',
      asked.minLevel && shownSkill ? `på nivån ${levelLabel(asked.minLevel).toLocaleLowerCase('sv')} eller högre` : '',
    ].filter(Boolean);
    if (!where.length)
      return single
        ? 'Ingen i organisationen har den registrerad.'
        : 'Ingen i organisationen har alla de valda registrerade.';
    const change = [asked.unitId ? 'välj en annan enhet' : '', asked.minLevel && shownSkill ? 'sänk lägsta nivå' : '']
      .filter(Boolean)
      .join(' eller ');
    return `Ingen ${where.join(' ')} har ${single ? 'den registrerad' : 'alla registrerade'}. ${change.replace(/^./, c => c.toLocaleUpperCase('sv'))} för att se fler.`;
  };

  // The orders the result can be read in: by name and unit always, by status and day where a type can end, by level
  // where one is a skill. The headers sort the columns they head; "Sortera" offers every order, and stands in for the
  // headers where the rows are a list, and beside them where several types have no column of their own for it.
  const sortKeys: CompetenceSearchSort[] = [
    'name',
    'unit',
    ...(shownEnding ? (['status', 'until'] as const) : []),
    ...(shownSkill ? (['level'] as const) : []),
  ];
  const sortable = sortKeys
    .flatMap(sort => (['asc', 'desc'] as const).map(by => `${sort}:${by}` as const))
    .map(value => ({ value, label: SORTS[value].label }));
  const sortState: TableSortState<CompetenceSearchSort> = [
    { sortKey: asked.sort, direction: asked.order === 'desc' ? 'descending' : 'ascending' },
  ];
  const sortPlugin = useTableSortable<Row, CompetenceSearchSort>({
    sort: sortState,
    onSortChange: next => {
      const entry = next[0];
      show(
        entry
          ? { sort: entry.sortKey, order: entry.direction === 'descending' ? 'desc' : 'asc' }
          : { sort: 'name', order: 'asc' },
      );
    },
    allowUnsortedState: false,
  });
  const one = shown[0];
  const columns: TableColumn<Row>[] = [
    {
      key: 'person',
      header: 'Person',
      width: WIDTHS.person,
      sortable: { sortKey: 'name' },
      renderCell: r => <PersonName row={r.row} href={personOf(r.row)} />,
    },
    {
      key: 'unit',
      header: 'Enhet',
      width: WIDTHS.unit,
      sortable: true,
      renderCell: r => <Text>{unitsOf(r.row)}</Text>,
    },
    ...(several || !one
      ? shown.map((t, i): TableColumn<Row> => ({
          key: 'type:' + t.id,
          header: t.name,
          width: WIDTHS.type,
          renderCell: r => <Held held={r.row.held[i]} skill={isSkill(t)} />,
        }))
      : [
          {
            key: 'status',
            header: 'Status',
            width: WIDTHS.status,
            sortable: !isSkill(one),
            renderCell: (r: Row) => (r.row.held[0] ? <Status held={r.row.held[0]} /> : null),
          },
          ...(isSkill(one)
            ? [
                {
                  key: 'level',
                  header: 'Nivå',
                  width: WIDTHS.level,
                  sortable: true,
                  renderCell: (r: Row) => (r.row.held[0] ? <Level held={r.row.held[0]} /> : null),
                },
              ]
            : []),
          {
            key: 'until',
            header: 'Giltigt till',
            width: WIDTHS.until,
            sortable: !isSkill(one),
            renderCell: (r: Row) => <Text>{r.row.held[0] ? until(r.row.held[0]) : ''}</Text>,
          },
        ]),
    // One cell cannot be two links: the row's own read has a column of its own, as on every list (`view.tsx`).
    {
      key: 'holdings',
      header: 'Kompetenser',
      width: WIDTHS.holdings,
      renderCell: r => <HoldingsLink row={r.row} from={from} />,
    },
  ];
  // The rows are a table where its columns fit beside the rail (and the panel, when it is open), else a list.
  const { tableMinWidth } = resolveColumnWidths(
    columns.map(c => ({ key: c.key, ...(c.width ? { width: c.width } : {}) })),
  );
  const fitsAlone = useMediaQuery(panelBesideQuery(tableMinWidth + 2 * PADDING, 0));
  const fitsBeside = useMediaQuery(panelBesideQuery(tableMinWidth + 2 * PADDING));
  const narrow = mobile || !(panel.occupied ? fitsBeside : fitsAlone);
  const unreadable =
    asked.unreadable === 'types'
      ? `Adressen anger fler än ${COMPETENCE_SEARCH_TYPES_MAX} kompetenser, och en sökning gäller högst ${COMPETENCE_SEARCH_TYPES_MAX}.`
      : asked.unreadable === 'type'
        ? 'Adressen anger en kompetens som inte finns.'
        : asked.unreadable === 'unit'
          ? 'Adressen anger en enhet som inte finns.'
          : null;

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
                      <VStack gap={2} ref={top}>
                        {/* The fields lead, each where it was: a least level, offered once a skill is chosen, comes
                            last so nothing moves for it; the status and the window stay, disabled with the reason, when
                            every chosen type is a skill. */}
                        <HStack
                          gap={2}
                          wrap="wrap"
                          vAlign="end"
                          role="search"
                          aria-label="Sök vem som har en kompetens"
                        >
                          <Tokenizer<TypeItem>
                            label="Kompetens"
                            description={`De som har alla valda visas, högst ${COMPETENCE_SEARCH_TYPES_MAX}.`}
                            placeholder="Sök på namn eller område"
                            searchSource={source}
                            value={tokens}
                            onChange={items => choose(items)}
                            handleRef={field}
                            maxEntries={COMPETENCE_SEARCH_TYPES_MAX}
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
                            width={mobile ? '100%' : 360}
                          />
                          <Selector
                            label="Enhet"
                            description="Med enheterna under den."
                            placeholder="Hela organisationen"
                            presentation="adaptive"
                            hasClear
                            hasSearch
                            searchPlaceholder="Sök enhet"
                            emptyText="Katalogen har inte fört in några enheter."
                            emptySearchText="Ingen enhet heter så"
                            options={[
                              ...units.map(u => ({
                                value: u.id,
                                label: u.label,
                                ...(u.parentLabel ? { description: u.parentLabel } : {}),
                              })),
                              // A unit the address names and the tree no longer holds is shown as such, so the field
                              // and the refusal under it say the same.
                              ...(asked.unitId && !units.some(u => u.id === asked.unitId)
                                ? [{ value: asked.unitId, label: 'Enhet som inte finns' }]
                                : []),
                            ]}
                            value={asked.unitId}
                            onChange={(unitId: string | null) => show({ unitId: unitId || null })}
                          />
                          <MultiSelector
                            label="Status"
                            placeholder="Alla"
                            presentation="adaptive"
                            triggerDisplay="labels"
                            hasClear
                            options={COMPETENCE_SEARCH_STATUSES.map(s => ({ value: s, label: STATUS_LABEL[s] }))}
                            value={asked.status}
                            onChange={(value: string[]) =>
                              show({ status: COMPETENCE_SEARCH_STATUSES.filter(s => value.includes(s)) })
                            }
                            isDisabled={allSkills && !asked.status.length}
                            disabledMessage="En färdighet går inte ut, så den har ingen status att välja."
                          />
                          <Selector
                            label="Giltigt till"
                            placeholder="Alla datum"
                            presentation="adaptive"
                            hasClear
                            options={COMPETENCE_SEARCH_WINDOWS.map(days => ({
                              value: String(days),
                              label: windowLabel(days),
                            }))}
                            value={asked.until ? String(asked.until) : null}
                            onChange={(value: string | null) =>
                              show({ until: COMPETENCE_SEARCH_WINDOWS.find(d => String(d) === value) ?? null })
                            }
                            isDisabled={allSkills && !asked.until}
                            disabledMessage="En färdighet går inte ut, så den har inget slutdatum att välja."
                          />
                          {(someSkill || asked.minLevel) && (
                            <Selector
                              label="Lägsta nivå"
                              placeholder="Alla nivåer"
                              presentation="adaptive"
                              hasClear
                              options={COMPETENCE_LEVELS.map(l => ({ value: String(l), label: levelLabel(l) }))}
                              value={asked.minLevel ? String(asked.minLevel) : null}
                              onChange={(value: string | null) =>
                                show({ minLevel: COMPETENCE_LEVELS.find(l => String(l) === value) ?? null })
                              }
                            />
                          )}
                        </HStack>
                        {/* The one line that says what the search found, read out when it changes (4.1.3), on a line of
                            its own under the fields, so nothing beside it moves when it is long: there from the start
                            and empty before a search. */}
                        <Text weight="semibold" role="status">
                          {said}
                        </Text>
                        <HStack gap={2} wrap="wrap" vAlign="center" justify="between">
                          <Text type="supporting">
                            Varje sökning, nedladdning och öppnad person loggas med vem som läste och när, också när en
                            sökning öppnas från en länk eller laddas om.
                          </Text>
                          <HStack gap={2} wrap="wrap" vAlign="center">
                            {data && data.total > 1 && (narrow || several) && (
                              <Selector
                                label="Sortera"
                                isLabelHidden
                                size="sm"
                                presentation="adaptive"
                                options={sortable}
                                value={sortable.some(o => o.value === order) ? order : 'name:asc'}
                                onChange={(value: string) => {
                                  const [sort, by] = value.split(':') as [CompetenceSearchSort, CompetenceSearchOrder];
                                  show({ sort, order: by });
                                }}
                                renderValue={o => `Sortera: ${o.label}`}
                              />
                            )}
                            {narrowed && <Button size="sm" variant="ghost" label="Rensa filter" onClick={clear} />}
                            {data && data.total > 0 && (
                              <Button
                                size="sm"
                                variant="secondary"
                                label={`Ladda ner ${rowsOf(data.total)} som CSV`}
                                icon={<Icon icon={ArrowDownTrayIcon} size="sm" />}
                                isLoading={downloading}
                                onClick={() => void download()}
                              />
                            )}
                          </HStack>
                        </HStack>
                      </VStack>
                    </Section>
                    {unreadable ? (
                      <Section variant="transparent" padding={3}>
                        <VStack gap={2}>
                          <Text as="p" role="alert" color="accent">
                            {unreadable}
                          </Text>
                          <HStack>
                            <Button
                              size="sm"
                              variant="secondary"
                              label={asked.unreadable === 'unit' ? 'Sök utan enheten' : 'Börja om'}
                              onClick={() =>
                                navigate(
                                  asked.unreadable === 'unit'
                                    ? searchHref({ unitId: null }, location.search)
                                    : noSearchHref(location.search),
                                )
                              }
                            />
                          </HStack>
                        </VStack>
                      </Section>
                    ) : !body ? (
                      <EmptyState
                        isCompact
                        headingLevel={2}
                        title="Välj en kompetens"
                        description="Sök fram en eller flera kompetenser, så visas alla i organisationen som har dem, med var de står och när de går ut."
                      />
                    ) : listError ? (
                      <Section variant="transparent" padding={3}>
                        <VStack gap={2}>
                          <Text as="p" role="alert" color="accent">
                            {listError}
                          </Text>
                          <HStack gap={2} wrap="wrap">
                            {unknown.length > 0 ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                label={unknown.length === 1 ? 'Sök utan den' : 'Sök utan dem'}
                                onClick={() => show({ typeIds: asked.typeIds.filter(id => !unknown.includes(id)) })}
                              />
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                label="Försök igen"
                                isLoading={result.isFetching}
                                onClick={() => void result.refetch()}
                              />
                            )}
                            {narrowed && <Button size="sm" variant="ghost" label="Rensa filter" onClick={clear} />}
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
                        title={
                          data.unfiltered > 0
                            ? 'Ingen matchar filtret'
                            : several
                              ? 'Ingen har alla de kompetenserna'
                              : 'Ingen har den kompetensen'
                        }
                        description={loosen(data)}
                        {...(narrowed ? { actions: <Button size="sm" label="Rensa filter" onClick={clear} /> } : {})}
                      />
                    ) : (
                      <VStack gap={0} aria-busy={result.isPlaceholderData}>
                        {narrow ? (
                          <List aria-label={`Personer med ${names}`} hasDividers>
                            {rows.map(row => (
                              <ListItem
                                key={row.personId}
                                label={<PersonName row={row} href={personOf(row)} />}
                                endContent={<HoldingsLink row={row} from={from} />}
                                description={
                                  <VStack gap={1} hAlign="start">
                                    <Text type="supporting">{unitsOf(row)}</Text>
                                    {several || !one ? (
                                      shown.map((t, i) => (
                                        <HStack key={t.id} gap={2} vAlign="center" wrap="wrap">
                                          <Text type="supporting">{`${t.name}:`}</Text>
                                          {row.held[i] &&
                                            (isSkill(t) ? (
                                              <Level held={row.held[i]} />
                                            ) : (
                                              <>
                                                <Status held={row.held[i]} />
                                                <Text type="supporting">{until(row.held[i])}</Text>
                                              </>
                                            ))}
                                        </HStack>
                                      ))
                                    ) : row.held[0] ? (
                                      <>
                                        <HStack gap={2} vAlign="center" wrap="wrap">
                                          <Status held={row.held[0]} />
                                          <Level held={row.held[0]} />
                                        </HStack>
                                        <Text type="supporting">{`Giltigt till: ${until(row.held[0])}`}</Text>
                                      </>
                                    ) : null}
                                  </VStack>
                                }
                              />
                            ))}
                          </List>
                        ) : (
                          <Table<Row>
                            data={rows.map(row => ({ id: row.personId, row }))}
                            idKey="id"
                            columns={columns}
                            plugins={{ sort: sortPlugin }}
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
                                  onPageSizeChange: (size: number) =>
                                    show({
                                      pageSize:
                                        COMPETENCE_SEARCH_PAGE_SIZES.find(n => n === size) ??
                                        COMPETENCE_SEARCH_PAGE_SIZES[0],
                                    }),
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
