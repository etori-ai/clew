import {
  ASK_ANSWER_MAX,
  ASK_SOURCES_MAX,
  type AssistantAskSource,
  type AuthenticatedContext,
  type ConversationInput,
  type ConversationResponse,
  type Handover,
  type HandoverAssistant,
  type MessageMeta,
  type TurnEvent,
  type TurnStep,
} from '@clew/contracts';
import { CapabilityError } from '@clew/connectors';
import { InputError } from '../context';
import { threadAccess } from '../threads/access';
import { TurnStopped } from './domain';
import type { AssistantDeps } from './ports';

/** The step a handed-over turn shows while the other system's assistant answers; no capability of that name exists. */
export const HANDOVER_STEP = 'clew.handover';
const connectorOf = (assistant: string) => assistant.slice(0, assistant.indexOf(':'));

/**
 * One turn handed to an assistant of another system (the assistants profile). The person chose it: `input.assistant`
 * is their pick in the composer, never something a model decided, and Clew's own model is not asked in the turn at all.
 * What leaves Clew is the person's text, unchanged, and nothing else of the conversation; the answer is stored and
 * shown as that assistant's own, unchanged. The whole assistant answers there, with its own instructions, knowledge
 * and tools, so nothing here reads its knowledge or rewrites what it said.
 *
 * A conversation is handed to at most one assistant, and keeps the source's key for the conversation there, so a
 * follow-up continues it. When the source refuses or does not answer, the turn says so in Clew's words and is marked
 * `failed`: Clew never answers in the assistant's name. The two messages, the conversation's state and the audit row
 * (`conversation.handed`: which assistant, new or continued, how many sources, never a word of either text) commit
 * together; a turn the person stops writes nothing here, though the source may already hold the question.
 */
