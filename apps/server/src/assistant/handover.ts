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
import { HandoverHeld, TurnStopped } from './domain';
import { peopleInTurn } from './people';
import { matchCards } from './router';
import type { ClewTool } from './model';
import type { AssistantDeps } from './ports';

/** The step a handed-over turn shows while the other system's assistant answers; no capability of that name exists. */
export const HANDOVER_STEP = 'clew.handover';
const connectorOf = (assistant: string) => assistant.slice(0, assistant.indexOf(':'));
/**
 * A question another system's assistant handed back without answering (D125 item 12): which assistant, the
 * conversation's state there, whether Clew's own model had chosen it, and how long it took. The caller answers.
 */
export interface HandedBack {
  handedBack: Handover;
  routed?: true;
  ms: number;
}
/** The tool Clew's own model hands a question over with (D125 item 11). Clew's own, never a capability. */
export const HANDOVER_TOOL = 'clew.handOver';
/** The most assistants Clew's model is told of in one turn; with more, the source's own finding read is the way. */
export const ROUTABLE_MAX = 12;
/** One assistant as the model's prompt lists it: the id the tool takes, its name, its system and what it is for. */
export const assistantLine = (a: HandoverAssistant) =>
  `${a.id}: ${a.name} i ${a.source}${a.description ? `. ${a.description}` : ''}`;
/**
 * The handover tool for one turn: the model names one of the assistants the person may ask, and that is all it does.
 * The question is not the model's to write: the turn is handed over afterwards with the person's own words, and the
 * model's text for the turn is dropped. `picked` hears the choice; an id the person may not ask is refused. The choice
 * is a suggestion: the person is asked before anything leaves Clew.
 */
export function handoverTool(
  assistants: HandoverAssistant[],
  picked: (assistant: HandoverAssistant) => void,
): ClewTool {
  return {
    name: HANDOVER_TOOL,
    description:
      'Föreslå att personens fråga lämnas till en assistent i ett annat system, som då svarar personen direkt. Använd ' +
      'det för frågor om regler, avtal, villkor, rutiner och annan allmän kunskap inom assistentens område enligt dess ' +
      'beskrivning, före sökning. Aldrig för frågor om personens egna uppgifter här. Personen får först välja om ' +
      'frågan ska skickas dit, precis som den skrevs. Skriv inget eget svar efter anropet.',
    input: {
      type: 'object',
      properties: {
        assistant: {
          type: 'string',
          enum: assistants.map(a => a.id),
          description: 'Assistentens id, som det står under "Assistenter du kan lämna frågan till".',
        },
      },
      required: ['assistant'],
      additionalProperties: false,
    },
    execute: input => {
      const found = assistants.find(a => a.id === input.assistant);
      if (!found) return { handed: false, note: 'Den assistenten finns inte för personen. Svara själv.' };
      picked(found);
      return { handed: true, note: `Personen får välja om frågan ska lämnas till ${found.name}. Skriv inget mer.` };
    },
  };
}

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
    observer: { emit?: (event: TurnEvent) => void; signal?: AbortSignal; offers?: boolean } = {},
  ): Promise<ConversationResponse | HandedBack> {
    // Clew's own assistant suggested this assistant and the person said yes (D125 item 11): the turn says so.
    const routed = input.suggested === true;
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
    // Before the words leave Clew (D125 item 13): a question that names someone the person manages, or one of their
    // open cards, is most likely meant for Clew, and what it says is not another system's to have by mistake. It is
    // held and the person is asked, by what Clew can tell without a model. Their answer, sent with `confirmed`, lets
    // it through, and is recorded.
    if (!input.confirmed) {
      const named = (await peopleInTurn(deps, persona, input.text, [])).named.length > 0;
      const carded =
        !named &&
        matchCards(
          input.text,
          (await access.list(persona, clock().toISOString())).filter(t => t.state === 'open' && t.kind === 'pushed'),
        ).length > 0;
      if (named || carded) {
        if (!observer.offers)
          throw new InputError('Frågan nämner något som hör hemma i Clew och skickas inte vidare härifrån.');
        throw new HandoverHeld(listed, named ? 'person' : 'card');
      }
    }
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
    // From here what is heard is the other assistant's: the listener draws it as such from its first word.
    emit({ type: 'handed', assistant: { id: picked, name: listed.name, source: listed.source } });
    emit({ type: 'step', step: { ...step, status: 'running' } });
    const continued = existing?.handover?.session;
    let body = '';
    let cut = false;
    const cites: AssistantAskSource[] = [];
    let session = continued;
    let link = existing?.handover?.link;
    let failed: CapabilityError['code'] | undefined;
    // How the assistant returned the conversation, if it did (D125 item 12).
    let returned: 'declined' | 'completed' | undefined;
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
        } else if (event.type === 'handback') {
          returned = event.reason;
          session = event.session ?? session;
          link = event.link ?? link;
        }
      }
      // An answer without a word is the source failing, not an answer; a question handed back needs none.
      if (!body.trim() && returned !== 'declined')
        throw new CapabilityError(`${listed.source} svarar inte just nu.`, 'unavailable');
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
    if (returned === 'declined' && !failed) {
      // The question is not that assistant's: nothing it wrote stands, nothing is stored here, and the caller answers
      // the person's same words itself. What the caller is told is who handed back and where the conversation there
      // is, never a word of the other system's.
      if (body) emit({ type: 'text', delta: '', reset: true });
      // The listener hears it now, before Clew starts on its own answer, so the change is seen as it happens.
      emit({ type: 'handedBack', assistant: { id: picked, name: listed.name, source: listed.source } });
      return {
        handedBack: {
          assistant: picked,
          name: listed.name,
          source: listed.source,
          ...(session ? { session } : {}),
          ...(link ? { link } : {}),
        },
        ...(routed ? { routed: true as const } : {}),
        ms: took(),
      };
    }
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
    const asked = { ...who, ...(routed ? { routed: true as const } : {}) };
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
        ...(returned === 'completed' && !failed ? { returned: true as const } : {}),
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
      await tx.addMessage(conversationId, { role: 'user', body: input.text, at, meta: { handed: asked } });
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
          ...(returned === 'completed' && !failed ? { returned: 'completed' } : {}),
          // How the assistant was chosen: by the person in the list above the field, or on Clew's suggestion.
          ...(routed ? { routed: 'suggested' } : {}),
          // The question was held for naming a person or a card of the asker's, and they sent it anyway.
          ...(input.confirmed ? { confirmed: true } : {}),
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
