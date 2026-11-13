import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import {
  Dialog,
  DialogHeader,
  Divider,
  Heading,
  HStack,
  Icon,
  IconButton,
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutPanel,
  Link,
  ScrollableArea,
  StackItem,
  Text,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { mobileQuery, shortQuery } from '../media';
import { narrowItemQuery } from './work-item';

/**
 * A person's or a unit's page (D112 item 5, board Person): the work item's page shape (`work-item-detail`,
 * `WorkItemPage`) drawn for an entity. The header holds the way back with where the entity stands on the same line, on
 * a phone as on a wide screen (D124 item 6), then the avatar, the name and its line, and the actions with "Fråga Clew"
 * at the end of the name's line (on a phone "Åtgärder" under it, the width of the column). The main column holds every section one under the other, each with its heading, the source's
 * badge on the heading's line and a rule between them; nothing is chosen, so there is no tab strip. The details rail is
 * 340 px beside the column, a named complementary region; at 1024 px and below, and while the page's panel holds
 * something beside it, its content is behind "Visa detaljer" in a fullscreen dialog, as on the work item's page. On a
 * short screen nothing is pinned and the page scrolls as one (1.4.10).
 *
 * The header's controls stay where they are at every width and with the panel open or closed, so a card an action made
 * closes back to the button that started it.
 */

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
  sections,
  empty,
  details,
  label,
  panel,
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
  /** The line under the name: a person's title, "Enhet" for a unit. */
  subtitle?: ReactNode;
  /** The actions about the entity and "Fråga Clew". */
  actions?: ReactNode;
  sections: PageSectionEntry[];
  /** What the column says when no section has anything. */
  empty?: ReactNode;
  /** The details rail's content: "Detaljer" and where the entity belongs. */
  details: ReactNode;
  /** The column's scroll area, named while it scrolls. */
  label: string;
  /** The page's panel (`usePagePanel`), in the end slot after the rail. */
  panel: { end: ReactNode; occupied: boolean };
}) {
  const mobile = useMediaQuery(mobileQuery);
  const narrowWindow = useMediaQuery(narrowItemQuery);
  const short = useMediaQuery(shortQuery);
  // While the panel holds something beside the page the details go behind "Visa detaljer", as in a narrow window, so the
  // column keeps its width (the work item's page does the same).
  const narrow = narrowWindow || panel.occupied;
  const [detailsOpen, setDetailsOpen] = useState(false);
  // The dialog belongs to the narrow layout: a window widened under it lets go of it, so it does not come back by itself.
  useEffect(() => {
    if (!narrow) setDetailsOpen(false);
  }, [narrow]);
  const trail =
    back || crumbs || place ? (
      <HStack gap={3} wrap="wrap" vAlign="center">
        {back && (
          <Link href={back.href} type="supporting" color="secondary">
            <HStack as="span" gap={1} vAlign="center">
              <Icon icon="chevronLeft" size="sm" />
              {back.label}
            </HStack>
          </Link>
        )}
        {back && (crumbs || place) && <Divider orientation="vertical" />}
        {crumbs}
        {place && (
          <Text type="supporting" color="secondary">
            {place}
          </Text>
        )}
      </HStack>
    ) : null;
  const header = (
    <LayoutHeader padding={mobile ? 4 : 6} hasDivider>
      <VStack gap={mobile ? 3 : 4}>
        {(trail || narrow) && (
          <HStack gap={2} vAlign="center">
            <StackItem size="fill">{trail}</StackItem>
            {narrow && (
              <IconButton
                variant="secondary"
                label="Visa detaljer"
                tooltip="Visa detaljer"
                icon={<Icon icon="info" />}
                onClick={() => setDetailsOpen(true)}
              />
            )}
          </HStack>
        )}
        <HStack gap={4} vAlign="start" wrap="wrap">
          <StackItem size="fill">
            <HStack gap={3} vAlign="center">
              {icon}
              <VStack gap={0}>
                <Heading level={1}>{title}</Heading>
                {subtitle && <Text color="secondary">{subtitle}</Text>}
              </VStack>
            </HStack>
          </StackItem>
          {!mobile && actions}
        </HStack>
        {mobile && actions}
      </VStack>
    </LayoutHeader>
  );
  const column =
    sections.length === 0 ? (
      (empty ?? null)
    ) : (
      <VStack gap={6}>
        {sections.map((s, i) => (
          <VStack key={s.key} gap={6}>
            {i > 0 && <Divider />}
            {s.node}
          </VStack>
        ))}
      </VStack>
    );
  // The column scrolls in Astryx's ScrollableArea, which takes a tab stop while it scrolls, so a column with nothing
  // focusable can still be read by keyboard (axe: scrollable-region-focusable). On a short screen the page scrolls as one.
  // The column stays a scroll container while it still fits (`stickyContainment="always"`): the sections answer one by
  // one, and a section the address names is scrolled to as they arrive (`useAddressedSection`), which a fitting
  // ScrollableArea clips until it has seen them overflow.
  const content = short ? (
    <LayoutContent padding={mobile ? 4 : 6} isScrollable={false}>
      {column}
    </LayoutContent>
  ) : (
    <LayoutContent padding={0} isScrollable={false}>
      <ScrollableArea label={label} height="100%" padding={mobile ? 4 : 6} stickyContainment="always">
        {column}
      </ScrollableArea>
    </LayoutContent>
  );
  return (
    <>
      <Layout
        height={short ? 'auto' : 'fill'}
        header={header}
        content={content}
        end={
          narrow ? (
            panel.end
          ) : (
            <>
              <LayoutPanel
                width={340}
                padding={6}
                role="complementary"
                label="Detaljer"
                hasDivider
                isScrollable={!short}
              >
                {details}
              </LayoutPanel>
              {panel.end}
            </>
          )
        }
      />
      <Dialog variant="fullscreen" isOpen={narrow && detailsOpen} onOpenChange={setDetailsOpen}>
        <Layout
          header={<DialogHeader title="Detaljer" onOpenChange={setDetailsOpen} />}
          content={<LayoutContent padding={4}>{details}</LayoutContent>}
        />
      </Dialog>
    </>
  );
}

