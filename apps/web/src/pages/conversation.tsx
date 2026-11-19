import { useCallback, useLayoutEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Thread, ViewRef } from '@clew/contracts';
import {
  AreaMark,
  Button,
  Card,
  ChatLayout,
  Divider,
  EmptyState,
  Heading,
  HStack,
  Icon,
  IconButton,
  LayoutPanel,
  Link,
  ResizeHandle,
  Skeleton,
  StackItem,
  Text,
  VStack,
  VisuallyHidden,
  XMarkIcon,
  percent,
  pixel,
  useMediaQuery,
  useResizable,
  type AgendaItem,
} from '@clew/ui';
import { areasQuery, entityDetailQuery, entityListQuery, threadQuery, threadsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { keys } from '../query-keys';
import { applyThread } from '../thread-cache';
import { withCard, withoutPanel } from '../panel-address';
import { lensTabHref, openedAsPage, opensAsPage, viewOpenHref, viewPageHref } from '../view-address';
import { itemPageHref } from '../work-items';
import { personPageHref, unitPageHref } from '../person-address';
import { useMarks } from '../marks';
import { usePageTitle } from '../page-title';
import { DOT } from '../dot';
import {
  ASSISTANT_PARAM,
  aboutWords,
  addressEntity,
  assistantHref,
  askAboutWords,
  askPersonPlaceholder,
  withWords,
  withoutSubject,
  type EntitySubjectKind,
} from '../conversation-about';
import { mobileQuery, shortQuery } from '../components/shell/shell';
import { Composer } from '../components/conversation/composer';
import { Transcript } from '../components/conversation/conversation';
import { AssistantPane, AssistantsMenu } from '../components/conversation/assistant-pane';
import { NamedMenu } from '../components/conversation/named-menu';
import { titled, useConversation, type ChipRef } from '../components/conversation/conversation-context';
import { drawn } from '../components/conversation/thing-panel';
import { cardBody } from '../components/work/card-panel';
import { PanelBody, answersWithRowsOf } from '../components/views/panel';
import { useView } from '../components/views/view-read';
import { BriefSkeleton } from '../components/work/brief';
import { EventDialog } from '../components/calendar/event-dialog';
import { PageFrame, type EntryStyle } from '../components/shell/page-frame';
import { EntityPane } from './entity-pane';

/**
 * From this window width the thing a conversation is about stands beside the transcript (D126 rule 2, board Samtal):
 * the rail, a transcript that still reads as one, and the pane's 440 px. Narrower, the thing is one link away, in the
 * header's line.
 */
const PANE = 440;
/**
 * The pane's width is the person's own (the product owner, 2026-11-17, after Eneo's panel): dragged by the grip on its
 * edge or moved with the arrow keys on it, never under what its header and buttons need and never over two fifths of
 * the window, so the transcript still reads as one; kept in the browser.
 */
const PANE_MIN = 360;
const PANE_MAX = 720;
const PANE_SHARE = 40;
const paneQuery = `(min-width: ${260 + 500 + PANE}px)`;
/** Esc inside a menu, a list or a dialog is theirs. */
const OWN_ESCAPE = '[role="menu"], [role="listbox"], [role="dialog"], dialog';

/**
 * The conversation's title in the header and the browser tab: the question as typed; before one, what it is about
 * ("Fråga om Johan Byström", the product owner 2026-11-14: the page says what it is before anything is written), and
 * "Nytt samtal" only for a conversation about nothing in particular. While the subject's name is read, the words of the
 * button that led here.
 */
export function conversationTitle(
  talk: Pick<ReturnType<typeof useConversation>, 'conversation' | 'pending'>,
  about: Pick<About, 'name' | 'subject'> = { name: null, subject: false },
): string {
  const asked = talk.conversation?.title ?? talk.pending?.text.slice(0, 80);
  if (asked) return titled(asked);
  if (about.name) return askAboutWords(about.name);
  return about.subject ? 'Fråga assistenten' : 'Nytt samtal';
}

/** How many frames an answer may take to draw its item again before the focus goes to the box instead (about a second). */
const DRAWN_WITHIN = 60;
/** The element takes the focus once it is drawn; one that never is leaves the focus to what the caller falls back on. */
function focusOnceDrawn(id: string, otherwise: () => void, left = DRAWN_WITHIN) {
  const element = document.getElementById(id);
  if (element) element.focus();
  else if (left <= 0) otherwise();
  else requestAnimationFrame(() => focusOnceDrawn(id, otherwise, left - 1));
}

/**
 * Where a work item was drawn in an answer while it stands beside the transcript (one item, one place): a row that says
 * where it is, and "Visa här", which lets the pane go of it so the answer draws it again.
 */
function ShownBeside({ onShowHere }: { onShowHere: () => void }) {
  return (
    <Card variant="muted" padding={3}>
      <HStack justify="between" vAlign="center" gap={3}>
        <Text type="supporting" color="secondary">
          Visas bredvid samtalet
        </Text>
        <Button size="sm" variant="ghost" label="Visa här" onClick={onShowHere} />
      </HStack>
    </Card>
  );
}

/**
 * What the conversation is about, by its address (D126 rule 2): the work item beside it (`card`), a view that is one
 * thing (`open`, a record, a document, a day), a person or a unit (`person`, `unit`, one subject whichever of their tabs
 * "Fråga assistenten" was pressed on; `section` is only the pane's tab), or the people under a lens of Personal (`lens`). Its
 * chips go with every question there; a person or a unit goes with none, since what a source says about them never
 * reaches the model (D97 item 7, D115).
 */
export interface About {
  /** Whether the address names anything at all, named yet or not. */
  subject: boolean;
  /** Its name, in the title before the first question and after "om" in the header's line once there is one. */
  name: string | null;
  /** Its own page, the link in the header's line where no pane stands beside the transcript. */
  href: string | null;
  chips: ChipRef[];
  /** A person or a unit: said under the first question, and a person's first name in the empty box. */
  entity?: { kind: EntitySubjectKind; name: string | null };
  /** The pane beside the transcript, and its landmark's name; absent for what has no pane. */
  pane?: { label: string; body: ReactNode; scrolls: boolean };
}

/**
 * The conversation's page (D126 rules 2 and 5, the `ai-chat` template, boards Samtal, SamtalVerktyg, SamtalEneoFraga and
 * SamtalEneo): its title and a line saying whom it is with and, when it is about a thing, which; the transcript in
 * `ChatLayout` with the box docked under it; and the thing it is about in the end panel, drawn with the parts the
 * queue's reading pane draws (source line, the title as the link to its page, the decisions under the title, the facts),
 * with ✕. `/conversations/new` is a conversation not asked yet: "Fråga assistenten" lands there with the thing beside it, the
 * box has the focus, and nothing is sent until the person writes. At narrow width the thing is one link away instead of
 * a pane. On a short screen (1.4.10) nothing is docked and the page scrolls as one.
 */
export function ConversationPage({ entry, onChange }: { entry: EntryStyle; onChange: (thread: Thread) => void }) {
  const talk = useConversation();
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const fits = useMediaQuery(paneQuery);
  const beside = fits && !short;
  const navigate = useNavigate();
  const location = useLocation();
  const { pathname, search } = location;
  const here = pathname + search;
  const client = useQueryClient();
  const views = useQuery(areasQuery).data?.views;
  const marks = useMarks();
  // An entry opened from a day beside the conversation (D32): the calendar's own dialog, over the page.
  const [openItem, setOpenItem] = useState<{ item: AgendaItem; dayItems: AgendaItem[] } | null>(null);
  /** ✕, or Esc in the pane: the thing leaves the address, the conversation stays, and the box has the focus. */
  const closePane = useCallback(() => {
    navigate(addressEntity(search) ? withoutSubject(pathname, search) : withoutPanel(pathname, search));
    requestAnimationFrame(() => talk.focus());
  }, [navigate, pathname, search, talk]);
  const escape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || (e.target as HTMLElement).closest(OWN_ESCAPE)) return;
    // The pane lets go of its thing; the conversation behind it is not closed with it.
    e.stopPropagation();
    closePane();
  };
  // The menu over what the conversation has named, in the header of whatever stands beside the transcript.
  const named = <NamedMenu />;
  const about = useAbout({ here, closePane, escape, onChange, onOpenItem: setOpenItem, tools: named });
  const pane = useResizable({
    defaultSize: PANE,
    minSize: PANE_MIN,
    maxSize: percent(PANE_SHARE, { max: pixel(PANE_MAX) }),
    autoSaveId: 'clew:conversation-pane',
  });
  /** "Visa här": the item goes back into the answer that is about it, and its title there has the focus. */
  const showHere = useCallback(
    (threadId: string) => {
      navigate(withoutPanel(pathname, search));
      focusOnceDrawn(`thread-${threadId}-title`, () => talk.focus());
    },
    [navigate, pathname, search, talk],
  );
  // Another system's assistant beside the conversation (`assistant` in the address): its own exchange and its own box.
  // One panel holds one thing, so it stands in the place of the thing the conversation is about while it is open.
  const asideId = new URLSearchParams(search).get(ASSISTANT_PARAM);
  const closeAside = useCallback(() => {
    talk.dropAside();
    navigate(assistantHref(pathname, search, null));
    requestAnimationFrame(() => talk.focus());
  }, [navigate, pathname, search, talk]);
  // At the end of the header: what the conversation holds, the way to put any of it beside the transcript when nothing
  // stands there, and the other systems' assistants.
  const assistants = (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <NamedMenu place="header" />
      <AssistantsMenu open={asideId} hrefFor={id => assistantHref(pathname, search, id)} />
    </HStack>
  );
  const aside = asideId ? (
    <AssistantPane
      assistant={asideId}
      tools={named}
      onClose={closeAside}
      onKeyDown={e => {
        if (e.key !== 'Escape' || (e.target as HTMLElement).closest(OWN_ESCAPE)) return;
        e.stopPropagation();
        closeAside();
      }}
    />
  ) : null;
  // A view an answer names (D116): a table or a list is its own page with the conversation as the way back, one thing
  // beside the transcript.
  const viewHref = (v: ViewRef) => viewOpenHref(views, pathname, search, v);
  const besideCard = new URLSearchParams(search).get('card');
  // Whether the item the address names is drawn in the pane now: the pane fits, and no assistant stands in its place.
  const cardInPane = beside && !aside && !!about.pane;
  // A person or a unit is said under the first question, so the transcript reads alone later.
  const firstLine = about.entity?.name ? aboutWords(about.entity.name) : undefined;
  const transcript = (
    <Transcript
      about={about.chips}
      firstLine={firstLine}
      onOpenView={v => navigate(viewHref(v))}
      // The item beside the transcript is not drawn again in the turn that is about it: one item, one place. Where it
      // was drawn, a row says so and brings it back.
      renderCard={t =>
        besideCard !== t.id ? (
          cardBody(t, { place: 'answer', level: 2, compact: mobile, onChange })
        ) : cardInPane ? (
          <ShownBeside onShowHere={() => showHere(t.id)} />
        ) : null
      }
      viewHref={viewHref}
      asideHref={id => assistantHref(pathname, search, id)}
      asideOpen={asideId}
      // A row of several items opens its item beside the transcript, in the place of an assistant's exchange if one
      // stands there: one panel holds one thing.
      cardHref={id => {
        const q = new URLSearchParams(search);
        q.delete(ASSISTANT_PARAM);
        return withCard(pathname, q, id);
      }}
    />
  );
  // Opened from its address, a conversation is read before it is drawn: its shape meanwhile, never an empty page. On
  // Hem, where the transcript takes the column while the first answer is written, nothing is read: the log stays the
  // same log when the answer gives the conversation its address, so it speaks the answer once (4.1.3).
  const routeId = pathname.startsWith('/conversations/') ? pathname.slice('/conversations/'.length) : null;
  const loading = !!routeId && routeId !== 'new' && talk.conversation?.id !== routeId && !talk.pending && !talk.error;
  // The line under the title: whom the conversation is with and, once something is asked and the title is the question,
  // which thing it is about. Before that the title says it ("Fråga om …"); where nothing stands beside the transcript
  // the line still holds the thing's name as the link to its page.
  const asked = !!talk.conversation || !!talk.pending;
  const paneShown = !!about.pane && beside && !aside;
  const meta = (
    <Text type="supporting" color="secondary">
      {`Samtal med ${withWords(null)}`}
      {about.name && (asked || !paneShown) && (
        <>
          {asked ? `${DOT}om ` : DOT}
          {paneShown ? about.name : about.href ? <Link href={about.href}>{about.name}</Link> : about.name}
        </>
      )}
    </Text>
  );
  const heading = loading ? 'Samtal' : conversationTitle(talk, about);
  // The page names itself in the browser tab (2.4.2). The log speaks its answers and the box keeps the focus, so the
  // change of title is not spoken.
  usePageTitle(heading, false);
  const composer = (
    <Composer
      place="conversation"
      // With the thing in the pane, the question says it stands open beside the transcript: the assistant reads "det
      // öppna ärendet" as it. Where no pane is drawn it goes along as before, as what the conversation is about.
      about={paneShown ? about.chips.map(c => ({ ...c, beside: true as const })) : about.chips}
      placeholder={
        about.entity?.kind === 'person' && about.entity.name ? askPersonPlaceholder(about.entity.name) : undefined
      }
    />
  );
  const body = loading ? (
    <VStack gap={2}>
      <VisuallyHidden role="status">Hämtar samtalet …</VisuallyHidden>
      <Skeleton width="60%" height={14} />
      <Skeleton width="40%" height={14} index={1} />
    </VStack>
  ) : (
    transcript
  );
  const dialog = (
    <EventDialog
      item={openItem?.item ?? null}
      dayItems={openItem?.dayItems ?? []}
      onClose={() => setOpenItem(null)}
      /* The day beside the conversation and every loaded week are read again; a moved proposal's thread goes into the cache like any other answer. */
      onChanged={t => {
        if (t) {
          onChange(t);
          void applyThread(client, t);
        }
        void client.invalidateQueries({ queryKey: keys.viewAll });
        void client.invalidateQueries({ queryKey: keys.calendarAll });
      }}
    />
  );
  // The conversation in the page frame every page has (D126, the product owner 2026-11-14): the title on Hem's line,
  // the transcript and its box in the column under it, and the thing it is about in the end panel inside the same frame.
  // On a short screen (1.4.10) nothing is docked and the page scrolls as one.
  if (short)
    return (
      <>
        <PageFrame entry={entry} title={heading} titleId="samtal" meta={meta} actions={assistants} label="Samtalet">
          {aside ?? (
            <VStack gap={4}>
              {body}
              {composer}
            </VStack>
          )}
        </PageFrame>
        {dialog}
      </>
    );
  return (
    <>
      <PageFrame
        entry={entry}
        title={heading}
        titleId="samtal"
        meta={meta}
        actions={assistants}
        label="Samtalet"
        bare
        end={
          beside && (aside || about.pane) ? (
            <>
              {/* The grip draws the line between the transcript and the pane, so the pane draws none of its own. */}
              <ResizeHandle
                direction="horizontal"
                isReversed
                hasDivider
                resizable={pane.props}
                label="Ändra rutans bredd"
              />
              {aside ? (
                <LayoutPanel
                  width={pane.size}
                  padding={0}
                  hasDivider={false}
                  role="complementary"
                  label="Assistent i ett annat system"
                >
                  {aside}
                </LayoutPanel>
              ) : (
                <LayoutPanel
                  width={pane.size}
                  padding={0}
                  hasDivider={false}
                  isScrollable={about.pane!.scrolls}
                  role="complementary"
                  label={about.pane!.label}
                >
                  {about.pane!.body}
                </LayoutPanel>
              )}
            </>
          ) : undefined
        }
      >
        {/* As the `ai-chat` template holds it: the chat column is the content's full height, and ChatLayout owns the
            scroll, so the box stays docked inside the window. */}
        {/* Where nothing fits beside the transcript, the assistant's exchange takes the column until it is closed. */}
        <VStack height="100%">{!beside && aside ? aside : <ChatLayout composer={composer}>{body}</ChatLayout>}</VStack>
      </PageFrame>
      {dialog}
    </>
  );
}

