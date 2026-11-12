import type { Ask, AskValues, AuthenticatedContext, Thread } from '@clew/contracts';
import { actorOf, answersOf, asksFor, givenBy } from '@clew/connectors';
import type { AssistantDeps } from './ports';
import type { ClewTool } from './model';

/**
 * The assistant drafts, the person decides (D112 item 8). With exactly one work item as the conversation's subject the
 * model may fill in one of the item's actions that asks the person for something: which action and the values for its
 * asks. The values are checked against the asks the way the decision checks them (`answersOf`), the draft is kept in the
 * conversation's message, and nothing is executed: the person opens the draft in the action's own dialog and sends it
 * from there, through the human decision endpoint, which checks everything again. The tool is Clew's own and writes
 * nothing; an execute is never a tool and the decision endpoint is never reached from here.
 */
export const DRAFT_TOOL = 'clew.draftAction';

/** An action on the work item the assistant may fill in, with what it asks. */
export interface DraftableAction {
  id: string;
  label: string;
  capability: string;
  asks: Ask[];
  /** The capability's input schema, whose property limits the values are held to. */
  input: unknown;
}
/** What the model filled in: the action and the checked values. */
export interface ActionDraft {
  actionId: string;
  values: AskValues;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const VALUE_MAX = 4000;

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
  const actor = actorOf(persona);
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

/** How the model is to write one answer: the kind's form in words, for the tool's schema. */
function hint(ask: Ask): string {
  const required = ask.required ? ' Krävs.' : '';
  switch (ask.kind) {
    case 'meeting':
      return `${ask.label}: starttiden som ISO 8601 med tidszon, ett möte på ${ask.durationMinutes} minuter.${required}`;
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
 * with the Swedish reason, so the model can correct it; nothing is kept of it.
 */
export function draftTool(actions: DraftableAction[], now: string, drafted: (draft: ActionDraft) => void): ClewTool {
  const properties: Record<string, { type: 'string'; description: string }> = {};
  for (const action of actions)
    for (const ask of action.asks) properties[ask.property] ??= { type: 'string', description: hint(ask) };
  return {
    name: DRAFT_TOOL,
    description:
      'Fyll i en av ärendets åtgärder som ett utkast åt personen. Ingenting skickas eller sparas i något system: personen ' +
      'granskar utkastet och skickar det själv med åtgärdens knapp. Åtgärder: ' +
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
      if (!action) return { error: 'Ärendet har ingen sådan åtgärd.' };
      const given = isRecord(input.values) ? input.values : {};
      const values: AskValues = {};
      for (const [key, value] of Object.entries(given)) {
        if (typeof value !== 'string') return { error: 'Varje värde ska vara text.' };
        if (value.length > VALUE_MAX) return { error: 'Ett värde är för långt.' };
        values[key] = value;
      }
      const answered = answersOf(action.asks, values, now, action.input);
      if ('problem' in answered) return { error: answered.problem };
      drafted({ actionId: action.id, values: answered.answers });
      return { drafted: true, note: 'Utkastet visas för personen. Inget är skickat.' };
    },
  };
}