/**
 * One section of the main column (board Person): its heading at level 2 with the source's badge at the end of the
 * heading's line and the source's own way in after it, then what it holds. A named region of the page. The heading
 * takes the focus from a script (`?section=`), never from Tab.
 */
export function PageSection({
  title,
  badge,
  end,
  headingRef,
  children,
}: {
  title: string;
  /** Whose the section is: the source's name as a badge. */
  badge?: ReactNode;
  /** The source's own way in ("Öppna samtalet"), at the end of the heading's line. */
  end?: ReactNode;
  headingRef?: ((el: HTMLHeadingElement | null) => void) | undefined;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <VStack as="section" gap={3} aria-labelledby={id}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <StackItem size="fill">
          <Heading id={id} ref={headingRef} tabIndex={-1} level={2}>
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

/**
 * The section the address names (`?section=<capability>` or `needs-you`): an old link, "N att agera på" on Personal and
 * a talk's way back still land on it. Once its heading is on the page it is scrolled to the top of the column and takes
 * the focus, once per page and section, so a card opened beside the page, a talk over it or a reload of what the panel
 * holds never has the focus taken back. While something else holds the focus (`hold`: a thing in the panel, a talk or
 * a review over the page) the section is only scrolled to. The sections and their reads answer one by one, and one
 * that answers above the heading pushes it down as it grows into place with Astryx's motion: while the heading still
 * has the focus (or, held, while nobody has scrolled the column since) it is scrolled to again as each read lands and
 * once that motion has ended, so the focus is never left out of sight (2.4.7, 2.4.11). Returns the ref each section's
 * heading takes.
 */
export function useAddressedSection(section: string | undefined, page: string, hold: boolean) {
  const pending = useIsFetching();
  const headings = useRef(new Map<string, HTMLHeadingElement>());
  const refs = useRef(new Map<string, (el: HTMLHeadingElement | null) => void>());
  const landed = useRef<string | null>(null);
  const waiting = useRef(pending);
  const scrolledTo = useRef(0);
  const [mounted, setMounted] = useState(0);
  const refFor = useCallback((id: string) => {
    let ref = refs.current.get(id);
    if (!ref) {
      ref = el => {
        if (el) {
          headings.current.set(id, el);
          setMounted(n => n + 1);
        } else headings.current.delete(id);
      };
      refs.current.set(id, ref);
    }
    return ref;
  }, []);
  useEffect(() => {
    if (!section) {
      landed.current = null;
      return;
    }
    const at = `${page}\n${section}`;
    const heading = headings.current.get(section);
    const arrived = waiting.current !== pending;
    waiting.current = pending;
    /** The column the heading scrolls in, and where it stood after the last time it was scrolled to the heading. */
    const scroller = (el: HTMLElement) => {
      let at = el.parentElement;
      while (at && !/auto|scroll/.test(getComputedStyle(at).overflowY)) at = at.parentElement;
      return at;
    };
    const scrollTo = (el: HTMLHeadingElement) => {
      el.scrollIntoView({ block: 'start' });
      scrolledTo.current = scroller(el)?.scrollTop ?? 0;
    };
    /**
     * Scrolled to again, now and once what is growing above it has settled: while it holds the focus, or while what
     * holds the focus beside or over the page has left the column where it was put.
     */
    const keep = (el: HTMLHeadingElement) => {
      const still = () => {
        if (!el.isConnected) return;
        const untouched = hold && Math.abs((scroller(el)?.scrollTop ?? 0) - scrolledTo.current) < 2;
        if (document.activeElement === el || untouched) scrollTo(el);
      };
      still();
      const growing = document
        .getAnimations()
        .filter(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity);
      if (growing.length) void Promise.all(growing.map(a => a.finished.catch(() => undefined))).then(still);
    };
    if (landed.current === at) {
      if (arrived && heading) keep(heading);
      return;
    }
    if (!heading) return;
    landed.current = at;
    scrollTo(heading);
    if (!hold) heading.focus({ preventScroll: true });
    keep(heading);
  }, [section, page, hold, mounted, pending]);
  return refFor;
}
