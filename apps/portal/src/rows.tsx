import { useNavigate } from 'react-router';
import type { Thread } from '@clew/contracts';
import { List } from '@clew/ui';
import { ThreadRow } from '../../web/src/components/card';
import { cardHref } from './hrefs';

const noop = () => undefined;

/**
 * Threads as rows (the web app's `ThreadRow`, D48, D63 item 6): the day, the title as the link to the card, the area
 * and the reason, and the one next step. In the portal a card is a page, so the title leads there and a read action's
 * view opens under the card on that page.
 */
export function ThreadRows({
  threads,
  areaTitle,
  notice,
}: {
  threads: Thread[];
  areaTitle: (area: string) => string;
  /** The threads that are for information only (händelse): the info mark instead of a day. */
  notice?: Set<string>;
}) {
  const navigate = useNavigate();
  return (
    <List hasDividers density="balanced" edge="flush">
      {threads.map(t => (
        <ThreadRow
          key={t.id}
          thread={t}
          areaTitle={areaTitle(t.area)}
          notice={notice?.has(t.id) ?? false}
          href={cardHref(t.id)}
          onChange={noop}
          onOpenCardView={(threadId, actionId) => navigate(cardHref(threadId, actionId))}
        />
      ))}
    </List>
  );
}
