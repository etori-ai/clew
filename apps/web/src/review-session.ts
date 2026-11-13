import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ReviewEvidence, Thread } from '@clew/contracts';

/**
 * A review in progress (D70 item 2), as the browser keeps it while the review is a page of its own (2026-11-12): what
 * the person has decided on each row so far, kept per work item for the session, so a reload, Back and Forward between
 * steps, or a person or a link opened on the way and left again finds the decisions where they were. Nothing is
 * written to the source until Skicka; this is the person's own draft, in their own tab.
 *
 * What is kept is the least the page needs: each row's ref with "approve" or "leave", and for an approval taken on a
 * versioned document (D79) the versions it was taken on (the record's and each document's revision, never the bytes,
 * the proof or its expiry). The review's evidence stays in the page's memory only: D79 keeps no durable evidence, so
 * after a reload Skicka reads the row's documents again and sends that evidence only when the versions are the ones the
 * approval was taken on; a document that has changed takes the approval back. Session storage (this tab, until it
 * closes) with a copy in memory, so a browser that refuses storage still keeps the draft while the tab lives. Every
 * access is guarded: storage may throw (private windows, blocked site data) and the page then works from memory.
 *
 * The draft belongs to the rows as the person saw them (`reviewVersion`): when a row is added, removed or read again
 * with another revision, label or detail, the draft is the item's no longer and is dropped. It is cleared on Skicka,
 * and every draft goes when the session ends.
 */
export type Decision = 'approve' | 'leave';
/** The versions an approval on a versioned document was taken on: the evidence without its proof and its expiry. */
export interface Seen {
  revision: string;
  documents: Array<{ id: string; revision: string }>;
}
export interface ReviewDraft {
  decisions: Readonly<Record<string, Decision>>;
  seen: Readonly<Record<string, Seen>>;
}
export const EMPTY_DRAFT: ReviewDraft = { decisions: {}, seen: {} };

const PREFIX = 'clew.review.';

/** The rows a review decides on, in the item's order (D70: its selectable rows). */
export const reviewRows = <T extends Pick<Thread, 'items'>>(thread: T): T['items'] =>
  thread.items.filter(i => i.selectable);

/** FNV-1a over the text, as eight hex digits: short enough for a key's value, and no row's words in storage. */
const digest = (text: string) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
/** The rows as the person sees them: a draft is about these and no others. */
export const reviewVersion = (thread: Pick<Thread, 'items'>): string =>
  digest(JSON.stringify(reviewRows(thread).map(i => [i.ref, i.revision ?? null, i.label, i.detail])));

const isSeen = (value: unknown): value is Seen => {
  const v = value as Partial<Seen> | null;
  return (
    !!v &&
    typeof v.revision === 'string' &&
    Array.isArray(v.documents) &&
    v.documents.every(d => !!d && typeof d.id === 'string' && typeof d.revision === 'string')
  );
};
/**
 * The draft kept for an item, read for the rows it has now: nothing when the text is not a draft, or one taken on
 * other rows (`version`); a decision on a row the item no longer has is left out, and the versions kept only for a row
 * still approved.
 */
export function parseDraft(text: string | null, version: string, refs: readonly string[]): ReviewDraft {
  if (!text) return EMPTY_DRAFT;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return EMPTY_DRAFT;
  }
  const stored = value as { version?: unknown; decisions?: unknown; seen?: unknown } | null;
  if (!stored || typeof stored !== 'object' || stored.version !== version) return EMPTY_DRAFT;
  const decisions: Record<string, Decision> = {};
  const seen: Record<string, Seen> = {};
  const given = (stored.decisions ?? {}) as Record<string, unknown>;
  const versions = (stored.seen ?? {}) as Record<string, unknown>;
  for (const ref of refs) {
    const d = given[ref];
    if (d !== 'approve' && d !== 'leave') continue;
    decisions[ref] = d;
    if (d === 'approve' && isSeen(versions[ref])) seen[ref] = versions[ref];
  }
  return Object.keys(decisions).length ? { decisions, seen } : EMPTY_DRAFT;
}
/** The text a draft is kept as. */
export const draftText = (version: string, draft: ReviewDraft): string =>
  JSON.stringify({ version, decisions: draft.decisions, seen: draft.seen });

/** The versions of an evidence, as a draft keeps them. */
export const seenOf = (evidence: ReviewEvidence): Seen => ({
  revision: evidence.revision,
  documents: evidence.documents.map(d => ({ id: d.id, revision: d.revision })),
});
/** A row decided: an approval with the versions it was taken on (none for a document without versions), or left behind. */
export function withDecision(draft: ReviewDraft, ref: string, decision: Decision, seen?: Seen): ReviewDraft {
  const { [ref]: _was, ...rest } = draft.seen;
  return {
    decisions: { ...draft.decisions, [ref]: decision },
    seen: decision === 'approve' && seen ? { ...rest, [ref]: seen } : rest,
  };
}
/** A row's decision taken back (its document was corrected or has changed): it is not judged again until it is reviewed. */
export function withoutDecision(draft: ReviewDraft, ref: string): ReviewDraft {
  const { [ref]: _d, ...decisions } = draft.decisions;
  const { [ref]: _s, ...seen } = draft.seen;
  return { decisions, seen };
}
export const approvedOf = (draft: ReviewDraft, rows: ReadonlyArray<{ ref: string }>): string[] =>
  rows.filter(r => draft.decisions[r.ref] === 'approve').map(r => r.ref);
