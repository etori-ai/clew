import {
  createContext,
  use,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import {
  columnFilteringFeature,
  columnPinningFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  tableFeatures,
  useTable,
  type ColumnFiltersState,
  type FilterFn,
  type Header,
  type Row,
} from '@tanstack/react-table';
import {
  defaultRangeExtractor,
  observeWindowOffset,
  observeWindowRect,
  useVirtualizer,
  windowScroll,
  type Range,
} from '@tanstack/react-virtual';
import type {
  CompetenceMatrixCell,
  CompetenceMatrixColumn,
  CompetenceMatrixOutput,
  CompetenceMatrixRow,
} from '@clew/contracts';
import {
  Card,
  Table,
  TableCell,
  VStack,
  pixel,
  proportional,
  resolveColumnWidths,
  useGridFocus,
  useTableStickyColumns,
  type TableColumn,
  type TablePlugin,
} from '@clew/ui';

/**
 * Medarbetarnas kompetens as a grid (the matrix of `/competence/matrix`): what the matrix holds and does, with all of
 * the drawing left to Astryx. Under the product owner's rule of 2026-11-13 (CLAUDE.md) a headless library that manages
 * state or behaviour may be used where Astryx draws:
 *
 * - TanStack Table owns the column model: the names' column pinned at the start, one column per competence read, which
 *   columns are shown and which people are kept when the matrix is narrowed to what needs the manager (the one
 *   definition, `competenceMatrixNeeding`, decides; the table holds it as its visibility and filter state).
 * - TanStack Virtual windows the rows against the page's own scrolling, each row measured as drawn, and the competences'
 *   columns against the table's sideways scrolling, so only what is in view (and a little either side) is in the
 *   document. The cell that holds the grid's tab stop is always drawn, so the focus is never lost to a scroll.
 * - Astryx draws: its `Table` (the `table-comparison` template's: names pinned by `useTableStickyColumns`, a grid of
 *   dividers, compact rows), its cells, and what is not drawn as one row or one column of its size, an empty `TableCell`
 *   (with an empty `VStack` of the rows' height), all through the Table's documented plugin hooks, as are the grid's
 *   roles, indices and keys. Astryx's `useGridFocus` is the WAI-ARIA grid's keyboard: one tab stop, the arrow keys
 *   between cells, Home and End along a row; Ctrl+Home and Ctrl+End, Page Up and Page Down, and a move to a cell not
 *   drawn yet go through the windows (`go`).
 *
 * A cell that takes the focus is scrolled sideways until it lies wholly clear of the pinned names (2.4.11 focus not
 * obscured); its menu is mounted only once it is pressed (`useCellMenu`), so the grid holds one menu, not one a cell.
 */

/** The names' column, pinned at the start. */
export const PERSON = 'person';
/** A competence's column key. */
export const typeKey = (typeId: string) => `type:${typeId}`;
const PERSON_PX = 200;
const CELL_PX = 124;
/**
 * The pinned column of names, and each competence's column: as wide as a cell's one control, its longest word a badge
 * ("Går ut snart") or a skill's level ("Grundläggande"): at 1280 px six columns are in view where a cell of a word, a day
 * and a menu of its own left four, a row is 37 px high where it was 59, and thirty columns scroll past the names.
 */
export const PERSON_WIDTH = pixel(PERSON_PX),
  CELL_WIDTH = proportional(1, { minWidth: CELL_PX });

/** A row as drawn before it is measured: one control's height in the compact density. */
const ROW_ESTIMATE = 37;
/** Rows and columns drawn beyond each edge of the view, so a key or a short scroll meets one already there. */
const ROW_OVERSCAN = 6;
const COLUMN_OVERSCAN = 2;
/** The view the first window plans for, before the page's scrolling and the table's region are measured. */
const INITIAL_VIEW = { width: 1376, height: 900 };
/** A cell of the grid among the table's cells: the name of each row and each competence's cell. */
const CELL = '[data-matrix-cell]';
/** A column or a row standing for those not drawn. */
const GAP = 'gap:';

const features = tableFeatures({
  columnVisibilityFeature,
  columnPinningFeature,
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
});
type Features = typeof features;
const helper = createColumnHelper<Features, CompetenceMatrixRow>();
/** A person is kept where the narrowing kept them. */
const keptPeople: FilterFn<Features, CompetenceMatrixRow> = (row, _columnId, kept: ReadonlySet<string>) =>
  kept.has(row.id);

/** One row as Astryx's Table is given it: a person's row, or the stretch of rows not drawn between two that are. */
interface GridItem extends Record<string, unknown> {
  id: string;
  /** The row's place among the rows kept (0-based), or -1 for a stretch. */
  index: number;
  row?: Row<Features, CompetenceMatrixRow>;
  /** The height of the rows a stretch stands for, and how many columns it spans. */
  gap?: number;
  span?: number;
}

/**
 * Which cell's menu is mounted: one at a time, the cell last pressed. A cell draws its control as a plain button until
 * it is pressed; then its menu is mounted under the same button and opened (`useCellMenu`).
 */
function createMenuStore() {
  let armed: string | null = null;
  let opening = false;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    armed: () => armed,
    arm(key: string) {
      armed = key;
      opening = true;
      listeners.forEach(l => l());
    },
    /** Whether the menu just mounted for `key` is to open now: true once after it was pressed. */
    take(key: string) {
      if (armed !== key || !opening) return false;
      opening = false;
      return true;
    },
  };
}
type MenuStore = ReturnType<typeof createMenuStore>;
const MenuStoreContext = createContext<MenuStore | null>(null);
const noSubscription = () => () => {};

