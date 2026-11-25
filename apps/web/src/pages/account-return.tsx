import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { Button, Card, Heading, Layout, LayoutContent, Text, VStack, VisuallyHidden } from '@clew/ui';
import { usePageTitle } from '../page-title';
import { ACCOUNTS_PATH, LINK_CHANNEL, linkMessage, returnPageWords } from '../linked-accounts';

/** How long the window gets to close itself before the page says that the person can close it. */
const CLOSE_MS = 400;

/**
 * Where a system returns the window a person signed in in (D147 item 6): it tells every page of Clew in the browser
 * what happened, over Clew's own broadcast channel, and closes itself. Nothing is read here and no session is asked
 * for: the return route has already finished the link.
 *
 * A browser may refuse to close a window (one it opened as a tab on a phone, or one a system's sign-in cut off from
 * the page that opened it). The page then says what happened and that the window can be closed, with a way to Clew.
 */
export function AccountReturnPage() {
  const { search } = useLocation();
  const message = linkMessage(search);
  const words = returnPageWords(message?.outcome ?? null);
  const [stays, setStays] = useState(false);
  usePageTitle(words.title, false);
  useEffect(() => {
    if (message && typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(LINK_CHANNEL);
      channel.postMessage(message);
      channel.close();
    }
    // After the message has left: a window that closes in the same turn may take it along.
    const close = window.setTimeout(() => window.close(), 50);
    const said = window.setTimeout(() => setStays(true), CLOSE_MS);
    return () => {
      window.clearTimeout(close);
      window.clearTimeout(said);
    };
  }, []);
  return (
    <Layout
      height="fill"
      padding={4}
      content={
        <LayoutContent role="main">
          {stays ? (
            <VStack height="100%" vAlign="center" hAlign="center">
              <Card padding={8} width="100%" maxWidth={420}>
                <VStack gap={4}>
                  <Heading level={1}>{words.title}</Heading>
                  <Text as="p">{words.line}</Text>
                  <Button variant="secondary" label="Till Kopplade konton" href={ACCOUNTS_PATH} />
                </VStack>
              </Card>
            </VStack>
          ) : (
            <VisuallyHidden role="status">Stänger fönstret …</VisuallyHidden>
          )}
        </LayoutContent>
      }
    />
  );
}
