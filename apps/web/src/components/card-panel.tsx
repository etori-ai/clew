import type { Thread } from '@clew/contracts';
import { GenericCard } from './card';
import { ThreadCard } from './thread';

/** How a card is drawn where it is open: its heading's level and the surface it stands on. */
export interface CardPlace {
  level?: 2 | 3;
  /** In the panel beside the page: the panel is the card's border, and its header holds what is open and ✕ (D66). */
  beside?: boolean;
  /** A proposal's times as rows rather than the week (`ThreadCard`). */
  compact?: boolean;
  /** In the phone's sheet (artboard 12): the chip on its own line, the next step and the secondary actions full width. */
  sheet?: boolean;
  /** After a receipt (D70): the way on from the done card, where the page has a stream to continue in. */
  next?: { title: string; href: string } | undefined;
  onChange: (thread: Thread) => void;
}

/**
 * One card, drawn by the components Hem draws it with wherever it is open: beside a page or over it in the panel
 * (`page-panel.tsx`), in Hem's sheet on a phone and in a conversation's turn. A proposal keeps the calendar's
 * specialised card; every other card is the generic one. The cards read the same cache (D33), so a decision made on one
 * page is the decision made on Hem: the same confirm, the same decision endpoint, the same receipt. A card's own read
 * unfolds inside it wherever it is drawn (`card-read.tsx`).
 */
export const cardBody = (thread: Thread, place: CardPlace) =>
  thread.proposals.length ? (
    <ThreadCard
      key={thread.id}
      thread={thread}
      compact={!!place.compact}
      headingLevel={place.level ?? 3}
      beside={!!place.beside}
      onChange={place.onChange}
    />
  ) : (
    <GenericCard
      key={thread.id}
      thread={thread}
      headingLevel={place.level ?? 3}
      beside={!!place.beside}
      sheet={!!place.sheet}
      next={place.next}
      onChange={place.onChange}
    />
  );