/** A cell's menu in the grid: whether it is mounted, how to mount and open it, and whether to open it now. */
export interface CellMenu {
  isMounted: boolean;
  open: () => void;
  takeOpen: () => boolean;
}
/** The menu of the cell `key` in the grid, or null outside it (the list draws every cell's menu, as before). */
export function useCellMenu(key: string): CellMenu | null {
  const store = use(MenuStoreContext);
  const isMounted = useSyncExternalStore(store?.subscribe ?? noSubscription, () => store?.armed() === key);
  if (!store) return null;
  return { isMounted, open: () => store.arm(key), takeOpen: () => store.take(key) };
}

/** What the page can ask of the grid. */
export interface MatrixGridHandle {
  /**
   * Gives the focus to a cell's control, bringing its row and its column into the document and into view first where
   * they are not drawn; false where the matrix shows no such cell (a column that went with what was removed).
   */
  focusCell: (personId: string, typeId: string) => boolean;
}

/** The nearest ancestor that scrolls the page up and down, or the window where the document itself does. */
function pageScroller(from: Element | null | undefined): Element | Window {
  for (let n = from?.parentElement; n; n = n.parentElement) {
    if (n === document.body || n === document.documentElement) break;
    if (/(auto|scroll|overlay)/.test(getComputedStyle(n).overflowY)) return n;
  }
  return window;
}
/** The indexes in the window, and the one kept beside them (the tab stop's), in order. */
const keeping = (kept: RefObject<number | null>) => (range: Range) => {
  const indexes = defaultRangeExtractor(range);
  const keep = kept.current;
  if (keep !== null && keep >= 0 && keep < range.count && !indexes.includes(keep)) {
    indexes.push(keep);
    indexes.sort((a, b) => a - b);
  }
  return indexes;
};
/** A cell's place among the columns (0 for the name), from its `aria-colindex`. */
const columnOf = (cell: Element | null | undefined) => Number(cell?.getAttribute('aria-colindex') ?? 0) - 1;

/**
 * The matrix as a grid. `read` is what the server answered, `shown` the same narrowed (`competenceMatrixNeeding`) or
 * `read` itself; the cells are drawn by the page (`renderCell`), each one control.
 */
