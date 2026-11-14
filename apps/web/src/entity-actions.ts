import { createElement, useCallback, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { AskValues, EffectPreview, EntityAction, EntityActionStarted, EntityKind } from '@clew/contracts';
import { sessionFetch, type MoreMenu } from '@clew/ui';
import { api } from './api';
import { ApiError } from './api-error';
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

/**
 * Where what the person typed in a propose's dialog is kept while the page stays (D112 item 10): per entity and action,
 * and per the answers the dialog was started from (a plan's row tied to the action with them, D124), so a row's answers
 * fill its own dialog and never another row's, while a dialog closed and opened again from the same row or button keeps
 * what was typed. A start without answers (a person's page, Personal's row menu) is keyed as it always was.
 */
export function askDraftKey(action: Pick<EntityAction, 'capability'>, subject: ActionSubject, preset?: AskValues) {
  const base = `${subject.kind ?? 'person'}:${subject.key}:${action.capability}`;
  const answers = preset ? Object.entries(preset).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : [];
  return answers.length ? `${base}?${JSON.stringify(answers)}` : base;
}
/** The drafts with a dialog's starting answers filled in where nothing was typed under its key yet. */
export const withPreset = (
  drafts: Readonly<Record<string, AskValues>>,
  key: string,
  preset: AskValues | undefined,
): Readonly<Record<string, AskValues>> => (preset && !drafts[key] ? { ...drafts, [key]: preset } : drafts);

/** Starting an action about an entity, and the source's refusal of the last one when it refused. */
export interface EntityActionStart {
  /**
   * Open the action dialog of `action` about `subject`. `values` are answers it starts from (a plan's item tied to the
   * action with them, D124): prefilled and still the person's to change, never sent before the dialog's last button.
   */
  start: (action: EntityAction, subject: ActionSubject, values?: AskValues) => void;
  /** The source's Swedish sentence, shown beside what started it until the next start. */
  error: string | null;
  busy: boolean;
  /** The action dialog (D112 item 10); the page renders it wherever it renders the buttons. */
  dialog: ReactNode;
}

/**
 * The two routes of an action about an entity that the dialog reaches and `api.entities` does not carry (D112, D126
 * item 7): what the action would write, read before anything exists, and an execute sent from the last button. Called
 * as `api.ts` calls every route: through the session's fetch, a refusal as the server's Swedish sentence.
 */
async function entityRoute<T>(
  route: 'effect' | 'decide',
  kind: EntityKind,
  key: string,
  capability: string,
  values: AskValues,
): Promise<T> {
  const response = await sessionFetch(`/api/entities/${kind}/${encodeURIComponent(key)}/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capability, values }),
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(response.status, 'Tjänsten svarade oväntat.');
  }
  if (!response.ok) throw new ApiError(response.status, (data as { error?: string }).error ?? 'Något gick fel.');
  return data as T;
}
/** "Det här händer" for an action about an entity before any work item exists: a read, nothing is written. */
const entityEffect = (kind: EntityKind, key: string, capability: string, values: AskValues) =>
  entityRoute<EffectPreview>('effect', kind, key, capability, values);
/** An execute about an entity sent from its dialog: its work item and its human decision, at once (D45). */
const entityDecide = (kind: EntityKind, key: string, capability: string, values: AskValues) =>
  entityRoute<EntityActionStarted>('decide', kind, key, capability, values);

/**
 * What the action dialog's last button sends for an action about an entity (D126 item 7), the only thing it sends: a
 * propose `drafts` its work item with the answers, which the person then decides on; an execute is `decided` at once,
 * its work item made with the human decision in it. Nothing goes before it, whatever the kind, so every action opens the
 * dialog first, also one that asks nothing, whose "Det här händer" is then the capability's own description.
 */
export const lastButton = (action: Pick<EntityAction, 'kind'>): 'drafts' | 'decided' =>
  action.kind === 'execute' ? 'decided' : 'drafts';
/**
 * Starting an action about an entity (D97, D8): every one opens the action dialog first, and nothing is created before
 * its last button (D126 item 7, the critique of 2026-11-14), so cancelling it leaves no trace. The dialog asks what the
 * action asks and says what will happen: an execute's own effect read, else the capability's description. The last
 * button sends it without the model: a propose drafts the work item the person then decides on, and an execute becomes
 * its work item with the human decision already made, the approved intent in the ledger before any source is reached
 * (D45). The work item then opens on its own page (D126 rule 1, `withCard`), with the page the action was started on as
 * its way back, so Back leaves the person where they were, with its tab and its search. A refusal stays in the dialog,
 * placed on the field it concerns.
 */
export function useEntityAction(): EntityActionStart {
  const navigate = useNavigate();
  const location = useLocation();
  const here = useRef(location);
  here.current = location;
  const { start, busy, error, reset } = useEntityStart();
  // The dialog, and what the person typed while the page stays (`askDraftKey`), so a closed and reopened dialog keeps it.
  const [asking, setAsking] = useState<{
    action: EntityAction;
    subject: ActionSubject;
    draft: string;
    open: boolean;
  } | null>(null);
  const [drafts, setDrafts] = useState<Readonly<Record<string, AskValues>>>({});
  const run = useCallback((action: EntityAction, subject: ActionSubject, values?: AskValues) => {
    const preset = values && Object.keys(values).length ? values : undefined;
    // What the person typed from this start before wins over its preset; the preset fills a dialog opened afresh.
    const draft = askDraftKey(action, subject, preset);
    setDrafts(d => withPreset(d, draft, preset));
    setAsking({ action, subject, draft, open: true });
  }, []);
  /** The action with its answers: the work item it makes opens on its page; a refusal stays in the dialog. */
  const send = async (values: AskValues): Promise<string | null> => {
    if (!asking) return null;
    const { action, subject, draft } = asking;
    const kind = subject.kind ?? 'person';
    const started = await start(
      () =>
        lastButton(action) === 'decided'
          ? entityDecide(kind, subject.key, action.capability, values)
          : api.entities.start(kind, subject.key, action.capability, values),
      { kind, key: subject.key },
    );
    if (!started) return null;
    if ('error' in started) {
      // The dialog places the refusal; the page does not say it a second time.
      reset();
      return started.error;
    }
    setAsking({ ...asking, open: false });
    setDrafts(({ [draft]: _sent, ...rest }) => rest);
    navigate(withCard(here.current.pathname, here.current.search, started.threadId));
    return null;
  };
  const dialog = asking
    ? createElement(ActionDialog, {
        target: {
          kind: 'entity',
          entity: { kind: asking.subject.kind ?? 'person', key: asking.subject.key, name: asking.subject.name },
          action: asking.action,
          readEffect: values =>
            entityEffect(asking.subject.kind ?? 'person', asking.subject.key, asking.action.capability, values),
        },
        isOpen: asking.open,
        onOpenChange: open => {
          if (!open) setAsking({ ...asking, open: false });
        },
        values: drafts[asking.draft] ?? {},
        onValuesChange: values => setDrafts(d => ({ ...d, [asking.draft]: values })),
        onSend: send,
      })
    : null;
  return { start: run, error, busy, dialog };
}
