import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button, Icon, SparklesIcon } from '@clew/ui';
import { addressChipRefs } from '../../conversation-about';
import { useConversation, useModelConfigured, type ThingSubject } from './conversation-context';

/**
 * Where "Fråga assistenten" leads (D126 rule 5): a new conversation's page with the thing beside it (its part of the address,
 * `subject.search`). Nothing is asked there until the person writes.
 */
export const askAboutHref = (subject: ThingSubject): string => `/conversations/new${subject.search}`;
/**
 * "Fråga assistenten" as a verb (D126 rule 5): a new conversation, its page with the thing beside it, and the page it was
 * pressed on as where Esc leads back to. The thing beside the transcript goes with every question by its address; a
 * subject with nothing beside it (the queue's rows, a meeting) goes as chips in the box's drawer. Nothing is asked until
 * the person writes and sends (D111 rule 9: opening never asks the model).
 */
export function useAskAbout(): (subject: ThingSubject, options?: { replace?: boolean }) => void {
  const talk = useConversation();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  return useCallback(
    (subject, options) => {
      talk.newConversation({ from: pathname + search, stay: true });
      const beside = new Set(addressChipRefs(subject.search));
      subject.chips.filter(chip => !beside.has(chip.ref)).forEach(chip => talk.addChip(chip));
      navigate(askAboutHref(subject), options?.replace ? { replace: true } : undefined);
    },
    [talk, navigate, pathname, search],
  );
}

/**
 * "Fråga assistenten" (D126 rule 5, boards Ärende and Person): the one button every page uses to ask about its thing, a ghost
 * with the sparkles among the thing's actions, leading to a new conversation with that thing beside it
 * (`useAskAbout`). Nothing is asked until the person writes. Until the page knows its thing, and without a model to ask
 * (D8), the button is not drawn. `onAsk` replaces the whole verb, for a page that asks otherwise.
 */
export function AskClew({
  label = 'Fråga assistenten',
  onAsk,
  subject,
  size = 'md',
}: {
  label?: string;
  onAsk?: (() => void) | undefined;
  /** What the conversation is about: its part of the conversation page's address, or its chips. */
  subject?: ThingSubject | null | undefined;
  /** The size of the controls beside it: Kalender's header is `sm`. */
  size?: 'sm' | 'md' | 'lg';
}) {
  const model = useModelConfigured();
  const askAbout = useAskAbout();
  const ask = onAsk ?? (subject ? () => askAbout(subject) : undefined);
  if (!model || !ask) return null;
  return (
    <Button size={size} variant="ghost" label={label} icon={<Icon icon={SparklesIcon} size="sm" />} onClick={ask} />
  );
}

/** Whether a work item is drawn on the page now (`WorkItem`'s article: `card-<id>` beside a page, `thread-<id>` in a turn). */
export const drawn = (threadId: string) =>
  !!document.getElementById('card-' + threadId) || !!document.getElementById('thread-' + threadId);
