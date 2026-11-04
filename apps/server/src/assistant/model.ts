import { generateText, jsonSchema, stepCountIs, tool, type JSONSchema7, type ModelMessage, type ToolSet } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ViewRef } from '@clew/contracts';
import type { ToolInfo } from './router';

/** The configured model failed, timed out or answered nothing usable; the caller falls back to the router (D8). */
export class ModelUnavailable extends Error { constructor(message: string) { super(message); this.name = 'ModelUnavailable'; } }

/** Capability names carry one dot (`heroma.whoIsOn`); OpenAI-style function names do not allow it. */
export const toToolName = (name: string) => name.replace('.', '__');
export const fromToolName = (name: string) => name.replace('__', '.');
const RESULT_LIMIT = 8_000;
const clip = (value: unknown) => { const text = JSON.stringify(value); return text.length > RESULT_LIMIT ? { truncated: true, text: text.slice(0, RESULT_LIMIT) } : value; };

export type ToolSchemaInfo = ToolInfo & { input: unknown };
export type ToolCallRecord = { capability: string; input: Record<string, unknown>; output: unknown };
/** The model's tool set: every in-scope read capability, run through the same validated path as REST and cards. */
export function buildTools(tools: ToolSchemaInfo[], run: (name: string, input: unknown) => Promise<unknown>): ToolSet {
  return Object.fromEntries(tools.map(t => [toToolName(t.name), tool({
    description: `${t.title}. ${t.description}`,
    inputSchema: jsonSchema<Record<string, unknown>>(t.input as JSONSchema7),
    execute: async input => { try { return clip(await run(t.name, input)); } catch (e) { return { error: e instanceof Error ? e.message : 'fel' }; } },
  })]));
}
export interface PromptContext { name: string; role: 'manager' | 'employee'; unitLabel: string; now: Date; week: number; objects: string[]; }
/** The Swedish system prompt: who is asking, what day it is, the rules, and the chipped objects as "Du tittar på". */
export function systemPrompt(ctx: PromptContext): string {
  const date = ctx.now.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Stockholm' });
  const time = ctx.now.toLocaleTimeString('sv-SE', { timeStyle: 'short', timeZone: 'Europe/Stockholm' });
  const lines = [
    `Du är assistenten på Startsidan, Sundsvalls kommuns startsida för medarbetare. Du hjälper ${ctx.name}, ${ctx.role === 'manager' ? 'chef' : 'medarbetare'} på ${ctx.unitLabel}.`,
    `I dag är det ${date}, klockan ${time}, vecka ${ctx.week}.`,
    'Regler:',
    '- Svara på svenska med en eller två meningar. Nämn källan och tidpunkten, till exempel "Heroma 14:52".',
    '- Du kan bara läsa. Använd verktygen för att hämta aktuella uppgifter innan du svarar; gissa aldrig siffror.',
    '- Du utför aldrig något och påstår aldrig att något är gjort. När personen vill göra något: säg vilken knapp på kortet som gör det, eller att det inte går här.',
    '- Nämn inte enskilda medarbetares namn om personen inte själv använde dem.',
    '- Svara i ren text utan rubriker, listor eller markdown.',
  ];
  if (ctx.objects.length) lines.push('', 'Du tittar på (det personen lagt till i samtalet):', ...ctx.objects.map(o => `- ${o}`));
  return lines.join('\n');
}
export type ModelGenerate = (request: { system: string; messages: ModelMessage[]; tools: ToolSet; timeoutMs: number }) => Promise<{ text: string; toolCalls: ToolCallRecord[] }>;
/** The provider from the environment, or undefined when the model is not configured. The system runs fully without it (D8). */
export function createProvider(env: Record<string, string | undefined>, fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): { generate: ModelGenerate; model: string; baseURL: string; apiKey: string | undefined } | undefined {
  const baseURL = env.AI_BASE_URL?.trim();
  if (!baseURL) return undefined;
  const model = env.AI_MODEL?.trim();
  if (!model) throw new Error('AI_BASE_URL is set but AI_MODEL is missing.');
  const apiKey = env.AI_API_KEY?.trim() || undefined;
  const provider = createOpenAICompatible({ name: 'clew', baseURL, ...(apiKey ? { apiKey } : {}), ...(fetchImpl ? { fetch: fetchImpl as typeof fetch } : {}) });
  const generate: ModelGenerate = async ({ system, messages, tools, timeoutMs }) => {
    const result = await generateText({ model: provider(model), system, messages, tools, stopWhen: stepCountIs(4), maxRetries: 0, abortSignal: AbortSignal.timeout(timeoutMs) });
    const toolCalls: ToolCallRecord[] = result.steps.flatMap(step => step.toolResults.map(r => ({ capability: fromToolName(r.toolName), input: (r.input ?? {}) as Record<string, unknown>, output: r.output })));
    return { text: result.text, toolCalls };
  };
  return { generate, model, baseURL, apiKey };
}
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Ask the model. The answer is its text; the first tool result with rows is offered as a view. Any failure becomes ModelUnavailable. */
export async function modelAnswer(args: { system: string; history: { role: 'user' | 'assistant'; body: string }[]; text: string; tools: ToolSchemaInfo[]; run: (name: string, input: unknown) => Promise<unknown>; generate: ModelGenerate; timeoutMs?: number }): Promise<{ body: string; view?: ViewRef; toolCalls: ToolCallRecord[] }> {
  const messages: ModelMessage[] = [...args.history.map(m => ({ role: m.role, content: m.body }) as ModelMessage), { role: 'user', content: args.text }];
  let result: { text: string; toolCalls: ToolCallRecord[] };
  try { result = await args.generate({ system: args.system, messages, tools: buildTools(args.tools, args.run), timeoutMs: args.timeoutMs ?? 8_000 }); }
  catch (e) { throw new ModelUnavailable(e instanceof Error ? e.message : 'model failed'); }
  const body = result.text.trim();
  if (!body) throw new ModelUnavailable('empty answer');
  const withRows = result.toolCalls.find(c => isRecord(c.output) && Array.isArray(c.output.rows));
  const info = withRows ? args.tools.find(t => t.name === withRows.capability) : undefined;
  return { body, toolCalls: result.toolCalls, ...(withRows && info ? { view: { capability: info.name, input: withRows.input, title: info.title, source: info.source } } : {}) };
}
