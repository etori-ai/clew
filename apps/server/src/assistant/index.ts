import { eq } from 'drizzle-orm';
import type { AuthenticatedContext, Chip, ClewAction, ConversationInput, ConversationResponse, MessageMeta, Thread, Verb, ViewRef } from '@clew/contracts';
import { database, schema } from '@clew/db';
import { addMessage, readThread, writeAudit } from '@clew/db/threads';
import { weekNumber, today } from '@clew/calendar/dates';
import { InputError } from '../context';
import { actorOf, registry, runCapability } from '../connectors/registry';
import { calendar } from '../composition';
import { resolveChips, type ResolvedChips } from './chips';
import { serialiseContext } from './context';
import { routeFixed } from './fixed';
import { matchCapability, nearest, templatedAnswer } from './router';
import { modelAnswer, systemPrompt, type ToolCallRecord } from './model';
import { markAvailable, markUnavailable, providerOf, providerStatus } from './status';
import { draftSelection, parseVerb, verbsFor } from './verbs';
import { completionsFor } from './completions';

export { completionsFor } from './completions';
export { listObjects } from './objects';
export { providerStatus, startAssistantProbe } from './status';
export { verbsFor } from './verbs';

type Produced = {
  body: string; source: string; shape: ConversationResponse['shape']; assistant: ConversationResponse['assistant'];
  view?: ViewRef; draft?: NonNullable<ConversationResponse['draft']>; forslag?: { threadId: string }; clewActions: ClewAction[]; toolCalls?: ToolCallRecord[]; followUps: string[];
};
const whyLine = (t: Thread) => `Varför nu? ${t.trigger.reason}. Källa: ${t.trigger.source}, ${new Date(t.trigger.at).toLocaleTimeString('sv-SE', { timeStyle: 'short', timeZone: 'Europe/Stockholm' })}.`;

