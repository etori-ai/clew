import { inScope } from '@clew/connectors';
import type { AuthenticatedContext, CalendarEvent, Chip, Thread } from '@clew/contracts';
import { listThreads, readThread } from '@clew/db/threads';
import { today, weekStart } from '@clew/calendar/dates';
import { listWeek } from '../modules/calendar/usecases/reads';
import { registry } from '../connectors/registry';
import { InputError } from '../context';

import type { ResolvedObject } from './context';
export type { ResolvedObject };
export interface ResolvedChips { objects: ResolvedObject[]; threads: Map<string, Thread>; primaryThread?: Thread; }

const gone = () => new InputError('Något du pekade på finns inte längre.');
export async function resolveChips(persona: AuthenticatedContext, chips: Chip[]): Promise<ResolvedChips> {
  const objects: ResolvedObject[] = [];
  const threads = new Map<string, Thread>();
  let open: Thread[] | undefined;
  const openThreads = async () => (open ??= (await listThreads(persona.id)).filter(t => t.state === 'open'));
  for (const chip of chips) {
    if (chip.kind === 'thread') {
      const id = chip.ref.replace(/^thread:/, '');
      const found = await readThread(persona.id, id);
      if (!found) throw gone();
      threads.set(found.thread.id, found.thread);
      objects.push({ kind: 'thread', ref: chip.ref, thread: found.thread });
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
      const id = chip.ref.replace(/^event:/, '');
      let event: CalendarEvent | undefined;
      try { const { view } = await listWeek(persona, weekStart(today()), 14); event = view.find(e => e.id === id); } catch { event = undefined; }
      if (!event) throw gone();
      objects.push({ kind: 'event', ref: chip.ref, event });
    } else {
      const name = chip.ref.replace(/^capability:/, '');
      const found = registry.find(name);
      if (!found || !inScope(found.capability.scope, { id: persona.id, name: persona.name, unitId: persona.unitId, unitLabel: persona.unitLabel, role: persona.role })) throw gone();
      objects.push({ kind: 'capability', ref: chip.ref, name, title: found.capability.title, source: found.connector.source });
    }
  }
  const ids = [...threads.keys()];
  return { objects, threads, ...(ids.length === 1 && objects.every(o => 'thread' in o) ? { primaryThread: threads.get(ids[0]!) } : {}) };
}
