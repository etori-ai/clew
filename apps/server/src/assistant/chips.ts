import { audiencedActorOf, SEARCH_CONNECTOR } from '@clew/connectors';
import type { AuthenticatedContext, CalendarEvent, Chip, SearchHit, Thread } from '@clew/contracts';
import { displayDate, weekStart } from '@clew/calendar/dates';
import { InputError } from '../context';
import type { ResolvedObject } from './context';
import type { AssistantDeps } from './ports';
import { threadAccess } from '../threads/access';

export type { ResolvedObject };
export interface ResolvedChips {
  objects: ResolvedObject[];
  threads: Map<string, Thread>;
  primaryThread?: Thread;
}

const gone = () => new InputError('Något du pekade på finns inte längre.');
/** What the chips point at, read fresh so a stale ref is refused rather than guessed. */
export async function resolveChips(
  deps: AssistantDeps,
  persona: AuthenticatedContext,
  chips: Chip[],
): Promise<ResolvedChips> {
  const access = threadAccess(deps.store, deps.registry);
  const objects: ResolvedObject[] = [];
  const threads = new Map<string, Thread>();
  let open: Thread[] | undefined;
  const openThreads = async () =>
    (open ??= (await access.list(persona, deps.clock().toISOString())).filter(t => t.state === 'open'));
  for (const chip of chips) {
    if (chip.kind === 'thread') {
      const id = chip.ref.replace(/^thread:/, '');
      const found = await access.read(persona, id);
      if (!found) throw gone();
      threads.set(found.id, found);
      objects.push({ kind: 'thread', ref: chip.ref, thread: found });
    } else if (chip.kind === 'item') {
      const thread = (await openThreads()).find(t => t.items.some(i => i.ref === chip.ref));
      const item = thread?.items.find(i => i.ref === chip.ref);
      if (!thread || !item) throw gone();
      threads.set(thread.id, thread);
      objects.push({ kind: 'item', ref: chip.ref, thread, item });
    } else if (chip.kind === 'proposal') {
      const id = chip.ref.replace(/^proposal:/, '');
      const thread = (await openThreads()).find(t => t.proposals.some(p => p.id === id));
      const proposal = thread?.proposals.find(p => p.id === id);
      if (!thread || !proposal) throw gone();
      threads.set(thread.id, thread);
      objects.push({ kind: 'proposal', ref: chip.ref, thread, proposal });
    } else if (chip.kind === 'event') {
      if (!deps.registry.visible(persona, 'calendar')) throw gone();
      const id = chip.ref.replace(/^event:/, '');
      let event: CalendarEvent | undefined;
      try {
        const { view } = await deps.calendar.listWeek(persona, weekStart(displayDate(deps.clock().toISOString())), 14);
        event = view.find(e => e.id === id);
      } catch {
        event = undefined;
      }
      if (!event) throw gone();
      objects.push({ kind: 'event', ref: chip.ref, event });
    } else if (chip.kind === 'document') {
      // A passage from the panel (D26): fetched again from the connector that found it, so the model reads the source, not the browser's copy.
      const ref = chip.ref.replace(/^document:/, '');
      let hit: SearchHit | undefined;
      try {
        hit = await deps.run<SearchHit>(persona, SEARCH_CONNECTOR + '.fetchSource', { ref }, { caller: 'assistant' });
      } catch {
        hit = undefined;
      }
      if (!hit) throw gone();
      objects.push({ kind: 'document', ref: chip.ref, hit });
    } else {
      const name = chip.ref.replace(/^capability:/, '');
      const found = deps.registry.allowed(audiencedActorOf(persona), name);
      if (!found) throw gone();
      objects.push({
        kind: 'capability',
        ref: chip.ref,
        name,
        title: found.capability.title,
        source: found.connector.source,
      });
    }
  }
  const ids = [...threads.keys()];
  return {
    objects,
    threads,
    ...(ids.length === 1 && objects.every(o => 'thread' in o) ? { primaryThread: threads.get(ids[0]!) } : {}),
  };
}
