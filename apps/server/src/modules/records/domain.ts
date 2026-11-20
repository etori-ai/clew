import type { RecordAboutAction } from '@clew/connectors';
import type { RecordAction, ThreadItem, View } from '@clew/contracts';

/**
 * The records module's pure part (D137): an action about one record as the browser gets it, what the record fills of
 * its input, and what the record is called where Clew names it. No I/O.
 */

/** The action as the record's page draws it: what it is, whose, and its way to the decision; never what the record fills. */
export const recordActionOf = (action: RecordAboutAction): RecordAction => ({
  capability: action.name,
  connector: action.connectorId,
  source: action.source,
  title: action.title,
  kind: action.kind,
  path: action.path,
  ...(action.core ? { own: true as const } : {}),
});

/**
 * What the record fills of the action's input (D137 item 3): each property `params` maps, from the read's input the
 * record's page was read with. Never from the person's answers, which name only what the action asks. A property the
 * record's input lacks is left out, and the capability's input schema decides whether the action can run without it.
 */
export function filledBy(params: Record<string, string>, input: Record<string, unknown>): Record<string, unknown> {
  const filled: Record<string, unknown> = {};
  for (const [property, from] of Object.entries(params))
    if (Object.prototype.hasOwnProperty.call(input, from) && input[from] !== undefined) filled[property] = input[from];
  return filled;
}

/** The longest name of a record Clew writes on a card. */
const LABEL_MAX = 200;
/**
 * What the record is called as its page heads it: the value of a `detail` or `record` view's title field when the read
 * answered it as text. Undefined for any other view, and for a title the answer does not give.
 */
export function recordLabel(view: View | undefined, output: unknown): string | undefined {
  if (!view || (view.kind !== 'detail' && view.kind !== 'record')) return undefined;
  const value = output && typeof output === 'object' ? (output as Record<string, unknown>)[view.title] : undefined;
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return text ? [...text].slice(0, LABEL_MAX).join('') : undefined;
}

/**
 * The one row an action's card names the record by (D97 item 6, D137): what it acts on, as the record's page heads it,
 * under the read's own title. Clew's row: a ref of the read, since a record has no key of its own beside its input.
 */
export function recordItem(read: string, title: string, label: string | undefined): ThreadItem {
  return {
    ref: `record:${read}`.slice(0, LABEL_MAX),
    label: label ?? title,
    detail: label ? title : '',
    selectable: false,
    selected: true,
  };
}
