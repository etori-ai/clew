import { Value } from 'typebox/value';
import type { AuthenticatedContext, ThreadAction, ThreadItem } from '@clew/contracts';
import { actorOf, CapabilityError, type Registry, type ThreadDraft } from '@clew/connectors';
import { ThreadDraftSchema } from '@clew/connectors/protocol';
import { InputError } from '../../context';
import type { ThreadStore } from '../model';

/**
 * A card the person starts (D8, D97): an action and its input, chosen without the model, becomes a card the person
 * decides on. Nothing else turns a `propose` or an `execute` with an input into a card without the model: a scan pushes
 * what a source wants, a card's own button runs on that card, and the box asks the model. A `propose` runs here as the
 * person and the `ThreadDraft` it answers is the card. An `execute` is never called here: it is the card's one button,
 * so it runs only through the human decision (`decisions.ts`), with the approved intent in the ledger first (D45). The
 * person's choice is the card's reason, whatever the source wrote. While the card is open the same request, under the
 * same authority, gives the same card. The card, its first message and the audit row commit together.
 */
export interface StartedDeps {
  store: ThreadStore;
  registry: Pick<Registry, 'validate' | 'draftProblem'>;
  /** Run a capability as the person, with input validation and scope: `runCapability` in the server. */
  run: (persona: AuthenticatedContext, name: string, input: unknown) => Promise<unknown>;
  /** A short, stable digest of a value: what makes two requests the same card. */
  digest: (value: unknown) => string;
  clock: () => Date;
  ids: () => string;
}
/** What the caller knows that the action does not. */
export interface StartContext {
  /** Swedish, under "Varför ser jag detta?": the person's choice. */
  reason: string;
  /** The rows of an execute's card: what it acts on. A propose's card has its draft's rows. */
  items?: ThreadItem[];
  /** What the action is about, for the audit row (D97: `{ entity, key }`). */
  about?: Record<string, unknown>;
}

export function startedCards({ store, registry, run, digest, clock, ids }: StartedDeps) {
  /** The card for an action the person chose, with its input: `{ threadId }` of a new card, or of the one still open. */
  async function startCard(
    persona: AuthenticatedContext,
    capability: string,
    input: Record<string, unknown>,
    context: StartContext,
  ): Promise<{ threadId: string }> {
    await persona.authorize();
    let found: Awaited<ReturnType<typeof registry.validate>>;
    try {
      found = await registry.validate(actorOf(persona), capability, input);
    } catch (error) {
      throw error instanceof CapabilityError ? new InputError(error.message) : error;
    }
    const { connector, capability: declared } = found;
    // A follower answers a fact with steps, and a reviewed execute needs rows the person picks: neither starts from a key.
    if ((declared.kind !== 'propose' && declared.kind !== 'execute') || declared.follows || declared.review)
      throw new InputError('Åtgärden kan inte startas härifrån.');
    let draft: Omit<ThreadDraft, 'topic' | 'reason' | 'occurrences'>;
    let identity: unknown;
    if (declared.kind === 'propose') {
      const output = await run(persona, capability, input);
      if (!Value.Check(ThreadDraftSchema, output) || registry.draftProblem(connector.id, output))
        throw new InputError(`Förslaget från ${connector.source} kunde inte läsas.`);
      draft = output;
      identity = output.topic;
    } else {
      const decide: ThreadAction = {
        id: 'decide',
        label: declared.title,
        capability,
        kind: 'execute',
        role: 'primary',
        input,
      };
      draft = {
        area: connector.areas.find(a => a.roles.includes(persona.role))?.id ?? connector.areas[0]?.id ?? connector.id,
        title: declared.title,
        summary: declared.description,
        items: context.items ?? [],
        actions: [decide],
      };
    }
    // The same action with the same input (for a propose, the same occurrence) under the same authority is one card.
    const topic = `started:${capability}:${digest({ input, identity, authority: persona.authorizationVersion })}`;
    const open = await store.openThread(persona.id, topic);
    if (open) return { threadId: open.id };
    const id = ids(),
      at = clock().toISOString();
    const inserted = await store.transaction(async tx => {
      const ok = await tx.insertThread({
        id,
        personId: persona.id,
        sourceAuthorization: persona.authorizationVersion,
        kind: 'pushed',
        topic,
        title: draft.title,
        state: 'open',
        week: null,
        connector: connector.id,
        area: draft.area,
        summary: draft.summary,
        items: draft.items ?? [],
        actions: draft.actions,
        // The person asked for it, so it waits on them.
        waitingOn: null,
        deadline: draft.deadline ?? null,
        trigger: { reason: context.reason, source: connector.source, at },
        createdAt: at,
        updatedAt: at,
      });
      if (!ok) return false;
      await tx.addMessage(id, { role: 'assistant', body: draft.summary, at });
      await tx.writeAudit({
        actor: persona.principal.id,
        action: 'thread.started',
        subject: 'thread:' + id,
        at,
        details: {
          connector: connector.id,
          capability,
          kind: declared.kind,
          topic,
          owner: persona.id,
          ...(context.about ? { about: context.about } : {}),
        },
      });
      return true;
    });
    if (inserted) return { threadId: id };
    // Another request made the same card first.
    const raced = await store.openThread(persona.id, topic);
    if (raced) return { threadId: raced.id };
    throw new InputError('Kortet kunde inte skapas.');
  }
  return { startCard };
}
export type StartedCards = ReturnType<typeof startedCards>;
