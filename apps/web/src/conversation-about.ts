import type { Thread } from '@clew/contracts';

/**
 * Whom a conversation is with and what it is about, as its page and Alla samtal say it (D125, D126). Pure: no React,
 * no request.
 */

/** Another system's assistant as a conversation names it: its key, its name and the system it lives in. */
export interface Recipient {
  id: string;
  name: string;
  source: string;
}

/**
 * Whom a stored conversation is with now (D125): the assistant it was handed to, unless that assistant handed the last
 * question back or answered and returned the conversation (item 12); otherwise Clew, as null.
 */
export function talkingTo(thread: Pick<Thread, 'handover' | 'messages'>): Recipient | null {
  if (!thread.handover) return null;
  const last = [...thread.messages].reverse().find(m => m.role === 'assistant');
  if (last?.meta?.handedBack || last?.meta?.handover?.returned) return null;
  return { id: thread.handover.assistant, name: thread.handover.name, source: thread.handover.source };
}

/** Whom, in the line under a conversation's title and on Alla samtal: "Clew", "HR-assistenten i Eneo". */
export const withWords = (recipient: Pick<Recipient, 'name' | 'source'> | null): string =>
  recipient ? `${recipient.name} i ${recipient.source}` : 'Clew';

/**
 * Under a question that went to another system's assistant (D126 item 6): sent on, when Clew suggested the assistant
 * and the person chose it; sent to, when the person had picked it themself.
 */
export const sentWords = (handed: { name: string; source: string; routed?: true | undefined }): string =>
  handed.routed ? `Skickad vidare till ${handed.name} i ${handed.source}` : `Skickat till ${handed.name}`;

/** The one line that takes the place of Clew's suggestion once the person has chosen the assistant (D126 item 6). */
export const suggestedWords = (handed: { name: string; source: string }): string =>
  `Clew föreslog ${handed.name} i ${handed.source} · du valde att fråga den`;

/**
 * The chips the conversation's page takes from its own address (`?card=` a work item, `?open=` a view): what stands
 * beside the transcript is what every question there is about, so "Fråga Clew" never puts these in the drawer too.
 */
export function addressChipRefs(search: URLSearchParams | string): string[] {
  const q = new URLSearchParams(search);
  const card = q.get('card'),
    open = q.get('open');
  return [...(card ? ['thread:' + card] : []), ...(open ? ['capability:' + open] : [])];
}
