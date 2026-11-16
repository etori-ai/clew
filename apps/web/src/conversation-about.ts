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

/** A person or a unit, the two things with tabs of their own that a conversation can be about. */
export type EntitySubjectKind = 'person' | 'unit';
/**
 * What "Fråga Clew" on a person's or a unit's page asks about (D126 rule 5; the product owner, 2026-11-14: one
 * conversation per person, not one per tab): the person or the unit, the same subject whichever of their tabs it was
 * pressed on. The tab only says what the pane beside the transcript shows first (`section`, the page's own name for a
 * tab), never what the conversation is about. Nothing about them goes with the question as a chip: what a source says
 * about a person never reaches the model (D97 item 7, D115).
 */
export function entitySubject(kind: EntitySubjectKind, key: string, tab?: string | null) {
  return {
    key: `${kind}:${key}`,
    label: kind === 'person' ? 'personen' : 'enheten',
    chips: [],
    search: `?${kind}=${encodeURIComponent(key)}${tab ? `&section=${encodeURIComponent(tab)}` : ''}`,
  };
}
/**
 * The person or the unit a conversation's address names, and the tab its pane shows (`section`, absent for Översikt).
 * An address from before one subject per person (`?person=&section=`) reads the same way: the section is the pane's
 * first tab. Null for a conversation about anything else.
 */
export function addressEntity(
  search: URLSearchParams | string,
): { kind: EntitySubjectKind; key: string; tab: string | null } | null {
  const q = new URLSearchParams(search);
  // A work item or a view in the same address is what the page draws beside the transcript, as `useAbout` reads it.
  if (q.get('card') || q.get('open')) return null;
  const person = q.get('person'),
    unit = q.get('unit');
  const tab = q.get('section') || null;
  if (person) return { kind: 'person', key: person, tab };
  if (unit) return { kind: 'unit', key: unit, tab };
  return null;
}
/** The pane's tab at this address (D126 rule 9: every tab is a URL): the conversation and its subject stay as they are. */
export function paneTabHref(pathname: string, search: URLSearchParams | string, tab: string | null): string {
  const q = new URLSearchParams(search);
  if (tab) q.set('section', tab);
  else q.delete('section');
  const s = q.toString();
  return s ? `${pathname}?${s}` : pathname;
}
/**
 * Whether a new conversation's address names anything to ask about (D126 rule 2): a work item or a view beside it, a
 * person, a unit or a lens of Personal. `/conversations/new` naming nothing is Ny fråga's own page (D126 item 14).
 */
export function asksAbout(search: URLSearchParams | string): boolean {
  const q = new URLSearchParams(search);
  return ['card', 'open', 'person', 'unit', 'lens'].some(key => !!q.get(key));
}
/** Every name a conversation's address gives a person, a unit or a lens of Personal, and the pane's tab. */
const SUBJECT_KEYS = ['person', 'unit', 'section', 'lens'];
/**
 * ✕ or Esc in the pane beside a conversation about a person or a unit (D126 rule 2): the conversation lets go of them,
 * and stays. Its address keeps nothing of them, so the header, the box and a reload agree that it is about nothing in
 * particular. A work item or a view beside the transcript is let go of by `withoutPanel`, one at a time.
 */
export function withoutSubject(pathname: string, search: URLSearchParams | string): string {
  const q = new URLSearchParams(search);
  SUBJECT_KEYS.forEach(k => q.delete(k));
  const s = q.toString();
  return s ? `${pathname}?${s}` : pathname;
}

/** The title of a conversation nothing has been asked in yet, when it is about something: "Fråga om Johan Byström". */
export const askAboutWords = (name: string): string => `Fråga om ${name}`;
/** What the box in a conversation about a person says before the first word (the person's first name). */
export const askPersonPlaceholder = (name: string): string => `Fråga om ${name.trim().split(/\s+/)[0] ?? name}`;
/** Under the first question of a conversation about a person or a unit: whom it is about, so it reads alone later. */
export const aboutWords = (name: string): string => `om ${name}`;

/**
 * What a stored conversation was about, as far as the conversation itself keeps it: the labels of the chips its first
 * question went with (a work item, a view, an entry), each once. A person or a unit is kept by nothing in the thread
 * (their reference never goes with a question, D97 item 7), so a conversation about one says nothing here.
 */
export function storedAbout(thread: Pick<Thread, 'messages'>): string[] {
  const first = thread.messages.find(m => m.role === 'user');
  return [...new Set((first?.meta?.chips ?? []).map(c => c.label).filter(Boolean))];
}
