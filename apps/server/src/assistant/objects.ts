import { actorOf } from '@clew/connectors';
import type { AuthenticatedContext, ClewObject } from '@clew/contracts';
import { displayDate, shortDayLabel, timeRange } from '@clew/calendar/dates';
import type { AssistantDeps } from './ports';
import { threadAccess } from '../threads/access';

/** How many objects one `@` menu offers: a menu, not an index. */
const LIMIT = 12;
/**
 * What `@` offers (D12), in the context the box sits in. `near` holds the refs of what the person is looking at: the
 * cards and rows a conversation has touched, the brief on the landing, the cards in view on the overview. An item or a
 * proposal ref brings its whole card into the context. With nothing typed the menu holds the context alone (its cards,
 * their rows, the proposed times, a meeting named in it), never everything open; with text it searches everything in
 * scope with the context first, then the other cards and rows, today's meetings, and the capabilities the person may
 * call. `visible` marks what is in the context.
 */
export async function listObjects(
  deps: AssistantDeps,
  persona: AuthenticatedContext,
  q: string,
  near: string[] = [],
): Promise<ClewObject[]> {
  const needle = q.trim().toLowerCase();
  const context = new Set(near);
  const threads = (await threadAccess(deps.store, deps.registry).list(persona, deps.clock().toISOString())).filter(
    t => t.state === 'open' && t.kind === 'pushed',
  );
  const close = (t: (typeof threads)[number]) =>
    context.has('thread:' + t.id) ||
    t.items.some(i => context.has(i.ref)) ||
    t.proposals.some(p => context.has('proposal:' + p.id));
  const all: ClewObject[] = [];
  for (const t of threads) {
    const visible = close(t);
    all.push({
      ref: 'thread:' + t.id,
      kind: 'thread',
      label: t.title,
      detail: `kort · ${t.trigger.source}`,
      threadId: t.id,
      visible,
    });
    for (const i of t.items)
      all.push({
        ref: i.ref,
        kind: 'item',
        label: i.label,
        detail: `rad i ${t.title} · ${i.detail}`,
        threadId: t.id,
        visible,
      });
    for (const p of t.proposals.filter(p => p.status === 'proposed'))
      all.push({
        ref: 'proposal:' + p.id,
        kind: 'proposal',
        label: p.participant.name,
        detail: `förslag · ${shortDayLabel(displayDate(p.start))} ${timeRange(p.start, p.end)}`,
        threadId: t.id,
        visible,
      });
  }
  if (deps.registry.visible(persona, 'calendar'))
    try {
      const day = await deps.calendar.readToday(persona);
      for (const e of day.events)
        all.push({
          ref: 'event:' + e.id,
          kind: 'event',
          label: e.title,
          detail: `i dag · ${e.allDay ? 'heldag' : timeRange(e.start, e.end)}`,
          visible: context.has('event:' + e.id),
        });
    } catch {
      /* the calendar is optional here */
    }
  if (!needle) return all.filter(o => o.visible).slice(0, LIMIT);
  // Only what the person may call (D23): a connector outside their audience has no capabilities to find.
  const actor = actorOf(persona);
  for (const { connector: m, capability: c } of deps.registry.capabilitiesFor(actor))
    all.push({
      ref: 'capability:' + c.name,
      kind: 'capability',
      label: c.title,
      detail: `${m.source} · ${c.kind === 'read' ? 'fråga' : 'gör något'}`,
      visible: false,
    });
  const hits = all.filter(o => o.label.toLowerCase().includes(needle) || o.detail.toLowerCase().includes(needle));
  return [...hits.filter(o => o.visible), ...hits.filter(o => !o.visible)].slice(0, LIMIT);
}
