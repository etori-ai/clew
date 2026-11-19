import { useId, useRef, type ReactNode } from 'react';
import {
  Badge,
  Collapsible,
  Divider,
  Heading,
  HStack,
  Text,
  VStack,
  VisuallyHidden,
  useAnimatedLayout,
} from '@clew/ui';

/**
 * A thing's section (D126 item 13, board StatusPanel's `Sec`): a rule above it, its name in the third heading size with
 * how many it holds as a neutral badge beside the name, an optional link at the end of the heading row, then what it
 * holds. The same in Att göra's reading pane and on the thing's own page; the level a screen reader is told is the
 * page's outline (`level`), whatever the drawn size. A `section` named by its heading.
 */
export function ItemSection({
  id,
  title,
  level,
  count,
  end,
  divided = true,
  of,
  children,
}: {
  id: string;
  title: string;
  /** The heading's level in the page's outline. */
  level: number;
  /** How many the section holds, beside its name. */
  count?: number | undefined;
  /** At the end of the heading row: a link to where the section's things are worked on ("Visa granskning"). */
  end?: ReactNode;
  /** The rule above it; not on the first section, under the rule its thing's head already draws. */
  divided?: boolean;
  /**
   * The id of the thing's own title, where several things can stand on one page (a work item in an answer, with another
   * beside the transcript or in another answer): the section is then named by its heading and the thing, so two
   * "Uppgifter" are two regions a screen reader can tell apart.
   */
  of?: string | undefined;
  children: ReactNode;
}) {
  return (
    <>
      {divided && <Divider />}
      <VStack as="section" gap={3} aria-labelledby={of ? `${id} ${of}` : id}>
        <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
          <HStack gap={2} vAlign="center">
            <Heading id={id} level={3} accessibilityLevel={level as 2 | 3 | 4 | 5}>
              {title}
            </Heading>
            {count !== undefined && <Badge variant="neutral" label={String(count)} />}
          </HStack>
          {end}
        </HStack>
        {children}
      </VStack>
    </>
  );
}

/**
 * The last section, folded (D126 item 13: "Händelser" closed by default): Astryx's Collapsible, its name and count as
 * the trigger, which is a button that says whether it is open (`aria-expanded`) and is reached by Tab; the section is a
 * region named by the name, so it is found as the others are. A heading cannot stand inside the trigger's button, so the
 * name is drawn as the trigger's own semibold text. Opening glides the content in (`useAnimatedLayout`).
 */
export function FoldedSection({
  title,
  count,
  countWord,
  quiet = false,
  of,
  children,
}: {
  title: string;
  count?: number | undefined;
  /** What the count counts, for a screen reader: "Händelser, 3 händelser". Not needed without a count. */
  countWord?: string;
  /** Its name in the body size: a section that explains, not one that is worked in ("Varför ser jag detta?"). */
  quiet?: boolean;
  /** The id of the thing's own title, where several things can stand on one page (`ItemSection`). */
  of?: string | undefined;
  children: ReactNode;
}) {
  const id = useId();
  const area = useRef<HTMLDivElement>(null);
  const animatedLayout = useAnimatedLayout({ containerRef: area });
  return (
    <>
      <Divider />
      <VStack ref={area} as="section" aria-labelledby={of ? `${id} ${of}` : id}>
        <Collapsible
          defaultIsOpen={false}
          animatedLayout={animatedLayout}
          trigger={
            <HStack gap={2} vAlign="center">
              <Text id={id} {...(quiet ? {} : { type: 'large' as const })} weight="semibold">
                {title}
              </Text>
              {count !== undefined && (
                <Badge
                  variant="neutral"
                  label={
                    <>
                      {count}
                      {countWord && <VisuallyHidden> {countWord}</VisuallyHidden>}
                    </>
                  }
                />
              )}
            </HStack>
          }
        >
          <VStack paddingBlockStart={3}>{children}</VStack>
        </Collapsible>
      </VStack>
    </>
  );
}
