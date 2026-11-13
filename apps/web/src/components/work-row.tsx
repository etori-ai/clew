import { useRef, type ReactNode } from 'react';
import type { Thread } from '@clew/contracts';
import { Badge, Link, List, ListItem, StatusDot, Text, VStack } from '@clew/ui';
import { rowLine, type RowFacts } from '../work-items';

/**
 * A row that is one link (D112 items 2 and 3, boards Inbox and Main): the title is the row's one link and its one tab
 * stop, named by the title alone (and, for a link out of Clew, Astryx's words that it opens in a new tab); the row
 * around it is Astryx's enlarged target for that link (`ListItem`'s `interactiveRef`), so a press anywhere on the row,
 * on the supporting line, a badge or the empty space beside them, follows the link, and the row's own hover, focus ring,
 * radius and padding are the list's. A work item's row and a news row on Hem are this one row, so they cannot drift.
 */
export function LinkRow({
  id,
  itemKey,
  href,
  title,
  description,
  descriptionLines = 2,
  startContent,
  endContent,
  isSelected = false,
  isExternal = false,
}: {
  id: string;
  itemKey: string;
  href: string;
  title: string;
  description: ReactNode;
  /**
   * The lines the supporting line may take before it is cut: a summary's two, or 0 for no cut at all (Astryx `Text`:
   * `maxLines` 0 is no truncation), which a work item's state and reason need: at 320 px they take four or five lines,
   * and what a clamp cuts a keyboard user cannot read on the row (WCAG 1.4.10).
   */
  descriptionLines?: number;
  startContent?: ReactNode;
  endContent?: ReactNode;
  /** The chosen row: marked as the current one, on the row and on its link. */
  isSelected?: boolean;
  /** The link leaves Clew: it opens in a new tab and says so. */
  isExternal?: boolean;
}) {
  const link = useRef<HTMLAnchorElement>(null);
  return (
    <ListItem
      id={id}
      itemKey={itemKey}
      interactiveRef={link}
      isSelected={isSelected}
      align="first-line"
      {...(startContent ? { startContent } : {})}
      label={
        <Link
          ref={link}
          href={href}
          color="primary"
          weight="semibold"
          maxLines={2}
          isExternalLink={isExternal}
          aria-current={isSelected ? 'true' : undefined}
        >
          {title}
        </Link>
      }
      description={
        <Text type="supporting" color="secondary" maxLines={descriptionLines}>
          {description}
        </Text>
      }
      {...(endContent ? { endContent } : {})}
    />
  );
}

/**
 * A work item as a row (D112 items 2 and 3, boards Inbox and Main): the state dot, the title, why it is here, when it
 * is due and where it comes from, as the one link row. The state is said in words at the start of the supporting line
 * ("Att göra i dag · Ansökan kom 10 november kl. 16:40"), so two states never differ by the dot's colour alone (WCAG
 * 1.4.1; Astryx's StatusDot is always paired with a visible label). The dot beside those words is decoration, hidden
 * from assistive technology as an avatar beside a name is, so the state is heard once, where it is read. The line is
 * never cut: it holds the state and why the item is here, and takes the lines it needs at any width.
 */
export function WorkRow({
  thread,
  facts,
  source,
  href,
  isSelected = false,
}: {
  thread: Thread;
  facts: RowFacts;
  /** The area's word (the queue) or the system's (Hem), as the boards draw the row's end. */
  source: string;
  href: string;
  isSelected?: boolean;
}) {
  return (
    <LinkRow
      id={`work-${thread.id}`}
      itemKey={thread.id}
      href={href}
      title={thread.title}
      isSelected={isSelected}
      startContent={<StatusDot variant={facts.state.variant} label={facts.state.label} aria-hidden />}
      description={rowLine(facts)}
      descriptionLines={0}
      endContent={
        <VStack gap={1} hAlign="end">
          {facts.due && <Badge variant={facts.due.variant} label={facts.due.label} />}
          <Text type="supporting" color="secondary" textWrap="nowrap">
            {source}
          </Text>
        </VStack>
      }
    />
  );
}

/**
 * The list the rows stand in, the same on Hem and in Att göra so the two cannot drift: no dividers, so each row keeps
 * the list's own rounded highlight with its padding around the words (board Inbox).
 */
export function WorkList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <List density="balanced" aria-label={label}>
      {children}
    </List>
  );
}
