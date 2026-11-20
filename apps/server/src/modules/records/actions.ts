import type {
  AskValues,
  AuthenticatedContext,
  EffectPreview,
  EntityActionStarted,
  RecordActions,
  RecordDraftRef,
} from '@clew/contracts';
import {
  answersOf,
  audiencedActorOf,
  CapabilityError,
  RelationsUnavailableError,
  type RecordAboutAction,
} from '@clew/connectors';
import { InputError } from '../../context';
import { filledBy, recordActionOf, recordItem, recordLabel } from './domain';
import type { RecordActionDeps, RecordRead } from './model';

/**
 * Actions about a record (D132): a connector's propose or execute that says it is about one record of one of its reads,
 * listed on that record's page and run without the model, as an action about a person is (D97, D8). A record is its
 * read and the input the page made it with. The person must be able to make that read now, with that input, before an
 * action about it is listed or started: Clew makes it as the person, as the page does, and a record the source does
 * not answer them has no actions, which the route answers 404 as it answers every other address the reader may not
 * reach. What `about.params` maps is filled from the record's input, never from the person's answers, which name only
 * what the action asks. A propose runs as the person and its draft becomes the card; an execute becomes a card whose
 * button is the human decision, which puts the approved intent in the execution ledger before any source is reached
 * (D45), and one sent from its dialog is decided at once (D126 item 7). Nothing is written to a source here, and
 * nothing is kept about the record beyond the card. One sent from the assistant's draft of it marks that draft as sent,
 * in the card's own transaction, so the conversation offers no second send.
 */
