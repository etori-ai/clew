import type { Thread } from '@clew/contracts';

/**
 * Alla samtal as a read (D130 rule 4), the pure part: the person's own conversations (threads of kind `question`),
 * newest first by when each was last continued, as the page lists them, each its title, what it was asked beside
 * (`askedBeside.label`) and its address. Never a message's text, and never anything but what `threads` holds: the
 * caller hands in the person's own threads through the stream's read boundary.
 */

/** The most conversations one read lists; `omitted` says how many more there are. */
export const CONVERSATIONS_MAX = 100;
export interface ConversationRow {
  title: string;
  /** What the conversation is about where it was asked beside a page: the words that page gave it. */
  about?: string;
  /** When it was last continued. */
  lastAt: string;
  /** Its page inside Clew. */
  address: string;
}
export interface ConversationList {
  total: number;
  omitted?: number;
  rows: ConversationRow[];
}
export const conversationAddress = (id: string) => `/conversations/${encodeURIComponent(id)}`;
export function conversationList(threads: readonly Thread[], max = CONVERSATIONS_MAX): ConversationList {
  const own = threads
    .filter(t => t.kind === 'question')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return {
    total: own.length,
    ...(own.length > max ? { omitted: own.length - max } : {}),
    rows: own.slice(0, max).map(t => ({
      title: t.title,
      ...(t.askedBeside ? { about: t.askedBeside.label } : {}),
      lastAt: t.updatedAt,
      address: conversationAddress(t.id),
    })),
  };
}
