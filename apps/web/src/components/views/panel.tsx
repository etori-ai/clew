import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  answersWithRows,
  type DayView,
  type PanelViewSpec,
  type SearchResult,
  type TodayView,
  type ViewRef,
  type WeekView,
} from '@clew/contracts';
import {
  AreaLine,
  Badge,
  Button,
  DayStrip,
  EventList,
  HStack,
  Link,
  List,
  ListItem,
  Text,
  VStack,
  agendaItems,
  type AgendaItem,
} from '@clew/ui';
import { dayLabel, timeRange } from '@clew/calendar/dates';
import { fieldLabel, fieldValue, hiddenFields, reviewLabel, staleLabel } from './panel-labels';
import { useConversation } from '../conversation/conversation-context';
import { AddToConversation } from '../conversation/add-to-conversation';
import { DeclaredView } from './view';
import { useMarks } from '../../marks';
import { entityHref } from '../../person-address';
import { isWebAddress } from '../../web-address';
import { useBranding } from '../../branding';

type BodyProps = {
  output: unknown;
  /**
   * Where a calendar entry leads, on a read's own page and beside a conversation (D126 rules 1 and 3): each entry is a
   * link to its place in Kalender. Without it an entry is drawn and is no control (WA-M2).
   */
  entryHref?: (item: AgendaItem, view: 'day' | 'week') => string;
  /** The capability's declared view (D38) and what it needs to be used: its input and how to change it, and where a row's own view lives. */
  view?: PanelViewSpec | undefined;
  source?: string | undefined;
  input?: Record<string, unknown>;
  onInput?: ((next: Record<string, unknown>) => void) | undefined;
  hrefFor?: (view: ViewRef) => string;
  isLoading?: boolean;
  /** Beside the page, where the panel is as narrow as a phone: a table is drawn as its list. */
  inline?: boolean;
  /** The level of a calendar read's day headings: 3 under a pane's own heading, 2 on the read's own page, under its title. */
  dayHeadingLevel?: 2 | 3;
};
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** A day view (D32): the `calendar.day` capability's output, drawn as the day strip instead of rows. */
const isDayView = (v: unknown): v is DayView =>
  isRecord(v) && isoDate(v.from) && Array.isArray(v.events) && Array.isArray(v.proposals);
/** Today (`calendar.today`): the day's events and its free gaps, drawn as the day strip with the gaps named under it. */
const isTodayView = (v: unknown): v is TodayView =>
  isRecord(v) && isoDate(v.date) && Array.isArray(v.events) && Array.isArray(v.gaps);
/** A week (`calendar.week`): the events from a Monday, without proposals (those come with a day or the page's own week), drawn as the list with a heading per day. */
const isWeekView = (v: unknown): v is Omit<WeekView, 'proposals'> =>
  isRecord(v) && isoDate(v.from) && Array.isArray(v.events) && !Array.isArray(v.proposals);
/** The composite search's output (D26): hits with a connector and a staleness, plus every source's status. */
const isSearchResult = (v: unknown): v is SearchResult =>
  isRecord(v) &&
  Array.isArray(v.rows) &&
  Array.isArray(v.sources) &&
  v.rows.every(
    r => isRecord(r) && typeof r.ref === 'string' && typeof r.label === 'string' && typeof r.connector === 'string',
  );
const scalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
/**
 * Whether a read answered with rows (D116): a declared table or list, the search's hits, or an undeclared answer with
 * `rows`. Such an answer is a page of its own, never a thing in the panel; a day, a record or label/value pairs are not.
 */
export const answersWithRowsOf = (view: PanelViewSpec | undefined, output: unknown): boolean =>
  view
    ? answersWithRows(view.kind)
    : !isDayView(output) &&
      !isTodayView(output) &&
      !isWeekView(output) &&
      (isSearchResult(output) || (isRecord(output) && Array.isArray(output.rows)));
const rowTitle = ['name', 'title', 'label', 'supplier'];
/** A media query that never matches: a table beside the page is always its list. */
const NEVER = 'not all';

/**
 * Found text as objects (D12, D26): every hit is numbered as the answer cites it, opens where it lives and, where the
 * page has a box, can be added to the conversation as a chip. The row itself is not interactive, so its buttons are the
 * only stops (Astryx's rule).
 * A hit about a person or a unit (D97 item 6, artboard P) leads to them instead of to one source's record: its name is
 * the link, and a hit several sources answered for names them all at the end of its line.
 */