export function recordActionUsecases(deps: RecordActionDeps) {
  /**
   * The record's read made as the person: its output, or undefined when the source or the registry refuses it them
   * (unknown, denied, not found, an input the read does not take). A source that does not answer is said to the person,
   * and a directory that cannot say who may be asked about is an error: neither is a refusal.
   */
  async function readable(persona: AuthenticatedContext, read: string, input: Record<string, unknown>) {
    try {
      return { output: await deps.read(persona, read, input) };
    } catch (error) {
      if (error instanceof RelationsUnavailableError) throw error;
      if (error instanceof CapabilityError && error.code === 'unavailable') throw new InputError(error.message);
      if (error instanceof CapabilityError) return undefined;
      throw error;
    }
  }
  /** The read, the action about its records the person may take, and the record as they read it now; or undefined. */
  async function offered(persona: AuthenticatedContext, read: string, input: Record<string, unknown>, name: string) {
    const record = await deps.records(audiencedActorOf(persona), read);
    const action = record?.actions.find(a => a.name === name);
    if (!record || !action) return undefined;
    const made = await readable(persona, read, input);
    return made ? { record, action, output: made.output, filled: filledBy(action.params, input) } : undefined;
  }
  /** The person's answers to what the action asks (D112), refused in Swedish when they do not fit, or name what the record fills. */
  function answered(action: RecordAboutAction, values: AskValues | undefined) {
    const result = answersOf(action.path.asks, values, deps.clock().toISOString());
    if ('problem' in result) throw new InputError(result.problem);
    return result.answers;
  }
  /**
   * What the card carries beside its input: the person's choice as its reason, the record as its one row, named as the
   * record's page heads it, and for the audit row which read the record is of. The record's input is on the card's
   * action, as the action's own; the audit row names the read only, as a turn's names the kind of thing (D131).
   */
  function context(read: string, record: RecordRead, action: RecordAboutAction, output: unknown) {
    const label = recordLabel(record.view, output);
    return {
      reason: `Du valde ${action.title} för ${label ?? record.title}`,
      items: [recordItem(read, record.title, label)],
      about: { record: read },
    };
  }
  /**
   * The assistant's draft a start or a decision was sent from (D132), with the record as this request names it: the
   * card's transaction marks the draft only when it is a draft of this action about this record, so a draft of another
   * record or action, someone else's or one already sent marks nothing and changes nothing of what is started.
   */
  const sentFrom = (read: string, input: Record<string, unknown>, draft: RecordDraftRef | undefined) =>
    draft ? { recordDraft: { ...draft, record: { capability: read, input } } } : {};

  /**
   * The actions about the record `read` draws with `input` that the person may take, each with what it asks; undefined
   * when the person may not call the read, or when it has actions and the record is not one they can read.
   */
  async function list(
    persona: AuthenticatedContext,
    read: string,
    input: Record<string, unknown>,
  ): Promise<RecordActions | undefined> {
    const record = await deps.records(audiencedActorOf(persona), read);
    if (!record) return undefined;
    // A read with no actions about its records for this person lists nothing; there is nothing to make it for.
    if (!record.actions.length) return { actions: [] };
    if (!(await readable(persona, read, input))) return undefined;
    return { actions: record.actions.map(recordActionOf) };
  }
  /**
   * Start `capability` about the record: a propose with the person's answers to its asks becomes its draft's card; an
   * execute becomes a card for a decision on it, its asks answered then. Undefined when the person may not. `draft`: the
   * assistant's draft it was sent from, marked as sent with the card (`sentFrom`).
   */
  async function start(
    persona: AuthenticatedContext,
    read: string,
    input: Record<string, unknown>,
    capability: string,
    values?: AskValues,
    draft?: RecordDraftRef,
  ): Promise<EntityActionStarted | undefined> {
    const found = await offered(persona, read, input, capability);
    if (!found) return undefined;
    const { record, action, output, filled } = found;
    // An execute's asks are answered on its card, when the person decides (D112): nothing of them is taken here.
    if (action.kind === 'execute' && values && Object.keys(values).length)
      throw new InputError('Svaren ges när du beslutar på ärendet.');
    const asked = action.kind === 'propose' ? answered(action, values) : {};
    // What the record fills comes last: an answer never stands in for it.
    return deps.start(
      persona,
      action.name,
      { ...asked, ...filled },
      {
        ...context(read, record, action, output),
        ...(Object.keys(asked).length ? { asked } : {}),
        ...sentFrom(read, input, draft),
      },
    );
  }
  /**
   * An execute about the record, sent from its dialog's last button (D126 item 7): its card is made now, with the
   * answers checked against the asks and the input against the capability, and decided at once with those answers
   * through the human decision, which puts the approved intent in the execution ledger before any source is reached
   * (D45). Undefined when the person may not; a refused answer is refused before anything is made. `draft`: the
   * assistant's draft it was sent from, marked as sent with the card (`sentFrom`).
   */
  async function decide(
    persona: AuthenticatedContext,
    read: string,
    input: Record<string, unknown>,
    capability: string,
    values?: AskValues,
    draft?: RecordDraftRef,
  ): Promise<EntityActionStarted | undefined> {
    const found = await offered(persona, read, input, capability);
    if (!found) return undefined;
    const { record, action, output, filled } = found;
    if (action.kind !== 'execute' || !deps.decide) throw new InputError('Åtgärden kan inte beslutas härifrån.');
    const answers = answered(action, values);
    const started = await deps.start(persona, action.name, filled, {
      ...context(read, record, action, output),
      ...(Object.keys(answers).length ? { answers } : {}),
      ...sentFrom(read, input, draft),
    });
    await deps.decide(persona, started.threadId, answers);
    return started;
  }
  /**
   * "Det här händer" for an execute about the record (D112), before any card exists: its effect read with what the
   * record fills and the person's answers, as the person; undefined when the person may not. Nothing is written.
   */
  async function effect(
    persona: AuthenticatedContext,
    read: string,
    input: Record<string, unknown>,
    capability: string,
    values?: AskValues,
  ): Promise<EffectPreview | undefined> {
    const found = await offered(persona, read, input, capability);
    if (!found) return undefined;
    const { action, filled } = found;
    return deps.effect(persona, action.name, { ...answered(action, values), ...filled }, action.connectorId);
  }
  return { list, start, decide, effect };
}
export type RecordActionUsecases = ReturnType<typeof recordActionUsecases>;
