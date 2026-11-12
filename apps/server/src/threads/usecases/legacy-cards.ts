import type { RefreshStore, Occurrence } from '../refresh-model';

/** What a reset of a connector's topic-only cards found, or did with `confirm`. Counts only. */
export interface LegacyReset {
  /** Open cards whose every open occurrence is topic-only: marked handled, or that would be. */
  cards: number;
  /** Their occurrences: resolved, or that would be. */
  occurrences: number;
  /** Open cards with a write under way or a receipt, left as they are. */
  skipped: number;
  /** Topic-only occurrences of cards that are not open (handled, dismissed) or of none, left as they are. */
  left: number;
}
/**
 * Retiring the open cards a connector's scan left as topic-only work (D47): occurrences stored from a scan that named a
 * card by its topic alone, which a complete observation never resolves, so such a card stays open after its cause is
 * gone. An operator's one-off step for a connector whose scan now reports occurrences, never the refresh's own path: D47
 * keeps topic-only scans conservative there. In one transaction, each open card whose every open occurrence is
 * topic-only has those occurrences resolved and is marked handled, as the refresh resolves a card whose source says it is
 * gone; the person's own snooze and reminder on it are ended through the timer path, and one audit row per card says
 * so. A card with a write under way or a receipt is left alone and counted. The connector's next scan pushes a fresh card
 * for every cause that still stands. Without `confirm` nothing is written and the counts say what would be done.
 */
export function legacyCardsUsecases({ store, clock }: { store: RefreshStore; clock: () => Date }) {
  return {
    async reset(connector: string, actor: string, options: { confirm: boolean }): Promise<LegacyReset> {
      const at = clock().toISOString();
      return store.transaction(async tx => {
        const open = await tx.openOccurrences(connector);
        const byThread = new Map<string, Occurrence[]>();
        let left = 0;
        for (const o of open) {
          if (!o.legacy) continue;
          if (!o.threadId) {
            left++;
            continue;
          }
          byThread.set(o.threadId, [...(byThread.get(o.threadId) ?? []), o]);
        }
        const result: LegacyReset = { cards: 0, occurrences: 0, skipped: 0, left };
        for (const [threadId, legacy] of byThread) {
          // A card that also carries open work under a current identity is the refresh's, not this reset's.
          if (open.some(o => o.threadId === threadId && !o.legacy)) {
            result.left += legacy.length;
            continue;
          }
          const thread = await tx.lockThread(legacy[0]!.personId, threadId);
          if (!thread || thread.state !== 'open') {
            result.left += legacy.length;
            continue;
          }
          if (
            thread.receipt ||
            (thread.execution && ['pending', 'running', 'unknown'].includes(thread.execution.state))
          ) {
            result.skipped++;
            continue;
          }
          result.cards++;
          result.occurrences += legacy.length;
          if (!options.confirm) continue;
          for (const o of legacy) await tx.saveOccurrence({ ...o, sourceState: 'resolved', observedAt: at });
          await tx.updateThread(threadId, { state: 'handled', handledAt: at, waitingOn: null, updatedAt: at });
          // The person's own snooze and reminder end with the card, as they do when a card is closed elsewhere.
          await tx.cancelTimer(`snooze:${threadId}`, at);
          await tx.cancelTimer(`reminder:${threadId}`, at);
          await tx.writeAudit({
            actor,
            action: 'thread.source_resolved',
            subject: `thread:${threadId}`,
            at,
            details: { connector, reason: 'legacy-reset', occurrences: legacy.length },
          });
        }
        return result;
      });
    },
  };
}
export type LegacyCardsUsecases = ReturnType<typeof legacyCardsUsecases>;