export function handoverPath(deps: AssistantDeps) {
  const { store, registry, clock, ids } = deps;
  const access = threadAccess(store, registry);
  return async function handOver(
    persona: AuthenticatedContext,
    input: ConversationInput,
    observer: { emit?: (event: TurnEvent) => void; signal?: AbortSignal } = {},
  ): Promise<ConversationResponse> {
    const outside = deps.handover;
    const picked = input.assistant;
    if (!outside || !picked) throw new InputError('Det finns ingen assistent att lämna frågan till.');
    // Nothing of the conversation follows the question until what may leave Clew is marked by its source.
    if (input.chips?.length) throw new InputError('Det går inte att skicka med något till assistenten.');
    const existing = input.conversationId ? await access.read(persona, input.conversationId) : undefined;
    if (input.conversationId && (!existing || existing.kind !== 'question'))
      throw new InputError('Samtalet finns inte.');
    if (existing?.handover && existing.handover.assistant !== picked)
      throw new InputError('Samtalet är lämnat till en annan assistent. Börja ett nytt samtal för att byta.');
    // Whom the person is asking, as the source names it now; a conversation already handed over keeps the name it had
    // if the source cannot be listed this moment, and the registry still checks the assistant before the question goes.
    const listed: HandoverAssistant | undefined =
      (await outside.list(persona)).find(a => a.id === picked) ??
      (existing?.handover ? { id: picked, name: existing.handover.name, source: existing.handover.source } : undefined);
    if (!listed) throw new InputError('Assistenten finns inte längre.');
    const emit = (event: TurnEvent) => {
      try {
        observer.emit?.(event);
      } catch {
        /* a listener never breaks the turn */
      }
    };
    const step: Omit<TurnStep, 'status'> = {
      id: 'steg-1',
      capability: HANDOVER_STEP,
      title: `Frågar ${listed.name}`,
      source: listed.source,
    };
    const started = clock().getTime();
    const took = () => Math.max(0, clock().getTime() - started);
    emit({ type: 'step', step: { ...step, status: 'running' } });
    const continued = existing?.handover?.session;
    let body = '';
    let cut = false;
    const cites: AssistantAskSource[] = [];
    let session = continued;
    let link = existing?.handover?.link;
    let failed: CapabilityError['code'] | undefined;
    try {
      for await (const event of outside.ask(
        persona,
        picked,
        { question: input.text, ...(continued ? { session: continued } : {}) },
        observer.signal,
      )) {
        if (event.type === 'text') {
          const room = ASK_ANSWER_MAX - body.length;
          const delta = event.delta.slice(0, Math.max(0, room));
          if (delta.length < event.delta.length) cut = true;
          if (delta) {
            body += delta;
            emit({ type: 'text', delta });
          }
        } else if (event.type === 'source') {
          if (
            cites.length < ASK_SOURCES_MAX &&
            !cites.some(c => c.label === event.source.label && c.link === event.source.link)
          )
            cites.push(event.source);
        } else if (event.type === 'done') {
          session = event.session;
          link = event.link ?? link;
        }
      }
      // An answer without a word is the source failing, not an answer.
      if (!body.trim()) throw new CapabilityError(`${listed.source} svarar inte just nu.`, 'unavailable');
    } catch (error) {
      if (observer.signal?.aborted) throw new TurnStopped();
      if (!(error instanceof CapabilityError)) throw error;
      failed = error.code ?? 'unavailable';
      body = error.message;
      cut = false;
      cites.length = 0;
      emit({ type: 'text', delta: body, reset: true });
    }
    if (observer.signal?.aborted) throw new TurnStopped();
    emit({ type: 'step', step: { ...step, status: failed ? 'error' : 'complete', ms: took() } });
    const at = clock().toISOString();
    const conversationId = existing?.id ?? ids();
    const connector = connectorOf(picked);
    const state: Handover = {
      assistant: picked,
      name: listed.name,
      source: listed.source,
      ...(session ? { session } : {}),
      ...(link ? { link } : {}),
    };
    const who = { assistant: picked, name: listed.name, source: listed.source };
    const answerMeta: MessageMeta = {
      shape: 'svar',
      assistant: 'handover',
      source: listed.name,
      // The answer is the source's: it stays readable only while the person still has that connector and its listing.
      access: {
        connectors: [connector],
        capabilities: [registry.connector(connector)?.assistants?.list].filter((n): n is string => !!n),
        authorizationVersion: persona.authorizationVersion,
      },
      handover: {
        ...who,
        ...(link ? { link } : {}),
        ...(cites.length ? { cites } : {}),
        ...(failed ? { failed: true as const } : {}),
        ...(cut ? { cut: true as const } : {}),
      },
    };
    await store.transaction(async tx => {
      if (!existing) {
        await tx.insertThread({
          id: conversationId,
          personId: persona.id,
          kind: 'question',
          topic: 'question',
          title: input.text.slice(0, 80),
          state: 'open',
          week: null,
          connector: 'clew',
          area: 'fragor',
          summary: body,
          handover: state,
          items: [],
          actions: [],
          waitingOn: null,
          deadline: null,
          trigger: { reason: 'Du ställde en fråga', source: listed.name, at },
          createdAt: at,
          updatedAt: at,
        });
      } else {
        await tx.updateThread(conversationId, { summary: body, updatedAt: at, handover: state });
      }
      await tx.addMessage(conversationId, { role: 'user', body: input.text, at, meta: { handed: who } });
      await tx.addMessage(conversationId, { role: 'assistant', body, at, meta: answerMeta });
      await tx.writeAudit({
        actor: persona.principal.id,
        action: 'conversation.handed',
        subject: 'thread:' + conversationId,
        at,
        details: {
          assistant: picked,
          connector,
          session: continued ? 'continued' : 'new',
          // What the person chose to send with the question; nothing can be yet.
          chips: [],
          cites: cites.length,
          ms: took(),
          ...(cut ? { cut: true } : {}),
          ...(failed ? { failed } : {}),
        },
      });
    });
    const conversation = (await access.read(persona, conversationId))!;
    return {
      conversationId,
      thread: conversation,
      shape: 'svar',
      assistant: 'handover',
      answer: { body, source: listed.name, at },
      clewActions: [],
      followUps: [],
    };
  };
}
