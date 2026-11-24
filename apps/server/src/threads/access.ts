import type { Actor, Registry } from '@clew/connectors';
import type { AuthenticatedContext, Thread } from '@clew/contracts';
import type { ConversationCursor, ThreadStore } from './model';

type AccessRegistry = Pick<Registry, 'visible' | 'allowed' | 'connector'>;
/** Conservative snapshot policy: historical source content requires its original authority today. */
export function visibleThread(
  registry: AccessRegistry,
  actor: Actor & Partial<Pick<AuthenticatedContext, 'authorizationVersion'>>,
  thread: Thread,
) {
  if (thread.kind === 'pushed') {
    if (!registry.visible(actor, thread.connector)) return false;
    // The version binds the full person/grant, including unit and role. Never adopt historical source content
    // into a new authority. Core-owned cards retain their own access rules; source snapshots fail closed.
    if (thread.sourceAuthorization) {
      if (thread.sourceAuthorization !== actor.authorizationVersion) return false;
    } else if (registry.connector(thread.connector)?.kind !== 'core') return false;
  }
  for (const message of thread.messages) {
    if (message.role !== 'assistant') continue;
    const access = message.meta?.access;
    // Old generated prose has no complete provenance. Keep it in storage, but never reuse it as authorized context.
    if (thread.kind === 'question' && !access) return false;
    if (
      access &&
      (access.authorizationVersion !== actor.authorizationVersion ||
        access.connectors.some(id => !registry.visible(actor, id)) ||
        access.capabilities.some(name => !registry.allowed(actor, name)))
    )
      return false;
  }
  return true;
}

/** Shared read boundary for stream, chips, objects, suggestions, history and model context. */
export function threadAccess(store: ThreadStore, registry: AccessRegistry) {
  return {
    async list(actor: Actor & Partial<Pick<AuthenticatedContext, 'authorizationVersion'>>, now: string) {
      return (await store.listThreads(actor.id, now)).filter(thread => visibleThread(registry, actor, thread));
    },
    async read(actor: Actor & Partial<Pick<AuthenticatedContext, 'authorizationVersion'>>, id: string) {
      const thread = await store.readThread(actor.id, id);
      return thread && visibleThread(registry, actor, thread) ? thread : undefined;
    },
    /**
     * Alla samtal (WD-L1): up to `limit` of the person's conversations they may see now, the latest activity first,
     * from `after` on. One they may no longer see is passed over and the store read on, `CONVERSATION_READS` times at
     * most, so a page is short only where nothing more is stored or the reads ran out; `next` then still says more
     * may follow.
     */
    async conversations(
      actor: Actor & Partial<Pick<AuthenticatedContext, 'authorizationVersion'>>,
      after: ConversationCursor | undefined,
      limit: number,
    ): Promise<{ threads: Thread[]; next: ConversationCursor | null }> {
      const shown: Thread[] = [];
      let cursor = after;
      for (let read = 0; read < CONVERSATION_READS && shown.length < limit; read++) {
        const page = await store.listConversations(actor.id, {
          ...(cursor ? { after: cursor } : {}),
          limit: limit - shown.length,
        });
        shown.push(...page.threads.filter(thread => visibleThread(registry, actor, thread)));
        cursor = page.next ?? undefined;
        if (!page.next) break;
      }
      return { threads: shown, next: cursor ?? null };
    },
  };
}
/** How many times one page of Alla samtal reads the store at most, passing over conversations the person may not see. */
const CONVERSATION_READS = 4;
