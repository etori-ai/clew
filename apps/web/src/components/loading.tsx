import type { ComponentProps, ReactNode } from 'react';
import { Card, Divider, Grid, HStack, Skeleton, VStack, VisuallyHidden, useEntryAnimation } from '@clew/ui';
import { TodayHeading } from './today';

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

/** Hem's "I dag" reserves its place from the first paint, its real heading over the card the rows will stand in. */
export function AsideSkeleton({ calendar = true }: { calendar?: boolean }) {
  return (
    <VStack gap={3} as="section" aria-labelledby="i-dag">
      <TodayHeading calendar={calendar} />
      <Card padding={4}>
        <VisuallyHidden role="status">Hämtar i dag …</VisuallyHidden>
        {Array.from({ length: 3 }, (_, i) => (
          <VStack key={i} gap={0}>
            {i > 0 && <Divider />}
            <HStack gap={3} paddingBlock={3}>
              <VStack width={52}>
                <Skeleton height={18} width={40} index={i} />
              </VStack>
              <VStack gap={1.5} width="100%">
                <Skeleton height={18} width="85%" index={i} />
                <Skeleton height={14} width="60%" index={i} />
              </VStack>
            </HStack>
          </VStack>
        ))}
      </Card>
    </VStack>
  );
}

/** A page's title line while the page is not yet known: the h1's height, at the width a short title takes. */
export function TitleSkeleton() {
  return <Skeleton height={32} width="30%" />;
}

/** Dialogstöd's "Att ta upp" while the sources answer: the card it stands in, its heading and a few lines. */
export function AttentionSkeleton({ label = 'Hämtar det som ska tas upp …' }: { label?: string }) {
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <VisuallyHidden role="status">{label}</VisuallyHidden>
        <Skeleton height={24} width="20%" />
        {['70%', '55%', '62%'].map((width, i) => (
          <Skeleton key={width} height={16} width={width} index={i + 1} />
        ))}
      </VStack>
    </Card>
  );
}

/**
 * Dialogstöd before the list of units has come: "Att ta upp" on top, then a group's heading and its table, so the page
 * is drawn in the shape it will have and nothing moves down when the units arrive.
 */
export function UnitsSkeleton() {
  return (
    <VStack gap={6}>
      <AttentionSkeleton label="Hämtar enheterna …" />
      <VStack gap={3}>
        <Skeleton height={28} width="22%" />
        <Card padding={4}>
          <VStack gap={4}>
            <Skeleton height={36} />
            {[0, 1].map(i => (
              <VStack key={i} gap={4}>
                <Divider />
                <Skeleton height={44} width={i ? '80%' : '90%'} index={i + 1} />
              </VStack>
            ))}
          </VStack>
        </Card>
      </VStack>
    </VStack>
  );
}

/**
 * Hem before the session is known (D126, board Hem): the greeting and its line, the box under them, then "Behöver dig"
 * beside "I dag", each a heading over its card, in the places the page draws them.
 */
export function HemSkeleton() {
  return (
    <VStack gap={8}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Skeleton height={32} width="35%" />
          <Skeleton height={14} width="25%" index={1} />
        </VStack>
        <Skeleton height={106} radius={4} index={2} />
      </VStack>
      <Grid columns={{ minWidth: 380, max: 2 }} gap={6}>
        {[0, 1].map(i => (
          <VStack key={i} gap={3}>
            <Skeleton height={24} width="30%" index={i} />
            <Card padding={4}>
              <VStack gap={3}>
                <Skeleton height={16} width="85%" index={i + 1} />
                <Skeleton height={16} width="65%" index={i + 2} />
                <Skeleton height={16} width="75%" index={i + 3} />
              </VStack>
            </Card>
          </VStack>
        ))}
      </Grid>
    </VStack>
  );
}
