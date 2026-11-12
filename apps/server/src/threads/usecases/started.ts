import { Value } from 'typebox/value';
import type { AuthenticatedContext, ThreadAction, ThreadItem } from '@clew/contracts';
import { actorOf, CapabilityError, pendingAsks, type Registry, type ThreadDraft } from '@clew/connectors';
import { ThreadDraftSchema } from '@clew/connectors/protocol';
import { InputError } from '../../context';
import { STARTED_ACTION, startedTopic } from '../domain';
import type { PersonKeys, ThreadStore } from '../model';
import { keyedDrafts } from './keys';

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
  registry: Pick<Registry, 'validate' | 'draftProblem' | 'find'>;
  /** Run a capability as the person, with input validation and scope: `runCapability` in the server. */
  run: (persona: AuthenticatedContext, name: string, input: unknown) => Promise<unknown>;
  /** A short, stable digest of a value: what makes two requests the same card. */
  digest: (value: unknown) => string;
  clock: () => Date;
  ids: () => string;
  /** Whose a source's key is (D116): a propose's rows that name a person by user name name them by id. Absent: by nobody. */
  people?: PersonKeys;
}
/** What the caller knows that the action does not. */
export interface StartContext {
  /** Swedish, under "Varför ser jag detta?": the person's choice. */
  reason: string;
  /** The rows of an execute's card: what it acts on. A propose's card has its draft's rows. */
  items?: ThreadItem[];
  /** What the action is about, for the audit row (D97: `{ entity, key }`). */
  about?: Record<string, unknown>;
  /** The person's answers to a propose's asks (D112), already in the input: the audit row names them. */
  asked?: Record<string, string>;
  /**
   * The person the action is about (D116): `input[param]` names them by Clew's key, their id, which is what the card
   * keeps and its topic is made from, and `sourceKey` is their user name now, what the source is sent. An execute's id is
   * resolved to the user name again when the person decides (`decisions.ts`).
   */
  person?: { param: string; personId: string; sourceKey: string };
}

export function startedCards({ store, registry, run, digest, clock, ids, people }: StartedDeps) {
  /** The card for an action the person chose, with its input: `{ threadId }` of a new card, or of the one still open. */
  async function startCard(
    persona: AuthenticatedContext,
    capability: string,
    input: Record<string, unknown>,
    context: StartContext,
  ): Promise<{ threadId: string }> {
    await persona.authorize();
    let found: Awaited<ReturnType<typeof registry.validate>>;
    // An execute's asks are answered when the person decides on its card (D112): until then the input may lack them.
    const declared = registry.find(capability)?.capability;
    const pending = declared?.kind === 'execute' ? pendingAsks(declared, Object.keys(input)) : [];
    // What the source is sent: a person by their user name (D116), where the card keeps their id.
    const { person } = context;
    if (person && input[person.param] !== person.personId) throw new InputError('Åtgärden kan inte startas härifrån.');
    const sent = person ? { ...input, [person.param]: person.sourceKey } : input;
    try {
      found = await registry.validate(actorOf(persona), capability, sent, pending);
    } catch (error) {
      throw error instanceof CapabilityError ? new InputError(error.message) : error;
    }
    const { connector, capability: chosen } = found;
    // A follower answers a fact with steps, and a reviewed execute needs rows the person picks: neither starts from a key.
    if ((chosen.kind !== 'propose' && chosen.kind !== 'execute') || chosen.follows || chosen.review)
      throw new InputError('Åtgärden kan inte startas härifrån.');
    let draft: Omit<ThreadDraft, 'topic' | 'reason' | 'occurrences'>;
    let identity: unknown;
    if (chosen.kind === 'propose') {
      const output = await run(persona, capability, sent);
      if (!Value.Check(ThreadDraftSchema, output) || registry.draftProblem(connector.id, output))
        throw new InputError(`Förslaget från ${connector.source} kunde inte läsas.`);
      // A person the draft's rows name by user name is kept by id (D116), resolved as the rows arrive.
      draft = (await keyedDrafts(people, persona, [output]))[0]!;
      identity = output.topic;
    } else {
      const decide: ThreadAction = {
        id: STARTED_ACTION,
        label: chosen.title,
        capability,
        kind: 'execute',
        role: 'primary',
        input,
      };
      draft = {
        area: connector.areas.find(a => a.roles.includes(persona.role))?.id ?? connector.areas[0]?.id ?? connector.id,
        title: chosen.title,
        summary: chosen.description,
        items: context.items ?? [],
        actions: [decide],
      };
    }
    // The same action with the same input (for a propose, the same occurrence) under the same authority is one card. The
    // input names a person by id (D116), so a rename leaves the topic as it was and a reused name gives another card.
    const topic = startedTopic(capability, digest({ input, identity, authority: persona.authorizationVersion }));
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
          kind: chosen.kind,
          topic,
          owner: persona.id,
          ...(context.about ? { about: context.about } : {}),
          ...(context.asked && Object.keys(context.asked).length ? { asked: context.asked } : {}),
        },
      });
      return true;
    });
    if (inserted) return { threadId: id };
    // Another request made the same card first.
    const raced = await store.openThread(persona.id, topic);
    if (raced) return { threadId: raced.id };
    throw new InputError('Ärendet kunde inte skapas.');
  }
  return { startCard };
}
export type StartedCards = ReturnType<typeof startedCards>;
