import { Card, Divider, HStack, Skeleton, VisuallyHidden, VStack } from '@clew/ui';

/**
 * The rows while the cards load (D36): the shape of a row (the day, the title over its line, the button), so the page
 * holds its place until they arrive. The brief these rows stood in for is gone (D53): the rows under the box are the page. The shimmer is for the eye; a reader hears one line.
 */
export function BriefSkeleton({ rows = 3, compact = false }: { rows?: number; compact?: boolean }) {
  return (
    <Card padding={2}>
      <VisuallyHidden role="status">Hämtar det som behöver dig …</VisuallyHidden>
      <VStack gap={0}>
        {Array.from({ length: rows }, (_, i) => (
          <VStack key={i} gap={0}>
            {i > 0 && <Divider />}
            <HStack gap={3} vAlign="center" padding={2}>
              <VStack width={56}>
                <Skeleton height={14} width={40} index={i} />
              </VStack>
              <VStack gap={1.5} width="100%">
                <Skeleton height={18} width="60%" index={i} />
                <Skeleton height={14} width="40%" index={i} />
              </VStack>
              {!compact && <Skeleton height={32} width={104} radius="rounded" index={i} />}
            </HStack>
          </VStack>
        ))}
      </VStack>
    </Card>
  );
}
