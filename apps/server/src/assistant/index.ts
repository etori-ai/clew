import type { AuthenticatedContext, Chip, ClewAction, ConversationInput, ConversationResponse, MessageMeta, SearchResult, Thread, Verb, ViewRef } from '@clew/contracts';
import { actorOf, SEARCH_CONNECTOR } from '@clew/connectors';
import { displayDate, weekNumber } from '@clew/calendar/dates';
import { InputError } from '../context';
import { resolveChips, type ResolvedChips } from './chips';
import { completionsFor } from './completions';
import { serialiseContext } from './context';
import { routeFixed } from './fixed';
import { headingFollowUps, matchCapability, nearest, searchAnswer, templatedAnswer } from './router';
import { modelAnswer, systemPrompt, type ToolCallRecord } from './model';
import { listObjects } from './objects';
import type { AssistantDeps } from './ports';
import { draftSelection, parseVerb, verbsFor } from './verbs';

export type { AssistantDeps, ModelProvider } from './ports';
export { verbsFor } from './verbs';

type Produced = {
  body: string; source: string; shape: ConversationResponse['shape']; assistant: ConversationResponse['assistant'];
  view?: ViewRef; draft?: NonNullable<ConversationResponse['draft']>; forslag?: { threadId: string }; clewActions: ClewAction[]; toolCalls?: ToolCallRecord[]; followUps: string[];
};
const SEARCH_TOOL = SEARCH_CONNECTOR + '.search';
const whyLine = (t: Thread) => `Varför nu? ${t.trigger.reason}. Källa: ${t.trigger.source}, ${new Date(t.trigger.at).toLocaleTimeString('sv-SE', { timeStyle: 'short', timeZone: 'Europe/Stockholm' })}.`;

/**
 * The assistant (D8, D12, D25): one conversation turn at a time, over ports. Chips are the explicit context; a
 * conversation is a question thread that keeps its memory; every turn and its audit row commit together. Execute
 * capabilities and the decision endpoint are never reached from here.
 */
