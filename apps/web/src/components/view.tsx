import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ANY_TONE,
  ViewRefSchema,
  checkContract,
  fieldTone,
  openRef,
  viewRows,
  type Activity,
  type Metric,
  type Series,
  type DocumentBundle,
  type PanelViewSpec,
  type ViewField,
  type ViewInput,
  type ViewRef,
  type ViewTone,
} from '@clew/contracts';
import { displayDate, shortDayLabel, timeLabel } from '@clew/calendar/dates';
import {
  AreaChip,
  MetricView,
  SeriesView,
  ActivityView,
  Badge,
  Button,
  EmptyState,
  Heading,
  HStack,
  Icon,
  Link,
  List,
  ListItem,
  Markdown,
  MetadataList,
  MetadataListItem,
  Card,
  Selector,
  Table,
  Text,
  TextInput,
  VStack,
  pixel,
  proportional,
  useAnnounce,
  useMediaQuery,
} from '@clew/ui';
import { counted, fieldValue, statusWord } from './panel-labels';
import { groupFields, rowGroups, wholeRow, type FieldGroup } from '../view-fields';
import { useMarks } from '../marks';
import { useConversation } from './conversation-context';
import { AddToConversation } from './add-to-conversation';
import { PageHeader } from './page-header';
import { DocumentReader } from './document-reader';
import { useLocation } from 'react-router';
import { entityHref } from '../person-address';

/**
 * A declared view (D38): the connector says what the output holds (a table, a list, one record, a text, and which
 * fields with which Swedish labels) and this file draws it, with Astryx components only. It is the one renderer for
 * every placement: the side panel, a tool's page and the compact embed under an answer, and every kind gets the one
 * header (D71, artboards 4 and 7): the area's chip, the source and the count in supporting, the view's own controls or
 * "Visa allt" at the end of the same line. On a tool's page the title comes first, with the controls at the end of its
 * line and the mark row under it, as on every other page (D74). A connector never sends markup, so a view looks, reads and tabs the same
 * whichever system it comes from.
 */
type Row = Record<string, unknown>;
type RowsView = Extract<PanelViewSpec, { kind: 'table' | 'list' }>;
export interface DeclaredViewProps {
  view: PanelViewSpec;
  output: unknown;
  /** The capability's current input, and how to change it: without `onInput` the view's own controls are not drawn (a card's view, an embed). */
  input?: Record<string, unknown>;
  onInput?: (next: Record<string, unknown>) => void;
  /** Where a row's own view lives; without it a row is not a link. */
  hrefFor?: (view: ViewRef) => string;
  isLoading?: boolean;
  /** Draw at most this many rows and say how many there are (the embed under an answer). */
  limit?: number;
  /** The outline level of a heading inside the view: 3 in the panel and under an answer, 2 on a tool's page, under its h1. */
  headingLevel?: 2 | 3;
  /** From which window width a table is drawn as a table: a page beside the rail needs more than the panel does. */
  tableQuery?: string;
  /** A tool page's title: the page's heading at level 1, the controls at the end of its line and the mark row under it (D74). */
  title?: string;
  /** Under an answer (artboard 4): "Visa allt" at the end of the header opens the whole view. */
  onShowAll?: () => void;
}

const dateOnly = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'long' });
const tone = { ok: 'success', warn: 'warning', alert: 'error', none: 'neutral' } as const;
/** The Astryx Badge variant a view's tone is drawn in: only what needs the person has a status colour. */
export const badgeVariant = (t: ViewTone) => tone[t];
/** The tone a field gives a value, by the one reading of `tones` the server shares (`fieldTone`, so `*` counts). */
const toneOf = (field: ViewField, value: unknown) => fieldTone(field, value);
/** Whether the view gives this value a tone of its own: named for it, or `*` for any value that is present (D97). */
const hasTone = (field: ViewField, value: unknown) => {
  const tones = field.tones;
  if (!tones || value === undefined || value === null) return false;
  const own = (key: string) => Object.prototype.hasOwnProperty.call(tones, key);
  return own(String(value)) || (value !== '' && own(ANY_TONE));
};
/**
 * A moment as the lists say it: the short weekday, the day, the month and the time, in Swedish time ("tors 12 nov. kl.
 * 09:00"). A calendar day without a time ("2026-11-04", a talk held that day) is the day alone ("ons 4 nov.").
 */
