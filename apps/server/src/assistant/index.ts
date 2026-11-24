import type {
  AskValues,
  AuthenticatedContext,
  Chip,
  ClewAction,
  HandoverAssistant,
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
  View,
  ViewRef,
  WrittenTurn,
} from '@clew/contracts';
import { matchesWrittenTurn, turnRequestKey, viewRows } from '@clew/contracts';
import { citationsOf, parseAnswer, visibleSoFar } from './answer';
import { audiencedActorOf, answersOf, CLEW_SOURCE, readsSummary, SEARCH_CONNECTOR } from '@clew/connectors';
import { dayLabel, displayDate, timeLabel, weekNumber } from '@clew/calendar/dates';
import { InputError } from '../context';
import { cardRows, namedItems, type CardRows } from './card';
import { resolveChips, type ResolvedChips, type ResolvedObject } from './chips';
import { serialiseContext, sourceLine } from './context';
import { routeFixed } from './fixed';
import {
  headingFollowUps,
  matchCapability,
  matchCards,
  matchPropose,
  nearest,
  searchAnswer,
  templatedAnswer,
  viewAnswer,
  viewInput,
} from './router';
import {
  FIXED_ANSWER,
  HISTORY_MESSAGE_MAX,
  modelAnswer,
  ModelUnavailable,
  systemPrompt,
  TURN_MS,
  type ModelUsage,
  type ReadRecord,
  type ToolCallRecord,
} from './model';
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
  speaksOf,
  type ManagedPerson,
  type PeopleInTurn,
} from './people';
import { WireError, type AssistantDeps, type ResolvedModel } from './ports';
import { draftSelection, parseVerb, verbsFor } from './verbs';
import { threadAccess } from '../threads/access';
import { HandoverHeld, HandoverOffered, TurnStopped } from './domain';
import { assistantLine, HANDOVER_TOOL, handoverPath, handoverTool, ROUTABLE_MAX } from './handover';

export { HandoverHeld, HandoverOffered, TurnStopped } from './domain';
export type { AssistantDeps, ModelResolver } from './ports';
export { verbsFor } from './verbs';

type Produced = {
  body: string;
  source: string;
  shape: ConversationResponse['shape'];
  assistant: ConversationResponse['assistant'];
  view?: ViewRef;
  /** Which rows of the view the card draws (`cardRows`). */
  viewRows?: CardRows;
  /** The work items among the rows the answer names (`namedItems`). */
  viewItems?: string[];
  draft?: NonNullable<ConversationResponse['draft']>;
  forslag?: { threadId: string };
  clewActions: ClewAction[];
  toolCalls?: ToolCallRecord[];
  followUps: string[];
  sources?: SourceCitation[];
  /** The administered model that wrote the answer (D24). */
  model?: ModelRef;
  /** Work items about a person the model looked up in the turn (D115), drawn with the answer. */
  cards?: string[];
  /** What the answer's text was written from besides its reads (`MessageMeta.basis`). */
  basis?: Basis;
};
/** `MessageMeta.basis`: the work items whose text, and the connectors whose data, an answer was written from. */
type Basis = NonNullable<MessageMeta['basis']>;
const basisOf = (items: Iterable<string>, connectors: Iterable<string>, capabilities: Iterable<string> = []): Basis => {
  const list = (values: Iterable<string>) => [...new Set(values)].slice(-100);
  const [i, c, r] = [list(items), list(connectors), list(capabilities)];
  return {
    ...(i.length ? { items: i } : {}),
    ...(c.length ? { connectors: c } : {}),
    ...(r.length ? { capabilities: r } : {}),
  };
};
/** The model path did not answer (D8): the router takes over and the reason is kept with the turn. */
type ModelUnavailableOutcome = { unavailable: string };
/** The model suggests an assistant of another system for the question (D125 item 11): which one. */
type HandedOutcome = { handTo: string };
const SEARCH_TOOL = SEARCH_CONNECTOR + '.search';
/** A question's turn key as the page makes it (`TurnKey`). */
const TURN_KEY = /^[A-Za-z0-9-]{8,64}$/;
/**
 * How long the page's read-back after Stoppa waits for a turn with its key still running in this process (WD-L3): long
 * enough for a stopped turn to write what it must (a propose's item as its answer), short enough that a turn that does
 * not end holds no request open.
 */