export function MatrixGrid({
  read,
  shown,
  name,
  personHeader,
  renderPerson,
  renderHeader,
  renderCell,
  handle,
}: {
  read: CompetenceMatrixOutput;
  shown: CompetenceMatrixOutput;
  name: string;
  personHeader: string;
  renderPerson: (row: CompetenceMatrixRow) => ReactNode;
  renderHeader: (column: CompetenceMatrixColumn) => ReactNode;
  renderCell: (row: CompetenceMatrixRow, column: CompetenceMatrixColumn, cell: CompetenceMatrixCell) => ReactNode;
  handle?: Ref<MatrixGridHandle>;
}) {
  // The column model: the names, then one column per competence read, each cell its holding's state.
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor(row => row.name, {
          id: PERSON,
          header: () => personHeader,
          cell: ({ row }) => renderPerson(row.original),
          filterFn: keptPeople,
        }),
        ...read.columns.map((competence, i) =>
          helper.accessor(row => row.cells[i]!, {
            id: typeKey(competence.typeId),
            header: () => renderHeader(competence),
            cell: ({ row, getValue }) => renderCell(row.original, competence, getValue()),
          }),
        ),
      ]),
    [read.columns, personHeader, renderPerson, renderHeader, renderCell],
  );
  // What the narrowing keeps, as the table's state: the competences it shows and the people it keeps.
  const columnVisibility = useMemo(() => {
    const kept = new Set(shown.columns.map(c => c.typeId));
    return Object.fromEntries(read.columns.map(c => [typeKey(c.typeId), kept.has(c.typeId)]));
  }, [read.columns, shown.columns]);
  const columnFilters = useMemo<ColumnFiltersState>(
    () =>
      shown.rows.length === read.rows.length ? [] : [{ id: PERSON, value: new Set(shown.rows.map(r => r.personId)) }],
    [read.rows, shown.rows],
  );
  const table = useTable({
    features,
    columns,
    data: read.rows,
    getRowId: row => row.personId,
    state: { columnPinning: { start: [PERSON], end: [] }, columnVisibility, columnFilters },
  });
  const rows = table.getRowModel().rows;
  // The leaf headers in order, the pinned names first; `span` is how many columns the grid has, drawn or not.
  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const [personColumn, ...typeHeaders] = headers;
  const span = headers.length;
  const sticky = useTableStickyColumns<GridItem>({ startKeys: table.getStartLeafColumns().map(c => c.id) });

  // The page's scrolling (the layout's content, or the window on a short screen), where the rows start in it, and the
  // table's own region, which scrolls sideways.
  const tableRef = useRef<HTMLTableElement | null>(null);
  const viewport = useRef<RefObject<HTMLDivElement | null> | null>(null);
  const [scroller, setScroller] = useState<Element | Window | null>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    // Found again only when the one found no longer scrolls (a short screen gives the scrolling to the window).
    const next =
      scroller instanceof Element && /(auto|scroll|overlay)/.test(getComputedStyle(scroller).overflowY)
        ? scroller
        : pageScroller(viewport.current?.current ?? tableRef.current);
    if (next !== scroller) setScroller(next);
    const body = tableRef.current?.tBodies[0];
    if (!body) return;
    const top = body.getBoundingClientRect().top;
    const offset =
      next instanceof Window
        ? top + next.scrollY
        : top - next.getBoundingClientRect().top + next.scrollTop - next.clientTop;
    if (Math.abs(offset - margin) >= 1) setMargin(Math.round(offset));
  });

  // The cell that holds the grid's tab stop stays drawn, its row and its column.
  const stopRow = useRef<number | null>(null);
  const stopColumn = useRef<number | null>(null);
  const keepRow = useMemo(() => keeping(stopRow), []);
  const keepColumn = useMemo(() => keeping(stopColumn), []);
  const onWindow = scroller instanceof Window;
  const rowWindow = useVirtualizer<Element, HTMLTableRowElement>({
    count: rows.length,
    getScrollElement: () => scroller as Element | null,
    estimateSize: () => ROW_ESTIMATE,
    getItemKey: index => rows[index]?.id ?? index,
    overscan: ROW_OVERSCAN,
    scrollMargin: margin,
    rangeExtractor: keepRow,
    initialRect: INITIAL_VIEW,
    ...(onWindow
      ? {
          observeElementRect: observeWindowRect as never,
          observeElementOffset: observeWindowOffset as never,
          scrollToFn: windowScroll as never,
          initialOffset: () => window.scrollY,
        }
      : {}),
  });
  // The competences' columns along the region, after the pinned names: each at its least width while the table is
  // wider than the region, which is the only time it scrolls, and so the only time there is anything to leave out.
  const columnWindow = useVirtualizer<HTMLDivElement, HTMLTableCellElement>({
    horizontal: true,
    count: typeHeaders.length,
    getScrollElement: () => viewport.current?.current ?? null,
    estimateSize: () => CELL_PX,
    getItemKey: index => typeHeaders[index]?.id ?? index,
    paddingStart: PERSON_PX,
    scrollPaddingStart: PERSON_PX,
    overscan: COLUMN_OVERSCAN,
    rangeExtractor: keepColumn,
    initialRect: INITIAL_VIEW,
  });
  const least = useMemo(
    () =>
      resolveColumnWidths([
        { key: PERSON, width: PERSON_WIDTH },
        ...typeHeaders.map(h => ({ key: h.id, width: CELL_WIDTH })),
      ]).tableMinWidth,
    [typeHeaders.length],
  );
  const regionWidth = columnWindow.scrollRect?.width ?? INITIAL_VIEW.width;
  const windowed = least > regionWidth + 1;

  // The rows Astryx draws: those in the window, with each stretch between them (and before and after) as one row of
  // its height, less the cell's own padding and divider, which a stretch drawn tells (`frame`).
  const frame = useRef(9);
  const rowItems = rowWindow.getVirtualItems();
  const rowsTotal = rowWindow.getTotalSize();
  // The columns Astryx draws: the names, then the competences in the window, each stretch left out as one empty column
  // of its width.
  const columnItems = columnWindow.getVirtualItems();
  const columnsTotal = columnWindow.getTotalSize();
  const drawnColumns = useMemo(() => {
    const column = (header: Header<Features, CompetenceMatrixRow, unknown>): TableColumn<GridItem> => ({
      key: header.column.id,
      header: <table.FlexRender header={header} />,
      width: header.column.id === PERSON ? PERSON_WIDTH : CELL_WIDTH,
      renderCell: (item: GridItem) => {
        const cell = item.row?.getVisibleCellsByColumnId()[header.column.id];
        return cell ? <table.FlexRender cell={cell} /> : null;
      },
    });
    const out: TableColumn<GridItem>[] = personColumn ? [column(personColumn)] : [];
    if (!windowed) return [...out, ...typeHeaders.map(column)];
    let end = PERSON_PX;
    const gap = (key: string, width: number) => {
      if (width >= 1) out.push({ key: GAP + key, header: '', width: pixel(width) });
    };
    for (const item of columnItems) {
      const header = typeHeaders[item.index];
      if (!header) continue;
      gap(String(item.index), item.start - end);
      out.push(column(header));
      end = item.end;
    }
    gap('end', columnsTotal - end);
    return out;
    // `headers` changes with the column model and its state, and every header with it.
  }, [headers, windowed, columnItems, columnsTotal, table]);
  const drawnSpan = drawnColumns.length;
  // The grid's cells in each row drawn, for `useGridFocus`: the name and each competence drawn.
  const cellsPerRow = drawnColumns.filter(c => !c.key.startsWith(GAP)).length;
  const data = useMemo(() => {
    const out: GridItem[] = [];
    let end = margin;
    const gap = (key: string, height: number) => {
      if (height >= 1) out.push({ id: GAP + key, index: -1, gap: height, span: drawnSpan });
    };
    for (const item of rowItems) {
      const row = rows[item.index];
      if (!row) continue;
      gap(String(item.index), item.start - end);
      out.push({ id: row.id, index: item.index, row });
      end = item.end;
    }
    gap('end', rowsTotal + margin - end);
    return out;
  }, [rowItems, rowsTotal, rows, margin, drawnSpan]);
  // Each column's place among all the columns, drawn or not (`aria-colindex` less one).
  const place = useMemo(() => new Map(headers.map((h, i) => [h.column.id, i])), [headers]);

  // The grid's keys over the cells drawn: each name and each competence's control.
  const targetAt = useCallback((row: number, col: number) => {
    const cell = tableRef.current?.querySelector(`tr[data-index="${row}"] > ${CELL}[aria-colindex="${col + 1}"]`);
    return cell?.querySelector<HTMLElement>('a[href], button') ?? null;
  }, []);
  /** Makes `target` the grid's one tab stop, and keeps its row and its column drawn. */
  const moveStop = useCallback((target: HTMLElement) => {
    for (const el of tableRef.current?.querySelectorAll<HTMLElement>(`${CELL} [tabindex="0"]`) ?? [])
      if (el !== target) el.setAttribute('tabindex', '-1');
    target.setAttribute('tabindex', '0');
    const row = Number(target.closest('tr')?.dataset.index);
    stopRow.current = Number.isFinite(row) ? row : null;
    const col = columnOf(target.closest(CELL));
    stopColumn.current = col > 0 ? col - 1 : null;
  }, []);
  // A cell asked for that is not drawn yet: its row and its column are scrolled to, and it takes the focus once drawn.
  const pending = useRef<{ row: number; col: number } | null>(null);
  const [, redraw] = useState(0);
  const go = useCallback(
    (row: number, col: number) => {
      const now = targetAt(row, col);
      if (now) {
        moveStop(now);
        now.focus();
        return;
      }
      pending.current = { row, col };
      rowWindow.scrollToIndex(row, { align: 'auto' });
      if (col > 0) columnWindow.scrollToIndex(col - 1, { align: 'auto' });
      redraw(n => n + 1);
    },
    [targetAt, moveStop, rowWindow, columnWindow],
  );
  useLayoutEffect(() => {
    const p = pending.current;
    const target = p && targetAt(p.row, p.col);
    if (!target) return;
    pending.current = null;
    moveStop(target);
    target.focus();
  });
  /** Where the focus is in the grid: its row, its cell and their places among all of them. */
  const at = () => {
    const cell = document.activeElement?.closest<HTMLElement>(CELL);
    const tr = cell?.parentElement;
    if (!cell || !tr || !tableRef.current?.contains(tr)) return null;
    return { tr, cell, row: Number(tr.dataset.index), col: columnOf(cell) };
  };
  /** The rows the view holds, less one: what Page Up and Page Down move by. */
  const page = () => {
    const height = scroller instanceof Window ? scroller.innerHeight : (scroller?.clientHeight ?? INITIAL_VIEW.height);
    return Math.max(1, Math.floor(height / ROW_ESTIMATE) - 1);
  };
  const grid = useGridFocus<HTMLTableElement>({
    columns: cellsPerRow,
    cellSelector: CELL,
    getFocusTarget: cell => cell.querySelector<HTMLElement>('a[href], button'),
    hasRovingTabIndex: true,
    onPageUp: () => {
      const here = at();
      if (here) go(Math.max(0, here.row - page()), here.col);
    },
    onPageDown: () => {
      const here = at();
      if (here) go(Math.min(rows.length - 1, here.row + page()), here.col);
    },
  });

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    // A menu opened from a cell is drawn elsewhere in the document: its keys are its own.
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
    const here = at();
    if (!here) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if ((e.key === 'Home' || e.key === 'End') && ctrl) {
      e.preventDefault();
      if (rows.length) go(e.key === 'Home' ? 0 : rows.length - 1, e.key === 'Home' ? 0 : span - 1);
      return;
    }
    // A move to a cell that is not the one drawn beside this one, since it is not drawn yet (or the tab stop's row or
    // column was kept apart from the window): to the cell by its place among all of them.
    const beside = (el: Element, forward: boolean, attribute: string) => {
      let n = forward ? el.nextElementSibling : el.previousElementSibling;
      while (n && !n.hasAttribute(attribute)) n = forward ? n.nextElementSibling : n.previousElementSibling;
      return n;
    };
    const toCell = (col: number) => {
      const n = beside(here.cell, col > here.col, 'data-matrix-cell');
      if (columnOf(n) === col) return false;
      e.preventDefault();
      go(here.row, col);
      return true;
    };
    const toRow = (row: number, col: number) => {
      if (row < 0 || row >= rows.length) return false;
      const n = beside(here.tr, row > here.row, 'data-index');
      if ((n as HTMLElement | null)?.dataset.index === String(row) && targetAt(row, col)) return false;
      e.preventDefault();
      go(row, col);
      return true;
    };
    if (!e.altKey) {
      if (e.key === 'ArrowRight' && here.col < span - 1 && toCell(here.col + 1)) return;
      if (e.key === 'ArrowLeft' && here.col > 0 && toCell(here.col - 1)) return;
      if (e.key === 'End' && !ctrl && here.col < span - 1 && !targetAt(here.row, span - 1)) {
        e.preventDefault();
        go(here.row, span - 1);
        return;
      }
      if (e.key === 'ArrowDown' && toRow(here.row + 1, here.col)) return;
      if (e.key === 'ArrowUp' && toRow(here.row - 1, here.col)) return;
      if (e.key === 'ArrowRight' && here.col === span - 1 && toRow(here.row + 1, 0)) return;
      if (e.key === 'ArrowLeft' && here.col === 0 && toRow(here.row - 1, span - 1)) return;
    }
    grid.handleKeyDown(e);
  };
  // A cell that takes the focus, by key, Tab, pointer or the page, becomes the tab stop and is scrolled sideways
  // until it lies wholly clear of the pinned names and inside the region (2.4.11 focus not obscured).
  const onFocus = (e: FocusEvent<HTMLTableElement>) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    const cell = target?.closest<HTMLElement>(CELL);
    if (target && cell && e.currentTarget.contains(cell)) {
      if (target.getAttribute('tabindex') !== '0') moveStop(target);
      const region = viewport.current?.current;
      const pinned = cell.parentElement?.querySelector<HTMLElement>('[role="rowheader"]');
      if (region && pinned && pinned !== cell) {
        const box = cell.getBoundingClientRect();
        const edge = pinned.getBoundingClientRect().right;
        const end = region.getBoundingClientRect().left + region.clientLeft + region.clientWidth;
        if (box.left < edge) region.scrollLeft -= Math.ceil(edge - box.left);
        else if (box.right > end) region.scrollLeft += Math.ceil(Math.min(box.right - end, box.left - edge));
      }
    }
    grid.handleFocus(e);
  };

  useImperativeHandle(
    handle,
    () => ({
      focusCell(personId, typeId) {
        const row = rows.findIndex(r => r.id === personId);
        const col = place.get(typeKey(typeId));
        if (row < 0 || col === undefined) return false;
        go(row, col);
        return true;
      },
    }),
    [rows, place, go],
  );

  // The grid's roles, indices and keys, and what is not drawn, through the Table's documented hooks. Read from `live`
  // when they run, so the plugin keeps one identity and a row drawn before is not drawn again for nothing.
  const live = useRef({ rows: rows.length, span, place, onKeyDown, onFocus, measure: rowWindow.measureElement });
  live.current = { rows: rows.length, span, place, onKeyDown, onFocus, measure: rowWindow.measureElement };
  const spacer = useCallback((el: HTMLElement | null) => {
    const tr = el?.closest('tr');
    if (el && tr) frame.current = Math.max(0, Math.round(tr.getBoundingClientRect().height - el.offsetHeight));
  }, []);
  const plugin = useMemo<TablePlugin<GridItem>>(
    () => ({
      transformTable: props => ({
        ...props,
        htmlProps: {
          ...props.htmlProps,
          role: 'grid',
          'aria-label': name,
          'aria-rowcount': live.current.rows + 1,
          'aria-colcount': live.current.span,
          // Before the cell's own control: a menu's button opens its menu on the up and down arrows, which in a grid
          // move between rows.
          onKeyDownCapture: e => live.current.onKeyDown(e as KeyboardEvent<HTMLTableElement>),
          onFocus: e => live.current.onFocus(e as FocusEvent<HTMLTableElement>),
        },
      }),
      transformHeaderRow: props => ({ ...props, htmlProps: { ...props.htmlProps, 'aria-rowindex': 1 } }),
      transformHeaderCell: (props, column) => ({
        ...props,
        htmlProps: {
          ...props.htmlProps,
          ...(column.key.startsWith(GAP)
            ? { 'aria-hidden': true }
            : { 'aria-colindex': (live.current.place.get(column.key) ?? 0) + 1 }),
        },
      }),
      transformBodyCell: (props, column, item) =>
        item.gap !== undefined
          ? { ...props, isContentSuppressed: true }
          : column.key.startsWith(GAP)
            ? { ...props, isContentSuppressed: true, htmlProps: { ...props.htmlProps, 'aria-hidden': true } }
            : {
                ...props,
                htmlProps: {
                  ...props.htmlProps,
                  'aria-colindex': (live.current.place.get(column.key) ?? 0) + 1,
                  'data-matrix-cell': '',
                  // The name is each row's header (1.3.1): moving down a column, a screen reader names the person.
                  ...(column.key === PERSON ? { role: 'rowheader' } : {}),
                },
              },
      transformBodyRow: (props, item) =>
        item.gap !== undefined
          ? {
              htmlProps: { 'aria-hidden': true },
              xstyle: [],
              children: (
                <TableCell colSpan={item.span}>
                  <VStack ref={spacer} height={Math.max(0, item.gap - frame.current)} />
                </TableCell>
              ),
            }
          : {
              ...props,
              htmlProps: { ...props.htmlProps, 'aria-rowindex': item.index + 2, 'data-index': item.index },
              ref: live.current.measure,
            },
      // The grid is the matrix's one tab stop and reaches every column, each cell scrolled into view as it takes the
      // focus: the region around it is no second stop. Its reference is the region the cells are kept clear in.
      transformScrollWrapper: (props, context) => {
        viewport.current = context?.viewport ?? null;
        return { ...props, htmlProps: { ...props.htmlProps, tabIndex: undefined } };
      },
    }),
    [name, spacer],
  );

  const store = useMemo(createMenuStore, []);
  const setTable = useCallback(
    (el: HTMLTableElement | null) => {
      tableRef.current = el;
      grid.gridRef.current = el;
    },
    [grid.gridRef],
  );

  return (
    <MenuStoreContext value={store}>
      <Card padding={0}>
        <Table<GridItem>
          ref={setTable}
          data={data}
          idKey="id"
          columns={drawnColumns}
          density="compact"
          dividers="grid"
          verticalAlign="top"
          hasHover
          plugins={{ sticky, grid: plugin }}
        />
      </Card>
    </MenuStoreContext>
  );
}
