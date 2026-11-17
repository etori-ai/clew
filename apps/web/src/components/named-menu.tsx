import { useEffect, useMemo, useRef, type ComponentProps } from 'react';
import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AreaGlyph, DropdownMenu, Icon, IconButton, VisuallyHidden } from '@clew/ui';
import { areasQuery, threadsQuery } from '../queries';
import { useMarks } from '../marks';
import { leadsElsewhere, namedInConversation, type NamedSection } from '../conversation-named';
import { DOT } from '../dot';
import { readShown, rememberShown } from '../conversation-shown';
import { useConversation } from './conversation-context';

/** What Astryx hands the control a menu hangs off. */
type TriggerProps = Parameters<NonNullable<ComponentProps<typeof DropdownMenu>['renderTrigger']>>[0];
/** How long after a row is pressed the menu on the thing it led to still takes the focus. */
const CHOSEN_FOR_MS = 2000;
/**
 * When a row was last pressed. The thing a row leads to is drawn by another pane, so the menu that was pressed goes
 * with the thing it was on; the menu on the thing that now stands beside the transcript takes the focus in its place
 * (2.4.3), so the keyboard is where the person chose to be and never back at the top of the page.
 */
let chosenAt = 0;

/** Everything the conversation has named that can stand beside its transcript, by kind (`namedInConversation`). */
export function useNamed(): NamedSection[] {
  const talk = useConversation();
  const { pathname, search } = useLocation();
  const threads = useQuery(threadsQuery).data?.threads;
  const views = useQuery(areasQuery).data?.views;
  const marks = useMarks();
  const messages = talk.conversation?.messages;
  const conversationId = talk.conversation?.id;
  // What stands beside the transcript now is kept for the menu's next list, once it has been drawn there.
  useEffect(() => rememberShown(conversationId, search), [conversationId, search]);
  return useMemo(
    () =>
      namedInConversation(
        messages ?? [],
        { pathname, search },
        {
          views,
          source: capability => marks.system(capability.split('.')[0] ?? '')?.source ?? '',
          item: id => {
            const thread = threads?.find(t => t.id === id);
            if (!thread) return undefined;
            const mark = marks.ofThread(thread);
            return {
              title: thread.title,
              proposal: thread.proposals.length > 0,
              source: mark.source,
              ...(mark.icon ? { icon: mark.icon } : {}),
            };
          },
        },
        readShown(conversationId),
      ),
    [messages, conversationId, pathname, search, threads, views, marks],
  );
}

/**
 * The menu on the header of the pane beside a conversation (the product owner, 2026-11-17, after Eneo's panel): what
 * the conversation has named, by kind and with how many, each row the link to the same conversation with that thing
 * beside it and the one that stands there now checked. A menu on the pane, not a list in it: the pane still holds one
 * thing (D126 rule 2). Drawn only when it leads somewhere, so a conversation about one thing has no control that does
 * nothing.
 *
 * The same menu stands at the end of the conversation's header (`place="header"`, the product owner, 2026-11-17: with
 * the pane closed there was no way to it but a row in the transcript): a button that says how many work items and
 * views the conversation holds, there whether or not anything stands beside the transcript, so the pane can be opened
 * from it. Other systems' assistants are not in it: they have their own menu beside it.
 */
export function NamedMenu({ place = 'pane' }: { place?: 'pane' | 'header' }) {
  const named = useNamed();
  const header = place === 'header';
  const sections = header ? named.filter(s => s.id !== 'assistants') : named;
  const held = sections.reduce((n, s) => n + s.things.length, 0);
  const { search } = useLocation();
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // The header's button stays where it is and keeps the focus it has; only the pane's menu goes with its thing.
    if (header || Date.now() - chosenAt > CHOSEN_FOR_MS) return;
    chosenAt = 0;
    trigger.current?.focus();
  }, [header, search]);
  if (header ? held === 0 : !leadsElsewhere(sections)) return null;
  // The name holds the words on the button (2.5.3), with how many the conversation holds.
  const words = `I samtalet${DOT}${held}`;
  return (
    <DropdownMenu
      menuWidth={360}
      menuMaxHeight={520}
      alignment="end"
      {...(header
        ? { button: { label: words, children: words, variant: 'secondary' as const, size: 'sm' as const } }
        : {
            renderTrigger: ({ ref, ...props }: TriggerProps) => (
              <IconButton
                {...props}
                ref={el => {
                  trigger.current = el;
                  ref(el);
                }}
                label="Annat i samtalet"
                variant="ghost"
                icon={<Icon icon="chevronDown" size="sm" />}
              />
            ),
          })}
      items={sections.map(s => ({
        type: 'section' as const,
        id: s.id,
        title: s.title,
        items: s.things.map(t => ({
          id: t.key,
          label: t.label,
          description: t.detail,
          href: t.href,
          onClick: () => {
            if (!header) chosenAt = Date.now();
          },
          ...(t.icon ? { icon: <AreaGlyph icon={t.icon} /> } : {}),
          ...(t.current
            ? {
                endContent: (
                  <>
                    <Icon icon="check" size="sm" />
                    <VisuallyHidden>Visas nu</VisuallyHidden>
                  </>
                ),
              }
            : {}),
        })),
      }))}
    />
  );
}