export function instantText(value: string): string | null {
  if (Number.isNaN(Date.parse(value))) return null;
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return shortDayLabel(value);
    return `${shortDayLabel(displayDate(value))} kl. ${timeLabel(value)}`;
  } catch {
    return null;
  }
}
/** A number as Swedish digits, its unit after it when the field declares one: "12 platser", "11 200 kr". */
const amount = (field: ViewField, value: unknown) =>
  typeof value === 'number'
    ? field.unit
      ? counted(value, field.unit)
      : value.toLocaleString('sv-SE')
    : `${String(value)}${field.unit ? ` ${field.unit.other}` : ''}`;
/**
 * A status is a badge only where it is a state with a word of its own (D71): a bare yes or no, which takes the field's
 * label as its word, or a value the view gives a tone, which a source does for the value that needs the person or, with
 * the tone `none`, for a state it wants drawn as a neutral badge ("Bokat"). Any other status is supporting text.
 */
export const isBadged = (field: ViewField, value: unknown) => typeof value === 'boolean' || hasTone(field, value);
/** The one word in its tone: only the state that needs the person has a status colour, the other is neutral, and a yes carries its check. */
function StatusBadge({ field, value }: { field: ViewField; value: unknown }) {
  return (
    <Badge
      variant={tone[toneOf(field, value)]}
      label={statusWord(field.label, value)}
      {...(value === true && toneOf(field, value) === 'none' ? { icon: <Icon icon="check" size="sm" /> } : {})}
    />
  );
}
/**
 * The mark row every view kind shares (D71, artboards 4 and 7): the chip of the area that offers the capability, in the
 * system's hue, then the source and the count in supporting.
 */
function MarkRow({ view, count }: { view: PanelViewSpec; count: number | null }) {
  const mark = useMarks().ofCapability(view.capability, view.connector, view.source);
  const noun = view.kind === 'table' || view.kind === 'list' ? view.noun : undefined;
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <AreaChip ordinal={mark.ordinal} label={mark.title} {...(mark.icon ? { icon: mark.icon } : {})} />
      <Text type="supporting">
        {/* A view with no area of its own has the system's word on its chip, and it is not said twice. */}
        {[mark.title === mark.source ? '' : mark.source, count === null ? '' : counted(count, noun)]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </HStack>
  );
}
/**
 * The header of a view in the panel and under an answer (D71): the mark row with the controls or "Visa allt" at the end
 * of the same line. On a tool's page the view has the page's title, and the header is the one page header instead
 * (D74): the title with the controls at the end of its line, the mark row under it.
 */
function ViewHeader({ view, count, end }: { view: PanelViewSpec; count: number | null; end?: ReactNode }) {
  return (
    <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
      <MarkRow view={view} count={count} />
      {end}
    </HStack>
  );
}
const empty = (value: unknown) => value === undefined || value === null || value === '';
/** The systems a combined list could not reach, as the server names them. */
const unansweredIn = (output: unknown): string[] => {
  const names = output && typeof output === 'object' ? (output as Row).unanswered : undefined;
  return Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string' && n.length > 0) : [];
};
/** A number as something a phone can dial: digits and a leading plus. Too short to be a number is drawn as text. */
const dial = (value: string) => {
  const n = value.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return n.replace(/\D/g, '').length >= 3 ? n : null;
};
const isMail = (value: string) => /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(value);
const isWeb = (value: string) => /^https?:\/\/[^\s]+$/i.test(value);
const linked = (field: ViewField) => field.format === 'phone' || field.format === 'email' || field.format === 'link';
/** A field drawn wherever the whole row is, compact or not: the title that names a row (D97). */
const drawnWhole = ({ compact: _compact, ...field }: ViewField): ViewField => field;
/**
 * One cell of a row (D97): the field that names it, then each field beside it on the same line, a value beside another
 * in supporting text unless it is a badge or a link.
 */
function Cell({ group, row, lead }: { group: FieldGroup; row: Row; lead?: ReactNode }): ReactNode {
  if (!group.beside.length) return lead ?? <Value field={group.lead} value={row[group.lead.key]} />;
  const beside = group.beside.filter(f => !empty(row[f.key]));
  const first = lead ?? (empty(row[group.lead.key]) ? null : <Value field={group.lead} value={row[group.lead.key]} />);
  if (!beside.length) return first ?? <Value field={group.lead} value={undefined} />;
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      {first}
      {beside.map(f => (
        <Value key={f.key} field={f} value={row[f.key]} text="supporting" />
      ))}
    </HStack>
  );
}
export { Cell as FieldCell };

