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

/** The same confirmation in reviews, receipts and completion toasts. Only mount after confirmed success. */
export function CompletionFeedback({ title = 'Klart', detail }: { title?: string; detail?: string }) {
  return (
    <HStack gap={3} vAlign="center">
      <CompletionMark />
      <VStack gap={1}>
        <Text weight="semibold">{title}</Text>
        {detail && <Text type="supporting">{detail}</Text>}
      </VStack>
    </HStack>
  );
}
