import { useContext, type ReactNode, type Ref } from 'react';
import {
  BreadcrumbItem,
  Breadcrumbs,
  Card,
  ArrowLeftIcon,
  Divider,
  Heading,
  HStack,
  Icon,
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  LayoutPanel,
  Link,
  ScrollableArea,
  StackItem,
  Text,
  VStack,
  useEntryAnimation,
  useMediaQuery,
} from '@clew/ui';
import { mobileQuery, shortQuery, tightQuery } from '../../media';
import { SHELL_WIDTH, SiteName } from './shell';
import { useClearCorner } from './assistant-corner';
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
 * scrolls as one (1.4.10).
 */
export function PageFrame({
  back,
  trail,
  icon,
  title,
  titleId,
  titleRef,
  status,
  meta,
  actions,
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
  scrollTabStop = false,
  footer,
  entry,
  layoutRef,
}: {
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
  /** False where the page places the facts in its narrow column itself (a work item's read). */
  factsAbove?: boolean;
  /** A pane of the page's own in the end slot (a `LayoutPanel`), where the page has no facts' panel. */
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
}) {
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const narrow = useMediaQuery(narrowPageQuery);
  const tight = useMediaQuery(tightQuery);
  // What the page pins at the window's foot is the page's to press: the floating way to the assistant gives way.
  useClearCorner(!!footer);
  const board = plain || (cards && !end && !facts && !start && !footer);
  // A board (Hem, a register of cards) scrolls as one page under the shell's header, as the startsidan prototype's
  // pages do (D130): nothing of it stays behind. A page with panels keeps its title while its column scrolls, so the
  // panels stand beside what they are about; on a short screen nothing is pinned anywhere (1.4.10).
  const pin = pinned ?? (!short && !board);
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
    heading || icon || actions ? (
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
        {!mobile && actions}
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
          {mobile && actions}
          {below}
        </VStack>
        {tabs}
      </VStack>
    </LayoutHeader>
  ) : undefined;
  const panelFacts = !!facts && !narrow;
  const column =
    facts && narrow && factsAbove ? (
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
  const content = bare ? (
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
      {...(end && !panelFacts ? {} : { contentWidth: width })}
      header={header}
      start={start}
      content={content}
      footer={footer}
      end={endPanel}
    />
  );
  // On a phone the page is the window. Elsewhere it stands in the shell's column (D130), centred under the header's
  // rows and on their lines, with the ground showing at both sides as the startsidan prototype draws its pages. Hem
  // (`plain`) is a board: its greeting and its cards stand on the ground itself. A page with a pane of its own (Att
  // göra's reading pane, the thing beside a conversation) stays in the same column, so its title does not move when the
  // pane opens.
  if (mobile) return layout;
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
        {layout}
      </VStack>
    </HStack>
  );
}