/** What the address says the conversation is about, and the pane that draws it. */
function useAbout({
  here,
  closePane,
  escape,
  onChange,
  onOpenItem,
  tools,
}: {
  here: string;
  closePane: () => void;
  escape: (e: KeyboardEvent) => void;
  onChange: (thread: Thread) => void;
  onOpenItem: (item: { item: AgendaItem; dayItems: AgendaItem[] }) => void;
  /** What stands before ✕ in the pane's header, whatever the pane holds (`NamedMenu`). */
  tools: ReactNode;
}): About {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const marks = useMarks();
  const q = new URLSearchParams(search);
  const cardId = q.get('card');
  const open = q.get('open');
  // A lens of Personal (`lens`): the conversation is about the people under that lens (D126 rule 5).
  const lens = q.get('lens');
  const views = useQuery(areasQuery).data?.views;
  // The work item: from the stream, else read on its own (handled long ago, past the stream's history).
  const listQ = useQuery({ ...threadsQuery, enabled: !!cardId });
  const listed = cardId ? listQ.data?.threads.find(t => t.id === cardId) : undefined;
  const oneQ = useQuery({ ...threadQuery(cardId ?? ''), enabled: !!cardId && !!listQ.data && !listed, retry: false });
  const thread = listed ?? oneQ.data;
  // A view: read as the person (D38). One that answers with rows is a page of its own (D116), never beside.
  const listedView = !!open && opensAsPage(views, open);
  const side = useView(open && !listedView ? open : null, open ? q.get('open-input') : null, {
    title: q.get('open-title') ?? open ?? '',
    address: here,
  });
  const rows = listedView || (!!side.shown && answersWithRowsOf(side.shown.spec, side.shown.output));
  const page = rows ? openedAsPage(pathname, q) : null;
  useLayoutEffect(() => {
    if (page) navigate(page, { replace: true });
  }, [page]);
  // A person or a unit: the subject, whichever tab it came from (`section` is only the pane's tab).
  const entity = addressEntity(search);
  const entityQ = useQuery({ ...entityDetailQuery(entity?.kind ?? 'person', entity?.key ?? ''), enabled: !!entity });
  const lensQ = useQuery({ ...entityListQuery('person'), enabled: !!lens && !cardId && !open && !entity });
  const lensSource = lens ? lensQ.data?.lenses.find(l => l.capability === lens) : undefined;

  if (cardId) {
    const missing = listQ.isError ? (
      <Text as="p" role="alert">
        {errorMessage(listQ.error, 'Ärendet kunde inte hämtas just nu.')}
      </Text>
    ) : listQ.data && !oneQ.isPending ? (
      <EmptyState
        isCompact
        headingLevel={2}
        title="Ärendet finns inte längre"
        description="Det kan ha tagits bort i källsystemet."
      />
    ) : (
      <BriefSkeleton rows={1} compact />
    );
    const close = (
      <HStack justify="end" gap={1}>
        {tools}
        <IconButton
          variant="ghost"
          label="Stäng ärendet"
          icon={<Icon icon={XMarkIcon} size="sm" />}
          onClick={closePane}
        />
      </HStack>
    );
    // The same parts as Att göra's reading pane (D126 rule 2): the work item at its narrow width, its ✕ in its own title
    // row and no "Fråga assistenten", since this is that conversation. A calendar proposal keeps its own card (D27).
    const body =
      thread && !thread.proposals.length ? (
        <VStack height="100%" onKeyDown={escape}>
          {cardBody(thread, { place: 'pane', level: 2, onChange, onClose: closePane, marked: true, tools })}
        </VStack>
      ) : (
        <VStack gap={3} padding={6} onKeyDown={escape}>
          {close}
          {thread ? cardBody(thread, { place: 'pane', level: 2, compact: true, onChange }) : missing}
        </VStack>
      );
    return {
      subject: true,
      name: thread?.title ?? null,
      href: thread ? itemPageHref(thread.id, here) : null,
      chips: [{ ref: 'thread:' + cardId, kind: 'thread', label: thread?.title ?? 'Ärendet', threadId: cardId }],
      pane: { label: thread?.title ?? 'Ärende', body, scrolls: !thread || !!thread.proposals.length },
    };
  }
  if (open) {
    const title = q.get('open-title') ?? open;
    const shown = rows ? null : side.shown;
    const input = shown?.input ?? {};
    const href = viewPageHref({ capability: open, title, input }, here);
    // A view's mark is its area's (D71), as on its chip: the capability's connector is the first part of its name.
    const mark = marks.ofCapability(open, open.split('.')[0] ?? '', shown?.source ?? '');
    const body = (
      <VStack gap={6} padding={6} onKeyDown={escape}>
        <HStack justify="between" vAlign="start" gap={3}>
          <AreaMark ordinal={mark.ordinal} icon={mark.icon} />
          <StackItem size="fill">
            <VStack gap={1}>
              {shown?.source && (
                <Text type="supporting" color="secondary">
                  {shown.source}
                </Text>
              )}
              <Heading level={2}>
                <Link href={href} color="primary" type="inherit" weight="semibold">
                  {title}
                </Link>
              </Heading>
            </VStack>
          </StackItem>
          <HStack gap={1} vAlign="center">
            {tools}
            <IconButton label="Stäng" variant="ghost" icon={<Icon icon={XMarkIcon} size="sm" />} onClick={closePane} />
          </HStack>
        </HStack>
        <Divider />
        {shown ? (
          <PanelBody
            output={shown.output}
            view={shown.spec}
            source={shown.source}
            input={shown.input}
            inline
            isLoading={side.isLoading}
            onOpenItem={(item, dayItems) => onOpenItem({ item, dayItems })}
            hrefFor={v => viewOpenHref(views, pathname, search, v)}
          />
        ) : side.failed ? (
          <Text as="p" role="alert">
            {errorMessage(side.failed, 'Kunde inte hämta.')}
          </Text>
        ) : (
          <BriefSkeleton rows={1} compact />
        )}
      </VStack>
    );
    return {
      subject: true,
      name: title,
      href,
      chips: [{ ref: 'capability:' + open, kind: 'capability', label: title }],
      ...(rows ? {} : { pane: { label: title, body, scrolls: true } }),
    };
  }
  if (entity) {
    // The person or the unit itself beside the transcript, drawn with their page's parts and tabs (D126 rule 2); the
    // tab the reader came from is the pane's first, and changing it changes nothing of the conversation.
    const name = entityQ.data?.entity.name ?? null;
    const page = entity.kind === 'person' ? personPageHref : unitPageHref;
    return {
      subject: true,
      name,
      href: page(entity.key, { ...(entity.tab ? { section: entity.tab } : {}), from: here }),
      chips: [],
      entity: { kind: entity.kind, name },
      pane: {
        label: name ?? (entity.kind === 'person' ? 'Personen' : 'Enheten'),
        body: (
          <EntityPane
            kind={entity.kind}
            entityKey={entity.key}
            tab={entity.tab}
            tools={tools}
            onClose={closePane}
            onKeyDown={escape}
          />
        ),
        scrolls: true,
      },
    };
  }
  if (lens)
    return {
      subject: true,
      name: lensSource?.title ?? null,
      href: lensTabHref(lens),
      chips: [],
    };
  return { subject: false, name: null, href: null, chips: [] };
}
