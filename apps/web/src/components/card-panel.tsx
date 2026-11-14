import type { ReactNode } from 'react';
import type { Thread } from '@clew/contracts';
import { Card } from '@clew/ui';
import { WorkItem, type ItemPlace } from './work-item';
import { ThreadCard } from './thread';

/** Where a work item is drawn at its narrow width, and its title's level there. */
export interface CardPlace {
  place: ItemPlace;
  level: 2 | 3;
  /** A proposal's times as rows rather than the week (`ThreadCard`). */
  compact?: boolean;
  onChange: (thread: Thread) => void;
  /** Kept for the callers from before D126: nothing folds under a conversation any more (rule 5). */
  folded?: boolean;
  /**
   * Where the item can be let go of (Att göra's reading pane): its ✕ stands at the end of the item's own header row,
   * not in a row of its own above it.
   */
  onClose?: () => void;
  /** "Fråga Clew" among the item's buttons (`AskClew`, D126 rule 5). */
  ask?: ReactNode;
}

/**
 * One work item, drawn the same wherever it is open at its narrow width (D126 rule 2): in Att göra's reading pane,
 * beside a conversation (`page-panel.tsx`) and in a conversation's answer. The items read the same cache (D33), so a
 * decision made in one place is the decision made everywhere: the same confirm, the same decision endpoint, the same
 * receipt. The calendar's proposals keep their own card (D27, D112 item 9); every other item is `WorkItem`.
 */
export const cardBody = (thread: Thread, place: CardPlace) =>
  thread.proposals.length ? (
    <ThreadCard
      key={thread.id}
      thread={thread}
      compact={!!place.compact}
      headingLevel={place.level}
      beside={place.place !== 'answer'}
      onChange={place.onChange}
    />
  ) : place.place === 'answer' ? (
    // In an answer the item is one discrete thing among the turn's words (Astryx: a Card is a discrete item).
    <Card key={thread.id} padding={4}>
      <WorkItem thread={thread} place="answer" headingLevel={place.level} onChange={place.onChange} />
    </Card>
  ) : (
    <WorkItem
      key={thread.id}
      thread={thread}
      place={place.place}
      headingLevel={place.level}
      onChange={place.onChange}
      {...(place.onClose ? { onClose: place.onClose } : {})}
      {...(place.ask ? { ask: place.ask } : {})}
    />
  );
