import { useId, type ReactNode, type Ref } from 'react';
import { useNavigate } from 'react-router';
import { Heading, HStack, StackItem, Tab, TabList, TabMenu, Text, VStack, useMediaQuery } from '@clew/ui';
import { mobileQuery } from '../../media';
import { PageFrame } from '../shell/page-frame';

/**
 * A thing's page for a person, a unit or a plan (D126 rule 1, board Person, the `work-item-detail` composition the work
 * item's page has, `WorkItemPage`): the way back with where the thing stands on the same line, then the thing's mark (a
 * person's avatar), its name and its line, and its actions at the end of the name's line (on a phone under it), then
 * the thing's tabs where it has them, each a link with its own address (D126 rule 9). The column holds the tab's
 * sections one under the other, each with its heading, a wide step apart; the facts are a 340 px end panel, a
 * named complementary region, and above the read at 1024 px and below, as on the work item's page. Nothing opens over
 * or beside the page (rule 3). On a short screen nothing is pinned and the page scrolls as one (1.4.10).
 */

/** One of a thing's tabs (D126 rule 9): its value, its name, its address and what it carries beside its name. */
export interface ThingTab {
  value: string;
  label: string;
  href: string;
  /** Beside the name on a wide screen: a count that needs the reader. */
  badge?: ReactNode;
  /** The count in words, for the phone's menu, which draws no badge: "Ärenden (2)". */
  count?: number;
}
/**
 * A thing's tabs, or a register's views (D126 rules 8 and 9), as Astryx's `TabList` of links, each with its own address,
 * the current one marked. On a phone the first tab stands and the others are under Astryx's `TabMenu` ("Fler"), which
 * names the current one when it is among them, so the strip fits 320 px without scrolling sideways (1.4.10); choosing
 * one there navigates to its address. `onPress` hears a tab pressed, for a page that keeps the focus on it across routes.
 *
 * `compact` is the same strip in the pane beside a conversation (D126 rule 2: the pane draws the page's parts): small
 * tabs on a rule of their own inside the pane's padding, and, with more tabs than the pane's width holds, the first
 * few standing and the rest under the same "Fler".
 */
