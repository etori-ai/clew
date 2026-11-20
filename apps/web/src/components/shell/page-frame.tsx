import { useCallback, useContext, useLayoutEffect, useRef, type ReactNode, type Ref, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { ConversationResponse, Prepared } from '@clew/contracts';
import {
  ArrowsPointingOutIcon,
  BreadcrumbItem,
  Breadcrumbs,
  Button,
  Card,
  ArrowLeftIcon,
  Divider,
  Drawer,
  Heading,
  HStack,
  Icon,
  IconButton,
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  LayoutPanel,
  Link,
  ResizeHandle,
  ScrollableArea,
  SparklesIcon,
  StackItem,
  Text,
  VStack,
  percent,
  pixel,
  useEntryAnimation,
  useMediaQuery,
  useResizable,
} from '@clew/ui';
import { mobileQuery, paneBesideQuery, shortQuery } from '../../media';
import { asksBeside, withAsk, withoutAsk } from '../../panel-address';
import { SHELL_WIDTH, SiteName } from './shell';
import { useClearCorner, useCornerDoor, useReturnFocusToCorner, type CornerDoor } from './assistant-corner';
import { PageFrameContext } from './page-frame-context';
import { useConversation, useModelConfigured } from '../conversation/conversation-context';
import {
  PageTalk,
  useOpenAsConversation,
  usePageConversation,
  type PageConversation,
  type PageSubject,
} from '../conversation/page-conversation';
import { useAskAbout } from '../conversation/thing-panel';
import { useBranding } from '../../branding';
import { DOT } from '../../dot';

/**
 * Hem's column (board Hem): the product owner decided on 2026-11-14 that the start page's container is every page's, so
 * a register, a thing, a conversation and an administration section sit in the same centred frame as Hem's greeting
 * and blocks, with the same header and content padding (D126). `PageFrame` is the only place that sets it.
 */
export const PAGE_WIDTH = SHELL_WIDTH;
/** The `work-item-detail` template's own line: the facts stand in the end panel above it, above the read at it and below. */
export const narrowPageQuery = '(max-width: 1024px)';
/** The facts' end panel beside the column (board Person, board Ärende). */
const FACTS_WIDTH = 340;
/**
 * The boards keep the page's 24 px inset on a phone (Hem, Att göra and Ärende at 390 px); only the narrowest screens,
 * where 1.4.10 asks for 320 px, take the tighter 16 px.
 */
const tightQuery = '(max-width: 359px)';

/**
 * Whether and about what a page has the assistant's pane (D135 rule 1, D138 item 3): every page says, so
 * leaving it out is a type error and no page can forget the assistant. `subject` is what the page shows: its list (the
 * registers, Läget and Att göra's queue) or its thing (a work item, its review, a record, a person, a unit and a plan,
 * D136), null until the page knows it (while its data loads, on a thing's missing page) and while a pane of the page's
 * own holds the end slot (Att göra's item). `none` is a page with no subject and why: Administration, where nothing is a
 * read the assistant may make; the assistant's own pages, Hem, Ny fråga and a conversation; a frame that is no page of
 * the person's work, the first load's or a missing calendar's. On those the corner's "Fråga AI" starts a new question
 * (`CornerDoor`).
 */
export type PageAsk = AskAbout | { none: 'administration' | 'assistant' | 'no-page' };
/** A page with the assistant's pane (D135 rules 2 to 4, D138 items 3 and 4). */
export interface AskAbout {
  subject: PageSubject | null;
  /** Hears each finished turn in the pane: the page makes ready what an answer prepared (Kalender, D140). */
  onAnswer?: ((response: ConversationResponse) => void) | undefined;
  /** What the page draws under an answer that prepared one of its decisions (Kalender's "Använd tiden"). */
  prepared?: ((prepared: Prepared) => ReactNode) | undefined;
}
/**
 * The assistant's pane (D138 item 4): a card 400 px wide at the end of the shell's column. It is dragged, or moved with
 * the arrow keys on its grip, between the limits below (the product owner asked on 2026-11-19 that it be resized as
 * Astryx's panels are), and its width is kept in the browser. It never takes more than half the column, so the page
 * keeps the larger part.
 */
const ASK_PANE = 400;
const ASK_PANE_MIN = 360;
const ASK_PANE_MAX = 720;
/** The most of the shell's column the pane may take, in percent. */
const ASK_PANE_SHARE = 50;
/**
 * Between the page and the pane: `CARD_GAP` (20 px) on a page with a card of the frame's, 10 px at each side of the
 * grip's line (the row's 2 px and the grip's own 8 px, which its 16 px grab zone fills). A board's cards inset
 * themselves and its column scrolls at the board's edge, so there the pane stands the board's own end inset (24 px) and
 * the grip's 8 px from it, and the grab zone stays off the column's scrollbar; the pane takes the board's inset at its
 * top, foot and end too.
 */
const PANE_GAP = 20;
const BOARD_INSET = 24;
const BOARD_PANE_GAP = BOARD_INSET + 8;
/** What a key pressed in the pane belongs to rather than the pane: a menu, a list box or a dialog over it. */
const OWNS_ESCAPE = '[role="menu"], [role="listbox"], [role="dialog"], dialog';
/** A field the person types in: where the press has put the focus once the box has it. */
const TYPING = 'input, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]';
/** How many frames the press waits for the box to be drawn (its editor may still be loading): about a second. */
const BOX_WITHIN = 60;
/** The drawer the pane is below `paneBesideQuery`: Astryx draws it as a dialog. */
const DRAWER = 'dialog, [role="dialog"]';
/** How many frames a closed pane waits for its drawer to let the focus out: about a second. */
const BACK_WITHIN = 60;

export type EntryStyle = NonNullable<ReturnType<typeof useEntryAnimation>> | undefined;
/** Where a page's way back leads, by the name of the place (D116): "Personal", "Att göra", "Alla verktyg". */
export interface WayBackTarget {
  label: string;
  href: string;
}

/** The way back at the top of a page (boards Ärende and Person): an arrow and the name of the place it leads to. */
export function WayBack({ back }: { back: WayBackTarget }) {
  return (
    <Link href={back.href} type="supporting" color="secondary">
      <HStack as="span" gap={1} vAlign="center">
        <Icon icon={ArrowLeftIcon} size="sm" />
        {back.label}
      </HStack>
    </Link>
  );
}

/**
 * The line that closes a page (D130 item 12), as the startsidan prototype closes every page: the site's name as the
 * header gives it and the organisation the installation's logo names. Text only: it names nothing the page above does
 * not already hold. `ruled` draws the rule over it where the line ends a column that scrolls.
 */
function Closing({ ruled }: { ruled: boolean }) {
  const site = useContext(SiteName);
  const organisation = useBranding().logo?.alt;
  const line = (
    <HStack gap={0} wrap="wrap">
      <Text type="supporting" weight="bold">
        {site}
      </Text>
      {organisation ? (
        <Text type="supporting" color="secondary">
          {DOT}
          {organisation}
        </Text>
      ) : null}
    </HStack>
  );
  return ruled ? (
    <VStack gap={4} paddingBlockEnd={6}>
      <Divider />
      {line}
    </VStack>
  ) : (
    line
  );
}

interface PageFrameProps {
  /** Whether and about what the page has the assistant's pane (D138 item 3). Required, so no page can leave it out. */
  ask: PageAsk;
  /** The way back, named; none where the page is a place of its own. */
  back?: WayBackTarget | null | undefined;
  /** After the way back on its line: where the thing stands (a source, a unit's trail). */
  trail?: ReactNode;
  /** What stands before the title: a person's avatar, a system's swatch. */
  icon?: ReactNode;
  /** The page's one level-1 heading. Absent where the content draws it (a tool's register, D74) or says why there is none. */
  title?: ReactNode;
  /** The heading's id, for a page that sends the focus back to it; the heading then takes focus from a script, never Tab. */
  titleId?: string | undefined;
  titleRef?: Ref<HTMLHeadingElement> | undefined;
  /** Beside the title on its line: a due badge, a state. */
  status?: ReactNode;
  /** The facts line under the title; a string is drawn as supporting text. */
  meta?: ReactNode;
  /** At the end of the title's line (on a phone under it): a register's search and one primary action, a thing's actions. */
  actions?: ReactNode;
  /** The actions stay at the end of the title's line on a phone too (Kalender's two rows of controls, 1.4.10). */
  actionsOnLine?: boolean;
  /** Directly under the title, the header's width: a work item's decisions, Hem's box, a page's alert. */
  below?: ReactNode;
  /** The page's tabs (`ThingTabs`), at the foot of the header. */
  tabs?: ReactNode;
  /** Hem: no rule under the header, which ends where the content's padding starts. */
  plain?: boolean;
  /**
   * The content is cards of its own (a register's table, a board's cards): the frame draws no card around them, and
   * they stand on the ground under the title as Hem's do (D130). A page with a panel of the frame's (the facts, a pane,
   * a start panel, a footer) keeps the frame's card, which is the surface those stand on.
   */
  cards?: boolean;
  children: ReactNode;
  /** What the column is named while it scrolls. */
  label?: string | undefined;
  /** The facts: the end panel beside the column, above the column where the window is narrow. */
  facts?: ReactNode;
  /** The facts' landmark name: "Uppgifter", or what the panel holds (the review's "Hittills"). */
  factsLabel?: string;
  /**
   * False where the page places the facts in its narrow column itself (a work item's read, the review's "Hittills"),
   * by `useFactsInColumn`, which says when the frame no longer draws them beside the column.
   */
  factsAbove?: boolean;
  /**
   * A pane of the page's own in the end slot (a `LayoutPanel`), where the page has no facts' panel: Att göra's reading
   * pane, Kalender's entry, the thing beside a conversation. While it holds something the box stands at its foot, and
   * the assistant's pane is not drawn (D135 rule 5, D138 item 2).
   */
  end?: ReactNode;
  /** A panel before the column (a `LayoutPanel`): Administration's sections. */
  start?: ReactNode;
  /** Only Att göra may widen its column (the list and the pane side by side), and only by the product owner's decision. */
  width?: number;
  /** Whether the header stays while the content scrolls; by default on a page with panels, where the screen is tall enough (1.4.10). */
  pinned?: boolean;
  /** The content is the page's own scroller and inset (the conversation's ChatLayout): no padding of the frame's. */
  bare?: boolean;
  /**
   * The content runs to the card's edges and is given the column's whole height to fill (Kalender's grid, which is its
   * own frame): no inset of the frame's. The column still scrolls what is taller.
   */
  bleed?: boolean;
  /**
   * The column scrolls in Astryx's `ScrollableArea`, which takes a tab stop while it scrolls, so a column that may hold
   * nothing focusable (a work item's read, a record, a review's step) can still be read by keyboard (axe:
   * scrollable-region-focusable).
   */
  scrollTabStop?: boolean;
  /**
   * What stays under the column (a `LayoutFooter`): the review's decision. On a page with a subject the frame draws the
   * corner's "Fråga AI" at its start (`withDoor`), since the corner gives way to it.
   */
  footer?: ReactNode;
  /** Astryx's entry motion, when the column changes hands (Hem and the conversation, D92). */
  entry?: EntryStyle;
  /** The page's own box, for a page that measures it (Att göra's `table-inbox` measure). */
  layoutRef?: Ref<HTMLDivElement>;
}

/**
 * Every page in the shell (D126, the product owner 2026-11-14: Hem's container is the one every page uses): Astryx's
 * page `Layout` in Hem's column (`PAGE_WIDTH`), its header and content at Hem's padding, so the title, the content and
 * the facts' panel stand on the same lines on every page and no page can drift. The header holds, in this order, the way
 * back with what stands beside it (`back`, `trail`), the title line (`icon`, the level-1 heading, `status` beside it,
 * `meta` under it, `actions` at its end and under it on a phone), what stands directly under the title (`below`: a work
 * item's decisions, Hem's box) and the page's tabs at its foot. The content is the column; `facts` is the end panel of
 * the `work-item-detail` template (above the column at `narrowPageQuery`), `end` a pane of the page's own (Att göra's
 * reading pane, the thing beside a conversation) and `start` a panel before the column (Administration's sections), all
 * inside the same frame. The header stays while the content scrolls; on a short screen nothing is pinned and the page
 * scrolls as one (1.4.10). Every page says what it is about (`ask`): the frame draws "Fråga AI" at the end of the title's
 * line (the product owner, 2026-11-20, in place of the corner's floating button of D138 items 1 and 5) and provides the
 * assistant's pane, a card at the end of the shell's column (`AskingFrame`, D138 item 4). No page draws a way to ask of
 * its own. Hem alone keeps the corner's button, which leads to its line.
 */
export function PageFrame(props: PageFrameProps) {
  const { ask, ...frame } = props;
  return 'subject' in ask ? <AskingFrame {...frame} about={ask} /> : <PageWithoutSubject {...frame} />;
}

/** A page with no subject (D135 rule 1): "Fråga AI" on its title's line starts a new question there. */
function PageWithoutSubject(frame: Omit<PageFrameProps, 'ask'>) {
  // Hem (`plain`) has its own line to ask and keeps the corner's button, which leads to it.
  useCornerDoor(frame.plain ? 'question' : 'hidden');
  return <FrameBody {...frame} {...(frame.plain ? {} : { door: <NewQuestionDoor /> })} />;
}

/** "Fråga AI" on a page with nothing to ask about, or with no pane to ask in: it starts a new question, with the page as the way back. */
function NewQuestionDoor() {
  const talk = useConversation();
  const { pathname, search } = useLocation();
  // A conversation's own page has its box: nothing more to ask through.
  if (talk.open) return null;
  return (
    <Button
      variant="ai"
      label="Fråga AI"
      icon={<Icon icon={SparklesIcon} color="inherit" />}
      href="/conversations/new"
      onClick={() => talk.newConversation({ from: pathname + search, stay: true })}
    />
  );
}

/**
 * A page with a subject (D135 rules 2 to 11, D138 items 3 to 5 and 11; canvas boards AttGora-tom and
 * Arende-tom). "Fråga AI" at the end of the title's line opens the pane (the product owner, 2026-11-20: "On title
 * line", in place of the corner's floating button). It is not drawn while the pane stands, while the page's own pane
 * holds its box (`end`), or before the page knows its subject. Without a model the pane is never drawn (D8) and the
 * button starts a new question, as on a page with no subject. Hem (`plain`) has its own line and keeps the corner's.
 *
 * The pane is in the address (`ask=1`): the press pushes it, so Back closes it and a reload opens it again; ✕ and Esc in
 * the pane take it away. It holds the assistant's round mark and "Fråga AI", "Öppna som samtal" and ✕, what it is about
 * in words and where the assistant cannot read (`subject.closed`), then the conversation and the box (`PageTalk`). From
 * `paneBesideQuery` it is a card at the end of the shell's column (`FrameBody`'s `aside`), which the page's own pane wins
 * while it holds something (Kalender's entry, rule 5); the page then lays itself out in the width left
 * (`useColumnQuery`; a thing's facts above its read, `useFactsInColumn`, D136 item 9). Narrower or short it is Astryx's
 * drawer over the page; on a phone the button leads to the conversation's page with the subject (D138 item 11).
 *
 * The press gives the focus to the box; arriving by the address moves nothing; closing gives it back to the button that
 * opened the pane, as does losing the pane with the focus in it. Opening says nothing
 * aloud: the turns announce their answers. The conversation is held here (`usePageConversation`), so it stays while the
 * pane becomes the drawer and back.
 */
function AskingFrame({ about, ...frame }: Omit<PageFrameProps, 'ask'> & { about: AskAbout }) {
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const beside = useMediaQuery(paneBesideQuery) && !short;
  const model = useModelConfigured();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const askAbout = useAskAbout();
  const returnFocus = useReturnFocusToCorner();
  const { subject } = about;
  const talk = usePageConversation(subject, { onAnswer: response => about.onAnswer?.(response) });
  const open = model && !mobile && asksBeside(search) && !frame.end;
  // Who changed the pane last: the person's press (the box takes the focus), ✕ or Esc (the focus goes back to the
  // corner's button), or nobody here (the address: nothing moves).
  const by = useRef<'press' | 'close' | null>(null);
  const close = useCallback(() => {
    by.current = 'close';
    navigate(withoutAsk(pathname, search));
  }, [navigate, pathname, search]);
  const press = () => {
    if (mobile) {
      if (subject) askAbout(subject);
    } else if (!open) {
      by.current = 'press';
      navigate(withAsk(pathname, search));
    }
  };
  // "Fråga AI" at the end of the title's line (the product owner, 2026-11-20): drawn only where no box stands on the
  // page. The shell's corner draws none on a page with a frame; Hem (`plain`) has its own line and keeps the corner's.
  const door: CornerDoor = !model ? 'question' : open || frame.end || !subject ? 'hidden' : 'pane';
  useCornerDoor(frame.plain ? door : 'hidden', press);
  const lineDoor = useRef<HTMLButtonElement>(null);
  const onLine = frame.plain ? undefined : door === 'pane' ? (
    <Button
      ref={lineDoor}
      variant="ai"
      label="Fråga AI"
      icon={<Icon icon={SparklesIcon} color="inherit" />}
      onClick={press}
    />
  ) : door === 'question' ? (
    <NewQuestionDoor />
  ) : undefined;
  // The focus goes back to the button that opened the pane: the title line's, else the corner's (Hem).
  const giveBack = useCallback(() => {
    if (lineDoor.current?.isConnected) lineDoor.current.focus();
    else if (frame.plain) returnFocus();
  }, [returnFocus, frame.plain]);
  const wasOpen = useRef(open);
  const settling = useRef(0);
  const { input } = talk.state;
  // The box takes the focus once it is drawn: the first time a page draws a box its editor may still be loading, so the
  // press waits for it a frame at a time, never longer than `BOX_WITHIN` frames.
  const focus = useCallback(() => {
    let left = BOX_WITHIN;
    const attempt = () => {
      input.current?.focus();
      if (!document.activeElement?.matches(TYPING) && --left > 0) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }, [input]);
  useLayoutEffect(() => {
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    // Read only when the pane has changed: a page's own pane may hold the slot a moment after the press (Kalender lets
    // go of a move being made once the address says the pane is open).
    const how = by.current;
    by.current = null;
    if (open) {
      if (how === 'press') focus();
      return;
    }
    const active = document.activeElement;
    if (how !== 'close' && active && active !== document.body) return;
    giveBack();
    // As a drawer the pane is a modal dialog until it has slid away, and nothing outside it takes the focus before
    // then: the button is asked again a frame at a time while the focus is nowhere or still in the closing drawer,
    // never longer than `BACK_WITHIN` frames, and not at all once the focus is somewhere else on the page.
    let left = BACK_WITHIN;
    const again = () => {
      const at = document.activeElement;
      if (at && at !== document.body && !at.closest(DRAWER)) return;
      giveBack();
      if (--left > 0) settling.current = requestAnimationFrame(again);
    };
    settling.current = requestAnimationFrame(again);
  }, [open, focus, giveBack]);
  useEffect(() => () => cancelAnimationFrame(settling.current), []);
  // The drawer keeps its content once it has been opened, so it is never empty while it slides away; before that it
  // holds nothing, and no box waits hidden in it.
  const drawerHeld = useRef(false);
  if (open && !beside) drawerHeld.current = true;
  const content = <AskPane talk={talk} prepared={about.prepared} close={close} />;
  return (
    <>
      <FrameBody
        {...frame}
        {...(onLine ? { door: onLine } : {})}
        {...(open && beside
          ? {
              aside: (
                <VStack
                  as="aside"
                  aria-label="Fråga AI"
                  height="100%"
                  onKeyDown={e => {
                    // Esc inside a menu, a list or a dialog is theirs; a bare Esc closes the pane.
                    if (e.key !== 'Escape' || (e.target as HTMLElement).closest(OWNS_ESCAPE)) return;
                    e.stopPropagation();
                    close();
                  }}
                >
                  <Card padding={0} height="100%">
                    {content}
                  </Card>
                </VStack>
              ),
            }
          : {})}
      />
      {!beside && !mobile && (
        <Drawer
          isOpen={open}
          onOpenChange={next => {
            if (!next) close();
          }}
          side="end"
          width={ASK_PANE}
          label="Fråga AI"
          padding={0}
        >
          {drawerHeld.current && content}
        </Drawer>
      )}
    </>
  );
}

/**
 * The assistant's round mark (D130 item 14, D138 items 6 and 9): Hem's ask pill's, the theme's blue for the assistant
 * alone; over the pane's heading and the answer under Hem's line.
 */
export function AssistantMark() {
  return (
    <Card variant="ai-mark" padding={1.5}>
      <Icon icon={SparklesIcon} color="inherit" size="sm" />
    </Card>
  );
}

/**
 * The pane's inside, as a card in the column and in the drawer alike (D138 item 6; canvas boards AttGora-tom and
 * Arende-tom): the round mark and "Fråga AI", the words and the mark of the button that opened it; "Öppna som samtal"
 * and ✕ at the end of its line; what it is about under it, and where the assistant cannot read; then the conversation
 * over the box (`PageTalk`). It shows no thing.
 */
function AskPane({
  talk,
  prepared,
  close,
}: {
  talk: PageConversation;
  prepared: AskAbout['prepared'];
  close: () => void;
}) {
  const whole = useOpenAsConversation(talk);
  const { subject } = talk;
  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader padding={5} hasDivider>
          <VStack gap={2}>
            <HStack hAlign="between" vAlign="center" gap={3}>
              <HStack gap={3} vAlign="center">
                <AssistantMark />
                <Heading level={2}>Fråga AI</Heading>
              </HStack>
              <HStack gap={1} vAlign="center">
                {whole && (
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Öppna som samtal"
                    icon={<Icon icon={ArrowsPointingOutIcon} size="sm" />}
                    href={whole.href}
                    {...(whole.onClick ? { onClick: whole.onClick } : {})}
                  />
                )}
                <IconButton size="sm" variant="ghost" label="Stäng" icon={<Icon icon="close" />} onClick={close} />
              </HStack>
            </HStack>
            {subject && (
              <Text type="supporting" color="secondary">
                {subject.about}
              </Text>
            )}
            {subject?.closed && <Text type="supporting">{subject.closed}</Text>}
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={5} isScrollable={false}>
          <PageTalk talk={talk} prepared={prepared} headed />
        </LayoutContent>
      }
    />
  );
}

