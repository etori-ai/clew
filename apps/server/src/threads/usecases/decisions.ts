import type { AuthenticatedContext, Thread } from '@clew/contracts';
import type { Registry } from '@clew/connectors';
import { InputError } from '../../context';

export interface CardDecisionsDeps {
  read(persona: AuthenticatedContext, id: string): Promise<Thread | undefined>;
  registry: Pick<Registry, 'allowed' | 'viewFor'>;
  run(persona: AuthenticatedContext, name: string, input: unknown): Promise<unknown>;
  approve(persona: AuthenticatedContext, input: { decisionId: string; operation: string; payload: unknown; compensates?: string; presentation: { threadId: string; version: string; actionId: string } }): Promise<unknown>;
  clock: () => Date;
}
/** Human card decisions enter the durable execution boundary. Reads remain immediate. */
export function cardDecisions({ read, registry, run, approve, clock }: CardDecisionsDeps) {
  const required = async (persona: AuthenticatedContext, id: string) => { const t = await read(persona, id); if (!t) throw new InputError('Tråden finns inte.'); return t; };
  async function act(persona: AuthenticatedContext, id: string, actionId: string, refs?: string[]) {
    const t = await required(persona, id), action = t.actions.find(a => a.id === actionId);
    if (!action) throw new InputError('Okänd handling.');
    const found = registry.allowed(persona, action.capability);
    if (!found || found.connector.id !== t.connector) throw new InputError('Okänd förmåga.');
    const selected = refs ?? t.items.filter(i => i.selected).map(i => i.ref);
    if (action.usesItems && selected.some(ref => !t.items.some(i => i.ref === ref))) throw new InputError('Något val är inte längre aktuellt.');
    const payload = { ...(action.input ?? {}), ...(action.usesItems ? { refs: [...new Set(selected)].sort() } : {}) };
    if (found.capability.kind !== 'execute') {
      const output = await run(persona, action.capability, payload), view = registry.viewFor(persona, action.capability);
      return { kind: found.capability.kind, output, ...(view ? { view } : {}) };
    }
    const previous = t.execution && !t.execution.compensates ? t.execution : undefined;
    if (!previous && t.state !== 'open') throw new InputError('Tråden är redan hanterad.');
    if (previous && previous.operation !== action.capability) throw new InputError('Ett tidigare beslut väntar redan på besked.');
    await approve(persona, { decisionId: previous?.decisionId ?? `card:${id}:${actionId}:${Date.parse(t.updatedAt)}`, operation: action.capability, payload, presentation: { threadId: id, version: t.updatedAt, actionId } });
    return { kind: 'execute' as const, thread: await required(persona, id) };
  }
  async function undoReceipt(persona: AuthenticatedContext, id: string) {
    const t = await required(persona, id), r = t.receipt;
    if (!r?.undoCapability || !r.undoUntil || r.undoUntil <= clock().toISOString()) throw new InputError('Ångerfönstret har gått ut.');
    if (!t.execution) throw new InputError('Det äldre kvittot behöver kontrolleras i källsystemet innan det kan ångras.');
    const originalId = t.execution.compensates ?? t.execution.id;
    await approve(persona, { decisionId: `undo:${originalId}`, operation: r.undoCapability, payload: r.undoInput ?? { refs: r.rows.filter(row => row.outcome === 'done').map(row => row.ref).sort() }, compensates: originalId, presentation: { threadId: id, version: t.updatedAt, actionId: 'undo' } });
    return required(persona, id);
  }
  return { act, undoReceipt };
}
