import {
  PreviewOutputSchema,
  type AuthenticatedContext,
  type ReviewPreview,
  type DocumentReview,
  type ReviewEvidence,
  type Thread,
} from '@clew/contracts';
import type { Registry } from '@clew/connectors';
import { Value } from '@sinclair/typebox/value';
import { InputError } from '../../context';

export interface CardDecisionsDeps {
  documentPreview?: (persona: AuthenticatedContext, capability: string, ref: string) => Promise<DocumentReview>;
  read(persona: AuthenticatedContext, id: string): Promise<Thread | undefined>;
  registry: Pick<Registry, 'allowed' | 'viewFor'>;
  run(persona: AuthenticatedContext, name: string, input: unknown): Promise<unknown>;
  /**
   * Told when a card's read has been answered, for a card whose read is its answer (D97: the introduction). It answers
   * the card as it now is when the read changed it, and the page gets that card with the read.
   */
  answered?: (persona: AuthenticatedContext, threadId: string) => Promise<Thread | undefined>;
  approve(
    persona: AuthenticatedContext,
    input: {
      decisionId: string;
      operation: string;
      payload: unknown;
      compensates?: string;
      presentation: { threadId: string; version: string; actionId: string };
    },
  ): Promise<unknown>;
  clock: () => Date;
}
/** Human card decisions enter the durable execution boundary. Reads remain immediate. */
export function cardDecisions({ read, registry, run, approve, clock, documentPreview, answered }: CardDecisionsDeps) {
  const required = async (persona: AuthenticatedContext, id: string) => {
    const t = await read(persona, id);
    if (!t) throw new InputError('Kortet finns inte.');
    return t;
  };
  async function act(
    persona: AuthenticatedContext,
    id: string,
    actionId: string,
    refs?: string[],
    reviews?: ReviewEvidence[],
  ) {
    const t = await required(persona, id),
      action = t.actions.find(a => a.id === actionId);
    if (!action) throw new InputError('Okänd handling.');
    const found = registry.allowed(persona, action.capability);
    if (!found || found.connector.id !== t.connector) throw new InputError('Okänd förmåga.');
    const selected = refs ?? t.items.filter(i => i.selected).map(i => i.ref);
    if (action.usesItems && selected.some(ref => !t.items.some(i => i.ref === ref)))
      throw new InputError('Något val är inte längre aktuellt.');
    const payload = {
      ...(action.input ?? {}),
      ...(action.usesItems ? { refs: [...new Set(selected)].sort() } : {}),
      ...(found.capability.review ? { reviews: reviews ?? [] } : {}),
    };
    if (found.capability.kind !== 'execute') {
      const output = await run(persona, action.capability, payload),
        view = registry.viewFor(persona, action.capability);
      const thread = await answered?.(persona, id);
      return { kind: found.capability.kind, output, ...(view ? { view } : {}), ...(thread ? { thread } : {}) };
    }
    const previous = t.execution && !t.execution.compensates ? t.execution : undefined;
    if (
      !previous &&
      found.capability.review &&
      selected.some(ref => {
        const revision = t.items.find(item => item.ref === ref)?.revision;
        return revision && reviews?.find(review => review.ref === ref)?.revision !== revision;
      })
    )
      throw new InputError('Underlaget och kortet gäller olika versioner. Läs in kortet igen.');
    if (!previous && t.state !== 'open') throw new InputError('Kortet är redan hanterat.');
    if (previous && previous.operation !== action.capability)
      throw new InputError('Ett tidigare beslut väntar redan på besked.');
    await approve(persona, {
      decisionId: previous?.decisionId ?? `card:${id}:${actionId}:${Date.parse(t.updatedAt)}`,
      operation: action.capability,
      payload,
      presentation: { threadId: id, version: t.updatedAt, actionId },
    });
    return { kind: 'execute' as const, thread: await required(persona, id) };
  }
  async function undoReceipt(persona: AuthenticatedContext, id: string) {
    const t = await required(persona, id),
      r = t.receipt;
    if (!r?.undoCapability || !r.undoUntil || r.undoUntil <= clock().toISOString())
      throw new InputError('Ångerfönstret har gått ut.');
    if (!t.execution)
      throw new InputError('Det äldre kvittot behöver kontrolleras i källsystemet innan det kan ångras.');
    if (['pending', 'running', 'unknown'].includes(t.execution.state) && !t.execution.compensates)
      throw new InputError('Kontrollera källans besked innan åtgärden kan ångras.');
    const originalId = t.execution.compensates ?? t.execution.id;
    await approve(persona, {
      decisionId: `undo:${originalId}`,
      operation: r.undoCapability,
      payload: r.undoInput ?? {
        refs: r.rows
          .filter(row => row.outcome === 'done')
          .map(row => row.ref)
          .sort(),
      },
      compensates: originalId,
      presentation: { threadId: id, version: t.updatedAt, actionId: 'undo' },
    });
    return required(persona, id);
  }
  /**
   * One item's document for the review flow (D70): the preview read the card's reviewed action names, run for one of the
   * card's own items. A read, so no decision; the answer is checked against the contract before the browser draws it.
   */
  async function preview(persona: AuthenticatedContext, id: string, ref: string): Promise<ReviewPreview> {
    const t = await required(persona, id),
      action = t.actions.find(a => a.review === 'each' && a.preview);
    if (!action?.preview) throw new InputError('Kortet har inget underlag att visa.');
    if (!t.items.some(i => i.ref === ref)) throw new InputError('Raden finns inte på kortet.');
    const found = registry.allowed(persona, action.preview);
    if (!found || found.connector.id !== t.connector || found.capability.kind !== 'read')
      throw new InputError('Okänd förmåga.');
    if (documentPreview && (found.capability.view?.kind === 'document' || found.capability.view?.kind === 'record')) {
      const preview = await documentPreview(persona, action.preview, ref);
      const revision = t.items.find(item => item.ref === ref)?.revision;
      if (!t.receipt && !t.execution && t.state === 'open' && revision && revision !== preview.bundle.revision)
        throw new InputError('Underlaget har ändrats sedan kortet skapades. Läs in kortet igen.');
      return preview;
    }
    const output = await run(persona, action.preview, { ref });
    if (!Value.Check(PreviewOutputSchema, output)) throw new InputError('Underlaget kunde inte läsas.');
    return output;
  }
  return { act, undoReceipt, preview };
}
