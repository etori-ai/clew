import { useCallback, useRef, type ComponentProps } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { EntityAction, EntityKind } from '@clew/contracts';
import { useAnnounce, type MoreMenu } from '@clew/ui';
import { api } from './api';
import { useEntityStart } from './mutations';
import { withCard } from './panel-address';

/** One entry of an Astryx action menu (`MoreMenu`, `DropdownMenu`), as the data array takes it. */
type MenuOption = ComponentProps<typeof MoreMenu>['items'][number];
/** The entity an action is about: its kind (a person unless said), its key on the wire and the name a person reads. */
export interface ActionSubject {
  kind?: EntityKind;
  key: string;
  name: string;
}

/** The actions about an entity grouped by the system they act in, in the order the systems first appear (D97, artboard A3). */
export function actionGroups(actions: EntityAction[]): Array<{ source: string; actions: EntityAction[] }> {
  const groups = new Map<string, EntityAction[]>();
  for (const a of actions) groups.set(a.source, [...(groups.get(a.source) ?? []), a]);
  return [...groups].map(([source, list]) => ({ source, actions: list }));
}

/**
 * The actions as the rows of an action menu: one section per system, titled with the system's name, as the row menu on
 * Personal draws them (artboard A3) and "Fler" on the opened person.
 */
export function actionMenuItems(actions: EntityAction[], start: (action: EntityAction) => void): MenuOption[] {
  return actionGroups(actions).map(g => ({
    type: 'section' as const,
    id: g.source,
    title: g.source,
    items: g.actions.map(a => ({ id: a.capability, label: a.title, onClick: () => start(a) })),
  }));
}

/** Starting an action about an entity, and the source's refusal of the last one when it refused. */
export interface EntityActionStart {
  start: (action: EntityAction, subject: ActionSubject) => void;
  /** The source's Swedish sentence, shown beside what started it until the next start. */
  error: string | null;
  busy: boolean;
}
/**
 * Starting an action about an entity (D97, D8): the server starts it on the entity's key without the model and answers
 * the card the person decides on; nothing reaches the source's write before that decision. The card opens beside the
 * page the action was started on (D110 rule 4): that page's address with the card in its panel (`withCard`), beside the
 * page's column where both fit and over it where they do not, so starting something never takes the person away and
 * closing the card leaves the page as it was, with its lens, its section and a person's cards listed beside it. The
 * address is the page's when the start has answered, and the focus lands on the card's heading as on every card opened
 * in a panel. A refusal is said aloud once per start (4.1.3) and stays as `error` for the page to show beside the
 * control.
 */
export function useEntityAction(): EntityActionStart {
  const navigate = useNavigate();
  const location = useLocation();
  const here = useRef(location);
  here.current = location;
  const announce = useAnnounce();
  const { start, busy, error } = useEntityStart();
  const run = useCallback(
    (action: EntityAction, subject: ActionSubject) => {
      const kind = subject.kind ?? 'person';
      void start(() => api.entities.start(kind, subject.key, action.capability), { kind, key: subject.key }).then(
        started => {
          if (!started) return;
          if ('threadId' in started) navigate(withCard(here.current.pathname, here.current.search, started.threadId));
          else announce(started.error);
        },
      );
    },
    [start, navigate, announce],
  );
  return { start: run, error, busy };
}