function SearchRows({ result, hrefFor }: { result: SearchResult; hrefFor?: ((view: ViewRef) => string) | undefined }) {
  const talk = useConversation();
  const marks = useMarks();
  const { pathname, search } = useLocation();
  const site = useBranding().name;
  const missed = result.sources.filter(s => s.status !== 'ok');
  return (
    <VStack gap={3}>
      {result.rows.length === 0 && <Text type="supporting">Inget hittades i källorna du får söka i.</Text>}
      {result.rows.length > 0 && (
        <List hasDividers density="compact" aria-label="Källor">
          {result.rows.map((r, i) => {
            const ref = `document:${r.connector}:${r.ref}`;
            const inConversation = talk.chipped.includes(ref);
            // A review date is a document's business: a person or a room has none to miss. Only an old one is a badge;
            // a missing date is a word in the meta line (artboard 7).
            const reviewed = r.reviewedAt ?? r.updatedAt;
            const note = r.kind === 'document' ? staleLabel(r.stale, reviewed) : '';
            const mark = marks.ofObject(`document:${r.connector}:`);
            const title = `${r.label}${r.section ? `\u00a0· ${r.section}` : ''}`;
            // The entity's page, except on that page itself (`entityHref`): the name is then plain text.
            const entity = r.subject ? entityHref(r.subject, pathname + search) : null;
            // Every source that answered for the same entity, the hit's own first: said once, on the hit's line.
            const merged = r.sources?.map(s => s.source).join('\u00a0· ');
            const meta = [merged ? '' : r.source, r.owner, reviewLabel(reviewed), r.stale ? '' : note.toLowerCase()]
              .filter(Boolean)
              .join('\u00a0· ');
            // A hit whose source declares its view (D38) opens here, drawn by Clew; the link still leads to the
            // source, in a new tab and marked as leaving Clew with Astryx's external link (D111 rule 8). A hit about an
            // entity leads to the entity instead. "Lägg till i samtalet" only where the page has a box (D111 rule 6); a
            // hit with none of the three has no line of buttons.
            const viewHref = !r.subject && r.view && hrefFor ? hrefFor(r.view) : null;
            const link = !r.subject && r.link && isWebAddress(r.link) ? r.link : null;
            return (
              <ListItem
                key={ref}
                align="start"
                startContent={<Badge variant="neutral" label={String(i + 1)} />}
                label={
                  r.subject || merged ? (
                    <HStack gap={2} justify="between" vAlign="center" wrap="wrap">
                      {entity ? (
                        <Link href={entity} weight="semibold" hasUnderline>
                          {title}
                        </Link>
                      ) : (
                        <Text weight="semibold">{title}</Text>
                      )}
                      {merged && <Text type="supporting">{merged}</Text>}
                    </HStack>
                  ) : (
                    <Text weight="semibold">{title}</Text>
                  )
                }
                description={
                  <VStack gap={1}>
                    <Text type="supporting">{r.snippet}</Text>
                    {/* The meta line starts with the source's glyph and word, so an answer from three systems shows where each hit came from. */}
                    {(meta || (r.stale && note)) && (
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        {merged ? (
                          meta && <Text type="supporting">{meta}</Text>
                        ) : (
                          <AreaLine {...(mark?.icon ? { icon: mark.icon } : {})}>{meta}</AreaLine>
                        )}
                        {r.stale && note && <Badge variant="warning" label={note} />}
                      </HStack>
                    )}
                    {(viewHref || link || talk.hasBox) && (
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        {viewHref && r.view && (
                          <Button size="sm" variant="secondary" label={r.view.title} href={viewHref} />
                        )}
                        {link && (
                          <Link href={link} isExternalLink isStandalone>
                            {r.view ? `Öppna i ${r.source}` : 'Öppna'}
                          </Link>
                        )}
                        {talk.hasBox && (
                          <AddToConversation
                            added={inConversation}
                            onAdd={() => talk.addChip({ ref, kind: 'document', label: r.label })}
                          />
                        )}
                      </HStack>
                    )}
                  </VStack>
                }
              />
            );
          })}
        </List>
      )}
      {missed.length > 0 && (
        <Text type="supporting">
          {missed.map(s => s.source).join(', ')} svarade inte. Träffarna ovan är från de källor som svarade.
        </Text>
      )}
      <Text type="supporting">Hämtat som du, ur det du får se. Inget av texten sparas på {site}.</Text>
    </VStack>
  );
}
/**
 * A read capability's output as the panel and a view's page draw it. A capability that declares its view (D38) is drawn
 * as it says; without a declaration rows become a list and anything else label/value pairs.
 */
