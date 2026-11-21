import type { AuthenticatedContext, Thread } from '@clew/contracts';
import { threadAccess } from '../threads/access';
import type { AssistantDeps } from './ports';

/**
 * A conversation asked beside a page is opened as a conversation (D141 rule 6): its page marks it once, and from then on
 * it is among the rail's latest. The rail cannot derive this in the browser, since it must hold on every device. A
 * conversation that was never asked beside a page, or one already opened, is left as it is and answered as it stands:
 * the conversation's page calls this on every visit, and only the first call writes, with its audit row in the same
 * transaction. Undefined for a conversation that is not the person's, does not exist or is not a question, as a thread
 * read answers it.
 */
export function openedPath(deps: Pick<AssistantDeps, 'store' | 'registry' | 'clock'>) {
  const { store, registry, clock } = deps;
  const access = threadAccess(store, registry);
  return async function markOpened(persona: AuthenticatedContext, conversationId: string): Promise<Thread | undefined> {
    const seen = await access.read(persona, conversationId);
    if (!seen || seen.kind !== 'question') return undefined;
    if (!seen.askedBeside || seen.askedBeside.openedAt) return seen;
    const at = clock().toISOString();
    await store.transaction(async tx => {
      // Under the lock: two tabs opening it at once mark it once and write one audit row.
      const current = await tx.lockThread(persona.id, conversationId);
      if (!current?.askedBeside || current.askedBeside.openedAt) return;
      // What was said and when is untouched: `updatedAt` stays the last turn's, so opening does not reorder the rail.
      await tx.updateThread(conversationId, { askedBeside: { ...current.askedBeside, openedAt: at } });
      await tx.writeAudit({
        actor: persona.principal.id,
        action: 'conversation.opened',
        subject: 'thread:' + conversationId,
        at,
      });
    });
    return access.read(persona, conversationId);
  };
}
