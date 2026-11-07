import type { ComponentProps, ReactNode } from 'react';
import { Card, Divider, Heading, HStack, Skeleton, VStack, VisuallyHidden, useEntryAnimation } from '@clew/ui';

type Gap = ComponentProps<typeof VStack>['gap'];

/** One entrance per loaded region. Refetches preserve the mounted content, its focus and local state. */
export function ContentArrival({ children, gap = 0 }: { children: ReactNode; gap?: Gap }) {
  const entry = useEntryAnimation('fadeIn');
  return (
    <VStack gap={gap} xstyle={entry ?? undefined}>
      {children}
    </VStack>
  );
}

/** Pending means no first answer yet, never a background fetch. The fallback occupies the content's own slot. */
export function AsyncContent({
  pending,
  fallback,
  children,
  gap = 0,
}: {
  pending: boolean;
  fallback: ReactNode;
  children: ReactNode;
  gap?: Gap;
}) {
  return (
    <VStack gap={0} aria-busy={pending}>
      {pending ? fallback : <ContentArrival gap={gap}>{children}</ContentArrival>}
    </VStack>
  );
}

/** Shared row shape for tools and administration; responsive widths also fit the 320 px layout. */
export function ContentSkeleton({
  label = 'Hämtar innehåll …',
  rows = 5,
  heading = true,
}: {
  label?: string;
  rows?: number;
  heading?: boolean;
}) {
  return (
    <VStack gap={4}>
      <VisuallyHidden role="status">{label}</VisuallyHidden>
      {heading && <Skeleton height={32} width="45%" />}
      <Card padding={4}>
        <VStack gap={4}>
          {Array.from({ length: rows }, (_, i) => (
            <VStack key={i} gap={3}>
              {i > 0 && <Divider />}
              <Skeleton height={18} width={i % 2 ? '65%' : '85%'} index={i} />
              <Skeleton height={14} width="45%" index={i} />
            </VStack>
          ))}
        </VStack>
      </Card>
    </VStack>
  );
}

/** Hem's side cards reserve their place from the first paint, including their real heading. */
export function AsideSkeleton({ kind }: { kind: 'today' | 'since' }) {
  const day = kind === 'today';
  const title = day ? 'I dag' : 'Sedan i går';
  return (
    <Card padding={4} variant={day ? 'default' : 'muted'}>
      <VStack gap={day ? 1 : 2} as="section" aria-label={title}>
        <Heading level={3} accessibilityLevel={2}>
          {title}
        </Heading>
        <VisuallyHidden role="status">Hämtar {title.toLowerCase()} …</VisuallyHidden>
        {Array.from({ length: 3 }, (_, i) => (
          <VStack key={i} gap={0}>
            {day && i > 0 && <Divider />}
            <HStack gap={3} paddingBlock={day ? 3 : 1}>
              {day && (
                <VStack width={52}>
                  <Skeleton height={18} width={40} index={i} />
                </VStack>
              )}
              <VStack gap={1.5} width="100%">
                <Skeleton height={18} width="85%" index={i} />
                <Skeleton height={14} width="60%" index={i} />
              </VStack>
            </HStack>
          </VStack>
        ))}
        {!day && <Skeleton height={14} width="45%" />}
      </VStack>
    </Card>
  );
}
