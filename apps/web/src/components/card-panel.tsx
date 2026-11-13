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
  /**
   * A conversation about the item runs under it (D112 item 7): its main column folds under "Visa allt", and its header
   * with the status and the buttons stays.
   */
  folded?: boolean;
  /**
   * Where the item can be let go of (Att göra's reading pane): its ✕ stands in the item's own header row, beside "Öppna
   * som sida", not in a row of its own above it.
   */
  onClose?: () => void;
}

/**
 * One work item, drawn the same wherever it is open at its narrow width (D112 item 4): in Att göra's reading pane,
 * beside a page or over it in the panel (`page-panel.tsx`) and in a conversation's answer. The items read the same cache
 * (D33), so a decision made in one place is the decision made everywhere: the same confirm, the same decision endpoint,
 * the same receipt. The calendar's proposals keep their own card (D112 item 9: the calendar is not redesigned); every
 * other item is `WorkItem`.
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
      folded={!!place.folded}
      {...(place.onClose ? { onClose: place.onClose } : {})}
    />
  );