/** The chip path (D12): with one chipped card the assistant does not guess. Clew-side actions are only proposed; drafts change the card, never a source. */
async function chipPath(persona: AuthenticatedContext, text: string, thread: Thread): Promise<Produced | undefined> {
  const verb = parseVerb(text, thread);
  if (!verb) return undefined;
  const base = { source: 'Startsidan', assistant: 'router' as const, clewActions: [] as ClewAction[], followUps: [] as string[] };
  switch (verb.kind) {
    case 'dismiss': return { ...base, shape: 'svar', body: `Vill du att jag avfärdar kortet "${thread.title}"? Det försvinner från Behöver dig och ligger kvar under Redan hanterat; du kan ångra i tio minuter.`,
      clewActions: [{ n: 1, kind: 'dismiss', threadId: thread.id, label: `Avfärda "${thread.title}"` }] };
    case 'snooze': return { ...base, shape: 'svar', body: `Vill du att jag tar upp kortet "${thread.title}" i morgon 06:00 i stället?`,
      clewActions: [{ n: 1, kind: 'snooze', threadId: thread.id, label: `Inte nu: "${thread.title}" tas upp i morgon 06:00` }] };
    case 'why': return { ...base, shape: 'svar', source: thread.trigger.source, body: whyLine(thread) };
    case 'replan': {
      const updated = await calendar.replan(persona, thread.id, verb.week!);
      return { ...base, shape: 'forslag', source: 'Kalendern', body: `Jag har ritat om förslagen i vecka ${weekNumber(verb.week!)}. Inget är skickat förrän du trycker på knappen i kortet.`, draft: { kind: 'replan', threadId: thread.id, week: verb.week!, thread: updated } };
    }
    case 'primary': {
      let items: Thread['items'];
      try { items = draftSelection(thread.items, verb.refs ?? []); } catch { throw new InputError('Något val är inte längre aktuellt. Läs om sidan.'); }
      const chosen = items.filter(i => i.selected).map(i => i.label.split(' · ')[0]);
      await database().transaction(async tx => {
        await tx.update(schema.threads).set({ items, updatedAt: new Date() }).where(eq(schema.threads.id, thread.id));
        await addMessage(tx, thread.id, 'assistant', `Utkast: ${chosen.length} av ${items.filter(i => i.selectable).length} valda. Knappen på kortet skickar.`, { draft: { kind: 'select', threadId: thread.id, refs: verb.refs ?? [] } });
        await writeAudit(tx, { actor: persona.principal.id, action: 'thread.drafted', subject: 'thread:' + thread.id, details: { refs: verb.refs ?? [] } });
      });
      const updated = (await readThread(persona.id, thread.id))!.thread;
      return { ...base, shape: 'forslag', body: `Jag har ändrat kortet: ${chosen.join(', ')} ${chosen.length === 1 ? 'är vald' : 'är valda'}. Inget är skickat förrän du trycker på knappen i kortet.`, draft: { kind: 'select', threadId: thread.id, refs: verb.refs ?? [], thread: updated } };
    }
  }
}
/** The deterministic path (D8): the fixed questions, then the best matching read capability, then an honest "not yet". */
async function routerPath(persona: AuthenticatedContext, text: string, assistant: 'router' | 'unavailable'): Promise<Produced> {
  const fixed = await routeFixed(persona, text);
  if (fixed) return { body: fixed.body, source: fixed.source, shape: fixed.forslagThreadId ? 'forslag' : 'svar', assistant, clewActions: [], followUps: [], ...(fixed.forslagThreadId ? { forslag: { threadId: fixed.forslagThreadId } } : {}) };
  const tools = registry.tools(actorOf(persona));
  const match = matchCapability(text, tools);
  if (match) {
    const output = await runCapability(persona, match.name, {});
    const answer = templatedAnswer(match, {}, output, new Date().toISOString());
    return { body: answer.body, source: match.source, shape: answer.view ? 'vy' : 'svar', assistant, clewActions: [], followUps: nearest(text, tools.filter(t => t.name !== match.name)).map(t => t.title), toolCalls: [{ capability: match.name, input: {}, output }], ...(answer.view ? { view: answer.view } : {}) };
  }
  const near = nearest(text, tools).map(t => t.title);
  return { body: `Det där kan jag inte svara på ännu. Jag kan svara om ${near.length ? near.map(t => t.toLowerCase()).join(', ') : 'dagen, utvecklingssamtalen, frånvaron, budgeten och HME'}.`, source: 'Startsidan', shape: 'svar', assistant, clewActions: [], followUps: near };
}
/** The model path: read tools only, chips as explicit context, the deterministic router as the fallback when it fails. */
async function modelPath(persona: AuthenticatedContext, text: string, history: Thread['messages'], chips: ResolvedChips): Promise<Produced | undefined> {
  const provider = providerOf();
  if (!provider || !providerStatus().available) return undefined;
  const tools = registry.tools(actorOf(persona));
  const now = new Date();
  const system = systemPrompt({ name: persona.name, role: persona.role, unitLabel: persona.unitLabel, now, week: weekNumber(today()), objects: serialiseContext(chips.objects) });
  try {
    const answer = await modelAnswer({ system, history: history.slice(-20).map(m => ({ role: m.role, body: m.body })), text, tools, run: (name, input) => runCapability(persona, name, input), generate: provider.generate });
    markAvailable();
    const source = answer.toolCalls.length ? [...new Set(answer.toolCalls.map(c => tools.find(t => t.name === c.capability)?.source ?? 'Startsidan'))].join(', ') : 'Assistenten';
    return { body: answer.body, source, shape: answer.view ? 'vy' : 'svar', assistant: 'model', clewActions: [], toolCalls: answer.toolCalls, followUps: nearest(text, tools).map(t => t.title), ...(answer.view ? { view: answer.view } : {}) };
  } catch (e) {
    markUnavailable();
    console.error('assistant: model unavailable, falling back to the router:', e instanceof Error ? e.message : e);
    return undefined;
  }
}
/**
 * One turn of the conversation. Chips are the explicit context; a conversation is a question thread that keeps its
 * memory; every turn and its audit row commit together. Execute capabilities and the decision endpoint are never reached from here.
 */
