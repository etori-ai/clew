import type {
  AuthenticatedContext,
  Chip,
  ClewAction,
  ConversationInput,
  ConversationResponse,
  MessageMeta,
  ModelCall,
  ModelRef,
  SearchResult,
  SourceCitation,
  Thread,
  TurnEvent,
  TurnStep,
  Verb,
  ViewRef,
} from '@clew/contracts';
import { citationsOf, parseAnswer, visibleSoFar } from './answer';
import { audiencedActorOf, readsSummary, SEARCH_CONNECTOR } from '@clew/connectors';
import { displayDate, weekNumber } from '@clew/calendar/dates';
import { InputError } from '../context';
import { resolveChips, type ResolvedChips } from './chips';
import { completionsFor } from './completions';
import { serialiseContext } from './context';
import { routeFixed } from './fixed';
import {
  headingFollowUps,
  matchCapability,
  matchCards,
  nearest,
  searchAnswer,
  templatedAnswer,
  viewAnswer,
  viewInput,
} from './router';
import { modelAnswer, systemPrompt, type ToolCallRecord } from './model';
import { DRAFT_TOOL, draftableActions, draftTool, type ActionDraft } from './drafts';
import { listObjects } from './objects';
import {
  namedWork,
  PERSON_TOOL,
  peopleInTurn,
  peopleLines,
  personAnswer,
  personSubject,
  personTool,
  type ManagedPerson,
  type PeopleInTurn,
} from './people';
import type { AssistantDeps, ResolvedModel } from './ports';
import { draftSelection, parseVerb, verbsFor } from './verbs';
import { threadAccess } from '../threads/access';

export type { AssistantDeps, ModelResolver } from './ports';
export { verbsFor } from './verbs';

type Produced = {
  body: string;
  source: string;
  shape: ConversationResponse['shape'];
  assistant: ConversationResponse['assistant'];
  view?: ViewRef;
  draft?: NonNullable<ConversationResponse['draft']>;
  forslag?: { threadId: string };
  clewActions: ClewAction[];
  toolCalls?: ToolCallRecord[];
  followUps: string[];
  sources?: SourceCitation[];
  /** The administered model that wrote the answer (D24). */
  model?: ModelRef;
  /** The model turn's cost and trace (D91). */
  modelCall?: ModelCall;
  /** Work items about a person the model looked up in the turn (D115), drawn with the answer. */
  cards?: string[];
};
/** The model path did not answer (D8): the router takes over and the reason is kept with the turn. */
type ModelUnavailableOutcome = { unavailable: string };
const SEARCH_TOOL = SEARCH_CONNECTOR + '.search';
/** What a caller hears while a turn runs (D36): the capabilities it reads and the model's text so far; `signal` is the person pressing Stoppa. */
export interface TurnObserver {
  emit?: (event: TurnEvent) => void;
  signal?: AbortSignal;
}
/** The person stopped the turn before its answer was written; nothing was saved and the model is not marked down. */
export class TurnStopped extends Error {
  constructor() {
    super('Frågan avbröts.');
    this.name = 'TurnStopped';
  }
}
/** One turn's way out: its events, its stop signal, and the capability runner that reports each read as a step. */
interface Turn {
  emit: (event: TurnEvent) => void;
  signal: AbortSignal | undefined;
  run: <O = unknown>(name: string, input: unknown) => Promise<O>;
}
const isSearchResult = (v: unknown): v is SearchResult =>
  !!v && typeof v === 'object' && Array.isArray((v as SearchResult).rows) && Array.isArray((v as SearchResult).sources);
const whyLine = (t: Thread) =>
  `Varför nu? ${t.trigger.reason.replace(/\.$/, '')}. Källa: ${t.trigger.source}, ${new Date(t.trigger.at).toLocaleTimeString('sv-SE', { timeStyle: 'short', timeZone: 'Europe/Stockholm' })}.`;

/**
 * The assistant (D8, D12, D25): one conversation turn at a time, over ports. Chips are the explicit context; a
 * conversation is a question thread that keeps its memory; every turn and its audit row commit together. Execute
 * capabilities and the decision endpoint are never reached from here.
 */
