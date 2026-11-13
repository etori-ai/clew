import { jsonSchema, stepCountIs, streamText, tool, type JSONSchema7, type ModelMessage, type ToolSet } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { modelReading } from '@clew/connectors';
import type { ModelReasoning, ViewRef } from '@clew/contracts';
import type { ToolInfo } from './router';

/** The configured model failed, timed out or answered nothing usable; the caller falls back to the router (D8). */
export class ModelUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelUnavailable';
  }
}

/** Capability names carry one dot (`hr.whoIsOn`); OpenAI-style function names do not allow it. */
export const toToolName = (name: string) => name.replace('.', '__');
export const fromToolName = (name: string) => name.replace('__', '.');

export type ToolSchemaInfo = ToolInfo & { input: unknown };
export type ToolCallRecord = { capability: string; input: Record<string, unknown>; output: unknown };
/**
 * A tool of Clew's own beside the read capabilities, named like one (`clew.<verb>`): the draft of a work item's action
 * (D112 item 8, `drafts.ts`). It runs in the process, writes nothing and never reaches a connector's execute.
 */
export interface ClewTool {
  name: string;
  description: string;
  input: unknown;
  execute: (input: Record<string, unknown>) => unknown;
}
/** What the wire reports about one turn (D91): tokens, steps and how the model stopped. Never content. */
export type ModelUsage = { inputTokens?: number; outputTokens?: number; finishReason?: string; steps?: number };
/**
 * The model's tool set: every in-scope read capability, run through the same validated path as REST and cards. What the
 * model is handed of an output is `modelReading` of the read's view (D122), the same for Clew's own reads and a remote
 * connector's: a summary where the view says so (D38), else the rows and facts as the view draws them, in words, without
 * refs or ids, bounded. The description names the system the read comes from, by the registry's name for it, so an
 * answer that names a system names the right one.
 */
