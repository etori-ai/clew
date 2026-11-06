import { useEffect, useRef, useState, type ReactNode } from 'react';
import { openRef, viewRows, type PanelViewSpec, type ViewField, type ViewInput, type ViewRef } from '@clew/contracts';
import {
  AreaChip,
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
import { useMarks } from '../marks';
import { useConversation } from './conversation-context';
import { AddToConversation } from './add-to-conversation';

/**
 * A declared view (D38): the connector says what the output holds (a table, a list, one record, a text, and which
 * fields with which Swedish labels) and this file draws it, with Astryx components only. It is the one renderer for
 * every placement: the side panel, a tool's page and the compact embed under an answer, and every kind gets the one
 * header (D71, artboards 4 and 7): the area's chip, the source and the count in supporting, the view's own controls or
 * "Visa allt" at the end of the same line. A connector never sends markup, so a view looks, reads and tabs the same
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
  /** A tool page's title (D71): the page's heading at level 1, drawn under the header's line. */
  title?: string;
  /** Under an answer (artboard 4): "Visa allt" at the end of the header opens the whole view. */
  onShowAll?: () => void;
}

const dateOnly = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'long' });
const tone = { ok: 'success', warn: 'warning', alert: 'error', none: 'neutral' } as const;
const toneOf = (field: ViewField, value: unknown) => field.tones?.[String(value)] ?? 'none';
/** A number as Swedish digits, its unit after it when the field declares one: "12 platser", "11 200 kr". */
const amount = (field: ViewField, value: unknown) =>
  typeof value === 'number'
    ? field.unit
      ? counted(value, field.unit)
      : value.toLocaleString('sv-SE')
    : `${String(value)}${field.unit ? ` ${field.unit.other}` : ''}`;
/**
 * A status is a badge only where it is a state with a word of its own (D71): a bare yes or no, which takes the field's
 * label as its word, or a value the view gives a tone because it needs the person. Any other status is supporting text.
 */
const badged = (field: ViewField, value: unknown) => typeof value === 'boolean' || toneOf(field, value) !== 'none';
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
 * The header every view kind shares (D71, artboards 4 and 7): the chip of the area that offers the capability, in the
 * system's hue, then the source and the count in supporting, and the controls or "Visa allt" at the end of the same line.
 */
