import type { ReactNode } from 'react';
import { HStack, Heading, StackItem, VStack } from '@clew/ui';

/**
 * The one page header (D74): every surface in the shell opens with it. The first line is the surface's title at level 1
 * at the start and the surface's own controls at the end (a search and its choice, a view switch, a primary button, a
 * switch, the day on Hem); the second line, when there is one, is the mark row or the subtitle in supporting text.
 *
 * Astryx has no page-header component: `LayoutHeader` is a slot and `Toolbar` is for actions inside a content area, "not
 * as a page-level header". This is the masthead its templates compose by hand (`table-page`: an `HStack` that wraps,
 * the `Heading` in a `StackItem size="fill"`, the action after it; `HeadingPageLayout`: the supporting line under the
 * heading), kept in one place so that no page composes its own. The title line is as tall as the heading's line
 * (24 px × 1.3333 = 32 px), which is Astryx's `md` control height, so a surface's controls never move its title; on a
 * narrow screen they wrap under it. The end is a plain flex child, not a static `StackItem`, so a row of controls wider
 * than a phone can still wrap inside itself (1.4.10).
 */
export function PageHeader({
  title,
  icon,
  titleId,
  end,
  meta,
}: {
  /** The surface's title, the page's one level-1 heading. */
  title: string;
  /** A mark that belongs to the title and stands before it: Hem's sparkle, a connected system's swatch. */
  icon?: ReactNode;
  /** Where focus is sent back to: the heading gets this id and can take focus from a script, not from Tab. */
  titleId?: string;
  /** The surface's own controls, at the end of the title's line. */
  end?: ReactNode;
  /** The second line: the mark row or the subtitle, in supporting text. */
  meta?: ReactNode;
}) {
  const heading = (
    <Heading level={1} {...(titleId ? { id: titleId, tabIndex: -1 } : {})}>
      {title}
    </Heading>
  );
  const line = (
    <HStack gap={3} vAlign="center" wrap="wrap">
      <StackItem size="fill">
        {icon ? (
          <HStack gap={2} vAlign="center">
            {icon}
            {heading}
          </HStack>
        ) : (
          heading
        )}
      </StackItem>
      {end}
    </HStack>
  );
  return meta ? (
    <VStack gap={1}>
      {line}
      {meta}
    </VStack>
  ) : (
    line
  );
}