/**
 * How a value that is neither a badge nor a link reads (D97): as `ordinary` text, or in `supporting` text, as a time
 * beside a state's badge does. Left out, a value reads as a declared view has always drawn it: a status without a tone
 * in supporting text, anything else ordinary.
 */
export type ValueText = 'ordinary' | 'supporting';
/**
 * One value, drawn by its declared format. What cannot be drawn as the format says is drawn as plain text, never as a
 * broken link. Exported as `FieldValue` for a page that places one field of one row itself (Personal's columns and lens,
 * the opened person's sections, D97), with `text` saying how a value without a badge reads there.
 */
function Value({ field, value, text }: { field: ViewField; value: unknown; text?: ValueText }): ReactNode {
  if (empty(value)) return <Text type="supporting">–</Text>;
  const raw = String(value);
  const words = (said: string, fallback: ValueText = 'ordinary') =>
    (text ?? fallback) === 'supporting' ? <Text type="supporting">{said}</Text> : <Text>{said}</Text>;
  switch (field.format) {
    case 'phone': {
      const number = dial(raw);
      return number ? (
        <Link href={`tel:${number}`} hasUnderline>
          {raw}
        </Link>
      ) : (
        words(raw)
      );
    }
    case 'email':
      return isMail(raw) ? (
        <Link href={`mailto:${raw}`} hasUnderline>
          {raw}
        </Link>
      ) : (
        words(raw)
      );
    case 'link':
      return isWeb(raw) ? (
        <Link href={raw} isExternalLink>
          {field.label}
        </Link>
      ) : (
        <Text type="supporting">–</Text>
      );
    case 'number':
      return text === 'supporting' ? (
        <Text type="supporting" hasTabularNumbers>
          {fieldText(field, value)}
        </Text>
      ) : (
        <Text hasTabularNumbers>{fieldText(field, value)}</Text>
      );
    case 'status':
      return isBadged(field, value) ? (
        <StatusBadge field={field} value={value} />
      ) : (
        words(fieldText(field, value), 'supporting')
      );
    default:
      return words(fieldText(field, value));
  }
}

export { Value as FieldValue };
/**
 * A value as words without its label (D97: the time beside a state, a value in a one-line summary): a date or a moment
 * in Swedish, a number with its unit, a status its word, anything else as given.
 */
export function fieldText(field: ViewField, value: unknown): string {
  const raw = String(value);
  switch (field.format) {
    case 'date': {
      const at = Date.parse(raw);
      return Number.isNaN(at) ? raw : dateOnly.format(at);
    }
    case 'instant':
      return instantText(raw) ?? raw;
    case 'number':
      return amount(field, value);
    case 'status':
      return statusWord(field.label, value);
    case 'phone':
    case 'email':
    case 'link':
      return raw;
    default:
      return fieldValue(value);
  }
}
/**
 * One field of a row as a line of words says it (D71): a status its word, a number with its unit ("40 platser") or its
 * label ("Perioder: 3"), a date or a moment with its label, a bare yes or no with its label, any other text as given.
 */
export function fieldWord(f: ViewField, value: unknown): string {
  if (f.format === 'status') return statusWord(f.label, value);
  if (f.format === 'number') return f.unit ? amount(f, value) : `${f.label}: ${amount(f, value)}`;
  if (f.format === 'date' && !Number.isNaN(Date.parse(String(value))))
    return `${f.label}: ${dateOnly.format(Date.parse(String(value)))}`;
  if (f.format === 'instant') {
    const at = instantText(String(value));
    if (at) return `${f.label}: ${at}`;
  }
  // A bare yes or no is said with its label, never as "Ja · Ja".
  const labelled = (f.format && f.format !== 'text') || typeof value === 'boolean';
  return labelled ? `${f.label}: ${fieldValue(value)}` : fieldValue(value);
}

