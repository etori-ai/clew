import type { Area, MessageMeta, ViewRef } from '@clew/contracts';
import { counted } from './components/panel-labels';

/**
 * The card under an answer in the transcript (D38), as the turn recorded it, decided without reading anything: the
 * view its read made, with the input the model gave it, and which of its rows the card draws (`MessageMeta.viewRows`,
 * worked out on the server from the read and the answer's words). The card is part of the history: the latest answer's
 * is drawn open and read; an older answer's stays in place folded, saying its title, its system and its count as the
 * turn recorded them, and is read only when the person unfolds it, so opening a long conversation reads one view. A
 * view that is not declared, and a card that would show rows the answer is not about (`show: 'none'`), are the button to
 * the whole read. This file imports nothing of the page, so a unit test loads it on its own.
 */
export type ViewRows = NonNullable<MessageMeta['viewRows']>;
export type AnswerCard =
  | { kind: 'open'; view: ViewRef; rows?: ViewRows }
  | { kind: 'folded'; view: ViewRef; rows?: ViewRows; summary: string }
  | { kind: 'button'; view: ViewRef };

/** How many rows a folded card holds, as the turn counted them: "4 rader", or "1 av 4 rader" for the rows named. */
export function rowsSummary(rows: ViewRows | undefined): string | undefined {
  if (!rows) return undefined;
  return rows.show === 'named' && rows.marks ? `${rows.marks.length} av ${counted(rows.count)}` : counted(rows.count);
}

/** The card one answer draws: open when it is the latest answer, folded when an older one, else its button; none without a view. */
export function answerCard(meta: MessageMeta | undefined, latest: boolean): AnswerCard | undefined {
  const view = meta?.view;
  if (!view) return undefined;
  const rows = meta?.viewRows;
  if (!view.declared || rows?.show === 'none') return { kind: 'button', view };
  if (latest) return { kind: 'open', view, ...(rows ? { rows } : {}) };
  const count = rowsSummary(rows);
  return {
    kind: 'folded',
    view,
    ...(rows ? { rows } : {}),
    summary: [view.source, count].filter(Boolean).join(' · '),
  };
}

/**
 * Which areas' figures are drawn as lines under a card (D54): only a figure that belongs to the read the card is, by the
 * figure's own declaration (`opens`, the read it opens), and only while the card is the read as a whole; a card of the
 * rows an answer names is not about the totals. A connector's figure is never drawn because another of its reads was.
 */
export function figureBelongs(view: ViewRef, rows: ViewRows | undefined): ((area: Area) => boolean) | undefined {
  if (rows && rows.show !== 'all') return undefined;
  return area => area.figure?.opens?.capability === view.capability;
}