const TURN_WAIT_MS = 3000;
/** Waits until `run` has settled, `ms` at most; neither its answer nor its failure is the waiter's. */
async function settledWithin(run: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    run.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>(resolve => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
}
/**
 * A question sent under a key that is another question's: another person's, or this person's for another conversation,
 * other words or another assistant. It is refused before anything is asked, and the words do not say which, so nobody
 * learns that a key is held elsewhere.
 */
const KEY_REFUSED = 'Frågan kunde inte ställas. Skriv den igen.';
/** What a caller hears while a turn runs (D36): the capabilities it reads and the model's text so far; `signal` is the person pressing Stoppa. */
export interface TurnObserver {
  emit?: (event: TurnEvent) => void;
  signal?: AbortSignal;
  /**
   * The caller can ask the person whether a question should go to another system's assistant (D125 item 11): only
   * then is Clew's own model offered the choice, and a choice ends the turn as `HandoverOffered`, with no conversation
   * saved: its audit row (`conversation.offered`) says which model was sent what.
   */
  offers?: boolean;
}
/**
 * One read a turn made (D122 item 8): which capability, and how many rows it answered where it answers rows, or that it
 * failed (refused, as a read about someone the person may not ask about is, or not answered). Never what it answered: the
 * turn's audit row carries this list, and a row of content never enters it.
 */
type TurnRead = { capability: string; rows?: number; failed?: true };
/**
 * One turn's way out: its events, its stop signal, the capability runner that reports each read as a step, and the
 * reads it made, in order.
 */
interface Turn {
  emit: (event: TurnEvent) => void;
  signal: AbortSignal | undefined;
  /**
   * Run a capability for the turn; `model` names the model whose tool call it is, and a propose's audit row says so.
   * Every read of a turn, the router's as the model's, holds only what the assistant may have (`RunContext.forModel`):
   * what it answers is the model's now or later in the conversation.
   */
  run: <O = unknown>(name: string, input: unknown, by?: { model: string }) => Promise<O>;
  reads: TurnRead[];
  /** The work item a propose called in this turn became, and what the propose was given (`begin`). */
  started?: { threadId: string; capability: string; input: Record<string, unknown> };
  /**
   * The model the turn called and what the call cost (D91), set when the call ends, whether it answered, failed or was
   * stopped: the turn's record says which model was sent what, also when the router answered or nothing was saved.
   */
  called?: { model: ModelRef; call: ModelCall };
}
/** How many rows an output holds: its declared view's rows, else a top-level `rows`; undefined when it has none. */
const rowCount = (view: View | undefined, output: unknown): number | undefined => {
  const rows = view ? viewRows(view, output) : (output as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? rows.length : undefined;
};
/** What the model is told when its propose became a work item: that nothing was sent, so it does not say otherwise. */
const STARTED_NOTE =
  'Ett utkast visas för personen som ett ärende. Inget är skickat till något system: personen granskar utkastet och skickar det själv.';
const isSearchResult = (v: unknown): v is SearchResult =>
  !!v && typeof v === 'object' && Array.isArray((v as SearchResult).rows) && Array.isArray((v as SearchResult).sources);
/** The most lines about earlier reads the prompt carries. */
const EARLIER_MAX = 10;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/**
 * The connectors the rows of a read's answer come from (`MessageMeta.basis`): a composite's hit or row names the
 * connector it is from (`connector`; a search hit several sources found names each of them in `sources`), and so does
 * a row of the person's work items. An answer written from such rows is theirs too, so closing one of those connectors
 * to the assistant later withholds the answer from the history (D122 item 4), whichever read carried the rows.
 */
function rowConnectors(view: View | undefined, output: unknown): string[] {
  const rows = view ? viewRows(view, output) : isRecord(output) ? output.rows : undefined;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap(row => {
    if (!isRecord(row)) return [];
    const merged = Array.isArray(row.sources) ? row.sources : [];
    return [row, ...merged].flatMap(r => (isRecord(r) && typeof r.connector === 'string' ? [r.connector] : []));
  });
}
/**
 * An earlier turn as Clew's model hears it (D125): a question the person sent to another system's assistant, and what
 * that assistant answered, say so in their first words, so the model reads them as an exchange it listened to and
 * never as its own answer or its own read. A turn the other system failed to answer is Clew's own words already. An
 * answer Clew wrote without a model (the router, also when the model did not answer) quotes what other systems wrote:
 * a work item's summary and why now, a meeting's title, a hit's label. It is heard as such material (D122): on one line
 * (`sourceLine`), after `FIXED_ANSWER`, which the first rule of the prompt names, so a line a source planted in a
 * summary is read as material and never as Clew's own words to the model.
 */
export const heardBody = (m: Pick<Thread['messages'][number], 'role' | 'body' | 'meta'>): string => {
  // A question the person brought to Clew from the panel is a question to Clew.
  if (m.role === 'user' && m.meta?.handed && !m.meta.handed.fromSide)
    return `(Frågan ställdes till ${m.meta.handed.name} i ${m.meta.handed.source}.) ${m.body}`;
  const handover = m.role === 'assistant' ? m.meta?.handover : undefined;
  if (handover?.declined) return `(${handover.name} i ${handover.source} svarade inte på frågan.)`;
  if (handover && !handover.failed)
    return `(Det här svarade ${handover.name} i ${handover.source}, inte du. Det är inget du själv har läst.) ${m.body}`;
  if (m.role === 'assistant' && (m.meta?.assistant === 'router' || m.meta?.assistant === 'unavailable'))
    return `${FIXED_ANSWER} ${sourceLine(m.body, HISTORY_MESSAGE_MAX - FIXED_ANSWER.length - 1)}`;
  return m.body;
};
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
  const handOver = handoverPath(deps, written);
  /** Clew's own tools of a turn (D112 item 8, D115, D125 item 11): never a read of the registry, never switched off. */
  const OWN_TOOLS = new Set([PERSON_TOOL, DRAFT_TOOL, HANDOVER_TOOL]);
  /**
   * Whether a read's data may reach the model now (D122 item 4): its connector's assistant switch and its own, as
   * `Registry.tools` asks them. A read the registry no longer has is closed.
   */
  const readOpen = (capability: string) => {
    if (OWN_TOOLS.has(capability)) return true;
    const found = registry.find(capability);
    return !!found && registry.forModel(found.connector.id, capability);
  };
  /** The connector a thing the person pointed at belongs to, the read it is when it is one, and its system's name. */
  function originOf(o: ResolvedObject): { connector: string; capability?: string; source: string } {
    switch (o.kind) {
      case 'thread':
      case 'item':
      case 'proposal':
        return { connector: o.thread.connector, source: o.thread.trigger.source };
      case 'event':
        return { connector: 'calendar', source: registry.connector('calendar')?.source ?? 'Kalendern' };
      case 'capability':
        return { connector: registry.find(o.name)?.connector.id ?? '', capability: o.name, source: o.source };
      case 'document':
        // A passage is chipped as `document:<connector>:<the source's ref>` (the search's `fetchSource`).
        return { connector: o.ref.replace(/^document:/, '').split(':')[0] ?? '', source: o.hit.source };
    }
  }
  /**
   * Whether the administrator lets the model have a thing the person pointed at (D122 item 4): the same switches as for
   * a read, asked of the thing's connector, and of the read itself when it is one.
   */
  const objectOpen = (o: ResolvedObject) => {
    const at = originOf(o);
    return registry.forModel(at.connector, at.capability);
  };
  /** What the model is told of a thing the person pointed at that it may not have: that it is there, and whose. */
  const closedLine = (o: ResolvedObject) =>
    `Något ur ${originOf(o).source} som du inte får läsa. Säg att du inte kan läsa det, och gissa aldrig vad det är.`;
  /** What the model is told instead of an earlier answer it may not have again. */
  const WITHHELD = '(Ett tidigare svar som inte lämnas till dig. Läs med verktygen det du behöver.)';
  /**
   * The conversation so far as the model hears it (`heardBody`), each earlier answer checked first. Not handed over is
   * an answer that read, or was written from, a connector or read the administrator has closed to the assistant since
   * (D122 item 4), and, while the conversation's words could name someone the asker manages, an answer written from a
   * work item's own text when that item is about one of them now or can no longer be read (D115): the guard holds for
   * the conversation, not only for the turn's prompt. What the answers handed over were written from is the new
   * answer's too (`inherited`), so an answer that repeats one is withheld with it.
   */
  async function heardHistory(persona: AuthenticatedContext, messages: Thread['messages'], people: PeopleInTurn) {
    const items = new Map<string, Thread | undefined>();
    const itemOf = async (id: string) => {
      if (!items.has(id)) items.set(id, await access.read(persona, id));
      return items.get(id);
    };
    const heard: Array<{ role: 'user' | 'assistant'; body: string }> = [];
    const inherited = { items: [] as string[], connectors: [] as string[], capabilities: [] as string[] };
    for (const m of messages) {
      if (m.role !== 'assistant') {
        heard.push({ role: m.role, body: heardBody(m) });
        continue;
      }
      const meta = m.meta;
      const reads = [
        ...(meta?.reads ?? []).map(r => r.capability),
        ...(meta?.toolCalls ?? []).map(c => c.capability),
        ...(meta?.view ? [meta.view.capability] : []),
        ...(meta?.basis?.capabilities ?? []),
      ].filter(c => !OWN_TOOLS.has(c));
      let withheld = reads.some(c => !readOpen(c)) || (meta?.basis?.connectors ?? []).some(c => !registry.forModel(c));
      if (!withheld && people.mentioned.length)
        for (const id of meta?.basis?.items ?? []) {
          const item = await itemOf(id);
          if (!item || people.guards(item)) {
            withheld = true;
            break;
          }
        }
      if (withheld) {
        heard.push({ role: 'assistant', body: WITHHELD });
        continue;
      }
      heard.push({ role: 'assistant', body: heardBody(m) });
      inherited.items.push(...(meta?.basis?.items ?? []));
      inherited.connectors.push(...(meta?.basis?.connectors ?? []));
      inherited.capabilities.push(...reads);
    }
    return { heard, inherited };
  }
  /**
   * The prompt's lines about what earlier answers read (D122): when, which reads by title and how many rows each
   * answered, or that it failed. What a read held is never carried into a later turn, so a question about facts reads
   * again; an answer written before turns kept their reads names its reads without counts. A read now closed to the
   * assistant is not named (D122 item 4).
   */
  function earlierReads(messages: Thread['messages'], now: string): string[] {
    const when = (at: string) =>
      `${displayDate(at) === displayDate(now) ? '' : dayLabel(displayDate(at)) + ' '}kl. ${timeLabel(at)}`;
    return messages
      .filter(m => m.role === 'assistant')
      .flatMap(m => {
        const reads: TurnRead[] = m.meta?.reads ?? m.meta?.toolCalls?.map(c => ({ capability: c.capability })) ?? [];
        const said = reads
          .filter(r => !OWN_TOOLS.has(r.capability) && readOpen(r.capability))
          .map(
            r =>
              (registry.find(r.capability)?.capability.title ?? r.capability) +
              (r.failed
                ? ' (svarade inte)'
                : r.rows !== undefined
                  ? ` (${r.rows} ${r.rows === 1 ? 'rad' : 'rader'})`
                  : ''),
          );
        return said.length ? [`Svaret ${when(m.createdAt)}: ${said.join(', ')}.`] : [];
      })
      .slice(-EARLIER_MAX);
  }
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
    const reads: TurnRead[] = [];
    const run = async <O = unknown>(name: string, input: unknown, by?: { model: string }): Promise<O> => {
      known ??= registry.tools(audiencedActorOf(persona));
      const info = known.find(t => t.name === name);
      const step: Omit<TurnStep, 'status'> = {
        id: `steg-${++n}`,
        capability: name,
        title: info?.title ?? name,
        source: info?.source ?? CLEW_SOURCE,
      };
      const started = clock().getTime();
      const took = () => Math.max(0, clock().getTime() - started);
      emit({ type: 'step', step: { ...step, status: 'running' } });
      const proposed = info?.kind === 'propose' && !!deps.start;
      try {
        // A propose is never run as a read: asked for in a conversation it becomes a work item the person decides on,
        // through the same use case as an item the person starts themselves. What it was given is kept for the draft.
        // Every read of the turn is the assistant's, made for the person (D122 items 5 and 6), and what it answers is
        // the model's, now or when a later turn hears the answer: the registry keeps from it what the administrator has
        // closed to the assistant (D122 item 4), the router's reads as the model's, as the router routes only to the
        // reads `Registry.tools` offers.
        const output = proposed
          ? ((await begin(name, input, by)) as O)
          : await deps.run<O>(persona, name, input, { caller: 'assistant', forModel: true });
        emit({ type: 'step', step: { ...step, status: 'complete', ms: took() } });
        // A propose that became a work item is not a read: the item has its own audit row.
        if (proposed) return output;
        const rows = rowCount(registry.find(name)?.capability.view, output);
        reads.push({ capability: name, ...(rows !== undefined ? { rows } : {}) });
        return output;
      } catch (e) {
        emit({ type: 'step', step: { ...step, status: 'error', ms: took() } });
        if (!proposed) reads.push({ capability: name, failed: true });
        throw e;
      }
    };
    const begin = async (name: string, input: unknown, by?: { model: string }) => {
      const given = isRecord(input) ? input : {};
      // The propose's own topic says which work it is: asked again with more, in this turn or a later one, it is the
      // item that is already open, and what was said before is kept under what is said now. The item's audit row says
      // the assistant started it, and which model when a model's tool call did (D91).
      const { threadId } = await deps.start!(persona, name, given, {
        reason: 'Du bad assistenten förbereda det',
        same: 'topic',
        by: { assistant: true, ...(by ? { model: by.model } : {}) },
      });
      const before = turn.started?.threadId === threadId ? turn.started.input : {};
      turn.started = { threadId, capability: name, input: { ...before, ...given } };
      return { started: true, note: STARTED_NOTE };
    };
    const turn: Turn = { emit, signal: observer.signal, run, reads };
    return turn;
  }
  /**
   * The draft a started work item is shown with. What the assistant gave the propose is the person's to review: where
   * the item's action asks for a property of the same name, the value is the draft of that ask, checked as the decision
   * checks it and opened in the action's own dialog, where the person can change it (D112 item 8). A value that does
   * not pass is left out, and what is still missing is asked there. A draft of the same action on the same item earlier
   * in the conversation is what was said before: its values stand where this turn says nothing else. Nothing is sent
   * from here.
   */
  async function startedDraft(
    persona: AuthenticatedContext,
    started: NonNullable<Turn['started']>,
    now: string,
    history: Thread['messages'] = [],
  ): Promise<Pick<Produced, 'draft' | 'forslag'>> {
    const thread = await access.read(persona, started.threadId);
    if (!thread) return {};
    const action = draftableActions(registry, persona, thread)[0];
    const earlier = history
      .map(m => m.meta?.draft)
      .filter(d => d?.kind === 'action' && d.threadId === thread.id && d.actionId === action?.id)
      .at(-1)?.values;
    const told: Record<string, unknown> = { ...earlier, ...started.input };
    const values: AskValues = {};
    if (action)
      for (const ask of action.asks) {
        const value = told[ask.property];
        if (typeof value !== 'string' || !value.trim()) continue;
        const one = answersOf([ask], { [ask.property]: value }, now, action.input);
        if (!('problem' in one)) Object.assign(values, one.answers);
      }
    return action && Object.keys(values).length
      ? { draft: { kind: 'action', threadId: thread.id, actionId: action.id, values, thread } }
      : { forslag: { threadId: thread.id } };
  }

  /**
   * The answer when a work item was started and no model wrote one: the router's own start, or a model call that failed
   * after its propose had become an item. The item is the answer, so the person is never left with an item on Hem that
   * the conversation says nothing about.
   */
  async function startedAnswer(
    persona: AuthenticatedContext,
    started: NonNullable<Turn['started']>,
    assistant: 'router' | 'unavailable',
    history: Thread['messages'] = [],
  ): Promise<Produced> {
    const tool = registry.tools(audiencedActorOf(persona)).find(t => t.name === started.capability);
    const connector = registry.find(started.capability)?.connector.id;
    return {
      body: `Jag har förberett "${tool?.title ?? 'ärendet'}" som ett ärende. Fyll i uppgifterna och skicka när du är klar. Inget är skickat.`,
      source: tool?.source ?? CLEW_SOURCE,
      shape: 'forslag',
      assistant,
      clewActions: [],
      followUps: [],
      basis: basisOf([], connector ? [connector] : []),
      ...(await startedDraft(persona, started, clock().toISOString(), history)),
    };
  }

  /** The chip path (D12): with one chipped card the assistant does not guess. Clew-side actions are only proposed; drafts change the card, never a source. */
  async function chipPath(persona: AuthenticatedContext, text: string, chipped: Thread): Promise<Produced | undefined> {
    const verb = parseVerb(text, chipped, todayDate());
    if (!verb) return undefined;
    // Every answer here names the card; why now and the choice of rows quote its own text too.
    const base = {
      source: CLEW_SOURCE,
      assistant: 'router' as const,
      clewActions: [] as ClewAction[],
      followUps: [] as string[],
      basis: basisOf(verb.kind === 'why' || verb.kind === 'primary' ? [chipped.id] : [], [chipped.connector]),
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
    // The router names the work by title and last day, never its text: the systems it is from are what it rests on.
    if (about)
      return {
        ...about,
        shape: 'svar',
        assistant,
        clewActions: [],
        followUps: [],
        basis: basisOf(
          [],
          namedWork(people).map(t => t.connector),
        ),
      };
    const fixed = await routeFixed(deps, persona, text, { namesPerson: people.named.length > 0 });
    if (fixed)
      return {
        body: fixed.body,
        source: fixed.source,
        shape: fixed.forslagThreadId ? 'forslag' : 'svar',
        assistant,
        clewActions: [],
        followUps: [],
        basis: basisOf([], fixed.connectors),
        ...(fixed.forslagThreadId ? { forslag: { threadId: fixed.forslagThreadId } } : {}),
      };
    const tools = registry.tools(audiencedActorOf(persona));
    const match = matchCapability(
      text,
      tools.filter(t => t.name !== SEARCH_TOOL),
    );
    const wanted = deps.start ? matchPropose(text, tools) : undefined;
    if (wanted) {
      // Without the model the propose is started as it is: the work item asks the person for everything.
      await turn.run(wanted.name, {});
      if (turn.started) return startedAnswer(persona, turn.started, assistant);
    }
    if (match) {
      // A view with a search field takes the rest of what was typed as its question (D38); every other read runs as it is.
      const input = viewInput(text, match);
      const output = await turn.run(match.name, input);
      const answer =
        match.view && readsSummary(match.view)
          ? viewAnswer({ ...match, view: match.view }, input, output)
          : templatedAnswer(match, input, output);
      // Without a model the sentence counts the read and names none of it: the card is the read as it is.
      const rows = match.view ? viewRows(match.view, output) : undefined;
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
        ...(answer.view && rows ? { viewRows: { count: rows.length, show: 'all' as const } } : {}),
        basis: basisOf([], rowConnectors(match.view, output)),
      };
    }
    // The catch-all (D26): a question no capability answers goes to the composite search as typed, and the hits become a view the person reads.
    const searchTool = tools.find(t => t.name === SEARCH_TOOL);
    if (searchTool) {
      const input = { query: text };
      const output = await turn.run<SearchResult>(SEARCH_TOOL, input);
      const answer = searchAnswer(output);
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
        // The hits' labels are in the sentence: the answer is written from their systems.
        basis: basisOf([], rowConnectors(undefined, output)),
      };
    }
    const near = nearest(text, tools).map(t => t.title);
    return {
      body: `Det där kan jag inte svara på ännu. Jag kan svara om ${near.length ? near.map(t => t.toLowerCase()).join(', ') : 'dagen, utvecklingssamtalen, frånvaron, budgeten och HME'}.`,
      source: CLEW_SOURCE,
      shape: 'svar',
      assistant,
      clewActions: [],
      followUps: near,
    };
  }
  /**
   * The card path (D34, H1): a question that names an open card is answered with that card, without the model. The
   * sentence is the connector's own (the card's summary and why now); the card itself follows in the turn. Several
   * cards are named by their titles alone.
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
      basis: basisOf(
        named.length === 1 ? [first.id] : [],
        named.map(t => t.connector),
      ),
    };
  }
  /**
   * The model path: the person's model (D24), read tools only (none when the model is set not to use them), chips as
   * explicit context, the deterministic router as the fallback when it fails. An endpoint that did not answer, or refused
   * the key, marks the provider down until the probe or a test brings it back (D8); a turn that failed for reasons of its
   * own (it ran out of time, the endpoint refused that one request, the model wrote nothing) marks nothing. The text
   * streams to the turn's listener as it is written, the trailer held back (D36); when the router takes over, the
   * listener is told to start the text over. A stop is not a failure. What the call cost is the turn's record whatever
   * the outcome (`Turn.called`). Nothing the administrator has closed to the assistant reaches the model (D122 item 4):
   * a read, nor through a read (a composite's source, a work item of a closed system in the person's pile: the model's
   * reads say `forModel`), a thing the person pointed at, a work item about a person, an earlier answer written from
   * one or from rows one answered.
   */
  async function modelPath(
    persona: AuthenticatedContext,
    text: string,
    history: Thread['messages'],
    chips: ResolvedChips,
    model: ResolvedModel,
    turn: Turn,
    people: PeopleInTurn,
    /** The assistants of other systems this turn may be handed to (D125 item 11); none when it may not be. */
    routable: HandoverAssistant[] = [],
  ): Promise<Produced | ModelUnavailableOutcome | HandedOutcome> {
    if (!models.health.available(model.providerId)) return { unavailable: 'provider marked down' };
    const tools = model.tools ? registry.tools(audiencedActorOf(persona)) : [];
    const now = clock();
    // The work about a person the model is told of is the work whose system it may have.
    const told: PeopleInTurn = { ...people, work: p => people.work(p).filter(t => registry.forModel(t.connector)) };
    // The one work item the conversation is about may have its actions filled in as a draft (D112 item 8): only what
    // the person may do, only with a model that uses tools, and nothing is sent. Without one chipped, the one work item
    // about the one person the question names is that item (D115). A chipped item the model may not have has no draft.
    const primary = chips.primaryThread && registry.forModel(chips.primaryThread.connector);
    const subject = chips.primaryThread ? (primary ? chips.primaryThread : undefined) : personSubject(told);
    const draftable = model.tools && subject ? draftableActions(registry, persona, subject) : [];
    const drafts: { last?: ActionDraft } = {};
    // A person the model looks up (D115) brings their work items into the turn's answer.
    const lookedUp = new Map<string, ManagedPerson>();
    // The assistant of another system the model hands the question to, if it does (D125 item 11).
    const handTo: { assistant?: HandoverAssistant } = {};
    const lookup = model.tools && told.people.length > 0;
    const own = [
      ...(draftable.length
        ? [
            draftTool(draftable, now.toISOString(), d => {
              drafts.last = d;
            }),
          ]
        : []),
      ...(lookup ? [personTool(told, now.toISOString(), p => lookedUp.set(p.key, p))] : []),
      ...(model.tools && routable.length
        ? [
            handoverTool(routable, a => {
              handTo.assistant = a;
            }),
          ]
        : []),
    ];
    // What the model is given of the conversation so far: the last twenty messages' text, each earlier answer checked
    // (`heardHistory`), and which reads each earlier answer made, when and how many rows each answered. Never what a
    // read held: a question about facts reads again.
    const recent = history.slice(-20);
    const { heard, inherited } = await heardHistory(persona, recent, people);
    const earlier = earlierReads(recent, now.toISOString());
    // A thing the person pointed at that the model may not have is said to be there, never what it is.
    const lines = (objects: ResolvedObject[]) =>
      objects.flatMap(o => (objectOpen(o) ? serialiseContext([o], now.toISOString(), people.guards) : [closedLine(o)]));
    const system = systemPrompt({
      name: persona.name,
      role: persona.role,
      unitLabel: persona.unitLabel,
      ...(persona.assignments ? { unitId: persona.unitId, assignments: persona.assignments } : {}),
      now,
      week: weekNumber(displayDate(now.toISOString())),
      // What stands open beside the transcript is said as that, apart from what the person added to the conversation.
      objects: lines(chips.objects.filter(o => o.ref !== chips.beside)),
      ...(chips.beside ? { beside: lines(chips.objects.filter(o => o.ref === chips.beside)) } : {}),
      drafts: draftable.length > 0,
      ...(told.people.length ? { people: { lines: peopleLines(told, now.toISOString()), lookup } } : {}),
      ...(earlier.length ? { earlier } : {}),
      ...(model.tools && routable.length ? { assistants: routable.map(assistantLine) } : {}),
    });
    let sent = '';
    const onText = (step: string) => {
      // Once the question is handed over, what the model writes is not the answer: nothing of it is shown.
      if (handTo.assistant) return;
      const visible = visibleSoFar(step);
      if (visible.startsWith(sent)) {
        if (visible.length > sent.length) turn.emit({ type: 'text', delta: visible.slice(sent.length) });
      } else turn.emit({ type: 'text', delta: visible, reset: true });
      sent = visible;
    };
    // The turn's record (D91): which model, what the call cost and where its trace is, never what was said.
    const started = clock().getTime();
    const called = (usage?: ModelUsage) => {
      const traceId = deps.trace?.();
      turn.called = {
        model: { id: model.id, title: model.title },
        call: {
          providerId: model.providerId,
          durationMs: Math.max(0, clock().getTime() - started),
          ...(usage?.steps !== undefined ? { steps: usage.steps } : {}),
          ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
          ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
          ...(usage?.finishReason ? { finishReason: usage.finishReason.slice(0, 40) } : {}),
          ...(traceId ? { traceId } : {}),
        },
      };
    };
    try {
      const answer = await modelAnswer({
        system,
        history: heard,
        text,
        tools,
        run: (name, input) => turn.run(name, input, { model: model.id }),
        generate: model.generate,
        timeoutMs: TURN_MS,
        onText,
        ...(turn.signal ? { signal: turn.signal } : {}),
        ...(own.length ? { own } : {}),
        pointed: chips.objects.flatMap(o => (o.kind === 'capability' && objectOpen(o) ? [o.name] : [])),
      });
      called(answer.usage);
      models.health.mark(model.providerId, true, clock().toISOString());
      if (handTo.assistant) {
        // Whatever the model wrote before or after choosing is taken back: the assistant it chose answers.
        if (sent) turn.emit({ type: 'text', delta: '', reset: true });
        return { handTo: handTo.assistant.id };
      }
      // The draft is not a read: it names no source, offers no view and is kept as the turn's draft instead. Neither is
      // a propose that became a work item.
      const reads = answer.toolCalls.filter(
        c => c.capability !== DRAFT_TOOL && c.capability !== turn.started?.capability,
      );
      const begun = turn.started ? await startedDraft(persona, turn.started, now.toISOString(), history) : {};
      // The sources are the systems the turn read and that answered, by the registry's names for them; a lookup of a
      // person is Clew's own (D115) and names none. A turn that read nothing names none: the answer is the assistant's.
      const answered: ReadRecord[] = answer.reads.length
        ? answer.reads.filter(r => !r.failed)
        : reads.filter(c => !(isRecord(c.output) && 'error' in c.output));
      const sourced = answered.filter(c => c.capability !== PERSON_TOOL);
      const source = sourced.length
        ? [...new Set(sourced.map(c => tools.find(t => t.name === c.capability)?.source ?? CLEW_SOURCE))].join(', ')
        : 'Assistenten';
      const searched = answered.find(c => c.capability === SEARCH_TOOL && isSearchResult(c.output));
      // A source and a time the model wrote at the end anyway are cut: they stand under the answer, from the turn.
      const parsed = parseAnswer(answer.body, [...registry.list().map(c => c.source), CLEW_SOURCE, 'Assistenten']);
      const sources = searched ? citationsOf(searched.output as SearchResult) : undefined;
      // A document answer's view is its sources, named so; follow-ups come from the model's trailer, else the document's headings, else the nearest capabilities.
      const view =
        answer.view && answer.view.capability === SEARCH_TOOL ? { ...answer.view, title: 'Källor' } : answer.view;
      // The card draws the rows of its read that the answer is about (`cardRows`), worked out from the output as the
      // registry answered it and the answer as the person reads it.
      const declaredView = view?.declared ? tools.find(t => t.name === view.capability)?.view : undefined;
      const namedRows =
        view && declaredView ? cardRows(declaredView, view.input, answer.viewOutput, parsed.body) : undefined;
      // The read the person pointed at with a chip is what the turn is about (the product owner, 2026-11-16): its card
      // is drawn with the read's first rows whatever the answer's wording, since which rows a sentence happens to name
      // or count is the model's phrasing and not the person's question. And when the model answered without reading
      // anything that has a card, as it may from what an earlier turn said, the pointed read is made here, as the
      // person, so the card under the answer is still the thing they asked about, as it is now.
      const pointedTool = chips.objects
        .flatMap(o => (o.kind === 'capability' ? [tools.find(t => t.name === o.name)] : []))
        .find(t => t?.view && (t.view.kind === 'list' || t.view.kind === 'table'));
      let card = view;
      let shownRows = namedRows;
      // The work items the answer names among its read's rows (`namedItems`), so the pane beside the conversation can
      // lead to each of them: of the read the answer rests on, or of the pointed read made for the card below.
      let items = view && declaredView ? namedItems(declaredView, answer.viewOutput, parsed.body) : [];
      if (pointedTool?.view && view?.capability === pointedTool.name) {
        // An answer that names some of the rows (the late ones, the invoices) keeps the card on those rows.
        if (namedRows?.show === 'none') shownRows = { count: namedRows.count, show: 'all' };
      } else if (pointedTool?.view && !view) {
        // Only the read the person pointed at is made for a card. A follow-up without a chip that the model answers
        // from what was said is not read again here: such a turn makes no read (a logged read least of all).
        try {
          const output = await turn.run(pointedTool.name, {});
          const rows = cardRows(pointedTool.view, {}, output, parsed.body);
          if (rows) {
            items = namedItems(pointedTool.view, output, parsed.body);
            card = {
              capability: pointedTool.name,
              input: {},
              title: pointedTool.title,
              source: pointedTool.source,
              declared: true,
            };
            shownRows = rows.show === 'none' ? { count: rows.count, show: 'all' } : rows;
          }
        } catch {
          // A read that takes an input, or a source that does not answer: the answer stands without a card.
        }
      }
      const followUps = parsed.followUps.length
        ? parsed.followUps
        : searched
          ? headingFollowUps((searched.output as SearchResult).rows)
          : nearest(text, tools).map(t => t.title);
      const draft = drafts.last;
      // Open work about a person the model looked up is drawn only when the answer speaks of it.
      const found = [...lookedUp.values()].flatMap(p =>
        told
          .work(p)
          .filter(t => speaksOf(parsed.body, t.title))
          .map(t => t.id),
      );
      const shape: Produced['shape'] = draft || turn.started ? 'forslag' : (parsed.shape ?? (view ? 'vy' : 'svar'));
      // What the answer was written from besides this turn's reads (`MessageMeta.basis`): the work items whose own text
      // the prompt carried (a guarded item's title and buttons are not its text), the systems of everything the person
      // pointed at, of the work about the people the turn named or looked up and of the rows its reads answered (a
      // composite's hits and rows, the person's work items), and what the earlier answers it heard were written from.
      const pointedAt = chips.objects.filter(objectOpen);
      const basis = basisOf(
        [
          ...pointedAt.flatMap(o => ('thread' in o && !people.guards(o.thread) ? [o.thread.id] : [])),
          ...inherited.items,
        ],
        [
          ...pointedAt.map(o => originOf(o).connector),
          ...[...namedWork(told), ...[...lookedUp.values()].flatMap(p => told.work(p))].map(t => t.connector),
          ...answered.flatMap(r => rowConnectors(registry.find(r.capability)?.capability.view, r.output)),
          ...inherited.connectors,
        ],
        inherited.capabilities,
      );
      return {
        body: parsed.body,
        source,
        shape,
        assistant: 'model',
        clewActions: [],
        toolCalls: reads,
        followUps,
        ...(card ? { view: card } : {}),
        ...(shownRows ? { viewRows: shownRows } : {}),
        ...(items.length ? { viewItems: items } : {}),
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
          : begun),
        model: { id: model.id, title: model.title },
        ...(found.length ? { cards: found } : {}),
        basis,
      };
    } catch (e) {
      if (!turn.called) called(e instanceof ModelUnavailable ? e.usage : undefined);
      if (turn.signal?.aborted) throw new TurnStopped();
      // The model chose an assistant and then wrote nothing, or ran out of time: its choice stands, since its text was
      // never going to be the answer.
      if (handTo.assistant) {
        if (sent) turn.emit({ type: 'text', delta: '', reset: true });
        return { handTo: handTo.assistant.id };
      }
      // Only an endpoint that did not answer, or refused the key, is down (`ModelHealth`).
      const wire = [e, e instanceof Error ? e.cause : undefined].find((c): c is WireError => c instanceof WireError);
      if (wire && wire.kind !== 'unsupported') models.health.mark(model.providerId, false, clock().toISOString());
      const reason = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      deps.log('assistant: model unavailable, falling back to the router:', reason);
      if (sent) turn.emit({ type: 'text', delta: '', reset: true });
      return { unavailable: reason };
    }
  }
  /**
   * One turn of the conversation. A listener hears its steps and the model's text while it runs (D36); the turn, its two
   * messages and its audit row are still written together once the answer is known, and a turn stopped before that
   * writes nothing of the conversation. A turn stopped after a propose had become a work item is written whole, with
   * the item as its answer (WD-L3): the item was committed with its own audit row when it started, and the
   * conversation says so. A turn that ends without an answer after it called a model, read anything or started a work
   * item (stopped, offered to another system's assistant, or failed on the way) still writes its audit row (`unanswered`): which
   * model was sent what is never lost (D91, D122 item 8). A question sent with a key (`ConversationInput.turn`) that is
   * already written is answered with that turn and asks nothing, when it is the same request; a key that is another
   * question's is refused before anything is asked (`written`).
   */
  async function converse(
    persona: AuthenticatedContext,
    input: ConversationInput,
    observer: TurnObserver = {},
  ): Promise<ConversationResponse> {
    // The same question sent again under its key (WD-L3), after a stop or an answer that broke on its way: the turn as
    // it was written, and nothing asked or written again. A key that is another question's is refused here.
    if (!input.turn) return keyedTurn(persona, input, observer);
    const done = await written(persona, input.turn, input);
    if (done) return done;
    const key = runningKey(persona, input.turn);
    const identity = turnRequestKey(input);
    const active = running.get(key);
    if (active) {
      if (active.identity !== identity) throw new InputError(KEY_REFUSED);
      await active.turn;
      const answer = await written(persona, input.turn, input);
      if (!answer) throw new InputError(KEY_REFUSED);
      return answer;
    }
    const turn = keyedTurn(persona, input, observer);
    running.set(key, { identity, turn });
    try {
      return await turn;
    } finally {
      running.delete(key);
    }
  }
  /** The turns running in this process, by the person and the question's key (WD-L3). */
  const running = new Map<string, { identity: string; turn: Promise<ConversationResponse> }>();
  const runningKey = (persona: AuthenticatedContext, key: string) => `${persona.id}\n${key}`;
  async function keyedTurn(
    persona: AuthenticatedContext,
    input: ConversationInput,
    observer: TurnObserver,
  ): Promise<ConversationResponse> {
    try {
      // Handed to an assistant of another system: the person's words go there unchanged and Clew's own model is not
      // asked. Its answer stands as its own; Clew never answers in its place unasked.
      return await (input.assistant ? handOver(persona, input, observer) : clewTurn(persona, input, observer));
    } catch (e) {
      // Two sends of one question raced and the other wrote first (the key is written once): its turn is the answer.
      // Each turn that lost wrote its own record of what it asked (`conversation.failed`).
      const expected =
        e instanceof TurnStopped ||
        e instanceof HandoverOffered ||
        e instanceof HandoverHeld ||
        e instanceof InputError;
      if (!input.turn || expected) throw e;
      let done: ConversationResponse | undefined;
      try {
        done = await written(persona, input.turn, input);
      } catch (refused) {
        // The key that won was another question's: that is the answer, as it is before anything is asked.
        if (refused instanceof InputError) throw refused;
      }
      if (done) return done;
      throw e;
    }
  }
  /**
   * The turn a question sent with this key was written as (WD-L3), answered as a turn is: the conversation as it stands
   * and the answer that followed the question. Undefined when no question carries the key. A key is written once in
   * the installation, so it is looked up across it: with the `request` it was sent again with, one that is another
   * person's, or this person's for another conversation, other words or another assistant, is refused (`InputError`,
   * in words that say nothing of where the key is held), and so is one in a conversation the person may no longer see.
   * Without a request (the page's read-back) it is undefined unless it is the person's own and theirs to see. What an
   * answer offered for the moment (Clew's actions, the verbs) is not offered again; the draft is drawn again only while
   * its item can be read.
   */
  async function written(
    persona: AuthenticatedContext,
    key: string,
    request?: ConversationInput,
  ): Promise<ConversationResponse | undefined> {
    const held = await store.turnWritten(key);
    if (!held) return undefined;
    const conversation = held.personId === persona.id ? await access.read(persona, held.threadId) : undefined;
    const asked = conversation ? conversation.messages.findIndex(m => m.role === 'user' && m.meta?.turn === key) : -1;
    if (request && !matchesWrittenTurn(conversation, asked, request)) throw new InputError(KEY_REFUSED);
    if (!conversation) return undefined;
    const answer = asked < 0 ? undefined : conversation.messages.slice(asked + 1).find(m => m.role === 'assistant');
    if (!answer) return undefined;
    const meta = answer.meta ?? {};
    const drafted = meta.draft ? await access.read(persona, meta.draft.threadId) : undefined;
    return {
      conversationId: conversation.id,
      thread: conversation,
      shape: meta.shape ?? 'svar',
      assistant: meta.assistant ?? 'router',
      answer: { body: answer.body, source: meta.source ?? '', at: answer.createdAt },
      ...(meta.view ? { view: meta.view } : {}),
      ...(meta.draft && drafted ? { draft: { ...meta.draft, thread: drafted } } : {}),
      clewActions: [],
      followUps: meta.followUps ?? [],
      ...(meta.sources?.length ? { sources: meta.sources } : {}),
      ...(meta.model ? { model: meta.model } : {}),
    };
  }
  /**
   * What a question sent with a turn key came to (WD-L3): the page reads it after a stop or a broken answer. A read. A
   * turn with that key still running in this process is waited for, `TURN_WAIT_MS` at most, so a turn stopped after its
   * propose became a work item is read once it is written, not before. Behind several server processes the read may
   * reach another than the one running the turn; then the key keeps the question safe: sent again, it is answered with
   * what was written, never asked twice.
   */
  async function writtenTurn(persona: AuthenticatedContext, key: string): Promise<WrittenTurn> {
    if (!TURN_KEY.test(key)) throw new InputError('Ogiltig förfrågan.');
    const run = running.get(runningKey(persona, key));
    if (run) await settledWithin(run.turn, TURN_WAIT_MS);
    return { written: (await written(persona, key)) ?? null };
  }
  /** One turn to Clew's own assistant, and its record when it ends without an answer. */
  async function clewTurn(
    persona: AuthenticatedContext,
    input: ConversationInput,
    observer: TurnObserver,
  ): Promise<ConversationResponse> {
    const turn = turnFor(persona, observer);
    try {
      return await answerTurn(persona, input, observer, turn);
    } catch (e) {
      try {
        await unanswered(persona, input, turn, e);
      } catch (failure) {
        // The turn's own error is what the person is told; a record that could not be written is logged beside it.
        deps.log(
          'assistant: the audit row of a turn without an answer was not written:',
          String(failure).slice(0, 200),
        );
      }
      throw e;
    }
  }
  /**
   * The audit row of a turn that ends without an answer: `conversation.stopped` when the person pressed Stoppa before a
   * propose became a work item, `conversation.offered` when the model suggested another system's assistant and the
   * person is asked first, and `conversation.failed` when anything else ended it (a read the router made that failed, a
   * store that did not answer, a turn whose key another send wrote first), with the error's kind (`failure`, its class
   * name) and never its message, which may hold the source's words or a statement's values. It says which model the
   * turn was sent to and what the call cost, every read the turn made with its count, the work item a propose became
   * and the assistant offered; never a word of the question or of what was read. A turn that did none of that writes
   * nothing. The subject is the conversation, or the person when the turn was to start one. A turn stopped after its
   * propose became a work item, or whose model suggested another assistant after that, does not end here: it is
   * written whole, the item its answer, and a stop says `stopped: true` in its `conversation.asked` or
   * `conversation.replied` row (WD-L3). A failure is its own action and not a stop with a reason, so the stops the
   * people pressed are the `conversation.stopped` rows and the turn rows with `stopped: true`, and nothing else.
   */
  async function unanswered(persona: AuthenticatedContext, input: ConversationInput, turn: Turn, ended: unknown) {
    if (!turn.called && !turn.reads.length && !turn.started) return;
    const action =
      ended instanceof TurnStopped
        ? 'conversation.stopped'
        : ended instanceof HandoverOffered
          ? 'conversation.offered'
          : 'conversation.failed';
    await store.transaction(tx =>
      tx.writeAudit({
        actor: persona.principal.id,
        action,
        subject: input.conversationId ? 'thread:' + input.conversationId : 'person:' + persona.id,
        at: clock().toISOString(),
        details: {
          chips: (input.chips ?? []).map(c => c.ref),
          ...(turn.reads.length ? { reads: turn.reads } : {}),
          ...(turn.started ? { started: { thread: turn.started.threadId, capability: turn.started.capability } } : {}),
          ...(turn.called ? { model: turn.called.model.id, modelCall: turn.called.call } : {}),
          ...(ended instanceof HandoverOffered ? { offered: ended.assistant.id } : {}),
          ...(action === 'conversation.failed'
            ? { failure: (ended instanceof Error ? ended.name : typeof ended).slice(0, 40) }
            : {}),
        },
      }),
    );
  }
  async function answerTurn(
    persona: AuthenticatedContext,
    input: ConversationInput,
    observer: TurnObserver,
    turn: Turn,
  ): Promise<ConversationResponse> {
    const chips: Chip[] = input.chips ?? [];
    const resolved = await resolveChips(deps, persona, chips, input.beside);
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
    // The model reads a named card as if the person had pointed at it, when it may have the card's system (D122 item 4):
    // the person named it in words and did not point, so one it may not have is left out, not said to be there.
    const told = named.filter(t => registry.forModel(t.connector));
    const context: ResolvedChips = told.length
      ? {
          ...resolved,
          objects: [
            ...resolved.objects,
            ...told.map(t => ({ kind: 'thread' as const, ref: 'thread:' + t.id, thread: t })),
          ],
        }
      : resolved;
    let produced: Produced | undefined;
    if (resolved.primaryThread) produced = await chipPath(persona, input.text, resolved.primaryThread);
    // The person's model is resolved on the server for every turn (D24): their pick, else the default; none means the router (D8).
    const model = produced ? undefined : await models.resolve(persona);
    const fallback = model ? 'unavailable' : 'router';
    let fallbackReason: string | undefined;
    // The model suggested another system's assistant after its propose had become a work item.
    let handedOn = false;
    if (!produced && model) {
      // The assistants the model may hand this question to (D125 item 11): only a question with nothing attached and
      // no card named, since nothing of the conversation may follow it. A conversation may have an exchange with more
      // than one of them. A source that does not answer in time offers none, and Clew answers.
      const routable =
        observer.offers &&
        !input.own &&
        model.tools &&
        deps.handover &&
        !chips.length &&
        !named.length &&
        !people.named.length
          ? (await deps.handover.list(persona).catch(() => [])).slice(0, ROUTABLE_MAX)
          : [];
      let outcome: Awaited<ReturnType<typeof modelPath>> | undefined;
      try {
        outcome = await modelPath(persona, input.text, history, context, model, turn, people, routable);
      } catch (e) {
        // Stopped after its propose had become a work item (WD-L3): the turn is written with the item as its answer
        // below, so the conversation never leaves an item unsaid. Stopped before that, nothing is written.
        if (!(e instanceof TurnStopped && turn.started)) throw e;
      }
      // The model suggests an assistant of another system: the person is asked before anything leaves Clew, and the
      // turn ends here with no conversation saved, as a stopped one does; its audit row is `unanswered`'s. Once its
      // propose has become a work item it is not offered: the item is the turn's answer, written whole as a stopped
      // turn's is, so no item is ever left without the turn that started it.
      if (outcome && 'handTo' in outcome && !turn.started) {
        const suggested = routable.find(a => a.id === outcome.handTo);
        if (suggested) throw new HandoverOffered(suggested);
      }
      if (outcome && 'handTo' in outcome) {
        handedOn = !!turn.started;
        fallbackReason = turn.started
          ? 'suggested an assistant after starting a work item'
          : 'suggested an assistant that is not listed';
      } else if (outcome && 'unavailable' in outcome) fallbackReason = outcome.unavailable;
      else if (outcome) produced = outcome;
    }
    // A stop that came after a propose had become a work item stops nothing more: the item stays, and the turn is
    // written with it as the answer, so what the turn wrote is always whole (WD-L3).
    const stopped = !!observer.signal?.aborted && !!turn.started;
    // The model failed, was stopped or suggested another assistant after its propose had become a work item: the item
    // is the answer, and nothing is routed or started a second time. A stopped or handed-on turn's answer is Clew's own
    // words, not those of a model that failed.
    if (!produced && turn.started)
      produced = await startedAnswer(persona, turn.started, stopped || handedOn ? 'router' : fallback, history);
    if (!produced && named.length) produced = cardPath(named, fallback);
    if (!produced) produced = await routerPath(persona, input.text, fallback, turn, people);
    if (observer.signal?.aborted && !turn.started) throw new TurnStopped();
    // Drawn in the turn: the chipped or named cards, then the asker's work about the people the question names or the
    // model looked up (D115), each once, three at most. Under a model's answer, work about a named person is drawn
    // only when the answer speaks of it: the model is told of that work and points at it when the question is about
    // it. Without a model nothing can tell, so it is kept and drawn as quiet rows (`cardsAs`).
    const byModel = produced.assistant === 'model';
    const answered = produced.body;
    const pointed = [...chippedCards, ...named].map(t => t.id);
    const about = namedWork(people)
      .filter(t => !byModel || speaksOf(answered, t.title))
      .map(t => t.id);
    const cards = [...new Set([...pointed, ...about, ...(produced.cards ?? [])])]
      .filter(id => !shown.has(id))
      .slice(0, 3);
    // A work item this turn started is drawn in the turn, also under a draft of its action: the draft's buttons open
    // the action's own dialog, and that dialog is the item's.
    if (turn.started && !cards.includes(turn.started.threadId)) cards.unshift(turn.started.threadId);
    const asRows =
      !byModel && cards.length > 0 && !cards.some(id => pointed.includes(id) || id === turn.started?.threadId);
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
      ...(produced.viewRows ? { viewRows: produced.viewRows } : {}),
      ...(produced.viewItems?.length ? { viewItems: produced.viewItems } : {}),
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
      // What the turn read and how much, for the next turn's prompt; never a row (D122 item 8).
      ...(turn.reads.length ? { reads: turn.reads.slice(0, 20) } : {}),
      ...(produced.sources?.length ? { sources: produced.sources } : {}),
      ...(produced.followUps.length ? { followUps: produced.followUps.slice(0, 3) } : {}),
      ...(cards.length ? { cards } : {}),
      ...(asRows ? { cardsAs: 'rows' as const } : {}),
      ...(produced.model ? { model: produced.model } : {}),
      // What the model call cost (D91), also when the router answered in its place.
      ...(turn.called ? { modelCall: turn.called.call } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
      ...(produced.basis && Object.keys(produced.basis).length ? { basis: produced.basis } : {}),
    };
    const askedMeta: MessageMeta = {
      ...(chips.length ? { chips, refs } : {}),
      ...(input.turn ? { turn: input.turn, turnBeside: resolved.beside ?? null } : {}),
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
        await tx.updateThread(conversationId, {
          summary: produced!.body,
          updatedAt: at,
        });
      }
      await tx.addMessage(conversationId, {
        role: 'user',
        body: input.text,
        at,
        ...(Object.keys(askedMeta).length ? { meta: askedMeta } : {}),
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
          // Every read the turn made through the registry, with its count or that it failed; never a row (D122 item 8).
          ...(turn.reads.length ? { reads: turn.reads } : {}),
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
          // A work item a propose became in the turn (its own audit row says so too).
          ...(turn.started ? { started: { thread: turn.started.threadId, capability: turn.started.capability } } : {}),
          // The person pressed Stoppa after that item was started: the turn is written with the item as its answer.
          ...(stopped ? { stopped: true } : {}),
          // The model the turn was sent to, whether it answered or the router did (D91), and what the call cost and
          // where its trace is; the text stays in the message, never here.
          ...(turn.called ? { model: turn.called.model.id, modelCall: turn.called.call } : {}),
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
    writtenTurn,
    ask,
    reply,
    listObjects: (persona: AuthenticatedContext, q: string, near: string[] = []) => listObjects(deps, persona, q, near),
    /** The assistants of other systems the person may hand a conversation to; none when no source has any for them. */
    listAssistants: async (persona: AuthenticatedContext) => (await deps.handover?.list(persona)) ?? [],
  };
}
export type AssistantUsecases = ReturnType<typeof assistantUsecases>;
