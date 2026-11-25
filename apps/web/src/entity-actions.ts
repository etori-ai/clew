import { createElement, useCallback, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type {
  AskValues,
  EffectPreview,
  EntityAction,
  EntityActionStarted,
  EntityKind,
  RecordAction,
  RecordDraftRef,
} from '@clew/contracts';
import { sessionFetch, type MoreMenu } from '@clew/ui';
import { api } from './api';
import { ApiError } from './api-error';
import type { ActionStep } from './action-path';
import { ActionDialog } from './components/work/action-dialog';
import { useEntityStart } from './mutations';
import { withCard } from './panel-address';
import { keys } from './query-keys';
import { recordSubjectKey } from './record-actions';

/** One entry of an Astryx action menu (`MoreMenu`, `DropdownMenu`), as the data array takes it. */
type MenuOption = ComponentProps<typeof MoreMenu>['items'][number];
/**
 * What an action is about, with the name a person reads: an entity by its kind (a person unless said) and its key on
 * the wire, or a record (D137) by its read and the input its page made it with.
 */
export type ActionSubject =
  | { kind?: EntityKind; key: string; name: string }
  | { kind: 'record'; read: string; input: Record<string, unknown>; name: string };
/** An action about an entity (D97) or about a record (D137): both run the one way, through the action dialog. */
export type SubjectAction = EntityAction | RecordAction;
/** The subject as caches and the dialog key it: an entity's kind and key, or `record` and the record's read and input. */
export const subjectKey = (subject: ActionSubject): { kind: EntityKind | 'record'; key: string } =>
  subject.kind === 'record'
    ? { kind: 'record', key: recordSubjectKey(subject.read, subject.input) }
    : { kind: subject.kind ?? 'person', key: subject.key };

/** The actions about an entity grouped by the system they act in, in the order the systems first appear (D97, artboard A3). */
export function actionGroups<A extends Pick<SubjectAction, 'source'>>(
  actions: readonly A[],
): Array<{ source: string; actions: A[] }> {
  const groups = new Map<string, A[]>();
  for (const a of actions) groups.set(a.source, [...(groups.get(a.source) ?? []), a]);
  return [...groups].map(([source, list]) => ({ source, actions: list }));
}

/**
 * The actions as the rows of an action menu: one section per system, titled with the system's name, as the row menu on
 * Personal draws them (artboard A3) and "Fler" on the opened person.
 */
export function actionMenuItems<A extends Pick<SubjectAction, 'source' | 'capability' | 'title'>>(
  actions: readonly A[],
  start: (action: A) => void,
): MenuOption[] {
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
export function askDraftKey(action: Pick<SubjectAction, 'capability'>, subject: ActionSubject, preset?: AskValues) {
  const { kind, key } = subjectKey(subject);
  const base = `${kind}:${key}:${action.capability}`;
  const answers = preset ? Object.entries(preset).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : [];
  return answers.length ? `${base}?${JSON.stringify(answers)}` : base;
}
/** The drafts with a dialog's starting answers filled in where nothing was typed under its key yet. */
export const withPreset = (
  drafts: Readonly<Record<string, AskValues>>,
  key: string,
  preset: AskValues | undefined,
): Readonly<Record<string, AskValues>> => (preset && !drafts[key] ? { ...drafts, [key]: preset } : drafts);

/** Starting an action about an entity or a record; a source's refusal is said in the action dialog, never by the page (D126 item 7). */
export interface EntityActionStart {
  /**
   * Open the action dialog of `action` about `subject`. `values` are answers it starts from (a plan's item tied to the
   * action with them, D124; an assistant's filled-in action, D138 item 8): prefilled and still the person's to change,
   * never sent before the dialog's last button. `startAt` is the step it opens at ("Granska och skicka": `effect`).
   * `from`: the assistant's draft about a record the dialog is opened from (D137), named to the server with what the
   * last button sends, so that the draft is marked as sent with the work item it becomes.
   */
  start: (
    action: SubjectAction,
    subject: ActionSubject,
    values?: AskValues,
    startAt?: ActionStep,
    from?: RecordDraftRef,
  ) => void;
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
 * The three routes an action's dialog reaches for its subject: "Det här händer", an execute's decision and a propose's
 * start. For a record (D137) they name it by its read and input, where an entity's are named by its kind and key, and a
 * decision or a start names the assistant's draft it was sent from (`from`).
 */
function routesOf(subject: ActionSubject, capability: string, from?: RecordDraftRef) {
  if (subject.kind === 'record') {
    const { read, input } = subject;
    return {
      effect: (values: AskValues) => api.records.effect(read, input, capability, values),
      decide: (values: AskValues) => api.records.decide(read, input, capability, values, from),
      start: (values: AskValues) => api.records.start(read, input, capability, values, from),
    };
  }
  const kind = subject.kind ?? 'person';
  return {
    effect: (values: AskValues) => entityEffect(kind, subject.key, capability, values),
    decide: (values: AskValues) => entityDecide(kind, subject.key, capability, values),
    start: (values: AskValues) => api.entities.start(kind, subject.key, capability, values),
  };
}

/**
 * What the action dialog's last button sends for an action about an entity (D126 item 7), the only thing it sends: a
 * propose `drafts` its work item with the answers, which the person then decides on; an execute is `decided` at once,
 * its work item made with the human decision in it. Nothing goes before it, whatever the kind, so every action opens the
 * dialog first, also one that asks nothing, whose "Det här händer" is then the capability's own description.
 */
export const lastButton = (action: Pick<SubjectAction, 'kind'>): 'drafts' | 'decided' =>
  action.kind === 'execute' ? 'decided' : 'drafts';
/**
 * Starting an action about an entity (D97, D8) or a record (D137): every one opens the action dialog first, and nothing
 * is created before its last button (D126 item 7, the critique of 2026-11-14), so cancelling it leaves no trace. The
 * dialog asks what the action asks and says what will happen: an execute's own effect read, else the capability's
 * description. The last button sends it without the model: a propose drafts the work item the person then decides on,
 * and an execute becomes its work item with the human decision already made, the approved intent in the ledger before
 * any source is reached (D45). The work item then opens on its own page (D126 rule 1, `withCard`), with the page the
 * action was started on as its way back, so Back leaves the person where they were, with its tab and its search; a
 * record's read is read again when its page is next drawn, so it shows what the action changed. A refusal stays in the
 * dialog, placed on the field it concerns.
 */
export function useEntityAction(): EntityActionStart {
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  const here = useRef(location);
  here.current = location;
  const { start, busy, reset } = useEntityStart();
  // The dialog, and what the person typed while the page stays (`askDraftKey`), so a closed and reopened dialog keeps it.
  const [asking, setAsking] = useState<{
    action: SubjectAction;
    subject: ActionSubject;
    draft: string;
    open: boolean;
    startAt?: ActionStep;
    from?: RecordDraftRef;
  } | null>(null);
  const [drafts, setDrafts] = useState<Readonly<Record<string, AskValues>>>({});
  const run = useCallback(
    (
      action: SubjectAction,
      subject: ActionSubject,
      values?: AskValues,
      startAt?: ActionStep,
      from?: RecordDraftRef,
    ) => {
      const preset = values && Object.keys(values).length ? values : undefined;
      // What the person typed from this start before wins over its preset; the preset fills a dialog opened afresh.
      const draft = askDraftKey(action, subject, preset);
      setDrafts(d => withPreset(d, draft, preset));
      setAsking({ action, subject, draft, open: true, ...(startAt ? { startAt } : {}), ...(from ? { from } : {}) });
    },
    [],
  );
  /** The action with its answers: the work item it makes opens on its page; a refusal stays in the dialog. */
  const send = async (values: AskValues): Promise<string | null> => {
    if (!asking) return null;
    const { action, subject, draft, from } = asking;
    const routes = routesOf(subject, action.capability, from);
    const started = await start(
      () => (lastButton(action) === 'decided' ? routes.decide(values) : routes.start(values)),
      subjectKey(subject),
    );
    if (!started) return null;
    if ('error' in started) {
      // The dialog places the refusal; the page does not say it a second time.
      reset();
      return started.error;
    }
    // The record's page, drawn again on the way back, reads the record again: the write may still be on its way now.
    if (subject.kind === 'record')
      void client.invalidateQueries({ queryKey: keys.viewRead(subject.read), refetchType: 'none' });
    // The conversation the draft stands in is read again: it says the draft was sent, and offers no second send.
    if (from) void client.invalidateQueries({ queryKey: keys.thread(from.conversationId) });
    setAsking({ ...asking, open: false });
    setDrafts(({ [draft]: _sent, ...rest }) => rest);
    navigate(withCard(here.current.pathname, here.current.search, started.threadId));
    return null;
  };
  const dialog = asking
    ? createElement(ActionDialog, {
        target: {
          kind: 'entity',
          entity: { ...subjectKey(asking.subject), name: asking.subject.name },
          action: asking.action,
          readEffect: routesOf(asking.subject, asking.action.capability).effect,
        },
        isOpen: asking.open,
        onOpenChange: open => {
          if (!open) setAsking({ ...asking, open: false });
        },
        ...(asking.startAt ? { startAt: asking.startAt } : {}),
        values: drafts[asking.draft] ?? {},
        onValuesChange: update => setDrafts(d => ({ ...d, [asking.draft]: update(d[asking.draft] ?? {}) })),
        onSend: send,
      })
    : null;
  return { start: run, busy, dialog };
}