/** The view's own controls: a search field and a choice, each bound to one input of the capability. Typing asks again after a pause, Enter at once. */
function Controls({
  controls,
  input,
  onInput,
  isLoading,
}: {
  controls: ViewInput;
  input: Record<string, unknown>;
  onInput: (next: Record<string, unknown>) => void;
  isLoading: boolean;
}) {
  const { query, filter } = controls;
  // The input as it is now, for a pause that ends after it changed: a choice made while a question was still being typed keeps both.
  const latest = useRef(input);
  latest.current = input;
  const askedIn = (from: Record<string, unknown>) =>
    query && typeof from[query.key] === 'string' ? (from[query.key] as string) : '';
  const withQuestion = (from: Record<string, unknown>, value: string) => {
    if (!query) return from;
    const { [query.key]: _dropped, ...rest } = from;
    return value.trim() ? { ...rest, [query.key]: value.trim() } : rest;
  };
  const asked = askedIn(input);
  const [typed, setTyped] = useState(asked);
  // What the address says wins when it changes under the field (back, a link, an answer's view); what is being typed is not overwritten by its own echo.
  const echoed = useRef(asked);
  useEffect(() => {
    if (asked !== echoed.current) {
      echoed.current = asked;
      setTyped(asked);
    }
  }, [asked]);
  const ask = (value: string) => {
    if (!query || value.trim() === askedIn(latest.current)) return;
    echoed.current = value.trim();
    onInput(withQuestion(latest.current, value));
  };
  // Only what is typed restarts the pause; `ask` reads the input as it is when the pause ends.
  useEffect(() => {
    const timer = setTimeout(() => ask(typed), 350);
    return () => clearTimeout(timer);
  }, [typed]);
  const choose = (value: string) => {
    if (!filter) return;
    echoed.current = typed.trim();
    onInput(withQuestion({ ...latest.current, [filter.key]: value }, query ? typed : ''));
  };
  const chosen = filter
    ? typeof input[filter.key] === 'string' && filter.options.some(o => o.value === input[filter.key])
      ? (input[filter.key] as string)
      : filter.options[0]!.value
    : '';
  return (
    <HStack gap={2} wrap="wrap" vAlign="end">
      {query && (
        <TextInput
          type="search"
          enterKeyHint="search"
          label={query.label}
          isLabelHidden
          placeholder={query.placeholder}
          value={typed}
          onChange={setTyped}
          onEnter={() => ask(typed)}
          hasClear
          isLoading={isLoading}
          startIcon="search"
          width={240}
        />
      )}
      {/* The choice as the artboards draw it (H, I): one selector that says what is chosen. */}
      {filter && (
        <Selector
          label={filter.label}
          isLabelHidden
          variant="secondary"
          value={chosen}
          onChange={choose}
          options={filter.options.map(o => ({ value: o.value, label: o.label }))}
        />
      )}
    </HStack>
  );
}

