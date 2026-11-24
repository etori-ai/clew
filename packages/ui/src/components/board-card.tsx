import { useRef, type ReactNode } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { useEntryAnimation } from '@astryxdesign/core/hooks';

/** A card's content once its first answer is here, with Astryx's entry motion, as `ContentArrival` draws a region. */
function Arrived({ children }: { children: ReactNode }) {
  const entry = useEntryAnimation('fadeIn');
  return <VStack xstyle={entry ?? undefined}>{children}</VStack>;
}

/**
 * A card on a board (D130 item 13), as the startsidan prototype draws one: its heading inside the card with how many it
 * holds after it ("Behöver dig · 7") and the way to all of them at the end of that line, and its content under them.
 * A region named by its heading. `list` is for content that is rows with their own inset (an Astryx `List`), so a row's
 * words stand on the heading's line; `flush` for a table, which reaches the card's edges, and `tools` for a register's
 * search under the heading. Where the page already names the card in view, directly over it (the current tab of a
 * phone's strip), `isHeadingHidden` keeps the heading and the count for a screen reader and for the region's name and
 * draws neither. While its first answer is on its way the card keeps its shape with placeholder
 * lines (`pending`, D36), and the answer then takes their place with Astryx's entry motion; what is in the card from
 * the first paint does not animate, and reduced motion shows it at once.
 */
export function BoardCard({
  id,
  title,
  count,
  countLabel,
  action,
  list = false,
  flush = false,
  tools,
  level = 2,
  isHeadingHidden = false,
  bare = false,
  pending = false,
  pendingLabel = 'Hämtar …',
  children,
}: {
  /** The heading's id: what the region is named by, and where a script may send the focus. */
  id: string;
  title: string;
  /** How many the card is about, after the heading. */
  count?: number | undefined;
  /** What the number counts, for a screen reader: "behöver dig". */
  countLabel?: string | undefined;
  /** At the end of the heading's line: the way to all of them. */
  action?: ReactNode;
  list?: boolean;
  /** The content reaches the card's edges: a table, which insets its own cells. */
  flush?: boolean;
  /** Under the heading's line, over the content: a register's search and filters. */
  tools?: ReactNode;
  /** The heading's level: 2 on a board, or what the page's outline asks for. */
  level?: 2 | 3;
  /**
   * The heading and the count are not drawn, since what stands directly over the card already says them in view; they
   * stay in the accessibility tree, where the region is named by them. An `action` is then not drawn either.
   */
  isHeadingHidden?: boolean;
  /**
   * No card of its own and no inset: the block stands in a frame that already is a card and insets it (a list beside
   * its reading pane).
   */
  bare?: boolean;
  pending?: boolean;
  pendingLabel?: string;
  children: ReactNode;
}) {
  // Whether the card has waited for its content: only then does the content arrive.
  const waited = useRef(pending);
  if (pending) waited.current = true;
  const heading = (
    <HStack gap={2} vAlign="center">
      <Heading id={id} tabIndex={-1} level={level}>
        {title}
      </Heading>
      {count !== undefined && count > 0 && (
        <Text type="supporting" weight="bold" color="secondary">
          {`· ${count}`}
          {countLabel ? <VisuallyHidden>{` ${countLabel}`}</VisuallyHidden> : null}
        </Text>
      )}
    </HStack>
  );
  // With no heading drawn, what comes first in a card of its own takes the heading's distance to the card's top.
  const top = isHeadingHidden && !bare;
  const block = (
    <VStack as="section" aria-labelledby={id} aria-busy={pending} height="100%">
      {isHeadingHidden ? (
        <VisuallyHidden as="div">{heading}</VisuallyHidden>
      ) : (
        <HStack
          justify="between"
          vAlign="center"
          gap={3}
          wrap="wrap"
          paddingInline={bare ? 0 : 6}
          paddingBlockStart={bare ? 0 : 5}
          paddingBlockEnd={list ? 2 : 4}
        >
          {heading}
          {action}
        </HStack>
      )}
      {tools ? (
        <VStack paddingInline={bare ? 0 : 6} paddingBlockStart={top ? 5 : 0} paddingBlockEnd={4}>
          {tools}
        </VStack>
      ) : null}
      <VStack
        paddingInline={flush || bare ? 0 : list ? 3 : 6}
        paddingBlockStart={top && !tools && !flush ? (list ? 3 : 6) : 0}
        paddingBlockEnd={flush || bare ? 0 : list ? 3 : 6}
      >
        {pending ? (
          <VStack gap={3} paddingInline={list ? 3 : 0} paddingBlock={2}>
            <VisuallyHidden role="status">{pendingLabel}</VisuallyHidden>
            {[70, 55, 62].map((width, i) => (
              <VStack key={i} gap={1.5}>
                <Skeleton height={18} width={`${width}%`} index={i} />
                <Skeleton height={14} width={`${width - 25}%`} index={i} />
              </VStack>
            ))}
          </VStack>
        ) : waited.current ? (
          <Arrived>{children}</Arrived>
        ) : (
          children
        )}
      </VStack>
    </VStack>
  );
  return bare ? (
    block
  ) : (
    <Card padding={0} height="100%">
      {block}
    </Card>
  );
}
