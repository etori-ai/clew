import { ArrowRightIcon } from '@heroicons/react/24/outline';
import { Card } from '@astryxdesign/core/Card';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';

/**
 * A key figure (D130 item 9), drawn as the startsidan prototype draws one, every tile the same shape: the label in
 * small capitals, with an arrow when the tile leads somewhere; the value large, in its status colour where it has one
 * and in the identity colour where it has none;
 * a line under it with the status in words and what the value is compared with; and last where the figure is from.
 * The word always stands beside the colour (1.4.1). With `href` the whole tile is a `ClickableCard` to the page of what
 * it counts; without, a card named as a group. `name` is what a screen reader hears for the tile.
 */
export function KeyFigure({
  label,
  value,
  tone,
  line,
  foot,
  href,
  name,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'warning' | 'error' | undefined;
  /** Under the value: the status word and what the value is compared with. */
  line?: string | undefined;
  /** Last: the area or source the figure is from. */
  foot?: string | undefined;
  href?: string | null | undefined;
  name: string;
}) {
  const content = (
    <VStack gap={1} paddingInline={1}>
      <HStack justify="between" vAlign="start" gap={2}>
        <Text type="eyebrow">{label}</Text>
        {href && <Icon icon={ArrowRightIcon} size="sm" color="secondary" />}
      </HStack>
      {/* Not a heading, which would put every figure in the page's outline. */}
      <Text type="display-3" color={tone ?? 'accent'}>
        {value}
      </Text>
      {(line || foot) && (
        <VStack gap={0}>
          {line && (
            <Text type="supporting" color="secondary">
              {line}
            </Text>
          )}
          {foot && (
            <Text type="supporting" color="secondary">
              {foot}
            </Text>
          )}
        </VStack>
      )}
    </VStack>
  );
  return href ? (
    <ClickableCard label={name} href={href} padding={5} height="100%">
      {content}
    </ClickableCard>
  ) : (
    <Card padding={5} height="100%">
      <VStack role="group" aria-label={name}>
        {content}
      </VStack>
    </Card>
  );
}
