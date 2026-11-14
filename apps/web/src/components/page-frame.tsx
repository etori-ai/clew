import type { ReactNode, Ref } from 'react';
import {
  ArrowLeftIcon,
  Divider,
  Heading,
  HStack,
  Icon,
  Layout,
  LayoutContent,
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
import { mobileQuery, shortQuery } from '../media';

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
  /** A pane of the page's own in the end slot (a `LayoutPanel`), where the page has no facts' panel. */
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
  const titleLine =
    heading || icon || actions ? (
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
        {(!mobile || actionsOnLine) && actions}
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
          {mobile && !actionsOnLine && actions}
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
        {column}
      </ScrollableArea>
    </LayoutContent>
  ) : (
    <LayoutContent padding={gutter} isScrollable={pin} {...(label ? { label } : {})}>
      {column}
    </LayoutContent>
  );
  return (
    <Layout
      {...(layoutRef ? { ref: layoutRef } : {})}
      {...(entry ? { xstyle: entry } : {})}
      height={pin ? 'fill' : 'auto'}
      contentWidth={width}
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
          end
        )
      }
    />
  );
}
