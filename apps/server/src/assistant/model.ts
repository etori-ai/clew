import { jsonSchema, stepCountIs, streamText, tool, type JSONSchema7, type ModelMessage, type ToolSet } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { readsSummary, viewSummary } from '@clew/connectors';
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
/** Ten search hits with 600-character snippets and their fields fit under this; a longer result is cut, not failed. */
const RESULT_LIMIT = 12_000;
const clip = (value: unknown) => {
  const text = JSON.stringify(value);
  return text.length > RESULT_LIMIT ? { truncated: true, text: text.slice(0, RESULT_LIMIT) } : value;
};

export type ToolSchemaInfo = ToolInfo & { input: unknown };
export type ToolCallRecord = { capability: string; input: Record<string, unknown>; output: unknown };
/** What the wire reports about one turn (D91): tokens, steps and how the model stopped. Never content. */
export type ModelUsage = { inputTokens?: number; outputTokens?: number; finishReason?: string; steps?: number };
/**
 * The model's tool set: every in-scope read capability, run through the same validated path as REST and cards. A tool whose
 * view says the model reads a summary (D38) is still run, so the person's view has its rows, but the model is handed only
 * that the result is shown and how much of it there is.
 */
export function buildTools(tools: ToolSchemaInfo[], run: (name: string, input: unknown) => Promise<unknown>): ToolSet {
  return Object.fromEntries(
    tools.map(t => [
      toToolName(t.name),
      tool({
        description: `${t.title}. ${t.description}`,
        inputSchema: jsonSchema<Record<string, unknown>>(t.input as JSONSchema7),
        execute: async input => {
          try {
            const output = await run(t.name, input);
            return clip(t.view && readsSummary(t.view) ? viewSummary(t.view, t.title, output) : output);
          } catch (e) {
            return { error: e instanceof Error ? e.message : 'fel' };
          }
        },
      }),
    ]),
  );
}
export interface PromptContext {
  name: string;
  role: 'manager' | 'employee';
  unitLabel: string;
  now: Date;
  week: number;
  objects: string[];
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
    '- Svara på svenska med en eller två meningar. Nämn källan och tidpunkten, till exempel "Personalsystemet 14:52".',
    '- Du kan bara läsa. Använd verktygen för att hämta aktuella uppgifter innan du svarar; gissa aldrig siffror.',
    '- Du utför aldrig något och påstår aldrig att något är gjort, utöver det ett korts kvitto visar. När personen vill göra något: säg vilken knapp på kortet som gör det, eller att det inte går här.',
    '- Nämn bara knappar som står under "Knappar på kortet nu". Är kortet redan hanterat, säg det först och vad som går nu, till exempel att Ångra allt måste tryckas innan kortets egna knappar kommer tillbaka.',
    '- Nämn inte enskilda medarbetares namn om personen inte själv använde dem.',
    '- När ett verktyg svarar att resultatet visas i en vy: säg kort att uppgifterna finns i vyn och hur många rader den har. Återge eller gissa aldrig innehållet.',
    '- Svara i ren text utan rubriker, listor eller markdown.',
    'När svaret bygger på sökverktyget (rutiner och dokument):',
    '- Svara bara utifrån de avsnitt som kom tillbaka och hitta aldrig på mer. Om avsnitten inte räcker, säg det.',
    '- Markera varje påstående med avsnittets nummer i hakparentes, till exempel [1]. Nämn dokumentets namn, vem som äger det och när det senast granskades, i stället för klockslag.',
    '- Är avsnittet en rutin med steg: svara som numrerade steg, ett per rad, "1. …". Annars en eller två meningar som vanligt.',
    '- Nämn källor som inte svarade, om sökverktyget rapporterar några.',
    '- Avsluta med en sista rad "Följdfrågor: fråga ett | fråga två | fråga tre": högst tre korta frågor personen kan ställa härnäst. Bara när sökverktyget användes.',
  ];
  if (ctx.objects.length)
    lines.push('', 'Du tittar på (det personen lagt till i samtalet):', ...ctx.objects.map(o => `- ${o}`));
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
/** Ask the model. The answer is its text; the last tool call with a declared view (D38), else the first tool result with rows, is offered as a view. Any failure becomes ModelUnavailable. */
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
}): Promise<{ body: string; view?: ViewRef; toolCalls: ToolCallRecord[]; usage?: ModelUsage }> {
  const messages: ModelMessage[] = [
    ...args.history.map(m => ({ role: m.role, content: m.body }) as ModelMessage),
    { role: 'user', content: args.text },
  ];
  let result: { text: string; toolCalls: ToolCallRecord[]; usage?: ModelUsage };
  try {
    result = await args.generate({
      system: args.system,
      messages,
      tools: buildTools(args.tools, args.run),
      timeoutMs: args.timeoutMs ?? 8_000,
      ...(args.onText ? { onText: args.onText } : {}),
      ...(args.signal ? { signal: args.signal } : {}),
    });
  } catch (e) {
    throw new ModelUnavailable(e instanceof Error ? e.message : 'model failed');
  }
  const body = result.text.trim();
  if (!body) throw new ModelUnavailable('empty answer');
  const declared = [...result.toolCalls]
    .reverse()
    .find(c => !(isRecord(c.output) && 'error' in c.output) && args.tools.find(t => t.name === c.capability)?.view);
  const shown = declared ?? result.toolCalls.find(c => isRecord(c.output) && Array.isArray(c.output.rows));
  const info = shown ? args.tools.find(t => t.name === shown.capability) : undefined;
  return {
    body,
    toolCalls: result.toolCalls,
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
        }
      : {}),
  };
}
