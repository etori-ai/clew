import { Value } from 'typebox/value';
import type { AuthenticatedContext, ThreadAction, ThreadItem } from '@clew/contracts';
import { audiencedActorOf, CapabilityError, pendingAsks, type Registry, type ThreadDraft } from '@clew/connectors';
import { ThreadDraftSchema } from '@clew/connectors/protocol';
import { InputError } from '../../context';
import { STARTED_ACTION, startedTopic, takesStarted } from '../domain';
import type { PersonKeys, RecordDraftSent, ThreadStore } from '../model';
import { keyedDrafts } from './keys';

/**
 * A card the person starts (D8, D97): an action and its input, chosen without the model, becomes a card the person
 * decides on. Nothing else turns a `propose` or an `execute` with an input into a card without the model: a scan pushes
 * what a source wants, a card's own button runs on that card, and the box asks the model. A `propose` runs here as the
 * person and the `ThreadDraft` it answers is the card. An `execute` is never called here: it is the card's one button,
 * so it runs only through the human decision (`decisions.ts`), with the approved intent in the ledger first (D45); one
 * decided in its dialog (D126 item 7) is made here with the answers checked and is decided on the next step. The
 * person's choice is the card's reason, whatever the source wrote. While the card is open the same request, under the
 * same authority, gives the same card. The card, its first message, the mark on the assistant's draft it was sent from
 * (D132) and the audit row commit together.
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
  /** Whose a source's key is (D122): a propose's rows that name a person by user name name them by id. Absent: by nobody. */
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
   * An execute decided in its dialog (D126 item 7): the person's answers to its asks, which the decision sends. They are
   * checked with the input against the capability's schema before the card is made, so a card the decision would refuse
   * is never made, and they tell this card from one with other answers; they are never kept on the card, whose input is
   * plain while approved input is sealed (D45). The decision's audit row names them, not this card's.
   */
  answers?: Record<string, string>;
  /**
   * The person the action is about (D122): `input[param]` names them by Clew's key, their id, which is what the card
   * keeps and its topic is made from, and `sourceKey` is their user name now, what the source is sent. An execute's topic
   * names `param`, and the id is resolved to the user name again when the person decides (`decisions.ts`).
   */
  person?: { param: string; personId: string; sourceKey: string };
  /**
   * `'topic'`: the propose's own topic alone says which work this is. What it was given is then only how the request
   * was worded (the assistant fills it in from a conversation, differently each time), so while the card is open a
   * request with other input is the same card. Without it the input is part of what makes two requests the same card.
   */
  same?: 'topic';
  /**
   * The assistant's draft about a record this was sent from (D132): its conversation's message, and the record as the
   * request names it. The transaction that makes the card marks the draft as sent, as this card, when it is the person's
   * own draft of this action about this record and not marked yet (`ThreadTx.markRecordDraftSent`), and the audit row
   * then says `fromDraft`. Anything else marks nothing, and the card is made exactly as without it: a draft never decides
   * whether or what is started. A request that finds its card already open makes nothing and marks nothing.
   */
  recordDraft?: Omit<RecordDraftSent, 'personId' | 'capability' | 'threadId'>;
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
    // An execute's asks are answered when the person decides on its card (D112): until then the input may lack them. One
    // decided in its dialog brings its answers, checked here with the input (D126 item 7).
    const declared = registry.find(capability)?.capability;
    const answers = declared?.kind === 'execute' ? (context.answers ?? {}) : {};
    if (context.answers && declared?.kind !== 'execute') throw new InputError('Åtgärden kan inte startas härifrån.');
    const pending =
      declared?.kind === 'execute' ? pendingAsks(declared, [...Object.keys(input), ...Object.keys(answers)]) : [];
    // What the source is sent: a person by their user name (D122), where the card keeps their id.
    const { person } = context;
    if (person && input[person.param] !== person.personId) throw new InputError('Åtgärden kan inte startas härifrån.');
    const sent = person ? { ...input, [person.param]: person.sourceKey } : input;
    try {
      found = await registry.validate(audiencedActorOf(persona), capability, { ...answers, ...sent }, pending);
    } catch (error) {
      throw error instanceof CapabilityError ? new InputError(error.message) : error;
    }
    const { connector, capability: chosen } = found;
    // A follower answers a fact with steps, and a reviewed execute needs rows the person picks: neither starts from a key.
    // A person goes where the capability takes them (D122), and only there, so the decision can resolve them again: a
    // card it would refuse is never made.
    if (
      (chosen.kind !== 'propose' && chosen.kind !== 'execute') ||
      chosen.follows ||
      chosen.review ||
      !takesStarted(person ? { person } : {}, chosen.about)
    )
      throw new InputError('Åtgärden kan inte startas härifrån.');
    let draft: Omit<ThreadDraft, 'topic' | 'reason' | 'occurrences'>;
    let identity: unknown;
    if (chosen.kind === 'propose') {
      const output = await run(persona, capability, sent);
      if (!Value.Check(ThreadDraftSchema, output) || registry.draftProblem(connector.id, output))
        throw new InputError(`Förslaget från ${connector.source} kunde inte läsas.`);
      // A person the draft's rows name by user name is kept by id (D122), resolved as the rows arrive.
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
    // input names a person by id (D122), so a rename leaves the topic as it was and a reused name gives another card. An
    // execute's topic also says which property of its input keeps the person, for the decision to resolve.
    // An execute decided in its dialog is told apart by its answers too, so another order is another card and the same
    // order sent twice is the one card (a digest: the answers themselves are not kept on it).
    // A propose whose topic alone is its identity (`same`) is one card whatever it was given.
    const authority = persona.authorizationVersion;
    const topic = startedTopic(
      capability,
      digest(
        chosen.kind === 'propose' && context.same === 'topic'
          ? { identity, authority }
          : { input, identity, authority, ...(Object.keys(answers).length ? { answers } : {}) },
      ),
      chosen.kind === 'execute' ? person?.param : undefined,
    );
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
      const fromDraft = context.recordDraft
        ? await tx.markRecordDraftSent({ ...context.recordDraft, personId: persona.id, capability, threadId: id })
        : false;
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
          // That it came from the assistant's draft, never which conversation or what it said.
          ...(fromDraft ? { fromDraft: true } : {}),
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
