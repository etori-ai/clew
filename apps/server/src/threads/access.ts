import type { Actor, Registry } from '@clew/connectors';
import type { AuthenticatedContext, Thread } from '@clew/contracts';
import type { ThreadStore } from './model';

type AccessRegistry = Pick<Registry, 'visible' | 'allowed'>;
/** Conservative snapshot policy: historical source content requires its original authority today. */
export function visibleThread(registry: AccessRegistry, actor: Actor & Partial<Pick<AuthenticatedContext, 'authorizationVersion'>>, thread: Thread) {
  if (thread.kind === 'pushed' && !registry.visible(actor, thread.connector)) return false;
  for (const message of thread.messages) {
    if (message.role !== 'assistant') continue;
    const access = message.meta?.access;
    // Old generated prose has no complete provenance. Keep it in storage, but never reuse it as authorized context.
    if (thread.kind === 'question' && !access) return false;
    if (access && (access.authorizationVersion !== actor.authorizationVersion || access.connectors.some(id => !registry.visible(actor, id)) || access.capabilities.some(name => !registry.allowed(actor, name)))) return false;
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
  };
}
