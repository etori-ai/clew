import { inScope } from '@clew/connectors';
import type { AuthenticatedContext, Completions } from '@clew/contracts';
import { listThreads } from '@clew/db/threads';
import { actorOf, registry } from '../connectors/registry';

/** Questions the deterministic router answers without any capability. Kept for the typeahead and the "Fråga om" group. */
export const fixedQuestions = ['Vad har jag i dag?', 'Hur ligger vi till med utvecklingssamtalen?', 'Hur ser korttidsfrånvaron ut?', 'Hur ligger budgeten?', 'Vad säger HME?', 'Varför ser jag detta?'];
/** The focus list: questions with their source, things to do, and earlier conversations. Everything here works without the model (D8). */
export async function completionsFor(persona: AuthenticatedContext): Promise<Completions> {
  const actor = actorOf(persona);
  const ask = registry.tools(actor).filter(t => t.kind === 'read').map(t => ({ text: t.title.endsWith('?') ? t.title : t.title, capability: t.name, source: t.source }));
  const areas = await registry.areas(actor);
  const standing = new Set(areas.flatMap(a => a.standing.map(s => s.capability)));
  const doList = registry.list().flatMap(m => m.capabilities.filter(c => c.kind !== 'read' && standing.has(c.name) && inScope(c.scope, actor)).map(c => ({ text: c.title, capability: c.name, source: m.source, kind: c.kind })));
  const recent = (await listThreads(persona.id)).filter(t => t.kind === 'question').slice(0, 5).map(t => ({ conversationId: t.id, title: t.title, at: t.updatedAt }));
  return { completions: [...fixedQuestions, ...ask.map(a => a.text)], ask, do: doList, recent };
}
