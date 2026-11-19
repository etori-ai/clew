import { createRef } from 'react';
import { useLocation } from 'react-router';
import { Button, Icon, SparklesIcon } from '@clew/ui';
import { useConversation } from '../conversation/conversation-context';

/** Where the floating button stands: the lower corner at the end of the line, clear of the page's edge. */
const CORNER = { position: 'fixed', insetInlineEnd: 24, insetBlockEnd: 24, zIndex: 10 } as const;
/** Hem's line to ask (`start.tsx`), which the button leads to while Hem is the page. */
export const hemLine = createRef<HTMLInputElement>();

/**
 * The way to the assistant from anywhere on a page (D130 item 14): a floating "Fråga AI" in the lower corner, as the
 * startsidan prototype has it. On Hem it leads to Hem's own line, as the reference's does: the line takes the focus
 * and is scrolled into view. On every other page it starts a new question about the page the person is on, as the
 * rail's "Ny fråga" did (D126 item 14): the conversation's own page opens, with this page as the way back.
 *
 * The button is Astryx's `Button` raised with `elevation`, as the `ButtonFloating` template raises one. Astryx places
 * nothing in a corner of the window, so the one `style` here does: the gap is recorded in D130 with this exception.
 */
export function AssistantCorner() {
  const talk = useConversation();
  const { pathname, search } = useLocation();
  const icon = <Icon icon={SparklesIcon} color="inherit" />;
  return (
    <div style={CORNER}>
      {pathname === '/' ? (
        <Button
          variant="ai"
          label="Fråga AI"
          icon={icon}
          size="lg"
          elevation="med"
          onClick={() => {
            hemLine.current?.scrollIntoView({ block: 'center' });
            hemLine.current?.focus();
          }}
        />
      ) : (
        <Button
          variant="ai"
          label="Fråga AI"
          icon={icon}
          size="lg"
          elevation="med"
          href="/conversations/new"
          onClick={() => talk.newConversation({ from: pathname + search, stay: true })}
        />
      )}
    </div>
  );
}