export function buildTools(
  tools: ToolSchemaInfo[],
  run: (name: string, input: unknown) => Promise<unknown>,
  own: ClewTool[] = [],
): ToolSet {
  return Object.fromEntries([
    ...tools.map(t => [
      toToolName(t.name),
      tool({
        description: `${t.title}. ${t.description} Källa: ${t.source}.`,
        inputSchema: jsonSchema<Record<string, unknown>>(t.input as JSONSchema7),
        execute: async input => {
          try {
            return modelReading(t.view, t.title, await run(t.name, input));
          } catch (e) {
            return { error: e instanceof Error ? e.message : 'fel' };
          }
        },
      }),
    ]),
    ...own.map(t => [
      toToolName(t.name),
      tool({
        description: t.description,
        inputSchema: jsonSchema<Record<string, unknown>>(t.input as JSONSchema7),
        execute: async input => {
          try {
            return await t.execute(input);
          } catch (e) {
            return { error: e instanceof Error ? e.message : 'fel' };
          }
        },
      }),
    ]),
  ]);
}
export interface PromptContext {
  name: string;
  role: 'manager' | 'employee';
  unitLabel: string;
  now: Date;
  week: number;
  objects: string[];
  /** The work item's actions may be filled in as a draft (D112 item 8): the prompt says how and that nothing is sent. */
  drafts?: boolean;
  /**
   * The asker manages people (D115): the lines about the people the question names, and whether the model may look a
   * name up itself. Absent for someone who manages nobody.
   */
  people?: { lines: string[]; lookup: boolean };
  /**
   * What earlier answers in the conversation read, one line per answer: when, which reads and how many rows each
   * answered. Never what they held: the model reads again for a question about facts.
   */
  earlier?: string[];
}
/** The Swedish system prompt: who is asking, what day it is, the rules, and the chipped objects as "Du tittar på". */
export function systemPrompt(ctx: PromptContext): string {
  const date = ctx.now.toLocaleDateString('sv-SE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Stockholm',
  });
  const time = ctx.now.toLocaleTimeString('sv-SE', { timeStyle: 'short', timeZone: 'Europe/Stockholm' });
  const lines = [
    `Du är assistenten på Startsidan, Sundsvalls kommuns startsida för medarbetare. Du hjälper ${ctx.name}, ${ctx.role === 'manager' ? 'chef' : 'medarbetare'} på ${ctx.unitLabel}.`,
    `I dag är det ${date}, klockan ${time}, vecka ${ctx.week}.`,
    'Regler:',
    '- Svara på svenska med en eller två meningar.',
    '- Du kan bara läsa. Använd verktygen för att hämta aktuella uppgifter innan du svarar; gissa aldrig siffror.',
    '- Uppgifter ur ett system läser du med verktygen i den här frågan, också när samma sak besvarades tidigare i samtalet: det som lästes då finns inte kvar hos dig och kan ha ändrats. Svara aldrig med uppgifter ur ett tidigare svar.',
    '- Gäller frågan inte uppgifter, till exempel att förklara ett tidigare svar enklare, svarar du utan verktyg.',
    '- Skriv datum och tider så som verktygen ger dem, till exempel "27 november 2027" eller "måndag 16 november 2026 kl. 09:00", aldrig som 2027-11-27.',
    '- Skriv inte källan eller klockslaget i svaret: de visas under svaret. Nämner du ett system, använd namnet som står som källa vid verktyget.',
    '- Du utför aldrig något och påstår aldrig att något är gjort, utöver det ett ärendes kvitto visar. När personen vill göra något: säg vilken knapp i ärendet som gör det, eller att det inte går här.',
    '- Nämn bara knappar som står under "Knappar i ärendet nu". Är ärendet redan hanterat, säg det först och vad som går nu, till exempel att Ångra måste tryckas innan ärendets egna knappar kommer tillbaka.',
    '- Nämn inte enskilda medarbetares namn om personen inte själv använde dem.',
    '- När ett verktyg svarar att resultatet visas i en vy: säg kort att uppgifterna finns i vyn och hur många rader den har. Återge eller gissa aldrig innehållet.',
    '- Svara i ren text utan rubriker, listor eller markdown.',
    'När svaret bygger på sökverktyget (rutiner och dokument):',
    '- Svara bara utifrån de avsnitt som kom tillbaka och hitta aldrig på mer. Om avsnitten inte räcker, säg det.',
    '- Markera varje påstående med avsnittets nummer i hakparentes, till exempel [1]. Nämn dokumentets namn, vem som äger det och när det senast granskades.',
    '- Är avsnittet en rutin med steg: svara som numrerade steg, ett per rad, "1. …". Annars en eller två meningar som vanligt.',
    '- Nämn källor som inte svarade, om sökverktyget rapporterar några.',
    '- Avsluta med en sista rad "Följdfrågor: fråga ett | fråga två | fråga tre": högst tre korta frågor personen kan ställa härnäst. Bara när sökverktyget användes.',
  ];
  if (ctx.people)
    lines.push(
      'När personen frågar om en medarbetare:',
      ...(ctx.people.lookup
        ? [
            '- Vem det är står under "Medarbetare som personen nämnde". Står det inte där, slå upp namnet som personen skrev det med verktyget clew__findPerson.',
          ]
        : ['- Vem det är står under "Medarbetare som personen nämnde".']),
      '- Kan namnet vara flera medarbetare: räkna upp namnen och fråga vem personen menar. Heter ingen så: säg det.',
      '- Uppgifter om medarbetarnas hälsa och frånvaro lämnas inte till dig. Utgå från det personen själv skrev, gissa aldrig och fråga aldrig om diagnos.',
      '- Frågar personen vad hen ska göra: läs rutinen med det verktyg som har den och säg kort vad den säger att chefen gör nu. Finns ett öppet ärende om medarbetaren, peka på det och på dess knapp; ärendet visas för personen i samtalet.',
    );
  if (ctx.drafts)
    lines.push(
      'När personen vill att en av ärendets åtgärder görs:',
      '- Fyll i den med verktyget clew__draftAction, efter att ha läst det du behöver (till exempel lediga tider i kalendern).',
      '- Säg sedan i en mening vad du fyllt i och att inget är skickat: personen granskar utkastet och skickar själv.',
    );
  if (ctx.earlier?.length)
    lines.push(
      '',
      'Lästes för tidigare svar i samtalet (det som lästes lämnas inte till dig igen):',
      ...ctx.earlier.map(o => `- ${o}`),
    );
  if (ctx.objects.length)
    lines.push('', 'Du tittar på (det personen lagt till i samtalet):', ...ctx.objects.map(o => `- ${o}`));
  if (ctx.people?.lines.length)
    lines.push(
      '',
      'Medarbetare som personen nämnde (bland dem personen är chef för):',
      ...ctx.people.lines.map(o => `- ${o}`),
    );
  return lines.join('\n');
}
/**
 * One model turn. `onText` hears the current step's text so far as it streams (D36); `signal` is the person stopping
 * the turn, which ends the call like the timeout does.
 */