function Rows({
  view,
  rows,
  hrefFor,
  wide,
}: {
  view: RowsView;
  rows: Row[];
  hrefFor?: (view: ViewRef) => string;
  wide: boolean;
}) {
  const talk = useConversation();
  const titleField = view.fields.find(f => f.key === view.title)!;
  // The whole row (D97): the compact field is left out and a field beside another shares its cell; the title names the
  // row and is always drawn, in a cell of its own.
  const groups = rowGroups(
    view.fields.map(f => (f.key === view.title ? drawnWhole(f) : f)),
    { lead: view.title },
  );
  const titleGroup = groups.find(g => g.lead.key === view.title);
  const columnGroups = groups.filter(g => g !== titleGroup);
  const others = groups.flatMap(groupFields).filter(f => f.key !== view.title);
  const opens = (row: Row) => {
    if (!hrefFor) return undefined;
    // A row of Clew's own combined list opens in the system it came from (D35 item 4); any other row opens its connector's own read.
    const own = view.rowViews && checkContract(ViewRefSchema, row.view) ? row.view : undefined;
    const ref = own ?? (view.open ? openRef(view.open, row, view.source) : undefined);
    return ref ? hrefFor(ref) : undefined;
  };
  // The person or unit a row names (D97 item 6): the row's key for it leads to the entity, with this page as the way back;
  // on that entity's own page it leads nowhere (`entityHref`).
  const { pathname, search } = useLocation();
  const entityOf = (row: Row) => {
    const key = view.subject ? row[view.subject.key] : undefined;
    return view.subject && typeof key === 'string' && key
      ? (entityHref({ entity: view.subject.entity, key }, pathname + search) ?? undefined)
      : undefined;
  };
  // A row that opens a read keeps that on its name; the entity is then a link of its own at the row's end, named for it.
  const entityLink = (row: Row) => {
    const href = opens(row) ? entityOf(row) : undefined;
    if (!href) return null;
    const label = empty(row[view.title])
      ? view.subject!.entity === 'unit'
        ? 'Öppna enheten'
        : 'Öppna personen'
      : `Öppna ${String(row[view.title])}`;
    return (
      <Link href={href} weight="semibold" isStandalone>
        {label}
      </Link>
    );
  };
  const name = (row: Row) => {
    const href = opens(row) ?? entityOf(row);
    const label = empty(row[view.title]) ? '–' : String(row[view.title]);
    return href ? (
      <Link href={href} weight="semibold" hasUnderline>
        {label}
      </Link>
    ) : (
      <Text weight="semibold">{label}</Text>
    );
  };
  // A row with a ref of a connector that can read it back can go into the box (D12), as a search hit can, where the
  // page has a box (D110 rule 6); without one neither the `@` nor its column is drawn.
  const chips = view.chip && !!view.ref && talk.hasBox;
  const chip = (row: Row) => {
    const ref =
      chips && view.ref && typeof row[view.ref] === 'string' ? `document:${view.connector}:${row[view.ref]}` : null;
    return ref ? (
      <AddToConversation
        added={talk.chipped.includes(ref)}
        onAdd={() => talk.addChip({ ref, kind: 'document', label: String(row[view.title] ?? view.source) })}
      />
    ) : null;
  };
  const key = (row: Row, i: number) =>
    view.ref && typeof row[view.ref] === 'string' ? (row[view.ref] as string) : String(i);
  if (view.kind === 'table' && wide) {
    type TableRow = { id: string; row: Row } & Record<string, unknown>;
    // A column is as wide as what it holds: a number never wraps, an address gets room, a Swedish title is one long word
    // that a narrower column would break in the middle, and the rest share what is left in proportion to their floors
    // (equal weights would give every column the widest floor, and a table wider than its panel).
    const share = (floor: number) => proportional(floor / 100, { minWidth: floor });
    const columns = [
      {
        key: view.title,
        header: titleField.label,
        width: share(130),
        renderCell: (r: TableRow) =>
          titleGroup ? <Cell group={titleGroup} row={r.row} lead={name(r.row)} /> : name(r.row),
      },
      ...columnGroups.map(({ lead: f, beside }) => ({
        key: f.key,
        header: f.label,
        width: f.format === 'phone' && !beside.length ? pixel(118) : share(f.format === 'email' ? 248 : 145),
        // Numbers are tabular and end-aligned, so the digits stand under each other (artboard 7).
        ...(f.format === 'number' && !beside.length ? { align: 'end' as const } : {}),
        renderCell: (r: TableRow) => <Cell group={{ lead: f, beside }} row={r.row} />,
      })),
      ...(chips
        ? [{ key: 'clew-chip', header: 'Samtal', width: pixel(66), renderCell: (r: TableRow) => chip(r.row) }]
        : []),
      // One cell cannot be two links: a row whose name opens a read has the entity it names in a column of its own.
      ...(view.subject && rows.some(row => opens(row) && entityOf(row))
        ? [
            {
              key: 'clew-entity',
              header: view.subject.entity === 'unit' ? 'Enhet' : 'Person',
              width: share(145),
              renderCell: (r: TableRow) => entityLink(r.row),
            },
          ]
        : []),
    ];
    // The table in a bordered card, as artboard I draws it.
    return (
      <Card padding={0}>
        <Table<TableRow>
          data={rows.map((row, i) => ({ id: key(row, i), row }))}
          idKey="id"
          columns={columns}
          density="compact"
          hasHover
        />
      </Card>
    );
  }
  // The list, and a table on a narrow surface: the row is not interactive itself, so its name, its numbers and its `@` are the only stops.
  return (
    <List hasDividers density="compact" aria-label={view.source}>
      {rows.map((row, i) => {
        const shown = others.filter(f => !empty(row[f.key]));
        // The meta line holds the words, the badges stand at the row's end, the links under the line (D71: the row level).
        const marks = shown.filter(f => f.format === 'status' && isBadged(f, row[f.key])),
          links = shown.filter(linked),
          worded = shown.filter(f => !linked(f) && !marks.includes(f));
        // A word beside another follows it on the line without a label of its own (D97): "Samtal: Bokat tors 12 nov".
        const words = groups
          .map(g =>
            groupFields(g)
              .filter(f => worded.includes(f))
              .map(f => (f === g.lead ? fieldWord(f, row[f.key]) : fieldText(f, row[f.key])))
              .join(' '),
          )
          .filter(Boolean);
        // The numbers and the address share a line and wrap where they must, so a long address never pushes the row sideways (1.4.10) and a person takes three lines, not five.
        return (
          <ListItem
            key={key(row, i)}
            align="start"
            label={name(row)}
            endContent={
              marks.length > 0 || entityLink(row) ? (
                <HStack gap={2} vAlign="center" wrap="wrap" justify="end">
                  {marks.map(f => (
                    <StatusBadge key={f.key} field={f} value={row[f.key]} />
                  ))}
                  {chip(row)}
                  {entityLink(row)}
                </HStack>
              ) : (
                chip(row)
              )
            }
            description={
              <VStack gap={1}>
                {words.length > 0 && <Text type="supporting">{words.join(' · ')}</Text>}
                {links.length > 0 && (
                  <HStack gap={3} wrap="wrap">
                    {links.map(f => (
                      <Text key={f.key} type="supporting">
                        {f.format !== 'link' && `${f.label} `}
                        <Value field={f} value={row[f.key]} />
                      </Text>
                    ))}
                  </HStack>
                )}
              </VStack>
            }
          />
        );
      })}
    </List>
  );
}

