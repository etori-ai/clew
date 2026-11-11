import type { ViewField } from '@clew/contracts';

/**
 * Where a view's fields stand when Clew draws a row (D97), as two rules of the view language say it: `beside` puts a
 * field in the cell or on the line of the field before it, under that field's label, and `compact` marks the field that
 * is the row in one value, drawn where one value has room and left out where the whole row is drawn. Pure, and shared
 * by every place that draws a view's rows: the declared view, Personal's columns and lens, the opened person's sections
 * and their one-line summaries.
 */

/** One cell or one line of a row: the field that names it, then the fields beside it. */
export interface FieldGroup {
  /** Its label is the column's heading or the line's label. */
  lead: ViewField;
  beside: ViewField[];
}
/**
 * The fields as the whole row draws them (a lens, a section, a detail, a table): the compact one left out, and a field
 * beside the one before it joined to that one's cell. A field beside one that is left out starts a cell of its own, as
 * does `lead` (a declared view's title, which is always its own cell).
 */
export function rowGroups(fields: readonly ViewField[], options: { lead?: string } = {}): FieldGroup[] {
  const groups: FieldGroup[] = [];
  let previousDrawn = false;
  for (const f of fields) {
    if (f.compact) {
      previousDrawn = false;
      continue;
    }
    const last = groups.at(-1);
    if (last && f.beside && previousDrawn && f.key !== options.lead) last.beside.push(f);
    else groups.push({ lead: f, beside: [] });
    previousDrawn = true;
  }
  return groups;
}
/** The fields of a cell in the order they are drawn. */
export const groupFields = (group: FieldGroup): ViewField[] => [group.lead, ...group.beside];
/** Every field the whole row draws, in order: all but the compact one. */
export const wholeRow = (fields: readonly ViewField[]): ViewField[] => fields.filter(f => !f.compact);
/** The field that is the row in one value, if the view declares one. */
export const compactField = (fields: readonly ViewField[]): ViewField | undefined => fields.find(f => f.compact);
/** Whether a value is there to be drawn: absent, null and the empty string are not. */
export const present = (value: unknown) => value !== undefined && value !== null && value !== '';
