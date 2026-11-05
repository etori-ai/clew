import { openRef, rowsKey, viewRows, type View } from '@clew/contracts';

export { openRef, rowsKey, viewRows };

/**
 * Declared views (D38), the pure part: the rules a declaration must keep, the rows it points at, what the model is
 * handed instead of the content, and the view a row opens. No I/O. The registry holds bundled connectors to the rules
 * when they register, the manifest loader holds remote ones to them, and the browser draws from the same declaration.
 */
type Schema = { properties?: Record<string, Schema>; items?: Schema };
/** What the rules need to know about a capability: its name, kind, schemas and view. */
export interface ViewSubject { name: string; kind: string; input: unknown; output: unknown; view?: View }
const props = (schema: unknown): Record<string, Schema> | undefined => (schema as Schema | undefined)?.properties;

/**
 * Why a capability's view may not be used, or undefined when it may. A view belongs to a read; its input controls bind
 * to properties the capability's input declares; a row opens only a read of the same connector (as a card's actions
 * are one system's, D35); and where the output schema declares its properties, every field is one of them.
 */
export function viewProblem(subject: ViewSubject, siblings: ViewSubject[]): string | undefined {
  const view = subject.view;
  if (!view) return undefined;
  if (subject.kind !== 'read') return `${subject.name}: only a read capability can declare a view`;
  if (view.kind === 'text') { const out = props(subject.output); return out && !out[view.body] ? `${subject.name}: view body "${view.body}" is not in the output schema` : undefined; }
  const keys = view.fields.map(f => f.key);
  if (new Set(keys).size !== keys.length) return `${subject.name}: a view field is listed twice`;
  let record = props(subject.output);
  if (view.kind !== 'detail') {
    if (!keys.includes(view.title)) return `${subject.name}: view title "${view.title}" must be one of its fields`;
    const rows = rowsKey(view)!;
    if (record && !record[rows]) return `${subject.name}: view rows "${rows}" is not in the output schema`;
    record = record?.[rows]?.items?.properties;
    const input = props(subject.input);
    for (const control of [view.input?.query, view.input?.filter]) if (control && input && !input[control.key]) return `${subject.name}: view input "${control.key}" is not in the input schema`;
    if (view.input?.query && view.input.filter && view.input.query.key === view.input.filter.key) return `${subject.name}: the view's query and filter bind the same input`;
    if (view.open) {
      const target = siblings.find(c => c.name === view.open!.capability);
      if (!target || target.kind !== 'read') return `${subject.name}: a row opens ${view.open.capability}, which is not a read of the same connector`;
      const targetInput = props(target.input);
      for (const [param, from] of Object.entries(view.open.params)) {
        if (targetInput && !targetInput[param]) return `${subject.name}: ${view.open.capability} takes no input "${param}"`;
        if (record && !record[from]) return `${subject.name}: a row has no "${from}" to open ${view.open.capability} with`;
      }
    }
    if (view.ref && record && !record[view.ref]) return `${subject.name}: view ref "${view.ref}" is not in the output schema`;
  }
  if (record) for (const key of view.kind === 'detail' ? [view.title, ...keys] : keys) if (!record[key]) return `${subject.name}: view field "${key}" is not in the output schema`;
  return undefined;
}

/**
 * What the model reads in place of the output when the view says `modelReads: 'summary'`: that the result is on the
 * person's screen and how much of it there is, never what it holds.
 */
export function viewSummary(view: View, title: string, output: unknown): { shown: true; view: string; rows?: number; note: string } {
  const rows = viewRows(view, output);
  return { shown: true, view: title, ...(rows ? { rows: rows.length } : {}),
    note: 'Resultatet visas för personen i vyn. Innehållet lämnas inte till dig: säg att uppgifterna finns i vyn och återge dem inte.' };
}
export const readsSummary = (view: View | undefined) => view?.modelReads === 'summary';
