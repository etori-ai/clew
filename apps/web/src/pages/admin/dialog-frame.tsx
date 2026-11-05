import type { ReactNode } from 'react';
import { HStack, Layout, LayoutContent, LayoutFooter, StackItem, Text } from '@clew/ui';

/**
 * The body of an administration dialog, as Astryx's `form-wizard-dialog` template composes it: a Layout that fills the
 * Dialog, the header (the DialogHeader, and a stepper in a LayoutHeader) pinned, the content in LayoutContent, which
 * scrolls against the dialog's maxHeight, and the actions in LayoutFooter, which never scrolls away. The secondary
 * action sits at the start, the error and the primary actions at the end. Composition only: no styles of its own.
 */
export function DialogFrame({ header, children, secondary, primary, error }: { header: ReactNode; children: ReactNode; secondary?: ReactNode; primary?: ReactNode; error: string | null }) {
  return <Layout height="fill" padding={4} defaultHasDividers header={header}
    content={<LayoutContent>{children}</LayoutContent>}
    footer={<LayoutFooter><HStack gap={2} vAlign="center" wrap="wrap">
      {secondary}
      <StackItem size="fill" />
      {error && <Text as="p" role="alert" color="accent">{error}</Text>}
      {primary}
    </HStack></LayoutFooter>} />;
}
