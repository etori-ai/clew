import { actorOf, inScope } from '@clew/connectors';
import type { AuthenticatedContext, ClewObject } from '@clew/contracts';
import { displayDate, shortDayLabel, timeRange } from '@clew/calendar/dates';
import type { AssistantDeps } from './ports';

/** What `@` offers (D12): the objects on the page first, then every capability in scope. */
export async function listObjects(deps: AssistantDeps, persona: AuthenticatedContext, q: string): Promise<ClewObject[]> {
  const needle = q.trim().toLowerCase();
  const threads = (await deps.store.listThreads(persona.id, deps.clock().toISOString())).filter(t => t.state === 'open' && t.kind === 'pushed');
  const visible: ClewObject[] = [];
  for (const t of threads) {
    visible.push({ ref: 'thread:' + t.id, kind: 'thread', label: t.title, detail: `kort · ${t.trigger.source}`, threadId: t.id, visible: true });
    for (const i of t.items) visible.push({ ref: i.ref, kind: 'item', label: i.label, detail: `rad · ${i.detail}`, threadId: t.id, visible: true });
    for (const p of t.proposals.filter(p => p.status === 'proposed')) visible.push({ ref: 'proposal:' + p.id, kind: 'proposal', label: p.participant.name, detail: `förslag · ${shortDayLabel(displayDate(p.start))} ${timeRange(p.start, p.end)}`, threadId: t.id, visible: true });
  }
  try { const day = await deps.calendar.readToday(persona); for (const e of day.events) visible.push({ ref: 'event:' + e.id, kind: 'event', label: e.title, detail: `i dag · ${e.allDay ? 'heldag' : timeRange(e.start, e.end)}`, visible: true }); } catch { /* the calendar is optional here */ }
  const actor = actorOf(persona);
  const everything: ClewObject[] = deps.registry.list().flatMap(m => m.capabilities.filter(c => inScope(c.scope, actor)).map(c => ({ ref: 'capability:' + c.name, kind: 'capability' as const, label: c.title, detail: `${m.source} · ${c.kind === 'read' ? 'fråga' : 'gör något'}`, visible: false })));
  const all = [...visible, ...everything];
  const hit = (o: ClewObject) => !needle || o.label.toLowerCase().includes(needle) || o.detail.toLowerCase().includes(needle);
  return all.filter(hit).slice(0, 20);
}