export function ThingTabs({
  label,
  value,
  tabs,
  onPress,
  tabRef,
  compact = false,
}: {
  label: string;
  value: string;
  tabs: ThingTab[];
  onPress?: (value: string) => void;
  /** The current tab's element, for a page that gives it the focus. */
  tabRef?: (el: HTMLElement | null) => void;
  compact?: boolean;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const navigate = useNavigate();
  // How many tabs stand before "Fler": one on a phone, the pane's few beside a conversation, else every one.
  const standing = mobile ? 1 : compact && tabs.length > PANE_TABS ? PANE_TABS - 1 : tabs.length;
  const shown = tabs.slice(0, standing);
  const rest = tabs.slice(standing);
  // One tab left over stands with the others: a menu of one says less than the tab itself.
  const menu = rest.length > 1;
  const tab = (t: ThingTab) => (
    <Tab
      key={t.value}
      value={t.value}
      label={t.label}
      href={t.href}
      {...(t.badge ? { endContent: t.badge } : {})}
      {...(t.value === value && tabRef ? { ref: tabRef } : {})}
    />
  );
  return (
    <TabList
      // On a page the rule under the strip is the page frame's header's, as on every page (D126); the strip meets the
      // header's edges and its labels start on the title's line. In the pane the strip draws its own rule.
      hasDivider={compact}
      isFullBleed={!compact}
      size={compact ? 'sm' : 'md'}
      value={value}
      onChange={next => {
        onPress?.(next);
        // A tab is a link and navigates itself; an option of the menu is not.
        const option = menu ? rest.find(t => t.value === next) : undefined;
        if (option && next !== value) navigate(option.href);
      }}
      aria-label={label}
    >
      {menu ? (
        <>
          {shown.map(tab)}
          <TabMenu
            label="Fler"
            options={rest.map(t => ({ value: t.value, label: t.count ? `${t.label} (${t.count})` : t.label }))}
          />
        </>
      ) : (
        tabs.map(tab)
      )}
    </TabList>
  );
}
/**
 * The pane beside a conversation is 440 px: this many small tabs stand in it, "Fler" counted as one (a source's name
 * such as "Utvecklingssamtal" is long). Should they still not fit, the strip scrolls, as Astryx's TabList does.
 */
const PANE_TABS = 3;

/** One section of the main column, keyed so a section that leaves (a source with nothing) does not remount the others. */
export interface PageSectionEntry {
  key: string;
  node: ReactNode;
}

export function EntityPage({
  back,
  place,
  crumbs,
  icon,
  title,
  subtitle,
  actions,
  tabs,
  sections,
  empty,
  details,
  label,
  headingRef,
  meta,
}: {
  /** The way back, named; none for an address that names no page Clew can name. */
  back: { label: string; href: string } | null;
  /** Where the entity stands, after the way back on the trail's line ("Bergsåkers skola"). */
  place?: string | undefined;
  /** A trail of the entity's own, after the way back: a unit's place among the units the reader follows up (D117). */
  crumbs?: ReactNode;
  /** What stands before the name: a person's avatar. */
  icon?: ReactNode;
  title: string;
  /** The line under the name: a person's title and unit, "Enhet" for a unit. */
  subtitle?: ReactNode;
  /** The actions about the entity and "Fråga assistenten". */
  actions?: ReactNode;
  /** The thing's tabs (`TabList`), under its name, at the foot of the header. */
  tabs?: ReactNode;
  sections: PageSectionEntry[];
  /** What the column says when no section has anything. */
  empty?: ReactNode;
  /** The facts: in the end panel, above the read where the window is narrow. */
  details: ReactNode;
  /** The column's scroll area, named while it scrolls. */
  label: string;
  /** The heading, for a page that gives it the focus from a script (a plan just started, D124): never from Tab. */
  headingRef?: Ref<HTMLHeadingElement> | undefined;
  /** Where the thing stands, under the name's line and before the phone's actions: a plan's progress (D124). */
  meta?: ReactNode;
}) {
  // The sections one under the other a wide step apart, with no rule between them (board Person).
  const read =
    sections.length === 0 ? (
      (empty ?? null)
    ) : (
      <VStack gap={8}>
        {sections.map(s => (
          <VStack key={s.key}>{s.node}</VStack>
        ))}
      </VStack>
    );
  // The one page frame (D126): the way back with where the thing stands, the mark, the name and its line, the actions
  // at the end of the name's line, the tabs, the read in the column and the facts in the end panel.
  return (
    <PageFrame
      back={back}
      trail={
        crumbs || place ? (
          <>
            {crumbs}
            {place && (
              <Text type="supporting" color="secondary">
                {place}
              </Text>
            )}
          </>
        ) : undefined
      }
      icon={icon}
      title={title}
      titleRef={headingRef}
      meta={subtitle ? <Text color="secondary">{subtitle}</Text> : undefined}
      actions={actions}
      below={meta}
      tabs={tabs}
      label={label}
      facts={details}
    >
      {read}
    </PageFrame>
  );
}

/**
 * One section of the main column (board Person): its heading at level 2 with the source's badge at the end of the
 * heading's line and the source's own way in after it, then what it holds. A named region of the page. The heading
 * takes the focus from a script (`?section=`), never from Tab.
 */
export function PageSection({
  title,
  level = 2,
  badge,
  end,
  headingRef,
  children,
}: {
  title: string;
  /** The heading's level: 2 on the page, 3 in the pane beside a conversation, under the thing's name (D126 rule 2). */
  level?: 2 | 3 | undefined;
  /** Whose the section is: the source's name as a badge. */
  badge?: ReactNode;
  /** The source's own way in ("Öppna samtalet"), at the end of the heading's line. */
  end?: ReactNode;
  headingRef?: ((el: HTMLHeadingElement | null) => void) | undefined;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <VStack as="section" gap={2} aria-labelledby={id}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <StackItem size="fill">
          <Heading id={id} ref={headingRef} tabIndex={-1} level={level}>
            {title}
          </Heading>
        </StackItem>
        {badge}
        {end}
      </HStack>
      {children}
    </VStack>
  );
}

/** A part of the details rail (board Person: "Detaljer" with the directory's name at the end of its line, "Tillhör"). */
export function RailSection({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string | undefined;
  children: ReactNode;
}) {
  return (
    <VStack gap={4}>
      <HStack gap={2} vAlign="center">
        <StackItem size="fill">
          <Heading level={3} accessibilityLevel={2}>
            {title}
          </Heading>
        </StackItem>
        {caption && (
          <Text type="supporting" color="secondary">
            {caption}
          </Text>
        )}
      </HStack>
      {children}
    </VStack>
  );
}