export function assistantUsecases(deps: AssistantDeps) {
  const { store, registry, calendar, models, clock, ids } = deps;
  const access = threadAccess(store, registry);
  const todayDate = () => displayDate(clock().toISOString());
  const thread = async (persona: AuthenticatedContext, id: string) => (await access.read(persona, id))!;
  /** The turn's runner (D36): every capability it reads is a step, running and then complete with its time, named by the registry's title and source. */
  function turnFor(persona: AuthenticatedContext, observer: TurnObserver): Turn {
    const emit = (event: TurnEvent) => {
      try {
        observer.emit?.(event);
      } catch {
        /* a listener never breaks the turn */
      }
    };
    let n = 0;
    let known: ReturnType<typeof registry.tools> | undefined;
    const run = async <O = unknown>(name: string, input: unknown): Promise<O> => {
      known ??= registry.tools(audiencedActorOf(persona));
      const info = known.find(t => t.name === name);
      const step: Omit<TurnStep, 'status'> = {
        id: `steg-${++n}`,
        capability: name,
        title: info?.title ?? name,
        source: info?.source ?? 'Startsidan',
      };
      const started = clock().getTime();
      const took = () => Math.max(0, clock().getTime() - started);
      emit({ type: 'step', step: { ...step, status: 'running' } });
      try {
        const output = await deps.run<O>(persona, name, input);
        emit({ type: 'step', step: { ...step, status: 'complete', ms: took() } });
        return output;
      } catch (e) {
        emit({ type: 'step', step: { ...step, status: 'error', ms: took() } });
        throw e;
      }
    };
    return { emit, signal: observer.signal, run };
  }

  /** The chip path (D12): with one chipped card the assistant does not guess. Clew-side actions are only proposed; drafts change the card, never a source. */
  async function chipPath(persona: AuthenticatedContext, text: string, chipped: Thread): Promise<Produced | undefined> {
    const verb = parseVerb(text, chipped, todayDate());
    if (!verb) return undefined;
    const base = {
      source: 'Startsidan',
      assistant: 'router' as const,
      clewActions: [] as ClewAction[],
      followUps: [] as string[],
    };
    switch (verb.kind) {
      case 'dismiss':
        return {
          ...base,
          shape: 'svar',
          body: `Vill du att jag avfärdar ärendet "${chipped.title}"? Det försvinner från Behöver dig och ligger kvar under Klart; du kan ångra i tio minuter.`,
          clewActions: [{ n: 1, kind: 'dismiss', threadId: chipped.id, label: `Avfärda "${chipped.title}"` }],
        };
      case 'snooze':
        return {
          ...base,
          shape: 'svar',
          body: `Vill du att jag tar upp ärendet "${chipped.title}" i morgon 06:00 i stället?`,
          clewActions: [
            { n: 1, kind: 'snooze', threadId: chipped.id, label: `Inte nu: "${chipped.title}" tas upp i morgon 06:00` },
          ],
        };
      case 'why':
        return { ...base, shape: 'svar', source: chipped.trigger.source, body: whyLine(chipped) };
      case 'replan': {
        const updated = await calendar.replan(persona, chipped.id, verb.week!);
        return {
          ...base,
          shape: 'forslag',
          source: 'Kalendern',
          body: `Jag har ritat om förslagen i vecka ${weekNumber(verb.week!)}. Inget är skickat förrän du trycker på knappen i ärendet.`,
          draft: { kind: 'replan', threadId: chipped.id, week: verb.week!, thread: updated },
        };
      }
      case 'primary': {
        let items: Thread['items'];
        try {
          items = draftSelection(chipped.items, verb.refs ?? []);
        } catch {
          throw new InputError('Något val är inte längre aktuellt. Läs om sidan.');
        }
        const chosen = items.filter(i => i.selected).map(i => i.label.split(' · ')[0]);
        const at = clock().toISOString();
        await store.transaction(async tx => {
          await tx.updateThread(chipped.id, { items, updatedAt: at });
          await tx.addMessage(chipped.id, {
            role: 'assistant',
            at,
            body: `Utkast: ${chosen.length} av ${items.filter(i => i.selectable).length} valda. Knappen i ärendet skickar.`,
            meta: { draft: { kind: 'select', threadId: chipped.id, refs: verb.refs ?? [] } },
          });
          await tx.writeAudit({
            actor: persona.principal.id,
            action: 'thread.drafted',
            subject: 'thread:' + chipped.id,
            at,
            details: { refs: verb.refs ?? [] },
          });
        });
        return {
          ...base,
          shape: 'forslag',
          body: `Jag har ändrat ärendet: ${chosen.join(', ')} ${chosen.length === 1 ? 'är vald' : 'är valda'}. Inget är skickat förrän du trycker på knappen i ärendet.`,
          draft: {
            kind: 'select',
            threadId: chipped.id,
            refs: verb.refs ?? [],
            thread: await thread(persona, chipped.id),
          },
        };
      }
    }
  }
  /**
   * The deterministic path (D8): the asker's open work about a person the question names (D115), the fixed questions,
   * then the best matching read capability, then an honest "not yet".
   */
  async function routerPath(
    persona: AuthenticatedContext,
    text: string,
    assistant: 'router' | 'unavailable',
    turn: Turn,
    people: PeopleInTurn,
  ): Promise<Produced> {
    const about = personAnswer(people);
    if (about) return { ...about, shape: 'svar', assistant, clewActions: [], followUps: [] };
    const fixed = await routeFixed(deps, persona, text, { namesPerson: people.named.length > 0 });
    if (fixed)
      return {
        body: fixed.body,
        source: fixed.source,
        shape: fixed.forslagThreadId ? 'forslag' : 'svar',
        assistant,
        clewActions: [],
        followUps: [],
        ...(fixed.forslagThreadId ? { forslag: { threadId: fixed.forslagThreadId } } : {}),
      };
    const tools = registry.tools(audiencedActorOf(persona));
    const match = matchCapability(
      text,
      tools.filter(t => t.name !== SEARCH_TOOL),
    );
    if (match) {
      // A view with a search field takes the rest of what was typed as its question (D38); every other read runs as it is.
      const input = viewInput(text, match);
      const output = await turn.run(match.name, input);
      const answer =
        match.view && readsSummary(match.view)
          ? viewAnswer({ ...match, view: match.view }, input, output)
          : templatedAnswer(match, input, output, clock().toISOString());
      return {
        body: answer.body,
        source: match.source,
        shape: answer.view ? 'vy' : 'svar',
        assistant,
        clewActions: [],
        followUps: nearest(
          text,
          tools.filter(t => t.name !== match.name),
        ).map(t => t.title),
        toolCalls: [{ capability: match.name, input, output }],
        ...(answer.view ? { view: answer.view } : {}),
      };
    }
    // The catch-all (D26): a question no capability answers goes to the composite search as typed, and the hits become a view the person reads.
    const searchTool = tools.find(t => t.name === SEARCH_TOOL);
    if (searchTool) {
      const input = { query: text };
      const output = await turn.run<SearchResult>(SEARCH_TOOL, input);
      const answer = searchAnswer(output, clock().toISOString());
      return {
        body: answer.body,
        source: searchTool.source,
        shape: 'vy',
        assistant,
        clewActions: [],
        followUps: headingFollowUps(output.rows),
        toolCalls: [{ capability: SEARCH_TOOL, input, output }],
        sources: citationsOf(output),
        view: { capability: SEARCH_TOOL, input, title: 'Källor', source: searchTool.source },
      };
    }
    const near = nearest(text, tools).map(t => t.title);
    return {
      body: `Det där kan jag inte svara på ännu. Jag kan svara om ${near.length ? near.map(t => t.toLowerCase()).join(', ') : 'dagen, utvecklingssamtalen, frånvaron, budgeten och HME'}.`,
      source: 'Startsidan',
      shape: 'svar',
      assistant,
      clewActions: [],
      followUps: near,
    };
  }
  /**
   * The card path (D34, H1): a question that names an open card is answered with that card, without the model. The
   * sentence is the connector's own (the card's summary and why now); the card itself follows in the turn.
   */
  function cardPath(named: Thread[], assistant: 'router' | 'unavailable'): Produced {
    const first = named[0]!;
    const body =
      named.length === 1
        ? [first.summary, first.trigger.reason]
            .filter(Boolean)
            .map(s => s.replace(/\.$/, ''))
            .join('. ') + '.'
        : `${named.length} ${named.length === 1 ? 'ärende' : 'ärenden'} väntar på dig: ${named.map(t => t.title).join('; ')}.`;
    return {
      body,
      source: [...new Set(named.map(t => t.trigger.source))].join(', '),
      shape: 'svar',
      assistant,
      clewActions: [],
      followUps: [],
    };
  }
  /**
   * The model path: the person's model (D24), read tools only (none when the model is set not to use them), chips as
   * explicit context, the deterministic router as the fallback when it fails. A failure marks the provider down until
   * the probe or a test brings it back (D8). The text streams to the turn's listener as it is written, the trailer held
   * back (D36); when the router takes over, the listener is told to start the text over. A stop is not a failure.
   */
  async function modelPath(
    persona: AuthenticatedContext,
    text: string,
    history: Thread['messages'],
    chips: ResolvedChips,
    model: ResolvedModel,
    turn: Turn,
    people: PeopleInTurn,
  ): Promise<Produced | ModelUnavailableOutcome> {
    if (!models.health.available(model.providerId)) return { unavailable: 'provider marked down' };
    const tools = model.tools ? registry.tools(audiencedActorOf(persona)) : [];
    const now = clock();
    // The one work item the conversation is about may have its actions filled in as a draft (D112 item 8): only what
    // the person may do, only with a model that uses tools, and nothing is sent. Without one chipped, the one work item
    // about the one person the question names is that item (D115).
    const subject = chips.primaryThread ?? personSubject(people);
    const draftable = model.tools && subject ? draftableActions(registry, persona, subject) : [];
    const drafts: { last?: ActionDraft } = {};
    // A person the model looks up (D115) brings their work items into the turn's answer.
    const lookedUp = new Map<string, ManagedPerson>();
    const lookup = model.tools && people.people.length > 0;
    const own = [
      ...(draftable.length
        ? [
            draftTool(draftable, now.toISOString(), d => {
              drafts.last = d;
            }),
          ]
        : []),
      ...(lookup ? [personTool(people, now.toISOString(), p => lookedUp.set(p.key, p))] : []),
    ];
    const system = systemPrompt({
      name: persona.name,
      role: persona.role,
      unitLabel: persona.unitLabel,
      now,
      week: weekNumber(displayDate(now.toISOString())),
      objects: serialiseContext(chips.objects, now.toISOString(), people.guards),
      drafts: draftable.length > 0,
      ...(people.people.length ? { people: { lines: peopleLines(people, now.toISOString()), lookup } } : {}),
    });
    let sent = '';
    const onText = (step: string) => {
      const visible = visibleSoFar(step);
      if (visible.startsWith(sent)) {
        if (visible.length > sent.length) turn.emit({ type: 'text', delta: visible.slice(sent.length) });
      } else turn.emit({ type: 'text', delta: visible, reset: true });
      sent = visible;
    };
    try {
      // The search fan-out (D26) takes up to four seconds of its own, so a turn that may search gets a longer budget than a plain read.
      const timeoutMs = tools.some(t => t.name === SEARCH_TOOL) ? 12_000 : 8_000;
      const started = clock().getTime();
      const answer = await modelAnswer({
        system,
        history: history.slice(-20).map(m => ({ role: m.role, body: m.body })),
        text,
        tools,
        run: (name, input) => turn.run(name, input),
        generate: model.generate,
        timeoutMs,
        onText,
        ...(turn.signal ? { signal: turn.signal } : {}),
        ...(own.length ? { own } : {}),
      });
      // The draft is not a read: it names no source, offers no view and is kept as the turn's draft instead.
      const reads = answer.toolCalls.filter(c => c.capability !== DRAFT_TOOL);
      const ended = clock();
      models.health.mark(model.providerId, true, ended.toISOString());
      // The turn's record (D91): what it cost and where its trace is, never what was said.
      const traceId = deps.trace?.();
      const modelCall: ModelCall = {
        providerId: model.providerId,
        durationMs: Math.max(0, ended.getTime() - started),
        ...(answer.usage?.steps !== undefined ? { steps: answer.usage.steps } : {}),
        ...(answer.usage?.inputTokens !== undefined ? { inputTokens: answer.usage.inputTokens } : {}),
        ...(answer.usage?.outputTokens !== undefined ? { outputTokens: answer.usage.outputTokens } : {}),
        ...(answer.usage?.finishReason ? { finishReason: answer.usage.finishReason.slice(0, 40) } : {}),
        ...(traceId ? { traceId } : {}),
      };
      // A lookup of a person is Clew's own (D115) and names no source; the sources are the systems that were read.
      const sourced = reads.filter(c => c.capability !== PERSON_TOOL);
      const source = sourced.length
        ? [...new Set(sourced.map(c => tools.find(t => t.name === c.capability)?.source ?? 'Startsidan'))].join(', ')
        : 'Assistenten';
      const searched = reads.find(c => c.capability === SEARCH_TOOL && isSearchResult(c.output));
      const parsed = parseAnswer(answer.body);
      const sources = searched ? citationsOf(searched.output as SearchResult) : undefined;
      // A document answer's view is its sources, named so; follow-ups come from the model's trailer, else the document's headings, else the nearest capabilities.
      const view =
        answer.view && answer.view.capability === SEARCH_TOOL ? { ...answer.view, title: 'Källor' } : answer.view;
      const followUps = parsed.followUps.length
        ? parsed.followUps
        : searched
          ? headingFollowUps((searched.output as SearchResult).rows)
          : nearest(text, tools).map(t => t.title);
      const draft = drafts.last;
      const found = [...lookedUp.values()].flatMap(p => people.work(p).map(t => t.id));
      const shape: Produced['shape'] = draft ? 'forslag' : (parsed.shape ?? (view ? 'vy' : 'svar'));
      return {
        body: parsed.body,
        source,
        shape,
        assistant: 'model',
        clewActions: [],
        toolCalls: reads,
        followUps,
        ...(view ? { view } : {}),
        ...(sources?.length ? { sources } : {}),
        ...(draft && subject
          ? {
              draft: {
                kind: 'action' as const,
                threadId: subject.id,
                actionId: draft.actionId,
                values: draft.values,
                thread: subject,
              },
            }
          : {}),
        model: { id: model.id, title: model.title },
        modelCall,
        ...(found.length ? { cards: found } : {}),
      };
    } catch (e) {
      if (turn.signal?.aborted) throw new TurnStopped();
      models.health.mark(model.providerId, false, clock().toISOString());
      const reason = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      deps.log('assistant: model unavailable, falling back to the router:', reason);
      if (sent) turn.emit({ type: 'text', delta: '', reset: true });
      return { unavailable: reason };
    }
  }
  /**
   * One turn of the conversation. A listener hears its steps and the model's text while it runs (D36); the turn, its two
   * messages and its audit row are still written together once the answer is known, and a turn stopped before that
   * writes nothing.
   */
  async function converse(
    persona: AuthenticatedContext,
    input: ConversationInput,
    observer: TurnObserver = {},
  ): Promise<ConversationResponse> {
    const turn = turnFor(persona, observer);
    const chips: Chip[] = input.chips ?? [];
    const resolved = await resolveChips(deps, persona, chips);
    const existing = input.conversationId ? await access.read(persona, input.conversationId) : undefined;
    if (input.conversationId && (!existing || existing.kind !== 'question'))
      throw new InputError('Samtalet finns inte.');
    const history = existing?.messages ?? [];
    // The people the question names among those the asker manages, and the asker's open work about them (D115).
    const people = await peopleInTurn(
      deps,
      persona,
      input.text,
      history.filter(m => m.role === 'user').map(m => m.body),
    );
    // The cards this turn is about (H1): the chipped cards, else the open cards the question names. Asking for a card and
    // being told about it land on the same card. A card the conversation already shows is not drawn again: that one is live.
    const chippedCards = [...resolved.threads.values()].filter(t => t.kind === 'pushed');
    const named = chippedCards.length
      ? []
      : matchCards(
          input.text,
          (await access.list(persona, clock().toISOString())).filter(t => t.state === 'open' && t.kind === 'pushed'),
        );
    const shown = new Set(history.flatMap(m => m.meta?.cards ?? []));
    // The model reads a named card as if the person had pointed at it.
    const context: ResolvedChips = named.length
      ? {
          ...resolved,
          objects: [
            ...resolved.objects,
            ...named.map(t => ({ kind: 'thread' as const, ref: 'thread:' + t.id, thread: t })),
          ],
        }
      : resolved;
    let produced: Produced | undefined;
    if (resolved.primaryThread) produced = await chipPath(persona, input.text, resolved.primaryThread);
    // The person's model is resolved on the server for every turn (D24): their pick, else the default; none means the router (D8).
    const model = produced ? undefined : await models.resolve(persona);
    const fallback = model ? 'unavailable' : 'router';
    let fallbackReason: string | undefined;
    if (!produced && model) {
      const outcome = await modelPath(persona, input.text, history, context, model, turn, people);
      if ('unavailable' in outcome) fallbackReason = outcome.unavailable;
      else produced = outcome;
    }
    if (!produced && named.length) produced = cardPath(named, fallback);
    if (!produced) produced = await routerPath(persona, input.text, fallback, turn, people);
    if (observer.signal?.aborted) throw new TurnStopped();
    // Drawn in the turn: the chipped or named cards, then the asker's work about the people the question names or the
    // model looked up (D115), each once, three at most.
    const cards = [
      ...new Set([...[...chippedCards, ...named, ...namedWork(people)].map(t => t.id), ...(produced.cards ?? [])]),
    ]
      .filter(id => !shown.has(id))
      .slice(0, 3);
    const at = clock().toISOString();
    const conversationId = existing?.id ?? ids();
    const refs = chips.map(c => c.ref);
    const assistantMeta: MessageMeta = {
      shape: produced.shape,
      assistant: produced.assistant,
      source: produced.source,
      // Include the full available source set: nested search and generated prose can combine several sources.
      access: {
        connectors: registry
          .list()
          .filter(c => registry.visible(persona, c.id))
          .map(c => c.id),
        capabilities: registry.capabilitiesFor(persona).map(c => c.capability.name),
        authorizationVersion: persona.authorizationVersion,
      },
      ...(produced.view ? { view: produced.view } : {}),
      ...(produced.draft
        ? {
            draft: {
              kind: produced.draft.kind,
              threadId: produced.draft.threadId,
              ...(produced.draft.refs ? { refs: produced.draft.refs } : {}),
              ...(produced.draft.week ? { week: produced.draft.week } : {}),
              ...(produced.draft.actionId ? { actionId: produced.draft.actionId } : {}),
              ...(produced.draft.values ? { values: produced.draft.values } : {}),
            },
          }
        : {}),
      ...(produced.toolCalls?.length
        ? { toolCalls: produced.toolCalls.map(c => ({ capability: c.capability, input: c.input })) }
        : {}),
      ...(produced.sources?.length ? { sources: produced.sources } : {}),
      ...(produced.followUps.length ? { followUps: produced.followUps.slice(0, 3) } : {}),
      ...(cards.length ? { cards } : {}),
      ...(produced.model ? { model: produced.model } : {}),
      ...(produced.modelCall ? { modelCall: produced.modelCall } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
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
          summary: produced!.body,
          items: [],
          actions: [],
          waitingOn: null,
          deadline: null,
          trigger: { reason: 'Du ställde en fråga', source: produced!.source, at },
          createdAt: at,
          updatedAt: at,
        });
      } else {
        await tx.updateThread(conversationId, { summary: produced!.body, updatedAt: at });
      }
      await tx.addMessage(conversationId, {
        role: 'user',
        body: input.text,
        at,
        ...(chips.length ? { meta: { chips, refs } } : {}),
      });
      await tx.addMessage(conversationId, { role: 'assistant', body: produced!.body, at, meta: assistantMeta });
      await tx.writeAudit({
        actor: persona.principal.id,
        action: existing ? 'conversation.replied' : 'conversation.asked',
        subject: 'thread:' + conversationId,
        at,
        details: {
          assistant: produced!.assistant,
          shape: produced!.shape,
          chips: refs,
          tools: (produced!.toolCalls ?? []).map(c => c.capability),
          ...(produced!.view ? { view: produced!.view.capability } : {}),
          // An action the assistant filled in (D112 item 8): which one, on which item, and which asks it answered.
          // The values are the conversation's, never the audit row's.
          ...(produced!.draft?.kind === 'action'
            ? {
                drafted: {
                  thread: produced!.draft.threadId,
                  action: produced!.draft.actionId,
                  asks: Object.keys(produced!.draft.values ?? {}),
                },
              }
            : {}),
          ...(produced!.sources?.length ? { sources: produced!.sources.map(s => s.ref) } : {}),
          ...(cards.length ? { cards } : {}),
          ...(produced!.model ? { model: produced!.model.id } : {}),
          // The audit row finds the turn's trace and cost (D91); the text stays in the message, never here.
          ...(produced!.modelCall ? { modelCall: produced!.modelCall } : {}),
          ...(fallbackReason ? { fallbackReason } : {}),
        },
      });
    });
    const conversation = await thread(persona, conversationId);
    const verbs: Verb[] | undefined = resolved.primaryThread
      ? verbsFor(produced.draft?.thread ?? resolved.primaryThread)
      : undefined;
    return {
      conversationId,
      thread: conversation,
      shape: produced.shape,
      assistant: produced.assistant,
      answer: { body: produced.body, source: produced.source, at },
      ...(produced.view ? { view: produced.view } : {}),
      ...(produced.forslag ? { forslag: produced.forslag } : {}),
      ...(produced.draft ? { draft: produced.draft } : {}),
      clewActions: produced.clewActions,
      ...(verbs ? { verbs } : {}),
      followUps: produced.followUps.slice(0, 3),
      ...(produced.sources?.length ? { sources: produced.sources } : {}),
      ...(produced.model ? { model: produced.model } : {}),
    };
  }
  /** Kept for the first-session routes: a question is one conversation turn. */
  async function ask(persona: AuthenticatedContext, question: string): Promise<Thread> {
    return (await converse(persona, { text: question })).thread;
  }
  /** A reply in a card keeps today's in-card router; a reply in a question thread is a conversation turn. */
  async function reply(persona: AuthenticatedContext, threadId: string, body: string): Promise<Thread> {
    const current = await access.read(persona, threadId);
    if (!current) throw new InputError('Ärendet finns inte.');
    if (current.kind === 'question') return (await converse(persona, { text: body, conversationId: threadId })).thread;
    const chipped = await converse(persona, {
      text: body,
      chips: [{ ref: 'thread:' + threadId, kind: 'thread', label: current.title }],
    });
    const at = clock().toISOString();
    await store.transaction(async tx => {
      await tx.addMessage(threadId, { role: 'user', body, at });
      await tx.addMessage(threadId, {
        role: 'assistant',
        body: chipped.answer.body,
        at,
        meta: {
          shape: chipped.shape,
          assistant: chipped.assistant,
          source: chipped.answer.source,
          ...(chipped.model ? { model: chipped.model } : {}),
        },
      });
      await tx.writeAudit({
        actor: persona.principal.id,
        action: 'thread.replied',
        subject: 'thread:' + threadId,
        at,
        details: { conversation: chipped.conversationId },
      });
    });
    return thread(persona, threadId);
  }
  return {
    converse,
    ask,
    reply,
    completionsFor: (persona: AuthenticatedContext) => completionsFor(deps, persona),
    listObjects: (persona: AuthenticatedContext, q: string, near: string[] = []) => listObjects(deps, persona, q, near),
  };
}
export type AssistantUsecases = ReturnType<typeof assistantUsecases>;
