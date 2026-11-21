import type { Ask, AskValues, AuthenticatedContext, RecordAction, Thread } from '@clew/contracts';
import { audiencedActorOf, answersOf, asksFor, givenBy } from '@clew/connectors';
import { recordActionOf } from '../modules/records/domain';
import { localInstant } from '@clew/calendar/dates';
import type { AssistantDeps } from './ports';
import type { ClewTool } from './model';

/**
 * The assistant drafts, the person decides (D112 item 8). With exactly one work item as the conversation's subject the
 * model may fill in one of the item's actions that asks the person for something: which action and the values for its
 * asks. The values are checked against the asks the way the decision checks them (`answersOf`), the draft is kept in the
 * conversation's message, and nothing is executed: the person opens the draft in the action's own dialog and sends it
 * from there, through the human decision endpoint, which checks everything again. The tool is Clew's own and writes
 * nothing; an execute is never a tool and the decision endpoint is never reached from here.
 *
 * With a record standing open on the page (D136), the same tool fills in one of the actions about that record (D137
 * item 4): the model picks the action and its values, never the record, which is the one that stands open; what the
 * record fills is not among the asks and cannot be given.
 */
export const DRAFT_TOOL = 'clew.draftAction';

/** An action on the work item, or about the record that stands open, the assistant may fill in, with what it asks. */
export interface DraftableAction {
  /** The work item's action id; for an action about a record, its capability. */
  id: string;
  label: string;
  capability: string;
  asks: Ask[];
  /** The capability's input schema, whose property limits the values are held to. */
  input: unknown;
  /** About a record (D137): the action as the person may take it now, for the answer's draft. */
  record?: RecordAction;
}
/** What the model filled in: the action and the checked values. */
export interface ActionDraft {
  actionId: string;
  values: AskValues;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const VALUE_MAX = 4000;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/;
/**
 * A meeting's start as the model writes it: a time in Swedish time without an offset, as the times it reads are given
 * in words (D122), becomes the instant the ask takes; a time that does not exist in Stockholm, or is ambiguous, stays
 * as written and is refused by the ask's own check. Anything else is left as it is.
 */
function meetingTime(value: string): string {
  if (!LOCAL_TIME.test(value)) return value;
  try {
    return localInstant(value.replace(' ', 'T'));
  } catch {
    return value;
  }
}

/**
 * The item's actions the person may take and that ask for something: a propose or an execute of the item's own
 * connector that the person's scope allows, on an open item with no decision on its way. An action reviewed one row at
 * a time keeps its review (D73) and is not drafted. A read is never drafted.
 */
export function draftableActions(
  registry: Pick<AssistantDeps['registry'], 'allowed'>,
  persona: AuthenticatedContext,
  thread: Thread,
): DraftableAction[] {
  if (thread.kind !== 'pushed' || thread.state !== 'open' || thread.receipt) return [];
  if (thread.execution && ['pending', 'running', 'unknown', 'partial'].includes(thread.execution.state)) return [];
  const actor = audiencedActorOf(persona);
  return thread.actions.flatMap(action => {
    if (action.kind === 'read') return [];
    const found = registry.allowed(actor, action.capability);
    if (!found || found.connector.id !== thread.connector) return [];
    if (found.capability.kind === 'read' || found.capability.review) return [];
    const asks = asksFor(found.capability, givenBy(found.capability, action));
    return asks.length
      ? [{ id: action.id, label: action.label, capability: action.capability, asks, input: found.capability.input }]
      : [];
  });
}

/**
 * The actions about the records of `read` the person may take and that ask for something (D137 item 4), by the
 * registry's index (`recordActions`): scope, audience and the connector switched on, as for any action. Under the same
 * limits as a work item's: an action that asks nothing has nothing to fill in, and a reviewed execute keeps its review.
 * Whether the person can make the record's read is the caller's to have found out.
 */
export function draftableRecordActions(
  registry: Pick<AssistantDeps['registry'], 'recordActions' | 'allowed'>,
  persona: AuthenticatedContext,
  read: string,
): DraftableAction[] {
  const actor = audiencedActorOf(persona);
  return registry.recordActions(actor, read).flatMap(action => {
    const found = registry.allowed(actor, action.name);
    if (!found || found.capability.kind === 'read' || found.capability.review || !action.path.asks.length) return [];
    return [
      {
        id: action.name,
        label: action.title,
        capability: action.name,
        asks: action.path.asks,
        input: found.capability.input,
        record: recordActionOf(action),
      },
    ];
  });
}

/** How the model is to write one answer: the kind's form in words, for the tool's schema. */
function hint(ask: Ask): string {
  const required = ask.required ? ' Krävs.' : '';
  switch (ask.kind) {
    case 'meeting':
      return `${ask.label}: starttiden i svensk tid som ÅÅÅÅ-MM-DDTHH:MM, till exempel 2026-11-16T09:00, ett möte på ${ask.durationMinutes} minuter.${required}`;
    case 'date':
      return `${ask.label}: ett datum, ÅÅÅÅ-MM-DD.${required}`;
    case 'choice':
      return `${ask.label}: ett av ${ask.options.map(o => `"${o.value}" (${o.label})`).join(', ')}.${required}`;
    default:
      return `${ask.label}: text.${required}`;
  }
}

/**
 * The tool the model drafts with. `now` decides whether a meeting time has passed, as the decision does; `drafted`
 * hears the one draft that passed (a later one in the same turn replaces it). A draft that does not pass is answered
 * with the Swedish reason, so the model can correct it; nothing is kept of it. `record` names the record that stands
 * open when the actions are about it (D137): the model is told it fills in the asks only, and the record is that one.
 */
export function draftTool(
  actions: DraftableAction[],
  now: string,
  drafted: (draft: ActionDraft) => void,
  record?: { title: string },
): ClewTool {
  const properties: Record<string, { type: 'string'; description: string }> = {};
  for (const action of actions)
    for (const ask of action.asks) properties[ask.property] ??= { type: 'string', description: hint(ask) };
  return {
    name: DRAFT_TOOL,
    description:
      (record
        ? `Fyll i en av åtgärderna för den öppna posten "${record.title}" som ett utkast åt personen. Du fyller bara i ` +
          'det åtgärden frågar efter; posten är den som står öppen bredvid samtalet och anges aldrig. Ingenting skickas ' +
          'eller sparas i något system: personen granskar utkastet och skickar det själv med åtgärdens knapp. Åtgärder: '
        : 'Fyll i en av ärendets åtgärder som ett utkast åt personen. Ingenting skickas eller sparas i något system: personen ' +
          'granskar utkastet och skickar det själv med åtgärdens knapp. Åtgärder: ') +
      actions
        .map(a => `"${a.id}" (${a.label}: ${a.asks.map(x => x.label + (x.required ? ', krävs' : '')).join('; ')})`)
        .join(', ') +
      '.',
    input: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: actions.map(a => a.id), description: 'Åtgärdens id.' },
        values: {
          type: 'object',
          description: 'Det åtgärden frågar efter, som text.',
          properties,
          additionalProperties: false,
        },
      },
      required: ['action', 'values'],
      additionalProperties: false,
    },
    execute: input => {
      const action = actions.find(a => a.id === input.action);
      if (!action) return { error: record ? 'Posten har ingen sådan åtgärd.' : 'Ärendet har ingen sådan åtgärd.' };
      const given = isRecord(input.values) ? input.values : {};
      const values: AskValues = {};
      for (const [key, value] of Object.entries(given)) {
        if (typeof value !== 'string') return { error: 'Varje värde ska vara text.' };
        if (value.length > VALUE_MAX) return { error: 'Ett värde är för långt.' };
        values[key] = action.asks.some(a => a.property === key && a.kind === 'meeting') ? meetingTime(value) : value;
      }
      const answered = answersOf(action.asks, values, now, action.input);
      if ('problem' in answered) return { error: answered.problem };
      drafted({ actionId: action.id, values: answered.answers });
      return { drafted: true, note: 'Utkastet visas för personen. Inget är skickat.' };
    },
  };
}
