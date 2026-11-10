import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { useEntryAnimation } from '@astryxdesign/core/hooks';

/** Shared completion motion: Astryx owns the animation, tokens and reduced-motion alternative. */
export function CompletionMark({ size = 'lg', animate = true }: { size?: 'md' | 'lg'; animate?: boolean }) {
  const entry = useEntryAnimation('scaleIn');
  return (
    <Icon
      icon="success"
      color="success"
      size={size}
      label="Klart"
      xstyle={animate ? (entry ?? undefined) : undefined}
    />
  );
}

/**
 * The same confirmation in reviews, receipts and completion toasts. Only mount after confirmed success.
 *
 * As a toast's body the title is passed as `children`: from 0.7.12 Astryx announces a toast from the text it can read in
 * the body's element children, and a title given as a prop is drawn but never spoken (4.1.3).
 */
export function CompletionFeedback({
  title = 'Klart',
  detail,
  children,
}: {
  title?: string;
  detail?: string;
  children?: string;
}) {
  return (
    <HStack gap={3} vAlign="center">
      <CompletionMark />
      <VStack gap={1}>
        <Text weight="semibold">{children ?? title}</Text>
        {detail && <Text type="supporting">{detail}</Text>}
      </VStack>
    </HStack>
  );
}