export type ModelGenerate = (request: {
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  timeoutMs: number;
  onText?: (text: string) => void;
  signal?: AbortSignal;
}) => Promise<{ text: string; toolCalls: ToolCallRecord[]; usage?: ModelUsage }>;
/**
 * The generate function for one model on one OpenAI-compatible endpoint (D24): the administered provider gives the base
 * URL and the opened key. Four steps at most, no retries, the caller's timeout. The completion is streamed (D36): each
 * text delta reports the step's text so far, and a new step starts it over, so the text heard last is the answer's.
 * `reasoning` is the model's own setting (D84): `provider-default` sends nothing. `fetchImpl` is for tests.
 * Telemetry (D91): the AI SDK's registered integration draws the turn's `gen_ai.*` spans; prompts, completions and
 * tool arguments go on them only when `recordContent` is set, which an operator does, never a default.
 */
export function createGenerator(
  endpoint: { baseUrl: string; apiKey?: string },
  model: string,
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  reasoning: ModelReasoning = 'provider-default',
  telemetry: { recordContent?: boolean } = {},
): ModelGenerate {
  const provider = createOpenAICompatible({
    name: 'clew',
    baseURL: endpoint.baseUrl,
    ...(endpoint.apiKey ? { apiKey: endpoint.apiKey } : {}),
    ...(fetchImpl ? { fetch: fetchImpl as typeof fetch } : {}),
  });
  return async ({ system, messages, tools, timeoutMs, onText, signal }) => {
    const abortSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    // Errors arrive as parts of the stream and are thrown below; the default handler would only log them a second time.
    const result = streamText({
      model: provider(model),
      reasoning,
      system,
      messages,
      tools,
      stopWhen: stepCountIs(4),
      maxRetries: 0,
      abortSignal,
      onError: () => undefined,
      telemetry: {
        functionId: 'assistant.turn',
        recordInputs: telemetry.recordContent === true,
        recordOutputs: telemetry.recordContent === true,
      },
    });
    let step = '';
    for await (const part of result.fullStream) {
      if (part.type === 'start-step') step = '';
      else if (part.type === 'text-delta') {
        step += part.text;
        onText?.(step);
      } else if (part.type === 'error') throw part.error instanceof Error ? part.error : new Error(String(part.error));
      else if (part.type === 'abort') throw new Error(part.reason ?? 'aborted');
    }
    const steps = await result.steps;
    const toolCalls: ToolCallRecord[] = steps.flatMap(s =>
      s.toolResults.map(r => ({
        capability: fromToolName(r.toolName),
        input: (r.input ?? {}) as Record<string, unknown>,
        output: r.output,
      })),
    );
    const [totalUsage, finishReason] = await Promise.all([result.totalUsage, result.finishReason]);
    const usage: ModelUsage = {
      steps: steps.length,
      ...(totalUsage.inputTokens !== undefined ? { inputTokens: totalUsage.inputTokens } : {}),
      ...(totalUsage.outputTokens !== undefined ? { outputTokens: totalUsage.outputTokens } : {}),
      ...(finishReason ? { finishReason } : {}),
    };
    return { text: await result.text, toolCalls, usage };
  };
}
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/**
 * One read a turn made, as the registry answered it: the output as it is, which the model never got (it got
 * `modelReading` of it). Kept in memory for the turn alone: the card's rows and a document answer's citations are
 * worked out from it, and nothing of it is stored.
 */