export async function converse(persona: AuthenticatedContext, input: ConversationInput): Promise<ConversationResponse> {
  const chips: Chip[] = input.chips ?? [];
  const resolved = await resolveChips(persona, chips);
  const existing = input.conversationId ? await readThread(persona.id, input.conversationId) : undefined;
  if (input.conversationId && (!existing || existing.thread.kind !== 'question')) throw new InputError('Samtalet finns inte.');
  const history = existing?.thread.messages ?? [];
  let produced: Produced | undefined;
  if (resolved.primaryThread) produced = await chipPath(persona, input.text, resolved.primaryThread);
  if (!produced) produced = await modelPath(persona, input.text, history, resolved);
  if (!produced) produced = await routerPath(persona, input.text, providerStatus().configured ? 'unavailable' : 'router');
  const now = new Date();
  const conversationId = existing?.thread.id ?? crypto.randomUUID();
  const refs = chips.map(c => c.ref);
  const assistantMeta: MessageMeta = { shape: produced.shape, assistant: produced.assistant, source: produced.source,
    ...(produced.view ? { view: produced.view } : {}), ...(produced.draft ? { draft: { kind: produced.draft.kind, threadId: produced.draft.threadId, ...(produced.draft.refs ? { refs: produced.draft.refs } : {}), ...(produced.draft.week ? { week: produced.draft.week } : {}) } } : {}),
    ...(produced.toolCalls?.length ? { toolCalls: produced.toolCalls.map(c => ({ capability: c.capability, input: c.input })) } : {}) };
  await database().transaction(async tx => {
    if (!existing) {
      await tx.insert(schema.threads).values({ id: conversationId, personId: persona.id, kind: 'question', topic: 'question', title: input.text.slice(0, 80), state: 'open', week: null, connector: 'startsidan', area: 'fragor', summary: produced!.body,
        trigger: { reason: 'Du ställde en fråga', source: produced!.source, at: now.toISOString() } });
    } else {
      await tx.update(schema.threads).set({ summary: produced!.body, updatedAt: now }).where(eq(schema.threads.id, conversationId));
    }
    await addMessage(tx, conversationId, 'user', input.text, chips.length ? { chips, refs } : undefined);
    await addMessage(tx, conversationId, 'assistant', produced!.body, assistantMeta);
    await writeAudit(tx, { actor: persona.principal.id, action: existing ? 'conversation.replied' : 'conversation.asked', subject: 'thread:' + conversationId,
      details: { assistant: produced!.assistant, shape: produced!.shape, chips: refs, tools: (produced!.toolCalls ?? []).map(c => c.capability), ...(produced!.view ? { view: produced!.view.capability } : {}) } });
  });
  const thread = (await readThread(persona.id, conversationId))!.thread;
  const verbs: Verb[] | undefined = resolved.primaryThread ? verbsFor(produced.draft?.thread ?? resolved.primaryThread) : undefined;
  return { conversationId, thread, shape: produced.shape, assistant: produced.assistant, answer: { body: produced.body, source: produced.source, at: now.toISOString() },
    ...(produced.view ? { view: produced.view } : {}), ...(produced.forslag ? { forslag: produced.forslag } : {}), ...(produced.draft ? { draft: produced.draft } : {}),
    clewActions: produced.clewActions, ...(verbs ? { verbs } : {}), followUps: produced.followUps.slice(0, 3) };
}
/** Kept for the first-session routes: a question is one conversation turn. */
export async function ask(persona: AuthenticatedContext, question: string): Promise<Thread> {
  return (await converse(persona, { text: question })).thread;
}
/** A reply in a card keeps today's in-card router; a reply in a question thread is a conversation turn. */
export async function reply(persona: AuthenticatedContext, threadId: string, body: string): Promise<Thread> {
  const current = await readThread(persona.id, threadId);
  if (!current) throw new InputError('Tråden finns inte.');
  if (current.thread.kind === 'question') return (await converse(persona, { text: body, conversationId: threadId })).thread;
  const chipped = await converse(persona, { text: body, chips: [{ ref: 'thread:' + threadId, kind: 'thread', label: current.thread.title }] });
  await database().transaction(async tx => {
    await addMessage(tx, threadId, 'user', body);
    await addMessage(tx, threadId, 'assistant', chipped.answer.body, { shape: chipped.shape, assistant: chipped.assistant, source: chipped.answer.source });
    await writeAudit(tx, { actor: persona.principal.id, action: 'thread.replied', subject: 'thread:' + threadId, details: { conversation: chipped.conversationId } });
  });
  return (await readThread(persona.id, threadId))!.thread;
}
