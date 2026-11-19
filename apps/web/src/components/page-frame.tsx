import { useCallback, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { ConversationResponse, Prepared } from '@clew/contracts';
import {
  ArrowsPointingOutIcon,
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
import { besideQuery, mobileQuery, shortQuery } from '../media';
import { asksBeside, withAsk, withoutAsk } from '../panel-address';
import { useModelConfigured } from './conversation-context';
import { PageTalk, useOpenAsConversation, usePageConversation, type PageSubject } from './page-conversation';
import { PageFrameContext } from './page-frame-context';
import { useAskAbout } from './thing-panel';

/**
 * Hem's column (board Hem): the product owner decided on 2026-11-14 that the start page's container is every page's, so
 * a register, a thing, a conversation and an administration section sit in the same centred frame as Hem's greeting
 * and blocks, with the same header and content padding (D126). `PageFrame` is the only place that sets it.
 */
export const PAGE_WIDTH = 1120;
/** The `work-item-detail` template's own line: the facts stand in the end panel above it, above the read at it and below. */
export const narrowPageQuery = '(max-width: 1024px)';
/** The facts' end panel beside the column (board Person, board Ärende). */
const FACTS_WIDTH = 340;
/**
 * The boards keep the page's 24 px inset on a phone (Hem, Att göra and Ärende at 390 px); only the narrowest screens,
 * where 1.4.10 asks for 320 px, take the tighter 16 px.
 */
const tightQuery = '(max-width: 359px)';

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
 * Whether and about what a page has "Fråga assistenten" (D130 rule 1): every page says, so leaving it out is a type error
 * and no page can forget the assistant. `subject` is what the page shows (null until the page knows it, while its data
 * loads, and while a pane of the page's own holds the end slot: Att göra's item); `none` is a page with no button and
 * why (Administration, where nothing is a read the assistant may make; the assistant's own pages, Hem, Ny fråga and a
 * conversation; a frame that is no page of the person's work, the first load's or a missing calendar's); `later` is a
 * thing's page, which still draws its own way to ask until its stage of the plan (stage 3) moves it into the frame, and
 * goes when it has moved. The registers, Läget and Att göra's queue are in the frame since stage 2.
 */
export type PageAsk = AskAbout | { none: 'administration' | 'assistant' | 'no-page' } | { later: 'things' };
/** A page with the frame's button and pane (D130 rules 1 to 4). */
export interface AskAbout {
  subject: PageSubject | null;
  /** Hears each finished turn in the pane: the page makes ready what an answer prepared (Kalender, D129). */
  onAnswer?: ((response: ConversationResponse) => void) | undefined;
  /** What the page draws under an answer that prepared one of its decisions (Kalender's "Använd tiden"). */
  prepared?: ((prepared: Prepared) => ReactNode) | undefined;
  /** False where a phone's head has no room for the button (Kalender's two full rows); the page asks elsewhere there. */
  onPhone?: boolean | undefined;
}
/**
 * The assistant's pane (D130 rule 11; canvas boards AskRegister and AskArende): it opens at Astryx's recommended panel
 * width and is dragged, or moved with the arrow keys on its grip, between the limits the pane beside a conversation has
 * (the product owner asked on 2026-11-19 why it could not be resized as Astryx's panels can). The width is kept in the
 * browser.
 */
const ASK_PANE = 400;
const ASK_PANE_MIN = 360;
const ASK_PANE_MAX = 720;
/** The most of the sheet the pane may take, in percent, so the page keeps the larger part. */
const ASK_PANE_SHARE = 40;
/** What a key pressed in the pane belongs to rather than the pane: a menu, a list box or a dialog over it. */
const OWNS_ESCAPE = '[role="menu"], [role="listbox"], [role="dialog"], dialog';
/** A field the person types in: where the press has put the focus once the box has it. */
const TYPING = 'input, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]';
/** How many frames the press waits for the box to be drawn (its editor may still be loading): about a second. */
const BOX_WITHIN = 60;

interface PageFrameProps {
  /** Whether and about what the page has "Fråga assistenten" (D130 rule 1). Required, so no page can leave it out. */
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
  children: ReactNode;
  /** What the column is named while it scrolls. */
  label?: string | undefined;
  /** The facts: the end panel beside the column, above the column where the window is narrow. */
  facts?: ReactNode;
  /** The facts' landmark name: "Uppgifter", or what the panel holds (the review's "Hittills"). */
  factsLabel?: string;
  /** False where the page places the facts in its narrow column itself (a work item's read). */
  factsAbove?: boolean;
  /**
   * A pane of the page's own in the end slot (a `LayoutPanel`), where the page has no facts' panel: Att göra's reading
   * pane, Kalender's entry, the thing beside a conversation. While it holds something it has the slot, and the
   * assistant's pane is not drawn (D130 rule 5).
   */
  end?: ReactNode;
  /** A panel before the column (a `LayoutPanel`): Administration's sections. */
  start?: ReactNode;
  /** Only Att göra may widen its column (the list and the pane side by side), and only by the product owner's decision. */
  width?: number;
  /** Whether the header stays while the content scrolls; by default wherever the screen is tall enough (1.4.10). */
  pinned?: boolean;
  /** The content is the page's own scroller and inset (the conversation's ChatLayout): no padding of the frame's. */
  bare?: boolean;
  /**
   * The content runs to the sheet's edges and is given the column's whole height to fill (Kalender's grid, which is its
   * own frame): no inset of the frame's, and the header on the same edges. The column still scrolls what is taller.
   */
  bleed?: boolean;
  /**
   * The column scrolls in Astryx's `ScrollableArea`, which takes a tab stop while it scrolls, so a column that may hold
   * nothing focusable (a work item's read, a record, a review's step) can still be read by keyboard (axe:
   * scrollable-region-focusable).
   */
  scrollTabStop?: boolean;
  /** What stays under the column (a `LayoutFooter`): the review's decision. */
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
 * scrolls as one (1.4.10). Every page says whether it has "Fråga assistenten" (`ask`, D130 rule 1); the frame draws
 * the button at the end of the title's line and the assistant's pane in the end slot (`AskingFrame`).
 */
export function PageFrame(props: PageFrameProps) {
  const { ask, ...frame } = props;
  return 'subject' in ask ? <AskingFrame {...frame} about={ask} /> : <FrameBody {...frame} />;
}

/**
 * A page with "Fråga assistenten" (D130 rules 1 to 4 and 11; canvas boards AskRegister, AskArende-empty and
 * AskArende-more). The button ends the title's line (or, where the content draws the title, that line: `PageHeader`
 * reads it from `PageFrameContext`). It is the pane's toggle and says so (`aria-expanded`), drawn as a secondary while
 * the pane is open. Without a model it is not drawn (D8), nor before the page knows its subject.
 *
 * The pane is in the address (`ask=1`): the press pushes it, so Back closes it and a reload opens it again; ✕, Esc in
 * the pane and the button again take it away. It holds the assistant's heading, what it is about in words, where the
 * assistant cannot read (`subject.closed`) and "Öppna som samtal", then the conversation and the box (`PageTalk`). From
 * `besideQuery` it stands beside the page in the end slot, which the page's own pane wins while it holds something
 * (Kalender's entry, rule 5); the column then draws its narrow layout (`useColumnQuery`, the facts above the read).
 * Narrower or short it is Astryx's drawer over the page; on a phone the button leads to the conversation's page with
 * the subject, as "Fråga assistenten" did before (D126 rule 5).
 *
 * The press gives the focus to the box; arriving by the address moves nothing; closing gives it back to the button, as
 * does losing the pane with the focus in it. Opening says nothing aloud: the turns announce their answers. The
 * conversation is held here (`usePageConversation`), so it stays while the pane becomes the drawer and back.
 */
function AskingFrame({ about, ...frame }: Omit<PageFrameProps, 'ask'> & { about: AskAbout }) {
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const beside = useMediaQuery(besideQuery) && !short;
  const model = useModelConfigured();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const askAbout = useAskAbout();
  const { subject } = about;
  const talk = usePageConversation(subject, { onAnswer: response => about.onAnswer?.(response) });
  const whole = useOpenAsConversation(talk);
  const open = model && !mobile && asksBeside(search) && !frame.end;
  // Astryx's resizable region (`useResizable`), as the pane beside a conversation and Att göra's reading pane have it:
  // one width for every page, remembered in the browser.
  const region = useResizable({
    defaultSize: ASK_PANE,
    minSize: ASK_PANE_MIN,
    maxSize: percent(ASK_PANE_SHARE, { max: pixel(ASK_PANE_MAX) }),
    autoSaveId: 'clew:assistant-pane',
  });
  const button = useRef<HTMLButtonElement>(null);
  // Who changed the pane last: the person's press (the box takes the focus), ✕, Esc or the button again (the focus goes
  // back to the button), or nobody here (the address: nothing moves).
  const by = useRef<'press' | 'close' | null>(null);
  const close = useCallback(() => {
    by.current = 'close';
    navigate(withoutAsk(pathname, search));
  }, [navigate, pathname, search]);
  const press = () => {
    if (mobile) {
      if (subject) askAbout(subject);
    } else if (open) close();
    else {
      by.current = 'press';
      navigate(withAsk(pathname, search));
    }
  };
  const wasOpen = useRef(open);
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
    if (how === 'close' || !active || active === document.body) button.current?.focus();
  }, [open, focus]);
  const drawn = model && (mobile ? about.onPhone !== false && !!subject : !!subject || open);
  const askButton = drawn ? (
    <Button
      ref={button}
      size="sm"
      variant={open ? 'secondary' : 'ghost'}
      label="Fråga assistenten"
      icon={<Icon icon={SparklesIcon} size="sm" />}
      {...(mobile ? {} : { 'aria-expanded': open })}
      onClick={press}
    />
  ) : null;
  // The pane's content, beside the page and in the drawer alike (board AskRegister): the sparkles in the accent and the
  // heading, "Öppna som samtal" and ✕ at the end of its line, what it is about under it; the conversation over the box.
  const content = (
    <Layout
      height="fill"
      header={
        <LayoutHeader padding={6} hasDivider>
          <VStack gap={2}>
            <HStack hAlign="between" vAlign="center" gap={3}>
              <HStack gap={2} vAlign="center">
                <Icon icon={SparklesIcon} size="sm" color="accent" />
                <Heading level={2}>Assistenten</Heading>
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
        <LayoutContent padding={6} isScrollable={false}>
          <PageTalk talk={talk} prepared={about.prepared} headed />
        </LayoutContent>
      }
    />
  );
  // The drawer keeps its content once it has been opened, so it is never empty while it slides away; before that it
  // holds nothing, and no box waits hidden in it.
  const drawerHeld = useRef(false);
  if (open && !beside) drawerHeld.current = true;
  const titled = frame.title !== undefined && frame.title !== null;
  const pane =
    open && beside ? (
      <>
        {/* The grip draws the line between the page and the pane, so the pane draws none of its own. */}
        <ResizeHandle
          direction="horizontal"
          isReversed
          hasDivider
          resizable={region.props}
          label="Ändra assistentens bredd"
        />
        <LayoutPanel
          width={region.size}
          padding={0}
          hasDivider={false}
          isScrollable={false}
          role="complementary"
          label="Assistenten"
        >
          <VStack
            height="100%"
            onKeyDown={e => {
              // Esc inside a menu, a list or a dialog is theirs; a bare Esc closes the pane.
              if (e.key !== 'Escape' || (e.target as HTMLElement).closest(OWNS_ESCAPE)) return;
              e.stopPropagation();
              close();
            }}
          >
            {content}
          </VStack>
        </LayoutPanel>
      </>
    ) : null;
  return (
    // Where the content draws the title (a register's view, D74), the button goes to that line through the context.
    <PageFrameContext.Provider value={{ askButton: titled ? null : askButton, paneWidth: pane ? region.size : 0 }}>
      <FrameBody {...frame} askButton={titled ? askButton : null} askPane={pane} />
      {!beside && !mobile && (
        <Drawer
          isOpen={open}
          onOpenChange={next => {
            if (!next) close();
          }}
          side="end"
          width={ASK_PANE}
          label="Assistenten"
          padding={0}
        >
          {drawerHeld.current && content}
        </Drawer>
      )}
    </PageFrameContext.Provider>
  );
}

/** The frame's layout, with the assistant's button and pane when `AskingFrame` gives them. */
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
  below,
  tabs,
  plain = false,
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
  askButton,
  askPane,
}: Omit<PageFrameProps, 'ask'> & {
  /** "Fråga assistenten", last on the title's line. */
  askButton?: ReactNode;
  /** The assistant's pane beside the page, in the end slot the page leaves free. */
  askPane?: ReactNode;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const narrow = useMediaQuery(narrowPageQuery);
  const tight = useMediaQuery(tightQuery);
  const pin = pinned ?? !short;
  const gutter = tight ? 4 : 6;
  const metaLine =
    typeof meta === 'string' ? (
      <Text type="supporting" color="secondary">
        {meta}
      </Text>
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
  const wayLine =
    back || trail ? (
      <HStack gap={4} wrap="wrap" vAlign="center">
        {back && <WayBack back={back} />}
        {trail}
      </HStack>
    ) : null;
  // "Fråga assistenten" ends the title's line, after the page's own actions and a step closer to them (D130 rule 1,
  // board AskRegister), and goes under the title with them on a phone.
  const lineEnd =
    askButton && actions ? (
      <HStack gap={2} vAlign="center" wrap="wrap">
        {actions}
        {askButton}
      </HStack>
    ) : (
      (askButton ?? actions)
    );
  const titleLine =
    heading || icon || lineEnd ? (
      <HStack gap={4} vAlign="center" wrap="wrap">
        {icon}
        <StackItem size="fill">
          {/* Hem's greeting stands a step further from its day line than a page's title from its facts (board Hem). */}
          <VStack gap={plain ? 1 : 0.5}>
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
        {(!mobile || actionsOnLine) && lineEnd}
      </HStack>
    ) : (
      metaLine
    );
  const hasHeader = !!(wayLine || titleLine || below || tabs);
  const header = hasHeader ? (
    <LayoutHeader padding={gutter} paddingBlockEnd={plain || tabs ? 0 : gutter} hasDivider={!plain}>
      <VStack gap={tabs ? 3 : 0}>
        <VStack gap={4}>
          {/* The way back stands close over a title (board Ärende) and a full step over a title with an avatar or a
              swatch before it (board Person). */}
          {wayLine && titleLine ? (
            <VStack gap={icon ? 4 : 2}>
              {wayLine}
              {titleLine}
            </VStack>
          ) : (
            (wayLine ?? titleLine)
          )}
          {mobile && !actionsOnLine && lineEnd}
          {below}
        </VStack>
        {tabs}
      </VStack>
    </LayoutHeader>
  ) : undefined;
  // The facts and the assistant's pane share the end slot: while the pane is open the facts stand above the read, as
  // where the window is narrow (D130 rule 11).
  const panelFacts = !!facts && !narrow && !askPane;
  const column =
    facts && (narrow || askPane) && factsAbove ? (
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
        {column}
      </ScrollableArea>
    </LayoutContent>
  ) : (
    <LayoutContent padding={gutter} isScrollable={pin} {...(label ? { label } : {})}>
      {column}
    </LayoutContent>
  );
  const layout = (
    <Layout
      {...(layoutRef ? { ref: layoutRef } : {})}
      {...(entry ? { xstyle: entry } : {})}
      height={pin ? 'fill' : 'auto'}
      // A page whose content runs to the sheet's edges has its header on the same edges, not on Hem's measure.
      {...((end && !panelFacts) || askPane || bleed ? {} : { contentWidth: width })}
      header={header}
      start={start}
      content={content}
      footer={footer}
      end={
        panelFacts ? (
          <LayoutPanel
            width={FACTS_WIDTH}
            padding={6}
            role="complementary"
            label={factsLabel}
            hasDivider
            isScrollable={pin}
          >
            {facts}
          </LayoutPanel>
        ) : (
          end || askPane
        )
      }
    />
  );
  // On a phone the page is the window. Elsewhere it is a sheet (D126 item 12): a surface of its own on the ground the
  // rail stands on, filling what the rail leaves at any window width. What reads as a column keeps Hem's measure in the
  // middle of the sheet; a page with a pane of its own lets the pane stand at the sheet's far edge and gives the rest
  // to its list or transcript, so nothing ends in the middle of the page.
  if (mobile) return layout;
  return (
    <VStack hAlign="stretch" height={pin ? '100%' : undefined} padding={3} paddingInlineStart={0}>
      <Card padding={0} height={pin ? '100%' : undefined}>
        {layout}
      </Card>
    </VStack>
  );
}