export type ReadRecord = { capability: string; input: Record<string, unknown>; output?: unknown; failed?: true };
/**
 * Ask the model. The answer is its text; the last read with a declared view (D38), else the first read whose output has
 * rows, is offered as a view, with the input the model gave it and the output it answered (`viewOutput`, from which the
 * caller works out which rows the card draws). Any failure becomes ModelUnavailable.
 */
export async function modelAnswer(args: {
  system: string;
  history: { role: 'user' | 'assistant'; body: string }[];
  text: string;
  tools: ToolSchemaInfo[];
  run: (name: string, input: unknown) => Promise<unknown>;
  generate: ModelGenerate;
  timeoutMs?: number;
  onText?: (text: string) => void;
  signal?: AbortSignal;
  /** Clew's own tools for this turn (the draft of an action, D112 item 8); their calls are in `toolCalls` by name. */
  own?: ClewTool[];
}): Promise<{
  body: string;
  view?: ViewRef;
  viewOutput?: unknown;
  toolCalls: ToolCallRecord[];
  reads: ReadRecord[];
  usage?: ModelUsage;
}> {
  // Earlier turns are their text alone: no tool result of an earlier turn is ever in the model's context.
  const messages: ModelMessage[] = [
    ...args.history.map(m => ({ role: m.role, content: m.body }) as ModelMessage),
    { role: 'user', content: args.text },
  ];
  const reads: ReadRecord[] = [];
  const run = async (name: string, input: unknown) => {
    const asked = isRecord(input) ? input : {};
    try {
      const output = await args.run(name, input);
      reads.push({ capability: name, input: asked, output });
      return output;
    } catch (e) {
      reads.push({ capability: name, input: asked, failed: true });
      throw e;
    }
  };
  let result: { text: string; toolCalls: ToolCallRecord[]; usage?: ModelUsage };
  try {
    result = await args.generate({
      system: args.system,
      messages,
      tools: buildTools(args.tools, run, args.own),
      timeoutMs: args.timeoutMs ?? 8_000,
      ...(args.onText ? { onText: args.onText } : {}),
      ...(args.signal ? { signal: args.signal } : {}),
    });
  } catch (e) {
    throw new ModelUnavailable(e instanceof Error ? e.message : 'model failed');
  }
  const body = result.text.trim();
  if (!body) throw new ModelUnavailable('empty answer');
  // The reads as the registry answered them; a generator that reports calls it did not run through the tools (a test
  // double) is taken at its word.
  const answered: ReadRecord[] = reads.length
    ? reads.filter(r => !r.failed)
    : result.toolCalls
        .filter(c => !(isRecord(c.output) && 'error' in c.output))
        .map(c => ({ capability: c.capability, input: c.input, output: c.output }));
  const toolOf = (r: ReadRecord) => args.tools.find(t => t.name === r.capability);
  const declared = [...answered].reverse().find(r => toolOf(r)?.view);
  const shown = declared ?? answered.find(r => isRecord(r.output) && Array.isArray(r.output.rows));
  const info = shown ? toolOf(shown) : undefined;
  return {
    body,
    toolCalls: result.toolCalls,
    reads,
    ...(result.usage ? { usage: result.usage } : {}),
    ...(shown && info
      ? {
          view: {
            capability: info.name,
            input: shown.input,
            title: info.title,
            source: info.source,
            ...(info.view ? { declared: true } : {}),
          },
          viewOutput: shown.output,
        }
      : {}),
  };
}
