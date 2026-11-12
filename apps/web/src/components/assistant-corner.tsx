import { useNavigate } from 'react-router';
import {
  Button,
  ChatLayout,
  Drawer,
  DrawerHeader,
  EmptyState,
  Icon,
  Layout,
  LayoutContent,
  Link,
  SparklesIcon,
  Text,
  VStack,
} from '@clew/ui';
import { withCard, withView } from '../panel-address';
import { Composer, type ComposerAbout } from './composer';
import { Transcript } from './conversation';
import { useConversation } from './conversation-context';

/** Where the floating button stands: the lower corner at the end of the line, clear of the page's edge. */
const CORNER = { position: 'fixed', insetInlineEnd: 24, insetBlockEnd: 24, zIndex: 10 } as const;

/**
 * The assistant on a page without a box of its own (D115 item 5): a floating "Fråga AI" in the lower corner that opens
 * the assistant in a panel over the page, with the box, the answer and the way on to Min AI. The page under it stays as
 * it is. The panel is Astryx's modal `Drawer`: the focus stays in it, Escape and the scrim close it, and the focus goes
 * back to the button. The conversation is the one state every box shares (`conversation-context.tsx`), so what was
 * asked here is the same conversation in Min AI, and the panel shows it again when it is reopened during the visit.
 *
 * The button is Astryx's `Button` raised with `elevation`, as the `ButtonFloating` template raises one. Astryx places
 * nothing in a corner of the window, so the one `style` here does: the gap is recorded in D115 with this exception.
 */
export function AssistantCorner({ about }: { about?: ComposerAbout | undefined }) {
  const talk = useConversation();
  const navigate = useNavigate();
  const id = talk.conversation?.id;
  const inMinAi = (search: URLSearchParams | string = '') => (id ? `/conversations/${id}${search}` : '/conversations');
  const close = () => talk.setCorner(false);
  return (
    <>
      <div style={CORNER}>
        <Button
          variant="primary"
          label="Fråga AI"
          icon={<Icon icon={SparklesIcon} />}
          elevation="med"
          aria-haspopup="dialog"
          onClick={() => talk.setCorner(true)}
        />
      </div>
      <Drawer isOpen={talk.corner} onOpenChange={talk.setCorner} side="end" width={480} label="Fråga AI">
        {/* Mounted only while open: the box has one handle for the whole app, and a hidden second box would take it. */}
        {talk.corner && (
          <Layout
            header={<DrawerHeader title="Fråga AI" onOpenChange={talk.setCorner} />}
            content={
              <LayoutContent isScrollable={false} padding={0}>
                <VStack height="100%" paddingInline={3}>
                  <ChatLayout
                    density="compact"
                    composer={
                      <VStack gap={2}>
                        {talk.open && id && (
                          <Text type="supporting" weight="medium">
                            <Link href={inMinAi()} color="primary" hasUnderline onClick={close}>
                              Fortsätt i Min AI
                            </Link>
                          </Text>
                        )}
                        <Composer place={talk.open ? 'conversation' : 'page'} about={talk.open ? undefined : about} />
                      </VStack>
                    }
                  >
                    {talk.open ? (
                      <Transcript
                        // A view an answer names opens beside the transcript in Min AI, where there is room for it.
                        onOpenView={view => {
                          close();
                          navigate(withView(inMinAi(), '', view));
                        }}
                        viewHref={view => withView(inMinAi(), '', view)}
                        // A card an answer is about is named with the way to it on the start page; the panel draws no card.
                        renderCard={thread => (
                          <Text as="p">
                            <Link href={withCard('/', '', thread.id)} hasUnderline onClick={close}>
                              {thread.title}
                            </Link>
                          </Text>
                        )}
                      />
                    ) : (
                      <EmptyState
                        isCompact
                        headingLevel={3}
                        icon={<Icon icon={SparklesIcon} size="lg" />}
                        title="Vad vill du göra?"
                        description={
                          about
                            ? `Fråga om ${about.label}, eller om något annat.`
                            : 'Skriv eller säg vad du vill göra. Svaret kommer här.'
                        }
                      />
                    )}
                  </ChatLayout>
                </VStack>
              </LayoutContent>
            }
          />
        )}
      </Drawer>
    </>
  );
}