export const leftOf = (draft: ReviewDraft, rows: ReadonlyArray<{ ref: string }>): string[] =>
  rows.filter(r => draft.decisions[r.ref] === 'leave').map(r => r.ref);
export const begun = (draft: ReviewDraft): boolean => Object.keys(draft.decisions).length > 0;
/** Where a review that is begun goes on (0-based): the first row not yet judged, else the last step, Skicka. */
export const nextStep = (draft: ReviewDraft, rows: ReadonlyArray<{ ref: string }>): number => {
  const at = rows.findIndex(r => !draft.decisions[r.ref]);
  return at < 0 ? rows.length : at;
};
/** Whether a fresh read of a row's documents is the version an approval was taken on (D79: a change never renews it). */
export const sameVersions = (seen: Seen, evidence: ReviewEvidence): boolean =>
  JSON.stringify(seenOf(evidence)) === JSON.stringify({ revision: seen.revision, documents: seen.documents });

/**
 * The work item's selection after a review (D73, amended 2026-11-11): a row chosen for approval is ticked, a row left
 * behind is not, and a row the review never judged keeps the tick it had. So a review that is opened and left again
 * leaves the item as it was, with the rows the source marked still ticked.
 */
export const selectionAfterReview = (selected: string[], review: { approved: string[]; left: string[] }) => [
  ...selected.filter(ref => !review.approved.includes(ref) && !review.left.includes(ref)),
  ...review.approved,
];

// The keeping. A copy in memory first (null: known to hold nothing), session storage behind it for a reload; both guarded.
const memory = new Map<string, string | null>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function stored(threadId: string): string | null {
  if (memory.has(threadId)) return memory.get(threadId) ?? null;
  try {
    return window.sessionStorage.getItem(PREFIX + threadId);
  } catch {
    return null;
  }
}
function keep(threadId: string, text: string | null) {
  memory.set(threadId, text);
  try {
    if (text === null) window.sessionStorage.removeItem(PREFIX + threadId);
    else window.sessionStorage.setItem(PREFIX + threadId, text);
  } catch {
    // Storage refused: the copy in memory holds the draft while the tab lives.
  }
  notify();
}
/** Keeps an item's draft for the rows of `version`; an empty draft is no draft. */
export const saveDraft = (threadId: string, version: string, draft: ReviewDraft): void =>
  keep(threadId, begun(draft) ? draftText(version, draft) : null);
/** Skicka, or a draft that is no longer the item's: nothing is kept for it. */
export const clearDraft = (threadId: string): void => {
  if (stored(threadId) !== null) keep(threadId, null);
};
/** The session has ended (signed out, ended, or another person's): every draft goes. */
export function clearDrafts(): void {
  for (const key of memory.keys()) memory.set(key, null);
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach(key => window.sessionStorage.removeItem(key));
  } catch {
    // Nothing more can be done without storage; the copy in memory is gone.
  }
  notify();
}

/**
 * An item's draft as it stands, drawn again when it changes, with the way to change it. No item (or one that is not
 * reviewed) has none. A draft taken on other rows is dropped once it is read.
 */
export function useReviewDraft(
  thread: Pick<Thread, 'id' | 'items'> | undefined,
): [ReviewDraft, (next: ReviewDraft) => void] {
  const id = thread?.id ?? null;
  const text = useSyncExternalStore(
    subscribe,
    () => (id ? stored(id) : null),
    () => null,
  );
  const version = thread ? reviewVersion(thread) : '';
  const refs = thread ? reviewRows(thread).map(i => i.ref) : [];
  const refsKey = refs.join('\n');
  const draft = useMemo(() => parseDraft(text, version, refs), [text, version, refsKey]);
  const stale = !!id && text !== null && !begun(draft);
  useEffect(() => {
    if (stale && id) clearDraft(id);
  }, [stale, id]);
  return [draft, next => (id ? saveDraft(id, version, next) : undefined)];
}

/**
 * The way back to the work item (2.4.3). The review page holds the address it was opened at while it is shown and lets
 * go when it gives way to anything else, as a unit's page does for the organisation tree; the work item the person comes
 * back to reads it as it is drawn (before the page it replaces has let go) and puts the focus on the control that leads
 * to that address: "Granska N", "Fortsätt granska", "Visa granskning", or a row under Dokument.
 */
let shown: { threadId: string; address: string } | null = null;
export function useReviewShownForTheWayBack(threadId: string, address: string) {
  useEffect(() => {
    const mine = { threadId, address };
    shown = mine;
    return () => {
      if (shown === mine) shown = null;
    };
  }, [threadId, address]);
}
/** The address of this item's review the person is leaving, or null: what the item's control for it points to. */
export const reviewLeftFor = (threadId: string): string | null => (shown?.threadId === threadId ? shown.address : null);
