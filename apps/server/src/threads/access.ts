import type { Actor, Registry } from '@clew/connectors';
import type { AboutSubject, AuthenticatedContext, Thread, ThreadMessage } from '@clew/contracts';
import type { ConversationCursor, ThreadStore } from './model';

type AuthorityRegistry = Pick<Registry, 'visible' | 'allowed' | 'connector'>;
type AccessRegistry = AuthorityRegistry & Pick<Registry, 'stands'>;
/** Conservative snapshot policy: historical source content requires its original authority today. */
export function visibleThread(
  registry: AuthorityRegistry,
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

/** The topic of a card made from an answer (`cardFromAnswer`): its summary is that answer's text. */
export const ANSWER_CARD = 'answer:';
/** One subject as it is asked once, however many answers name it: the same person or unit read under the same relations. */
const subjectKey = (subject: AboutSubject) =>
  [subject.entity, subject.id, [...subject.admits].sort().join(',')].join('\u0000');
/**
 * An answer the reader may not have again (D150), as it is sent: its place in the conversation and nothing of what it
 * said. No text, no rows, no sources, no card and no record of what it read, so nothing of the person it was about
 * leaves the server, and nothing later, a model's context included, is built on it.
 */
const withheld = (message: ThreadMessage): ThreadMessage => ({
  id: message.id,
  role: message.role,
  body: '',
  createdAt: message.createdAt,
  // Whom the conversation is with is its state, and names another system's assistant only: that a question was handed
  // back to Clew stays said, so the next question is still Clew's to answer.
  meta: { withheld: 'about', ...(message.meta?.handedBack ? { handedBack: message.meta.handedBack } : {}) },
});
/**
 * Who a saved answer is about decides whether it is shown again (D150). The authorization fingerprint of
 * `visibleThread` says that the reader is who they were: the same unit, role and capabilities. It does not say that
 * the people they read about are still theirs to read about: a report who has another manager now, or has left, changes
 * nothing of the manager's own authority. So each answer keeps whom its reads were about, by Clew's own key and with
 * the relations those reads admitted, and it is sent only while the reader stands to every one of them as one of those
 * relations today, asked of the directory once for all the threads of a read. An answer that fails is withheld by
 * itself: the conversation, its questions and every answer that is not about the person stand. An answer about more
 * people than Clew could record is withheld from everyone. A directory that cannot be read fails the read: never
 * "show it".
 */
export async function withholding<T extends Thread>(
  registry: Pick<Registry, 'stands'>,
  actor: Actor,
  threads: readonly T[],
): Promise<T[]> {
  const asked = new Map<string, AboutSubject>();
  let any = false;
  for (const thread of threads)
    for (const message of thread.messages) {
      const access = message.role === 'assistant' ? message.meta?.access : undefined;
      if (!access?.about?.length && !access?.aboutMore) continue;
      any = true;
      for (const subject of access.about ?? []) asked.set(subjectKey(subject), subject as AboutSubject);
    }
  if (!any) return [...threads];
  const subjects = [...asked.values()],
    answers = await registry.stands(actor, subjects),
    stands = new Map(subjects.map((subject, index) => [subjectKey(subject), answers[index] === true]));
  return threads.map(thread => {
    let changed = false;
    const messages = thread.messages.map(message => {
      const access = message.role === 'assistant' ? message.meta?.access : undefined;
      const shown =
        !access?.aboutMore && (access?.about ?? []).every(subject => stands.get(subjectKey(subject as AboutSubject)));
      if (shown) return message;
      changed = true;
      return withheld(message);
    });
    if (!changed) return thread;
    // A conversation's summary is its newest answer's text, and a card made from an answer keeps that answer's: where
    // the answer it repeats is withheld, the summary is too. A work item a source pushed keeps its own.
    const newest = [...messages].reverse().find(message => message.role === 'assistant');
    const repeats = thread.kind === 'question' || thread.topic.startsWith(ANSWER_CARD);
    return { ...thread, messages, ...(repeats && newest?.meta?.withheld ? { summary: '' } : {}) };
  });
}

/** Shared read boundary for stream, chips, objects, suggestions, history and model context. */
export function threadAccess(store: ThreadStore, registry: AccessRegistry) {
  return {
    async list(actor: Actor & Partial<Pick<AuthenticatedContext, 'authorizationVersion'>>, now: string) {
      return withholding(
        registry,
        actor,
        (await store.listThreads(actor.id, now)).filter(thread => visibleThread(registry, actor, thread)),
      );
    },
    async read(actor: Actor & Partial<Pick<AuthenticatedContext, 'authorizationVersion'>>, id: string) {
      const thread = await store.readThread(actor.id, id);
      return thread && visibleThread(registry, actor, thread)
        ? (await withholding(registry, actor, [thread]))[0]
        : undefined;
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
        shown.push(
          ...(await withholding(
            registry,
            actor,
            page.threads.filter(thread => visibleThread(registry, actor, thread)),
          )),
        );
        cursor = page.next ?? undefined;
        if (!page.next) break;
      }
      return { threads: shown, next: cursor ?? null };
    },
  };
}
/** How many times one page of Alla samtal reads the store at most, passing over conversations the person may not see. */
const CONVERSATION_READS = 4;
