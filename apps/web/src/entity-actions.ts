import { createElement, useCallback, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { AskValues, EntityAction, EntityKind } from '@clew/contracts';
import { useAnnounce, type MoreMenu } from '@clew/ui';
import { api } from './api';
import { opensDialog } from './action-path';
import { requestAction } from './action-requests';
import { ActionDialog } from './components/action-dialog';
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
  /** The action dialog of a propose that asks (D111 item 10); the page renders it wherever it renders the buttons. */
  dialog: ReactNode;
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
  const { start, busy, error, reset } = useEntityStart();
  // A propose that asks is filled in before it starts (D111 item 10): its dialog, and what the person typed per action
  // and entity while the page stays, so a closed and reopened dialog keeps it.
  const [asking, setAsking] = useState<{ action: EntityAction; subject: ActionSubject; open: boolean } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AskValues>>({});
  const draftKey = (action: EntityAction, subject: ActionSubject) =>
    `${subject.kind ?? 'person'}:${subject.key}:${action.capability}`;
  const run = useCallback(
    (action: EntityAction, subject: ActionSubject) => {
      const kind = subject.kind ?? 'person';
      if (action.kind === 'propose' && opensDialog(action)) {
        setAsking({ action, subject, open: true });
        return;
      }
      void start(() => api.entities.start(kind, subject.key, action.capability), { kind, key: subject.key }).then(
        started => {
          if (!started) return;
          if ('threadId' in started) {
            // An execute's answers are given at its decision (D111): its work item opens beside the page with the dialog
            // over it, on the item's own button.
            if (action.kind === 'execute' && opensDialog(action))
              requestAction({ threadId: started.threadId, actionId: 'decide' });
            navigate(withCard(here.current.pathname, here.current.search, started.threadId));
          } else announce(started.error);
        },
      );
    },
    [start, navigate, announce],
  );
  /** The propose with its answers: the work item it drafts opens beside the page; a refusal stays in the dialog. */
  const send = async (values: AskValues): Promise<string | null> => {
    if (!asking) return null;
    const { action, subject } = asking;
    const kind = subject.kind ?? 'person';
    const started = await start(() => api.entities.start(kind, subject.key, action.capability, values), {
      kind,
      key: subject.key,
    });
    if (!started) return null;
    if ('error' in started) {
      // The dialog places the refusal; the page does not say it a second time.
      reset();
      return started.error;
    }
    setAsking({ ...asking, open: false });
    setDrafts(({ [draftKey(action, subject)]: _sent, ...rest }) => rest);
    navigate(withCard(here.current.pathname, here.current.search, started.threadId));
    return null;
  };
  const dialog = asking
    ? createElement(ActionDialog, {
        target: {
          kind: 'entity',
          entity: { kind: asking.subject.kind ?? 'person', key: asking.subject.key, name: asking.subject.name },
          action: asking.action,
        },
        isOpen: asking.open,
        onOpenChange: open => {
          if (!open) setAsking({ ...asking, open: false });
        },
        values: drafts[draftKey(asking.action, asking.subject)] ?? {},
        onValuesChange: values => setDrafts(d => ({ ...d, [draftKey(asking.action, asking.subject)]: values })),
        onSend: send,
      })
    : null;
  return { start: run, error, busy, dialog };
}