export function PanelBody({
  output,
  entryHref,
  view,
  source,
  input,
  onInput,
  hrefFor,
  isLoading,
  inline = false,
  dayHeadingLevel = 3,
}: BodyProps) {
  const declared = view ?? null;
  const day = !declared && isDayView(output) ? output : null;
  const todayView = !declared && !day && isTodayView(output) ? output : null;
  const week = !declared && !day && !todayView && isWeekView(output) ? output : null;
  const calendar = day || todayView || week;
  const search = !declared && !calendar && isSearchResult(output) ? output : null;
  const dayItems = day
    ? agendaItems(day.events, day.proposals)
    : todayView
      ? agendaItems(todayView.events, [])
      : week
        ? agendaItems(week.events, [])
        : [];
  const navigate = useNavigate();
  const site = useBranding().name;
  const links = useMemo(() => {
    if (!entryHref) return undefined;
    const follow = (href: string) => void navigate(href);
    return {
      day: { href: (item: AgendaItem) => entryHref(item, 'day'), follow },
      week: { href: (item: AgendaItem) => entryHref(item, 'week'), follow },
    };
  }, [entryHref, navigate]);
  const rows =
    !declared && !calendar && !search && isRecord(output) && Array.isArray(output.rows)
      ? (output.rows as Record<string, unknown>[])
      : null;
  const pairs =
    !declared && !calendar && !search && isRecord(output)
      ? Object.entries(output).filter(([k]) => k !== 'rows' && !hiddenFields.has(k))
      : [];
  return (
    <VStack gap={3}>
      {declared && (
        <DeclaredView
          view={declared}
          output={output}
          {...(input ? { input } : {})}
          {...(onInput ? { onInput } : {})}
          {...(hrefFor ? { hrefFor } : {})}
          isLoading={!!isLoading}
          {...(inline ? { tableQuery: NEVER } : {})}
        />
      )}
      {day && (
        <>
          <Text type="supporting">Du tittar på {dayLabel(day.from)} i din kalender.</Text>
          <DayStrip date={day.from} items={dayItems} dayHeadingLevel={dayHeadingLevel} itemLink={links?.day} />
        </>
      )}
      {todayView && (
        <>
          <Text type="supporting">Du tittar på {dayLabel(todayView.date)} i din kalender.</Text>
          <DayStrip date={todayView.date} items={dayItems} dayHeadingLevel={dayHeadingLevel} itemLink={links?.day} />
          <Text type="supporting">
            {todayView.gaps.length
              ? `Lediga luckor: ${todayView.gaps.map(g => timeRange(g.start, g.end)).join(', ')}.`
              : 'Inga lediga luckor i dag.'}
          </Text>
        </>
      )}
      {week && (
        <EventList
          from={week.from}
          days={5}
          items={dayItems}
          dayHeadingLevel={dayHeadingLevel}
          itemLink={links?.week}
        />
      )}
      {search && <SearchRows result={search} hrefFor={hrefFor} />}
      {rows && (
        <List hasDividers density="compact">
          {rows.map((r, i) => {
            const key = rowTitle.find(k => r[k] !== undefined);
            const detail = Object.entries(r)
              .filter(([k, v]) => k !== key && !hiddenFields.has(k) && scalar(v))
              .map(([k, v]) => `${fieldLabel(k)}: ${fieldValue(v)}`)
              .join('\u00a0· ');
            return (
              <ListItem
                key={i}
                label={<Text>{key ? fieldValue(r[key]) : `Rad ${i + 1}`}</Text>}
                description={<Text type="supporting">{detail}</Text>}
              />
            );
          })}
        </List>
      )}
      {pairs.length > 0 && (
        <List density="compact">
          {pairs.map(([k, v]) => (
            <ListItem
              key={k}
              label={<Text>{fieldLabel(k)}</Text>}
              description={<Text type="supporting">{fieldValue(v)}</Text>}
            />
          ))}
        </List>
      )}
      {!declared && !calendar && !search && !rows && !pairs.length && <Text type="supporting">Inget att visa.</Text>}
      {/* A declared view and the search name where they read from themselves; a plain read says it here. */}
      {source && (rows || pairs.length > 0) && (
        <Text type="supporting">
          Hämtat ur {source}. Inget av det sparas på {site}.
        </Text>
      )}
    </VStack>
  );
}
