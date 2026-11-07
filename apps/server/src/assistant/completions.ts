import { actorOf } from '@clew/connectors';
import type { AuthenticatedContext, Completions } from '@clew/contracts';
import type { AssistantDeps } from './ports';
import { threadAccess } from '../threads/access';

/** Questions the deterministic router answers without any capability. Kept for the typeahead and the "Fråga om" group. */
export const fixedQuestions = [
  'Vad har jag i dag?',
  'Hur ligger vi till med utvecklingssamtalen?',
  'Hur ser korttidsfrånvaron ut?',
  'Hur ligger budgeten?',
  'Vad säger HME?',
  'Varför ser jag detta?',
];
/** The focus list: questions with their source, things to do, and earlier conversations. Everything here works without the model (D8). */
export async function completionsFor(deps: AssistantDeps, persona: AuthenticatedContext): Promise<Completions> {
  const actor = actorOf(persona);
  const ask = deps.registry
    .tools(actor)
    .filter(t => t.kind === 'read')
    .map(t => ({ text: t.title, capability: t.name, source: t.source }));
  const areas = await deps.registry.areas(actor, { figures: false, authorize: () => persona.authorize() });
  const standing = new Set(areas.flatMap(a => a.standing.map(s => s.capability)));
  const doList = deps.registry
    .capabilitiesFor(actor)
    .filter(({ capability: c }) => c.kind !== 'read' && standing.has(c.name))
    .map(({ connector: m, capability: c }) => ({ text: c.title, capability: c.name, source: m.source, kind: c.kind }));
  const recent = (await threadAccess(deps.store, deps.registry).list(persona, deps.clock().toISOString()))
    .filter(t => t.kind === 'question')
    .slice(0, 5)
    .map(t => ({ conversationId: t.id, title: t.title, at: t.updatedAt }));
  return { completions: [...fixedQuestions, ...ask.map(a => a.text)], ask, do: doList, recent };
}
