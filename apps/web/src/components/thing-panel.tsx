import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { Thread, ViewRef } from '@clew/contracts';
import { Button, ChatLayout, Icon, SparklesIcon, VStack } from '@clew/ui';
import { viewSearch, withAsk, withCard } from '../panel-address';
import {
  ConversationContext,
  useModelConfigured,
  type ThingConversation,
  type ThingSubject,
} from './conversation-context';
import { Transcript, type ActionDraftRef } from './conversation';
import { Composer } from './composer';
import { cardBody } from './card-panel';
import { HeadSlot } from './thing-head';

/**
 * "Fråga Clew" (D112 item 7, boards Assistant and Calendar) in a page's header: the panel opens with the page itself as
 * the thing it is about ("Fråga om veckan" on Kalender). The address says so (`ask=1`), so the panel is there after a
 * reload and the back button closes it. Without a model there is nothing to ask, and the button is not drawn (D8).
 * `onAsk` is a page that already has the thing beside it with its box (Att göra's reading pane): the box takes the focus.
 */
export function AskClew({
  label = 'Fråga Clew',
  onAsk,
  size = 'md',
}: {
  label?: string;
  onAsk?: (() => void) | undefined;
  /** The size of the controls beside it: Kalender's header is `sm`, a work item's buttons are `lg`. */
  size?: 'sm' | 'md' | 'lg';
}) {
  const model = useModelConfigured();
  const { pathname, search } = useLocation();
  if (!model) return null;
  const icon = <Icon icon={SparklesIcon} />;
  return onAsk ? (
    <Button size={size} variant="secondary" label={label} icon={icon} onClick={onAsk} />
  ) : (
    <Button size={size} variant="secondary" label={label} icon={icon} href={withAsk(pathname, search)} />
  );
}

/** Whether a work item is drawn on the page now (`WorkItem`'s article: `card-<id>` beside a page, `thread-<id>` in a turn). */
export const drawn = (threadId: string) =>
  !!document.getElementById('card-' + threadId) || !!document.getElementById('thread-' + threadId);

/**
 * The thing and the conversation about it in one panel (D112 item 7, boards Calendar and Assistant, the `ChatLayout`
 * panel view): the thing's head on top and out of the scroll (`useThingHead`), its facts under it and folded while a
 * conversation runs, the transcript under them, and the box docked at the foot by ChatLayout, which owns the scroll and
 * keeps the newest answer above the box. On a short screen (1.4.10) nothing is docked: the thing, the transcript and
 * the box follow one another and the panel scrolls.
 * The box and the transcript read the thing's own conversation; they are the landing's box and transcript, provided
 * with it. An answer's view is shown beside the conversation on its own page, where a long exchange continues, and the
 * work item an answer names is drawn in the turn unless it is the thing itself.
 */
export function ThingWithConversation({
  talk,
  subject,
  thing,
  short,
  inset = 6,
}: {
  talk: ThingConversation;
  subject: ThingSubject;
  thing: ReactNode;
  short: boolean;
  /** The panel's own inset, which the transcript and the box keep. */
  inset?: 3 | 6;
}) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const conversationId = talk.conversation?.id;
  const subjectThread = subject.chips.find(c => c.kind === 'thread')?.threadId;
  const openView = (view: ViewRef) => {
    if (conversationId) navigate(`/conversations/${conversationId}${viewSearch(view)}`);
  };
  const renderCard = (t: Thread) =>
    t.id === subjectThread ? null : cardBody(t, { place: 'answer', level: 3, compact: true, onChange: () => {} });
  // A draft about an item that is drawn nowhere on the page is opened beside it, where its dialog then opens.
  const onDraft = (draft: ActionDraftRef) => {
    if (draft.threadId !== subjectThread && !drawn(draft.threadId))
      navigate(withCard(pathname, search, draft.threadId));
  };
  const transcript = (
    <Transcript
      place="panel"
      subject={subject.chips.map(c => c.ref)}
      onOpenView={openView}
      renderCard={renderCard}
      viewHref={v => (conversationId ? `/conversations/${conversationId}${viewSearch(v)}` : viewSearch(v))}
      onDraft={onDraft}
    />
  );
  const box = <Composer place="thing" about={{ label: subject.label, chips: subject.chips, search: subject.search }} />;
  // While a conversation runs the thing's head is docked above ChatLayout, which owns the scroll of what is under it
  // (D112 gap 10: its panel view has no slot above the messages): the stack gives ChatLayout what the head leaves of the
  // panel's height. Before anything is asked there is no transcript to push the thing away, and it is drawn whole.
  const [head, setHead] = useState<HTMLElement | null>(null);
  const docked = head && talk.running ? { slot: head, inset } : null;
  return (
    <ConversationContext.Provider value={talk}>
      {short ? (
        <VStack gap={5}>
          {thing}
          {transcript}
          {box}
        </VStack>
      ) : (
        <VStack height="100%">
          <VStack ref={setHead} />
          <ChatLayout density="compact" composer={<VStack paddingInline={inset === 6 ? 3 : 0}>{box}</VStack>}>
            <VStack gap={5} paddingInline={inset} paddingBlockStart={inset}>
              <HeadSlot.Provider value={docked}>{thing}</HeadSlot.Provider>
              {transcript}
            </VStack>
          </ChatLayout>
        </VStack>
      )}
    </ConversationContext.Provider>
  );
}
