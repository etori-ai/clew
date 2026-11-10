import type { ReactNode } from 'react';
import { HStack, Layout, LayoutContent, LayoutFooter, ScrollableArea, StackItem, Text } from '@clew/ui';

/**
 * The body of a dialog whose content may outgrow the window, as Astryx's `form-wizard-dialog` template composes it: a
 * Layout that fills the Dialog, the header (the DialogHeader, and a stepper in a LayoutHeader) pinned, the content in
 * LayoutContent, which scrolls against the dialog's maxHeight, and the actions in LayoutFooter, which never scrolls
 * away. The secondary action sits at the start, the error and the primary actions at the end. Composition only: no
 * styles of its own. A Dialog clips what does not fit, so content placed straight in it is cut off in a low window.
 *
 * Keep the frame, and its DialogHeader, rendered while the dialog is closed: the Dialog names itself from a header
 * title present when it mounts (4.1.2), so only the content may wait for data.
 *
 * Content that can be all reading (a list, a day) passes `scrollLabel`: LayoutContent stops scrolling and a labelled
 * ScrollableArea owns the one viewport, which enters the tab order while it overflows, so a keyboard can scroll it
 * (2.1.1). Content with fields scrolls in LayoutContent; tabbing through the fields scrolls it.
 */
export function DialogFrame({
  header,
  children,
  secondary,
  primary,
  error,
  scrollLabel,
}: {
  header: ReactNode;
  children: ReactNode;
  secondary?: ReactNode;
  primary?: ReactNode;
  error: string | null;
  scrollLabel?: string;
}) {
  return (
    <Layout
      height="fill"
      padding={4}
      defaultHasDividers
      header={header}
      content={
        scrollLabel ? (
          <LayoutContent isScrollable={false} padding={0}>
            <ScrollableArea label={scrollLabel} height="100%" padding={4}>
              {children}
            </ScrollableArea>
          </LayoutContent>
        ) : (
          <LayoutContent>{children}</LayoutContent>
        )
      }
      footer={
        <LayoutFooter>
          <HStack gap={2} vAlign="center" wrap="wrap">
            {secondary}
            <StackItem size="fill" />
            {error && (
              <Text as="p" role="alert" color="accent">
                {error}
              </Text>
            )}
            {primary}
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