export function assistantUsecases(deps: AssistantDeps) {
  const { store, registry, run, calendar, model, clock, ids } = deps;
  const todayDate = () => displayDate(clock().toISOString());
  const thread = async (persona: Pick<AuthenticatedContext, 'id'>, id: string) => (await store.readThread(persona.id, id))!;

  /** The chip path (D12): with one chipped card the assistant does not guess. Clew-side actions are only proposed; drafts change the card, never a source. */
  async function chipPath(persona: AuthenticatedContext, text: string, chipped: Thread): Promise<Produced | undefined> {
    const verb = parseVerb(text, chipped, todayDate());
    if (!verb) return undefined;
    const base = { source: 'Startsidan', assistant: 'router' as const, clewActions: [] as ClewAction[], followUps: [] as string[] };
    switch (verb.kind) {
      case 'dismiss': return { ...base, shape: 'svar', body: `Vill du att jag avfärdar kortet "${chipped.title}"? Det försvinner från Behöver dig och ligger kvar under Redan hanterat; du kan ångra i tio minuter.`,
        clewActions: [{ n: 1, kind: 'dismiss', threadId: chipped.id, label: `Avfärda "${chipped.title}"` }] };
      case 'snooze': return { ...base, shape: 'svar', body: `Vill du att jag tar upp kortet "${chipped.title}" i morgon 06:00 i stället?`,
        clewActions: [{ n: 1, kind: 'snooze', threadId: chipped.id, label: `Inte nu: "${chipped.title}" tas upp i morgon 06:00` }] };
      case 'why': return { ...base, shape: 'svar', source: chipped.trigger.source, body: whyLine(chipped) };
      case 'replan': {
        const updated = await calendar.replan(persona, chipped.id, verb.week!);
        return { ...base, shape: 'forslag', source: 'Kalendern', body: `Jag har ritat om förslagen i vecka ${weekNumber(verb.week!)}. Inget är skickat förrän du trycker på knappen i kortet.`, draft: { kind: 'replan', threadId: chipped.id, week: verb.week!, thread: updated } };
      }
      case 'primary': {
        let items: Thread['items'];
        try { items = draftSelection(chipped.items, verb.refs ?? []); } catch { throw new InputError('Något val är inte längre aktuellt. Läs om sidan.'); }
        const chosen = items.filter(i => i.selected).map(i => i.label.split(' · ')[0]);
        const at = clock().toISOString();
        await store.transaction(async tx => {
          await tx.updateThread(chipped.id, { items, updatedAt: at });
          await tx.addMessage(chipped.id, { role: 'assistant', at, body: `Utkast: ${chosen.length} av ${items.filter(i => i.selectable).length} valda. Knappen på kortet skickar.`, meta: { draft: { kind: 'select', threadId: chipped.id, refs: verb.refs ?? [] } } });
          await tx.writeAudit({ actor: persona.principal.id, action: 'thread.drafted', subject: 'thread:' + chipped.id, at, details: { refs: verb.refs ?? [] } });
        });
        return { ...base, shape: 'forslag', body: `Jag har ändrat kortet: ${chosen.join(', ')} ${chosen.length === 1 ? 'är vald' : 'är valda'}. Inget är skickat förrän du trycker på knappen i kortet.`, draft: { kind: 'select', threadId: chipped.id, refs: verb.refs ?? [], thread: await thread(persona, chipped.id) } };
      }
    }
  }
  /** The deterministic path (D8): the fixed questions, then the best matching read capability, then an honest "not yet". */
  async function routerPath(persona: AuthenticatedContext, text: string, assistant: 'router' | 'unavailable'): Promise<Produced> {
    const fixed = await routeFixed(deps, persona, text);
    if (fixed) return { body: fixed.body, source: fixed.source, shape: fixed.forslagThreadId ? 'forslag' : 'svar', assistant, clewActions: [], followUps: [], ...(fixed.forslagThreadId ? { forslag: { threadId: fixed.forslagThreadId } } : {}) };
    const tools = registry.tools(actorOf(persona));
    const match = matchCapability(text, tools.filter(t => t.name !== SEARCH_TOOL));
    if (match) {
      const output = await run(persona, match.name, {});
      const answer = templatedAnswer(match, {}, output, clock().toISOString());
      return { body: answer.body, source: match.source, shape: answer.view ? 'vy' : 'svar', assistant, clewActions: [], followUps: nearest(text, tools.filter(t => t.name !== match.name)).map(t => t.title), toolCalls: [{ capability: match.name, input: {}, output }], ...(answer.view ? { view: answer.view } : {}) };
    }
    // The catch-all (D26): a question no capability answers goes to the composite search as typed, and the hits become a view the person reads.
    const searchTool = tools.find(t => t.name === SEARCH_TOOL);
    if (searchTool) {
      const input = { query: text };
      const output = await run<SearchResult>(persona, SEARCH_TOOL, input);
      const answer = searchAnswer(output, clock().toISOString());
      return { body: answer.body, source: searchTool.source, shape: 'vy', assistant, clewActions: [], followUps: headingFollowUps(output.rows), toolCalls: [{ capability: SEARCH_TOOL, input, output }],
        view: { capability: SEARCH_TOOL, input, title: 'Källor', source: searchTool.source } };
    }
    const near = nearest(text, tools).map(t => t.title);
    return { body: `Det där kan jag inte svara på ännu. Jag kan svara om ${near.length ? near.map(t => t.toLowerCase()).join(', ') : 'dagen, utvecklingssamtalen, frånvaron, budgeten och HME'}.`, source: 'Startsidan', shape: 'svar', assistant, clewActions: [], followUps: near };
  }
  /** The model path: read tools only, chips as explicit context, the deterministic router as the fallback when it fails. */
  async function modelPath(persona: AuthenticatedContext, text: string, history: Thread['messages'], chips: ResolvedChips): Promise<Produced | undefined> {
    if (!model.generate || !model.status().available) return undefined;
    const tools = registry.tools(actorOf(persona));
    const now = clock();
    const system = systemPrompt({ name: persona.name, role: persona.role, unitLabel: persona.unitLabel, now, week: weekNumber(displayDate(now.toISOString())), objects: serialiseContext(chips.objects) });
    try {
      const answer = await modelAnswer({ system, history: history.slice(-20).map(m => ({ role: m.role, body: m.body })), text, tools, run: (name, input) => run(persona, name, input), generate: model.generate });
      model.markAvailable();
      const source = answer.toolCalls.length ? [...new Set(answer.toolCalls.map(c => tools.find(t => t.name === c.capability)?.source ?? 'Startsidan'))].join(', ') : 'Assistenten';
      return { body: answer.body, source, shape: answer.view ? 'vy' : 'svar', assistant: 'model', clewActions: [], toolCalls: answer.toolCalls, followUps: nearest(text, tools).map(t => t.title), ...(answer.view ? { view: answer.view } : {}) };
    } catch (e) {
      model.markUnavailable();
      deps.log('assistant: model unavailable, falling back to the router:', e instanceof Error ? e.message : e);
      return undefined;
    }
  }
  /** One turn of the conversation. */
  async function converse(persona: AuthenticatedContext, input: ConversationInput): Promise<ConversationResponse> {
    const chips: Chip[] = input.chips ?? [];
    const resolved = await resolveChips(deps, persona, chips);
    const existing = input.conversationId ? await store.readThread(persona.id, input.conversationId) : undefined;
    if (input.conversationId && (!existing || existing.kind !== 'question')) throw new InputError('Samtalet finns inte.');
    const history = existing?.messages ?? [];
    let produced: Produced | undefined;
    if (resolved.primaryThread) produced = await chipPath(persona, input.text, resolved.primaryThread);
    if (!produced) produced = await modelPath(persona, input.text, history, resolved);
    if (!produced) produced = await routerPath(persona, input.text, model.status().configured ? 'unavailable' : 'router');
    const at = clock().toISOString();
    const conversationId = existing?.id ?? ids();
    const refs = chips.map(c => c.ref);
    const assistantMeta: MessageMeta = { shape: produced.shape, assistant: produced.assistant, source: produced.source,
      ...(produced.view ? { view: produced.view } : {}), ...(produced.draft ? { draft: { kind: produced.draft.kind, threadId: produced.draft.threadId, ...(produced.draft.refs ? { refs: produced.draft.refs } : {}), ...(produced.draft.week ? { week: produced.draft.week } : {}) } } : {}),
      ...(produced.toolCalls?.length ? { toolCalls: produced.toolCalls.map(c => ({ capability: c.capability, input: c.input })) } : {}) };
    await store.transaction(async tx => {
      if (!existing) {
        await tx.insertThread({ id: conversationId, personId: persona.id, kind: 'question', topic: 'question', title: input.text.slice(0, 80), state: 'open', week: null, connector: 'startsidan', area: 'fragor', summary: produced!.body,
          items: [], actions: [], waitingOn: null, deadline: null, trigger: { reason: 'Du ställde en fråga', source: produced!.source, at }, createdAt: at, updatedAt: at });
      } else {
        await tx.updateThread(conversationId, { summary: produced!.body, updatedAt: at });
      }
      await tx.addMessage(conversationId, { role: 'user', body: input.text, at, ...(chips.length ? { meta: { chips, refs } } : {}) });
      await tx.addMessage(conversationId, { role: 'assistant', body: produced!.body, at, meta: assistantMeta });
      await tx.writeAudit({ actor: persona.principal.id, action: existing ? 'conversation.replied' : 'conversation.asked', subject: 'thread:' + conversationId, at,
        details: { assistant: produced!.assistant, shape: produced!.shape, chips: refs, tools: (produced!.toolCalls ?? []).map(c => c.capability), ...(produced!.view ? { view: produced!.view.capability } : {}) } });
    });
    const conversation = await thread(persona, conversationId);
    const verbs: Verb[] | undefined = resolved.primaryThread ? verbsFor(produced.draft?.thread ?? resolved.primaryThread) : undefined;
    return { conversationId, thread: conversation, shape: produced.shape, assistant: produced.assistant, answer: { body: produced.body, source: produced.source, at },
      ...(produced.view ? { view: produced.view } : {}), ...(produced.forslag ? { forslag: produced.forslag } : {}), ...(produced.draft ? { draft: produced.draft } : {}),
      clewActions: produced.clewActions, ...(verbs ? { verbs } : {}), followUps: produced.followUps.slice(0, 3) };
  }
  /** Kept for the first-session routes: a question is one conversation turn. */
  async function ask(persona: AuthenticatedContext, question: string): Promise<Thread> {
    return (await converse(persona, { text: question })).thread;
  }
  /** A reply in a card keeps today's in-card router; a reply in a question thread is a conversation turn. */
  async function reply(persona: AuthenticatedContext, threadId: string, body: string): Promise<Thread> {
    const current = await store.readThread(persona.id, threadId);
    if (!current) throw new InputError('Tråden finns inte.');
    if (current.kind === 'question') return (await converse(persona, { text: body, conversationId: threadId })).thread;
    const chipped = await converse(persona, { text: body, chips: [{ ref: 'thread:' + threadId, kind: 'thread', label: current.title }] });
    const at = clock().toISOString();
    await store.transaction(async tx => {
      await tx.addMessage(threadId, { role: 'user', body, at });
      await tx.addMessage(threadId, { role: 'assistant', body: chipped.answer.body, at, meta: { shape: chipped.shape, assistant: chipped.assistant, source: chipped.answer.source } });
      await tx.writeAudit({ actor: persona.principal.id, action: 'thread.replied', subject: 'thread:' + threadId, at, details: { conversation: chipped.conversationId } });
    });
    return thread(persona, threadId);
  }
  return {
    converse, ask, reply,
    completionsFor: (persona: AuthenticatedContext) => completionsFor(deps, persona),
    listObjects: (persona: AuthenticatedContext, q: string) => listObjects(deps, persona, q),
    status: () => model.status(),
  };
}
export type AssistantUsecases = ReturnType<typeof assistantUsecases>;
