import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Avatar,
  Button,
  Center,
  ChatBubbleLeftIcon,
  Grid,
  Heading,
  HStack,
  Icon,
  Link,
  List,
  ListItem,
  Text,
  VStack,
} from '@clew/ui';
import type { Thread } from '@clew/contracts';
import { handoverAssistantsQuery, threadsQuery } from '../queries';
import { useBranding } from '../branding';
import { groupThreads } from '../stream';
import { usePageTitle } from '../page-title';
import { whenWord } from '../when-word';
import { Composer } from '../components/composer';
import { titled, useConversation } from '../components/conversation-context';
import { InstallationLogo } from '../components/shell';
import { PageFrame, type EntryStyle } from '../components/page-frame';

/** How many conversations and assistants stand under the box (board NyFraga, variant b): the rest are a link away. */
const SHOWN = 3;
const EMPTY_THREADS: Thread[] = [];

/**
 * Ny fråga (D126 item 14, board NyFraga variant b, the `ai-chat-landing` template without suggestion chips): a page of
 * its own at `/conversations/new` when the address names nothing to ask about. Inside the page's sheet, in a column of
 * at most 720 px centred both ways: the installation's mark as the rail's heading draws it (none when no logo is saved,
 * D98), the greeting Hem has as the page's one level-1 heading, the line "Vad vill du ha hjälp med?" and the box, which
 * has the focus. Under the box, the person's latest conversations to go on with and the other systems' assistants they
 * may ask (D125), each block only when it has something to list. Sending the first question continues on the
 * conversation's own address, which takes this one's place, so Back leads to where the person was before.
 */
export function NewQuestionPage({ greeting, entry }: { greeting: string; entry: EntryStyle }) {
  const talk = useConversation();
  const logo = useBranding().logo;
  usePageTitle('Ny fråga');
  // The page is for asking: the box has the focus when it opens.
  useEffect(() => {
    const frame = requestAnimationFrame(() => talk.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  // "Visa alla" opens the box's own "Till:" menu, where every assistant is, with the focus on its chosen row as when the
  // menu's own button opens it: Esc then closes the menu and gives the focus to that button (2.4.3), never the page.
  const [menuOpen, setMenuOpen] = useState(false);
  const showAll = () => {
    setMenuOpen(true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>('[role="menu"] [aria-checked="true"], [role="menu"] [role^="menuitem"]')
          ?.focus(),
      ),
    );
  };
  return (
    <PageFrame entry={entry} label="Ny fråga">
      <Center minHeight="100%">
        <VStack gap={10} width="100%" maxWidth={720} hAlign="stretch" paddingBlock={6}>
          <VStack gap={3} hAlign="center">
            {logo && <InstallationLogo logo={logo} height={44} decorative />}
            <Heading level={1} type="display-2" tabIndex={-1} id="ny-fraga">
              {greeting}
            </Heading>
            <Text type="large" color="secondary">
              Vad vill du ha hjälp med?
            </Text>
          </VStack>
          <Composer place="landing" recipientMenu={{ isOpen: menuOpen, onOpenChange: setMenuOpen }} />
          <UnderTheBox onShowAll={showAll} />
        </VStack>
      </Center>
    </PageFrame>
  );
}

/**
 * What stands under the box (the product owner, 2026-11-16: board NyFraga variant b): "Fortsätt", the person's latest
 * conversations as the rail's Samtal lists them, each the link to the conversation with when it was last active; and
 * "Fråga någon annan", the other systems' assistants the box's "Till:" menu lists (D125), at most three, each a row that
 * makes that assistant the box's recipient exactly as the menu does, sending nothing. A block with nothing to list is
 * not drawn.
 */
function UnderTheBox({ onShowAll }: { onShowAll: () => void }) {
  const talk = useConversation();
  const threads = useQuery(threadsQuery).data?.threads ?? EMPTY_THREADS;
  const now = new Date().toISOString();
  const latest = groupThreads(threads, now, now.slice(0, 10)).questions.slice(0, SHOWN);
  const assistants = useQuery(handoverAssistantsQuery).data ?? [];
  const shown = assistants.slice(0, SHOWN);
  if (!latest.length && !shown.length) return null;
  return (
    <Grid columns={{ minWidth: 300, max: 2 }} gap={8}>
      {latest.length > 0 && (
        <VStack as="section" gap={2} aria-labelledby="fortsatt">
          <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
            <Heading id="fortsatt" level={2}>
              Fortsätt
            </Heading>
            <Link href="/conversations">Alla samtal</Link>
          </HStack>
          <List hasDividers aria-label="Dina senaste samtal">
            {latest.map(t => (
              <ListItem
                key={t.id}
                startContent={<Icon icon={ChatBubbleLeftIcon} color="secondary" />}
                label={
                  <Link href={`/conversations/${t.id}`} color="primary">
                    {titled(t.title)}
                  </Link>
                }
                description={<Text type="supporting">{whenWord(t.updatedAt)}</Text>}
              />
            ))}
          </List>
        </VStack>
      )}
      {shown.length > 0 && (
        <VStack as="section" gap={2} aria-labelledby="fraga-nagon-annan">
          <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
            <Heading id="fraga-nagon-annan" level={2}>
              Fråga någon annan
            </Heading>
            <Button size="sm" variant="ghost" label="Visa alla" onClick={onShowAll} />
          </HStack>
          <List hasDividers aria-label="Andra systems assistenter">
            {shown.map(a => (
              <ListItem
                key={a.id}
                startContent={<Avatar name={a.name} size="sm" shape="square" tooltip={false} />}
                // As Text, which wraps: a line given as a string is cut, and what is cut cannot be read (1.4.10).
                label={<Text>{a.name}</Text>}
                description={<Text type="supporting">{[a.source, a.description].filter(Boolean).join(' · ')}</Text>}
                isSelected={talk.handed?.id === a.id}
                onClick={() => {
                  if (talk.handed?.id !== a.id) talk.handTo({ id: a.id, name: a.name, source: a.source });
                }}
              />
            ))}
          </List>
        </VStack>
      )}
    </Grid>
  );
}
