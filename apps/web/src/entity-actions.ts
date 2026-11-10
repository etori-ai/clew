import { useCallback, type ComponentProps } from 'react';
import type { EntityAction } from '@clew/contracts';
import type { MoreMenu } from '@clew/ui';
import { useConversation } from './components/conversation-context';

/** One entry of an Astryx action menu (`MoreMenu`, `DropdownMenu`), as the data array takes it. */
type MenuOption = ComponentProps<typeof MoreMenu>['items'][number];
/** The entity an action is about: its key on the wire and the name a person reads. */
export interface ActionSubject {
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

/**
 * Starting an action about an entity (D97): a `propose` or `execute` runs through the human decision as every standing
 * action does ("Gör själv" asks in the box, and the answer is a card the person confirms). The web has no other way to
 * start a write with an input: the question names the action and the person, the person's key in brackets for the
 * action's `param`, and carries the capability as a chip, as a tool's page asks about its view. Nothing runs before the
 * person confirms on the card.
 */
export function useEntityAction(): (action: EntityAction, subject: ActionSubject) => void {
  const talk = useConversation();
  return useCallback(
    (action: EntityAction, subject: ActionSubject) =>
      talk.ask(`${action.title} för ${subject.name} (${subject.key})`, {
        chips: [{ ref: `capability:${action.capability}`, kind: 'capability', label: action.title }],
        search: '',
      }),
    [talk],
  );
}
