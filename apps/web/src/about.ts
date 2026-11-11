import { openRef, type AboutResult, type View, type ViewField, type ViewRef } from '@clew/contracts';
import { statusWord } from './components/panel-labels';

/**
 * What the sources say about the people on a list (D97 items 2 and 5), as `clew.about` answered it: a mark on a
 * person's row only where a source gives one of its status fields a tone, which is its way of saying the value needs
 * the reader. A mark names its source, says the status in a word and, where the source declares a fuller view of the
 * row, opens it. Pure: the page draws what this returns.
 */
export interface Mark {
  /** Unique on the row: the read and the field. */
  id: string;
  /** The read's title, which is what the person reads the source as: "Kompetens". */
  title: string;
  /** The status in a word: "utgånget". */
  word: string;
  tone: 'warn' | 'alert';
  /** The source's fuller view of the row, when it declares one and the row has what it takes. */
  view?: ViewRef;
}
type FieldView = Extract<View, { fields: ViewField[] }>;
const hasFields = (view: View | undefined): view is FieldView =>
  !!view && Array.isArray((view as { fields?: unknown }).fields);

/**
 * The marks for one person. A section that did not answer, a row about someone else and a status without a warning or
 * an alert tone give none. An answer that is not what `clew.about` returns gives none either, so a page never fails on
 * it.
 */
export function marksFor(result: AboutResult | null | undefined, personId: string): Mark[] {
  if (!result || !Array.isArray(result.sections)) return [];
  const marks: Mark[] = [];
  for (const section of result.sections) {
    if (section.status !== 'ok' || !hasFields(section.view)) continue;
    const row = section.rows.find(r => r.key === personId);
    if (!row) continue;
    for (const field of section.view.fields) {
      const tone = field.format === 'status' ? field.tones?.[String(row[field.key])] : undefined;
      if (tone !== 'warn' && tone !== 'alert') continue;
      const open = 'open' in section.view ? section.view.open : undefined;
      const view = open ? openRef(open, row, section.source) : undefined;
      marks.push({
        id: `${section.capability}:${field.key}`,
        title: section.title,
        word: statusWord(field.label, row[field.key]),
        tone,
        ...(view ? { view } : {}),
      });
    }
  }
  return marks;
}
/** The sources that did not answer, by the name a person reads, each once: the page says so beside the list. */
export function unanswered(result: AboutResult | null | undefined): string[] {
  if (!result || !Array.isArray(result.sections)) return [];
  return [...new Set(result.sections.filter(s => s.status !== 'ok').map(s => s.source))];
}
