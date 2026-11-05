import { viewRows } from '@clew/connectors';
import type { SearchResult, Thread, View, ViewRef } from '@clew/contracts';
export { headingFollowUps } from '../modules/search/domain';

/** What the deterministic router knows about a capability: the same list the model gets as tools, plus the Swedish title. */
export interface ToolInfo { name: string; title: string; description: string; kind: string; source: string; view?: View; }

const clockOf = (at: string) => new Date(at).toLocaleTimeString('sv-SE', { timeStyle: 'short', timeZone: 'Europe/Stockholm' });
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
/**
 * The open cards a question names (D34, H1): a pull and a push land on the same card. Each card is scored by the
 * question's words against its title; a card wins when it shares at least half of the question's words, so
 * "attestera en faktura" finds "Attestera en faktura, 18 650 kr" and "vem är på plats" finds none. The best three, ties kept.
 */
export function matchCards(text: string, threads: Thread[], count = 3): Thread[] {
  const qt = tokens(text);
  if (!qt.length) return [];
  const scored = threads.map(t => { const tt = tokens(t.title); return { t, score: qt.filter(x => tt.some(y => same(x, y))).length }; })
    .filter(s => s.score > 0 && s.score * 2 >= qt.length);
  const best = Math.max(0, ...scored.map(s => s.score));
  return scored.filter(s => s.score === best).slice(0, count).map(s => s.t);
}
/**
 * What the person typed beyond naming the capability, as the input of a view with a search field (D38): "telefonboken
 * anna lind" matches "Sök i telefonboken" and asks it for "anna lind". The words that named the capability (its title,
 * description and source) and the stop words are left out; nothing left means the view opens as it is.
 */
export function viewInput(text: string, tool: ToolInfo): Record<string, unknown> {
  const query = tool.view && (tool.view.kind === 'table' || tool.view.kind === 'list') ? tool.view.input?.query : undefined;
  if (!query) return {};
  const named = tokens(`${tool.title} ${tool.description} ${tool.source}`);
  const rest = text.replace(/[^\p{L}\p{N}\s@.+-]/gu, ' ').split(/\s+/).filter(w => w && !STOP.has(w.toLowerCase()) && !named.some(n => same(n, w.toLowerCase()))).join(' ').trim();
  return rest.length >= 2 ? { [query.key]: rest.slice(0, 80) } : {};
}
/**
 * The sentence for a view the model may not read (D38): how much is shown, never what it holds. The view is the answer and
 * is drawn right under it, and the source and time stand on the message's own line, so the sentence repeats neither (D47).
 */
export function viewAnswer(tool: ToolInfo & { view: View }, input: Record<string, unknown>, output: unknown): { body: string; view: ViewRef } {
  const rows = viewRows(tool.view, output);
  const empty = 'empty' in tool.view && tool.view.empty ? tool.view.empty.replace(/\.$/, '') : `Inget under ${tool.title.toLowerCase()}`;
  const body = !rows ? `${tool.title} visas här under.` : rows.length ? `${tool.title}: ${rows.length} ${rows.length === 1 ? 'rad' : 'rader'}.` : `${empty}.`;
  return { body, view: { capability: tool.name, input, title: tool.title, source: tool.source, declared: true } };
}
/** The three nearest capability titles, for the "Det där kan jag inte svara på" sentence and as follow-ups. */
export function nearest(text: string, tools: ToolInfo[], count = 3): ToolInfo[] {
  const qt = tokens(text);
  return tools.filter(t => t.kind === 'read').map(t => ({ t, s: qt.filter(x => tokens(t.title + ' ' + t.description).some(y => same(x, y))).length }))
    .sort((a, b) => b.s - a.s).slice(0, count).map(x => x.t);
}
/** The composite search without a model (D26, D8): the hits are named, never read; the sources that did not answer are named too. */
export function searchAnswer(output: SearchResult, at: string): { body: string } {
  const missed = output.sources.filter(s => s.status !== 'ok').map(s => s.source);
  const missedLine = missed.length ? ` ${missed.join(', ')} ${missed.length === 1 ? 'svarade' : 'svarade'} inte.` : '';
  if (!output.rows.length) return { body: `Jag hittade inget om det här i källorna jag får söka i.${missedLine} Startsidan ${clockOf(at)}.` };
  const sources = [...new Set(output.rows.map(r => r.source))].join(', ');
  // A person is counted, never named (the names rule): who it is stands in the panel, read from the source.
  const people = output.rows.filter(r => r.kind === 'person').length;
  const found = output.rows.filter(r => r.kind !== 'person');
  const peopleLine = people ? `${people} ${people === 1 ? 'person' : 'personer'}` : '';
  if (!found.length) return { body: `${peopleLine} hittades. Se ${people === 1 ? 'kontaktuppgifterna' : 'dem'} i panelen. Källor: ${sources}.${missedLine} Startsidan ${clockOf(at)}.` };
  const names = found.slice(0, 3).map(r => r.label);
  return { body: `${found.length} ${found.length === 1 ? 'träff' : 'träffar'} i rutiner och dokument: ${names.join(', ')}${found.length > 3 ? ' …' : ''}.${people ? ` Dessutom ${peopleLine}.` : ''} Läs själv i panelen; jag har inte läst dem åt dig. Källor: ${sources}.${missedLine} Startsidan ${clockOf(at)}.` };
}
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const rowLabel = (r: Record<string, unknown>) => String(r.name ?? r.title ?? r.label ?? r.supplier ?? r.ref ?? '');
/** A Swedish sentence from a capability's output without a model: rows become a count and a view, scalars become "key: value". */
export function templatedAnswer(tool: ToolInfo, input: Record<string, unknown>, output: unknown, at: string): { body: string; view?: ViewRef } {
  const when = `${tool.source} ${clockOf(at)}`;
  if (isRecord(output) && Array.isArray(output.rows)) {
    const rows = output.rows as Record<string, unknown>[];
    const names = rows.slice(0, 3).map(rowLabel).filter(Boolean);
    const body = rows.length ? `${rows.length} ${rows.length === 1 ? 'post' : 'poster'} under ${tool.title.toLowerCase()}${names.length ? ': ' + names.join(', ') + (rows.length > 3 ? ' …' : '') : ''}. ${when}.` : `Inget under ${tool.title.toLowerCase()} just nu. ${when}.`;
    return { body, view: { capability: tool.name, input, title: tool.title, source: tool.source, ...(tool.view ? { declared: true } : {}) } };
  }
  if (isRecord(output)) {
    // One level of nesting is flattened ("today.ward"), so a shift or a budget reads as a sentence without a model.
    const flat = Object.entries(output).flatMap(([k, v]) => isRecord(v) ? Object.entries(v).map(([k2, v2]) => [`${k}.${k2}`, v2] as const) : [[k, v] as const]);
    const parts = flat.filter(([, v]) => typeof v !== 'object' || (Array.isArray(v) && v.every(x => typeof x === 'string'))).slice(0, 6)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v.length ? v.join(', ') : 'inga') : String(v)}`);
    return { body: `${tool.title}: ${parts.join('; ') || 'inget att visa'}. ${when}.`, view: { capability: tool.name, input, title: tool.title, source: tool.source, ...(tool.view ? { declared: true } : {}) } };
  }
  return { body: `${tool.title}: ${String(output)}. ${when}.` };
}
