import { useRef, useState, type ReactNode } from 'react';
import { Collapsible, Text, VStack, useAnimatedLayout, type AnimatedLayout } from '@clew/ui';

/**
 * "Visa allt" (D112 item 7, board Calendar): while a conversation about the thing runs, its facts fold to the essentials
 * and the buttons, and the rest is behind this disclosure. Astryx's Collapsible, folded to start with, gliding what comes
 * after it with `useAnimatedLayout` as every Collapsible here does. Not folded, the content is drawn as it is.
 */
export function Unfold({
  folded,
  children,
  animatedLayout,
}: {
  folded: boolean;
  children: ReactNode;
  /** The handle of the area the thing is drawn in; without one the Collapsible makes its own. */
  animatedLayout?: AnimatedLayout;
}) {
  const [open, setOpen] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const own = useAnimatedLayout({ containerRef: area });
  if (!folded) return <>{children}</>;
  return (
    <VStack ref={area}>
      <Collapsible
        isOpen={open}
        onOpenChange={setOpen}
        chevronPosition="start"
        animatedLayout={animatedLayout ?? own}
        trigger={<Text weight="semibold">{open ? 'Visa mindre' : 'Visa allt'}</Text>}
      >
        {children}
      </Collapsible>
    </VStack>
  );
}
