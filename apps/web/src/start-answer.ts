import type { MessageMeta, ThreadMessage } from '@clew/contracts';
import { isSide } from './conversation-about';
import { DOT } from './dot';

/**
 * The answer under Hem's line (D133 item 9): what the card draws of a conversation asked there, decided without
 * reading anything. The card shows the newest exchange only; the earlier ones are in the conversation. This file
 * imports nothing of the page, so a unit test loads it on its own.
 */

/** One question and the answer written to it, if one is. */
export interface Exchange {
  question: ThreadMessage;
  answer: ThreadMessage | null;
}

/**
 * The newest exchange of a conversation: its last question and the answer after it. What was said in the panel of
 * another system's assistant beside the conversation (D128) is that panel's, as it is in the transcript, so it is never
 * the newest exchange here. Null for a conversation with no question in it.
 */
export function newestExchange(messages: readonly ThreadMessage[]): Exchange | null {
  const said = messages.filter(m => !isSide(m));
  for (let at = said.length - 1; at >= 0; at--) {
    const m = said[at]!;
    if (m.role !== 'user') continue;
    return { question: m, answer: said.slice(at + 1).find(x => x.role === 'assistant') ?? null };
  }
  return null;
}

const conjunction = new Intl.ListFormat('sv-SE', { type: 'conjunction' });

/**
 * What an answer read (D122 item 8, `MessageMeta.reads`), by the titles the transcript names its reads by: those that
 * answered, once each ("Att göra och Kalender"), then those that failed ("kunde inte läsa Kalender"). A read with no
 * title the person would know is not named, as the transcript names it "Läste" alone. A turn from before the reads were
 * kept names its view. Empty when nothing can be named.
 */
export function readWords(meta: MessageMeta | undefined, titleOf: (capability: string) => string | undefined): string {
  const reads = meta?.reads ?? (meta?.view ? [{ capability: meta.view.capability }] : []);
  const titled = (failed: boolean) => [
    ...new Set(
      reads
        .filter(r => ('failed' in r && !!r.failed) === failed)
        .map(r => titleOf(r.capability) ?? (meta?.view?.capability === r.capability ? meta.view.title : undefined))
        .filter((t): t is string => !!t),
    ),
  ];
  const answered = titled(false);
  const failed = titled(true);
  return [
    answered.length ? conjunction.format(answered) : null,
    failed.length ? `kunde inte läsa ${conjunction.format(failed)}` : null,
  ]
    .filter(Boolean)
    .join(DOT);
}

/**
 * The line over the question in the card ("Svar · Att göra och Kalender", board Start variant b): that it is an answer
 * and what it read. An answer another system's assistant wrote names that assistant instead, as the transcript does over
 * it. While the answer is on its way the line says only "Svar": the steps say what is read.
 */
export function answerEyebrow(
  answer: ThreadMessage | null,
  titleOf: (capability: string) => string | undefined,
): string {
  if (!answer) return 'Svar';
  const other = answer.meta?.handover && !answer.meta.handover.failed ? answer.meta.handover : null;
  if (other) return `Svar från ${other.name} i ${other.source}`;
  return ['Svar', readWords(answer.meta, titleOf)].filter(Boolean).join(DOT);
}

/**
 * The work items an answer names, as the card draws them, as the rows "Behöver dig" has (D133 item 9): the items it is
 * about (`MessageMeta.cards`), the work items among the rows of a read it names (`MessageMeta.viewItems`: the rows of
 * Att göra the model's answer is about), the item an action it filled in is on, and the item a proposal answer made
 * (the turn's `forslag`); each once, in that order.
 */
export function namedItems(meta: MessageMeta | undefined, proposals?: string | null): string[] {
  return [
    ...new Set([
      ...(meta?.cards ?? []),
      ...(meta?.viewItems ?? []),
      ...(meta?.draft ? [meta.draft.threadId] : []),
      ...(proposals ? [proposals] : []),
    ]),
  ];
}
