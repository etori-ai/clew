import type { ViewRef } from '@clew/contracts';

/** What the deterministic router knows about a capability: the same list the model gets as tools, plus the Swedish title. */
export interface ToolInfo { name: string; title: string; description: string; kind: string; source: string; }

const STOP = new Set(['hur', 'vad', 'vem', 'var', 'när', 'är', 'det', 'den', 'de', 'jag', 'min', 'mitt', 'mina', 'och', 'i', 'på', 'för', 'med', 'om', 'dag', 'idag', 'nu', 'kan', 'ska', 'vill', 'visa', 'ligger', 'ser', 'finns', 'har', 'till', 'av', 'en', 'ett', 'vi', 'ut', 'ni', 'du', 'vilka', 'som', 'att', 'inte', 'mot', 'ange', 'annars', 'denna']);
const tokens = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(t => t.length >= 3 && !STOP.has(t));
const same = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
/** Score each read capability by its title and description against the question; the best wins, nothing matches below one point. */
export function matchCapability(text: string, tools: ToolInfo[]): ToolInfo | undefined {
  const q = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const qt = tokens(text);
  let best: { tool: ToolInfo; score: number } | undefined;
  for (const tool of tools) {
    if (tool.kind !== 'read') continue;
    const title = tool.title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    let score = q.includes(title) || title.includes(q) ? 10 : 0;
    const tt = tokens(tool.title), dt = tokens(tool.description);
    for (const t of qt) { if (tt.some(x => same(x, t))) score += 3; else if (dt.some(x => same(x, t))) score += 1; }
    if (score > 0 && (!best || score > best.score)) best = { tool, score };
  }
  return best?.tool;
}
/** The three nearest capability titles, for the "Det där kan jag inte svara på" sentence and as follow-ups. */
export function nearest(text: string, tools: ToolInfo[], count = 3): ToolInfo[] {
  const qt = tokens(text);
  return tools.filter(t => t.kind === 'read').map(t => ({ t, s: qt.filter(x => tokens(t.title + ' ' + t.description).some(y => same(x, y))).length }))
    .sort((a, b) => b.s - a.s).slice(0, count).map(x => x.t);
}
const clockOf = (at: string) => new Date(at).toLocaleTimeString('sv-SE', { timeStyle: 'short', timeZone: 'Europe/Stockholm' });
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const rowLabel = (r: Record<string, unknown>) => String(r.name ?? r.title ?? r.label ?? r.supplier ?? r.ref ?? '');
/** A Swedish sentence from a capability's output without a model: rows become a count and a view, scalars become "key: value". */
export function templatedAnswer(tool: ToolInfo, input: Record<string, unknown>, output: unknown, at: string): { body: string; view?: ViewRef } {
  const when = `${tool.source} ${clockOf(at)}`;
  if (isRecord(output) && Array.isArray(output.rows)) {
    const rows = output.rows as Record<string, unknown>[];
    const names = rows.slice(0, 3).map(rowLabel).filter(Boolean);
    const body = rows.length ? `${rows.length} ${rows.length === 1 ? 'post' : 'poster'} under ${tool.title.toLowerCase()}${names.length ? ': ' + names.join(', ') + (rows.length > 3 ? ' …' : '') : ''}. ${when}.` : `Inget under ${tool.title.toLowerCase()} just nu. ${when}.`;
    return { body, view: { capability: tool.name, input, title: tool.title, source: tool.source } };
  }
  if (isRecord(output)) {
    // One level of nesting is flattened ("today.ward"), so a shift or a budget reads as a sentence without a model.
    const flat = Object.entries(output).flatMap(([k, v]) => isRecord(v) ? Object.entries(v).map(([k2, v2]) => [`${k}.${k2}`, v2] as const) : [[k, v] as const]);
    const parts = flat.filter(([, v]) => typeof v !== 'object' || (Array.isArray(v) && v.every(x => typeof x === 'string'))).slice(0, 6)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v.length ? v.join(', ') : 'inga') : String(v)}`);
    return { body: `${tool.title}: ${parts.join('; ') || 'inget att visa'}. ${when}.`, view: { capability: tool.name, input, title: tool.title, source: tool.source } };
  }
  return { body: `${tool.title}: ${String(output)}. ${when}.` };
}