export function DeclaredView({
  view,
  output,
  input = {},
  onInput,
  hrefFor,
  isLoading = false,
  limit,
  headingLevel = 3,
  tableQuery = '(min-width: 1010px)',
  title,
  onShowAll,
}: DeclaredViewProps) {
  const wide = useMediaQuery(tableQuery);
  const { pathname, search } = useLocation();
  // A count that changes while someone types is spoken as one message, the latest (4.1.3); the visible line says the same.
  const announce = useAnnounce({ hasReplace: true });
  const all = view.kind === 'table' || view.kind === 'list' ? (viewRows(view, output) ?? []) : null;
  const count = all?.length ?? null;
  const said = useRef<number | null>(null);
  const controls = (view.kind === 'table' || view.kind === 'list') && onInput ? view.input : undefined;
  useEffect(() => {
    if (count === null || isLoading) return;
    if (said.current !== null && said.current !== count && controls)
      announce(
        count === 0
          ? ((view.kind === 'table' || view.kind === 'list') && view.empty) || 'Inga rader'
          : counted(count, view.kind === 'table' || view.kind === 'list' ? view.noun : undefined),
      );
    said.current = count;
  }, [count, isLoading, controls, announce, view]);
  const end = controls ? (
    <Controls controls={controls} input={input} onInput={onInput!} isLoading={isLoading} />
  ) : onShowAll ? (
    <Button size="sm" variant="secondary" label="Visa allt" onClick={onShowAll} />
  ) : undefined;
  const header = title ? (
    <PageHeader title={title} end={end} meta={<MarkRow view={view} count={count} />} />
  ) : (
    <ViewHeader view={view} count={count} end={end} />
  );
  if (view.kind === 'text') {
    const body = (output as Row | null)?.[view.body];
    return (
      <VStack gap={3}>
        {header}
        {/* The text's headings start one level under the surface's title (artboard 7): h3 in the panel, h2 on a page. */}
        {typeof body === 'string' && body.trim() ? (
          <Markdown density="compact" headingLevelStart={headingLevel}>
            {body}
          </Markdown>
        ) : (
          <Text type="supporting">Inget att visa.</Text>
        )}
      </VStack>
    );
  }
  if (view.kind === 'document' || view.kind === 'metrics' || view.kind === 'series' || view.kind === 'activity') {
    const body = (output as Row)?.[view.body];
    return (
      <VStack gap={3}>
        {header}
        {view.kind === 'document' ? (
          <DocumentReader
            bundle={body as DocumentBundle}
            capability={view.capability}
            input={input}
            compact={!!limit}
          />
        ) : view.kind === 'metrics' ? (
          <MetricView metrics={body as Metric[]} />
        ) : view.kind === 'series' ? (
          <SeriesView series={body as Series} chart={view.chart} />
        ) : (
          <ActivityView activity={body as Activity} />
        )}
      </VStack>
    );
  }
  if (view.kind === 'detail' || view.kind === 'record') {
    const record = output && typeof output === 'object' && !Array.isArray(output) ? (output as Row) : {};
    // The whole record (D97): the compact field is left out, and a fact beside another shares its line and its label.
    const shown = wholeRow(view.fields).filter(
      f => !empty(record[f.key]) && (f.format !== 'link' || isWeb(String(record[f.key]))),
    );
    const facts = shown.filter(f => f.format !== 'link'),
      out = shown.filter(f => f.format === 'link');
    const factLines = rowGroups(view.fields).filter(g => groupFields(g).some(f => facts.includes(f)));
    // The person or unit the record names (D97 item 6): its heading leads to the entity, except on that entity's own page.
    const subject = view.kind === 'detail' ? view.subject : undefined;
    const named = subject ? record[subject.key] : undefined;
    const entity =
      subject && typeof named === 'string' && named
        ? entityHref({ entity: subject.entity, key: named }, pathname + search)
        : undefined;
    return (
      <VStack gap={3}>
        {header}
        {/* The record's title is the open card's level (D71: level 2), under the surface's own heading in the outline. */}
        {!empty(record[view.title]) && (
          <Heading level={2} accessibilityLevel={headingLevel}>
            {entity ? (
              <Link href={entity} hasUnderline>
                {String(record[view.title])}
              </Link>
            ) : (
              String(record[view.title])
            )}
          </Heading>
        )}
        {facts.length > 0 && (
          <MetadataList>
            {factLines.map(g => (
              <MetadataListItem key={g.lead.key} label={g.lead.label}>
                <Cell group={{ lead: g.lead, beside: g.beside.filter(f => facts.includes(f)) }} row={record} />
              </MetadataListItem>
            ))}
          </MetadataList>
        )}
        {out.length > 0 && (
          <HStack gap={3} wrap="wrap">
            {out.map(f => (
              <Value key={f.key} field={f} value={record[f.key]} />
            ))}
          </HStack>
        )}
        {shown.length === 0 && empty(record[view.title]) && <Text type="supporting">Inget att visa.</Text>}
        {view.kind === 'record' && (
          <>
            {view.document && (
              <DocumentReader
                bundle={record[view.document] as DocumentBundle}
                capability={view.capability}
                input={input}
                compact={!!limit}
              />
            )}
            {view.items && (
              <Rows
                view={{ ...view, kind: 'table', title: view.items.title, fields: view.items.fields }}
                rows={(record[view.items.rows] as Row[]).slice(0, limit ?? 500)}
                hrefFor={hrefFor}
                wide={wide && !limit}
              />
            )}
            {view.metrics && <MetricView metrics={record[view.metrics] as Metric[]} />}
            {view.series && <SeriesView series={record[view.series] as Series} />}
            {view.activity && <ActivityView activity={record[view.activity] as Activity} />}
          </>
        )}
        <Text type="supporting">Hämtat ur {view.source}. Inget av det sparas på Startsidan.</Text>
      </VStack>
    );
  }
  const rows = limit ? all!.slice(0, limit) : all!;
  // A combined list names the systems that did not answer, so an empty or short list is never read as the whole truth.
  const missed = view.rowViews ? unansweredIn(output) : [];
  return (
    <VStack gap={3}>
      {header}
      {rows.length === 0 ? (
        <EmptyState
          isCompact
          headingLevel={headingLevel}
          title={missed.length > 0 ? 'Inget att visa från de system som svarade' : (view.empty ?? 'Inget att visa')}
        />
      ) : (
        <Rows view={view} rows={rows} hrefFor={hrefFor} wide={wide && !limit} />
      )}
      {/* Under an answer a cut list says how much is left out (artboard 4); the rows keep the order the source gave, which is the answer's. */}
      {rows.length > 0 && (
        <Text type="supporting">
          {all!.length > rows.length
            ? `${rows.length} av ${all!.length} rader. Inget av det sparas på Startsidan.`
            : `${counted(rows.length)} · ${view.source}. Inget av det sparas på Startsidan.`}
        </Text>
      )}
      {missed.length > 0 && <Text type="supporting">{missed.join(', ')} svarade inte.</Text>}
    </VStack>
  );
}
