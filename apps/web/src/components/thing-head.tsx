import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { VStack } from '@clew/ui';

/**
 * Where a thing's head stands beside its conversation (`ThingWithConversation`): above the transcript, outside its
 * scroll, at the panel's inset. Provided around the thing only, never around the transcript's answers.
 */
export const HeadSlot = createContext<{ slot: HTMLElement; inset: 3 | 6 } | null>(null);

/**
 * The thing's head beside its conversation (D111 item 7, board Calendar): the title, the status and the buttons stand
 * above the transcript, outside its scroll, so they never leave the panel while a conversation runs; the facts and the
 * transcript scroll under them. Null where nothing is docked (a page, an answer, a short screen, 1.4.10): the thing
 * draws its head where it stands. The thing passes the head it keeps in view; what it leaves in place scrolls.
 */
export function useThingHead(): ((head: ReactNode) => ReactNode) | null {
  const at = useContext(HeadSlot);
  return at
    ? head =>
        createPortal(
          <VStack paddingInline={at.inset} paddingBlockStart={at.inset}>
            {head}
          </VStack>,
          at.slot,
        )
    : null;
}