/**
 * The frame's layout. `aside` is the assistant's pane, which `AskingFrame` gives while it stands beside the page: a card
 * at the end of the shell's column, beside the page's whole layout, from the top of the page to its foot (D138 item 4,
 * the canvas's `frame.tsx`). The page keeps its own shape in the width that is left: the parts inside it ask
 * `useColumnQuery` and `useFactsInColumn`, which read the pane's width from `PageFrameContext`, and a board keeps its
 * title and scrolls its column while the pane stands, as a page with panels does. Astryx's grip between the two resizes
 * the pane.
 */
function FrameBody({
  back,
  trail,
  icon,
  title,
  titleId,
  titleRef,
  status,
  meta,
  actions,
  actionsOnLine = false,
  door,
  below,
  tabs,
  plain = false,
  cards = false,
  children,
  label,
  facts,
  factsLabel = 'Uppgifter',
  factsAbove = true,
  end,
  start,
  width = PAGE_WIDTH,
  pinned,
  bare = false,
  bleed = false,
  scrollTabStop = false,
  footer,
  entry,
  layoutRef,
  aside,
}: Omit<PageFrameProps, 'ask'> & {
  /** The assistant's pane, a card of its own at the end of the shell's column (D138 item 4). */
  aside?: ReactNode;
  /** The frame's "Fråga AI", at the end of the title's line after the page's own actions; under the title where the line has no room. */
  door?: ReactNode;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const narrow = useMediaQuery(narrowPageQuery);
  const tight = useMediaQuery(tightQuery);
  // What the page pins at the window's foot is the page's to press: the floating way to the assistant gives way.
  useClearCorner(!!footer);
  const board = plain || (cards && !end && !facts && !start && !footer);
  const besidePane = !!aside && !mobile;
  // The pane's width, the person's own (Astryx's resizable region, as Att göra's reading pane and the pane beside a
  // conversation have it): one width for every page, remembered in the browser, a share of the shell's column at most.
  const row = useRef<HTMLElement>(null);
  const region = useResizable({
    defaultSize: ASK_PANE,
    minSize: ASK_PANE_MIN,
    maxSize: percent(ASK_PANE_SHARE, { max: pixel(ASK_PANE_MAX) }),
    autoSaveId: 'clew:assistant-pane',
    containerRef: row,
  });
  const paneWidth = besidePane ? region.size + (board ? BOARD_PANE_GAP : PANE_GAP) : 0;
  // A board (Hem, a register of cards) scrolls as one page under the shell's header, as the startsidan prototype's
  // pages do (D130): nothing of it stays behind. A page with panels keeps its title while its column scrolls, so the
  // panels stand beside what they are about, and so does a board while the assistant's pane stands beside it (D138
  // item 4); on a short screen nothing is pinned anywhere (1.4.10).
  const pin = pinned ?? (!short && (!board || besidePane));
  const gutter = tight ? 4 : 6;
  // A page's facts line is running text under its title, as the startsidan prototype sets it (D130 item 18, measured:
  // 16 px in the softer ink); Hem's day line stays the small line it is under the greeting.
  const metaLine =
    typeof meta === 'string' ? (
      plain ? (
        <Text type="supporting" color="secondary">
          {meta}
        </Text>
      ) : (
        <Text size="lg" color="secondary">
          {meta}
        </Text>
      )
    ) : (
      meta
    );
  const heading =
    title === undefined || title === null ? null : (
      <Heading level={1} {...(titleId ? { id: titleId } : {})} {...(titleRef ? { ref: titleRef } : {})} tabIndex={-1}>
        {title}
      </Heading>
    );
  // The way back and what stands beside it, a step apart with no rule between them (board Ärende).
  // A place of its own has no way back: it opens with where it stands, the site and then the page (D130 item 17), as
  // the startsidan prototype opens a page with its trail. A page reached from another keeps its named way back.
  const site = useContext(SiteName);
  const crumbs =
    !plain && !back && !trail && typeof title === 'string' ? (
      <Breadcrumbs label="Du är här" variant="supporting" separator="›">
        <BreadcrumbItem href="/">{site}</BreadcrumbItem>
        <BreadcrumbItem isCurrent>{title}</BreadcrumbItem>
      </Breadcrumbs>
    ) : null;
  const wayLine =
    back || trail ? (
      <HStack gap={4} wrap="wrap" vAlign="center">
        {back && <WayBack back={back} />}
        {trail}
      </HStack>
    ) : (
      crumbs
    );
  const titleLine =
    heading || icon || actions || door ? (
      <HStack gap={4} vAlign="center" wrap="wrap">
        {icon}
        <StackItem size="fill">
          {/* Hem's greeting stands a step further from its day line than a page's title from its facts (board Hem). */}
          <VStack gap={plain ? 1 : 2}>
            {status ? (
              <HStack gap={3} vAlign="center" wrap="wrap">
                {heading}
                {status}
              </HStack>
            ) : (
              heading
            )}
            {metaLine}
          </VStack>
        </StackItem>
        {(!mobile || actionsOnLine) && actions}
        {door}
      </HStack>
    ) : (
      metaLine
    );
  const hasHeader = !!(wayLine || titleLine || below || tabs);
  // The page pattern (D130): where the window is wide, a page's way back, title, facts line and tabs stand on the ground,
  // on the header's lines, and what the page holds is a card under them, as the startsidan prototype draws a page. Hem
  // (`plain`) and a page whose content is cards already (`cards`) are boards with no card of the frame's; a phone keeps
  // the page as the window.
  const ground = !mobile && !board;
  const header = hasHeader ? (
    <LayoutHeader
      padding={ground ? 0 : gutter}
      paddingBlockEnd={ground ? (tabs ? 3 : 5) : plain ? 6 : board || tabs ? 0 : gutter}
      hasDivider={!ground && !board}
    >
      {/* Hem opens with the reference's air over its greeting (48 px with the header's own inset) and 20 px between
          the greeting and the line to ask. */}
      <VStack gap={tabs ? 3 : 0} {...(plain && !mobile ? { paddingBlockStart: 6 } : {})}>
        <VStack gap={plain ? 5 : 4}>
          {/* The way back stands close over a title (board Ärende) and a full step over a title with an avatar or a
              swatch before it (board Person). */}
          {wayLine && titleLine ? (
            <VStack gap={icon ? 4 : 3}>
              {wayLine}
              {titleLine}
            </VStack>
          ) : (
            (wayLine ?? titleLine)
          )}
          {mobile && !actionsOnLine && actions}
          {below}
        </VStack>
        {tabs}
      </VStack>
    </LayoutHeader>
  ) : undefined;
  // The facts and the assistant's pane: while the pane stands beside the page the facts stand above the read, as where
  // the window is narrow (D136 item 9, D138 item 4; `useFactsInColumn` says the same to a page that places them).
  const factsInColumn = narrow || besidePane;
  const panelFacts = !!facts && !factsInColumn;
  const column =
    facts && factsInColumn && factsAbove ? (
      <VStack gap={6}>
        <VStack as="section" gap={4} aria-label={factsLabel}>
          {facts}
        </VStack>
        <Divider />
        {children}
      </VStack>
    ) : (
      children
    );
  // The closing line ends the column where the column is the page (a board, a phone); under a card it stands on the
  // ground, in the layout's footer. A transcript's page has none: its box is the last thing on it.
  const closes = !bare && (board || mobile);
  const closed = closes ? (
    <VStack gap={10}>
      {column}
      <Closing ruled />
    </VStack>
  ) : (
    column
  );
  // A bare column keeps the frame's inset where the window is wide, so the transcript stands under the title; on a phone
  // the transcript's own inset is the page's (ChatLayout pads its messages and its box), so nothing is cut at 320 px.
  const content = bleed ? (
    <LayoutContent padding={0} isScrollable={pin} {...(label ? { label } : {})}>
      <VStack height="100%" hAlign="stretch">
        {children}
      </VStack>
    </LayoutContent>
  ) : bare ? (
    <LayoutContent padding={mobile ? 0 : gutter} isScrollable={false} {...(label ? { label } : {})}>
      {children}
    </LayoutContent>
  ) : scrollTabStop && pin ? (
    // The scroller fills the column and publishes the frame's inset on every side as its own content padding, so the
    // read starts a full step under the header's rule (board Ärende) and scrolls to the window's foot. The content keeps
    // the least inset Astryx has (0 is full bleed and leaves the centred column), which the scroller's bleed takes back:
    // a ScrollableArea is never taller than its box, so a bleed over the frame's whole inset stopped the read 48 px
    // short of the foot (Astryx gap: ScrollableArea has no `maxHeight` to lift its 100% cap).
    <LayoutContent padding={0.5} isScrollable={false}>
      <ScrollableArea label={label ?? 'Innehåll'} height="100%" isFullBleed padding={gutter}>
        {closed}
      </ScrollableArea>
    </LayoutContent>
  ) : (
    <LayoutContent padding={gutter} isScrollable={pin} {...(label ? { label } : {})}>
      {closed}
    </LayoutContent>
  );
  const endPanel = panelFacts ? (
    <LayoutPanel width={FACTS_WIDTH} padding={6} role="complementary" label={factsLabel} hasDivider isScrollable={pin}>
      {facts}
    </LayoutPanel>
  ) : (
    end
  );
  const layout = ground ? (
    // The header on the ground and, under it, the card with the page's own regions: an Astryx `Layout` in a `Layout`'s
    // content, so the header stays while the card's column scrolls.
    <Layout
      {...(entry ? { xstyle: entry } : {})}
      height={pin ? 'fill' : 'auto'}
      header={header}
      content={
        <LayoutContent padding={0} isScrollable={false}>
          <Card padding={0} height={pin ? '100%' : undefined}>
            <Layout
              {...(layoutRef ? { ref: layoutRef } : {})}
              height={pin ? 'fill' : 'auto'}
              start={start}
              content={content}
              footer={footer}
              end={endPanel}
            />
          </Card>
        </LayoutContent>
      }
      footer={
        bare ? undefined : (
          <LayoutFooter padding={0} hasDivider={false}>
            <VStack paddingBlockStart={3}>
              <Closing ruled={false} />
            </VStack>
          </LayoutFooter>
        )
      }
    />
  ) : (
    <Layout
      {...(layoutRef ? { ref: layoutRef } : {})}
      {...(entry ? { xstyle: entry } : {})}
      height={pin ? 'fill' : 'auto'}
      // A page whose content runs to the card's edges has its header on the same edges, not on Hem's measure.
      {...((end && !panelFacts) || bleed ? {} : { contentWidth: width })}
      header={header}
      start={start}
      content={content}
      footer={footer}
      end={endPanel}
    />
  );
  // What the parts inside the page read to follow the width the pane leaves them (`useColumnQuery`).
  const inColumn = (
    <PageFrameContext.Provider value={{ paneWidth, columnWidth: SHELL_WIDTH }}>{layout}</PageFrameContext.Provider>
  );
  // On a phone the page is the window. Elsewhere it stands in the shell's column (D130), centred under the header's
  // rows and on their lines, with the ground showing at both sides as the startsidan prototype draws its pages. Hem
  // (`plain`) is a board: its greeting and its cards stand on the ground itself. A page with a pane of its own (Att
  // göra's reading pane, the thing beside a conversation) stays in the same column, so its title does not move when the
  // pane opens, and so does a page with the assistant's pane beside it (D138 item 4).
  if (mobile) return inColumn;
  return (
    <HStack justify="center" height={pin ? '100%' : undefined}>
      <VStack
        hAlign="stretch"
        width="100%"
        maxWidth={SHELL_WIDTH}
        height={pin ? '100%' : undefined}
        padding={board ? 0 : 3}
        paddingBlockStart={board ? 0 : 6}
        paddingInline={board ? 2 : 8}
      >
        {besidePane ? (
          // The page and the pane side by side: the page fills what the pane leaves it. On a page with a card of the
          // frame's the grip stands in the middle of the 20 px between the two cards; on a board, whose cards inset
          // themselves and whose column scrolls at its edge, the grip stands 8 px off that edge with its pill there,
          // and the pane takes the board's own inset at its top, foot and end (`PANE_GAP`).
          <HStack ref={row} gap={board ? 0 : 0.5} height="100%" vAlign="stretch">
            <StackItem size="fill">{inColumn}</StackItem>
            <VStack height="100%" {...(board ? { paddingInlineStart: 2 } : { paddingInline: 2 })}>
              <ResizeHandle
                direction="horizontal"
                isReversed
                isAlwaysVisible={false}
                pillPlacement={board ? 'start' : 'center'}
                resizable={region.props}
                label="Ändra bredden på Fråga AI"
              />
            </VStack>
            {/* The pane keeps its width however wide the page's content is (a static item does not shrink). */}
            <StackItem>
              <VStack
                height="100%"
                width={region.size + (board ? BOARD_INSET : 0)}
                {...(board ? { paddingBlock: 6, paddingInlineEnd: 6 } : {})}
              >
                {aside}
              </VStack>
            </StackItem>
          </HStack>
        ) : (
          inColumn
        )}
      </VStack>
    </HStack>
  );
}