function ViewHeader({ view, count, end }: { view: PanelViewSpec; count: number | null; end?: ReactNode }) {
  const mark = useMarks().ofCapability(view.capability, view.connector, view.source);
  const noun = view.kind === 'table' || view.kind === 'list' ? view.noun : undefined;
  return (
    <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
      <HStack gap={2} vAlign="center" wrap="wrap">
        <AreaChip ordinal={mark.ordinal} label={mark.title} {...(mark.icon ? { icon: mark.icon } : {})} />
        <Text type="supporting">
          {/* A view with no area of its own has the system's word on its chip, and it is not said twice. */}
          {[mark.title === mark.source ? '' : mark.source, count === null ? '' : counted(count, noun)]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </HStack>
      {end}
    </HStack>
  );
}
const empty = (value: unknown) => value === undefined || value === null || value === '';
/** A number as something a phone can dial: digits and a leading plus. Too short to be a number is drawn as text. */
const dial = (value: string) => {
  const n = value.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return n.replace(/\D/g, '').length >= 3 ? n : null;
};
const isMail = (value: string) => /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(value);
const isWeb = (value: string) => /^https?:\/\/[^\s]+$/i.test(value);
const linked = (field: ViewField) => field.format === 'phone' || field.format === 'email' || field.format === 'link';

/** One value, drawn by its declared format. What cannot be drawn as the format says is drawn as plain text, never as a broken link. */
function Value({ field, value }: { field: ViewField; value: unknown }): ReactNode {
  if (empty(value)) return <Text type="supporting">–</Text>;
  const text = String(value);
  switch (field.format) {
    case 'phone': {
      const number = dial(text);
      return number ? (
        <Link href={`tel:${number}`} hasUnderline>
          {text}
        </Link>
      ) : (
        <Text>{text}</Text>
      );
    }
    case 'email':
      return isMail(text) ? (
        <Link href={`mailto:${text}`} hasUnderline>
          {text}
        </Link>
      ) : (
        <Text>{text}</Text>
      );
    case 'link':
      return isWeb(text) ? (
        <Link href={text} isExternalLink>
          {field.label}
        </Link>
      ) : (
        <Text type="supporting">–</Text>
      );
    case 'date': {
      const at = Date.parse(text);
      return <Text>{Number.isNaN(at) ? text : dateOnly.format(at)}</Text>;
    }
    case 'number':
      return <Text hasTabularNumbers>{amount(field, value)}</Text>;
    case 'status':
      return badged(field, value) ? (
        <StatusBadge field={field} value={value} />
      ) : (
        <Text type="supporting">{statusWord(field.label, value)}</Text>
      );
    default:
      return <Text>{fieldValue(value)}</Text>;
  }
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
  const others = view.fields.filter(f => f.key !== view.title);
  const opens = (row: Row) => {
    const ref = view.open && hrefFor ? openRef(view.open, row, view.source) : undefined;
    return ref && hrefFor ? hrefFor(ref) : undefined;
  };
  const name = (row: Row) => {
    const href = opens(row);
    const label = empty(row[view.title]) ? '–' : String(row[view.title]);
    return href ? (
      <Link href={href} weight="semibold" hasUnderline>
        {label}
      </Link>
    ) : (
      <Text weight="semibold">{label}</Text>
    );
  };
  // A row with a ref of a connector that can read it back can go into the box (D12), as a search hit can.
  const chip = (row: Row) => {
    const ref =
      view.chip && view.ref && typeof row[view.ref] === 'string' ? `document:${view.connector}:${row[view.ref]}` : null;
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
      { key: view.title, header: titleField.label, width: share(130), renderCell: (r: TableRow) => name(r.row) },
      ...others.map(f => ({
        key: f.key,
        header: f.label,
        width: f.format === 'phone' ? pixel(118) : share(f.format === 'email' ? 248 : 145),
        // Numbers are tabular and end-aligned, so the digits stand under each other (artboard 7).
        ...(f.format === 'number' ? { align: 'end' as const } : {}),
        renderCell: (r: TableRow) => <Value field={f} value={r.row[f.key]} />,
      })),
      ...(view.chip && view.ref
        ? [{ key: 'clew-chip', header: 'Samtal', width: pixel(66), renderCell: (r: TableRow) => chip(r.row) }]
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
        const marks = shown.filter(f => f.format === 'status' && badged(f, row[f.key])),
          links = shown.filter(linked),
          words = shown.filter(f => !linked(f) && !marks.includes(f));
        const word = (f: ViewField) => {
          const value = row[f.key];
          if (f.format === 'status') return statusWord(f.label, value);
          // A number with its unit says what it is ("40 platser"); one without keeps its label ("Perioder: 3").
          if (f.format === 'number') return f.unit ? amount(f, value) : `${f.label}: ${amount(f, value)}`;
          if (f.format === 'date' && !Number.isNaN(Date.parse(String(value))))
            return `${f.label}: ${dateOnly.format(Date.parse(String(value)))}`;
          // A bare yes or no is said with its label, never as "Ja · Ja".
          const labelled = (f.format && f.format !== 'text') || typeof value === 'boolean';
          return labelled ? `${f.label}: ${fieldValue(value)}` : fieldValue(value);
        };
        // The numbers and the address share a line and wrap where they must, so a long address never pushes the row sideways (1.4.10) and a person takes three lines, not five.
        return (
          <ListItem
            key={key(row, i)}
            align="start"
            label={name(row)}
            endContent={
              marks.length > 0 ? (
                <HStack gap={2} vAlign="center" wrap="wrap" justify="end">
                  {marks.map(f => (
                    <StatusBadge key={f.key} field={f} value={row[f.key]} />
                  ))}
                  {chip(row)}
                </HStack>
              ) : (
                chip(row)
              )
            }
            description={
              <VStack gap={1}>
                {words.length > 0 && <Text type="supporting">{words.map(word).join(' · ')}</Text>}
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
          ? (view.kind !== 'detail' && view.kind !== 'text' && view.empty) || 'Inga rader'
          : counted(count, view.kind === 'table' || view.kind === 'list' ? view.noun : undefined),
      );
    said.current = count;
  }, [count, isLoading, controls, announce, view]);
  const header = (
    <ViewHeader
      view={view}
      count={count}
      end={
        controls ? (
          <Controls controls={controls} input={input} onInput={onInput!} isLoading={isLoading} />
        ) : onShowAll ? (
          <Button size="sm" variant="secondary" label="Visa allt" onClick={onShowAll} />
        ) : undefined
      }
    />
  );
  const heading = title ? <Heading level={1}>{title}</Heading> : null;
  if (view.kind === 'text') {
    const body = (output as Row | null)?.[view.body];
    return (
      <VStack gap={3}>
        {header}
        {heading}
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
  if (view.kind === 'detail') {
    const record = output && typeof output === 'object' && !Array.isArray(output) ? (output as Row) : {};
    const shown = view.fields.filter(
      f => !empty(record[f.key]) && (f.format !== 'link' || isWeb(String(record[f.key]))),
    );
    const facts = shown.filter(f => f.format !== 'link'),
      out = shown.filter(f => f.format === 'link');
    return (
      <VStack gap={3}>
        {header}
        {heading}
        {/* The record's title is the open card's level (D71: level 2), under the surface's own heading in the outline. */}
        {!empty(record[view.title]) && (
          <Heading level={2} accessibilityLevel={headingLevel}>
            {String(record[view.title])}
          </Heading>
        )}
        {facts.length > 0 && (
          <MetadataList>
            {facts.map(f => (
              <MetadataListItem key={f.key} label={f.label}>
                <Value field={f} value={record[f.key]} />
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
        <Text type="supporting">Hämtat ur {view.source}. Inget av det sparas på Startsidan.</Text>
      </VStack>
    );
  }
  const rows = limit ? all!.slice(0, limit) : all!;
  return (
    <VStack gap={3}>
      {header}
      {heading}
      {rows.length === 0 ? (
        <EmptyState isCompact headingLevel={headingLevel} title={view.empty ?? 'Inget att visa'} />
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
    </VStack>
  );
}
