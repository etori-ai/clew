import type {
  AskValues,
  AuthenticatedContext,
  EffectPreview,
  EntityAction,
  EntityActionStarted,
  EntityDetail,
  EntityKind,
  ThreadItem,
} from '@clew/contracts';
import { answersOf } from '@clew/connectors';
import { InputError } from '../../context';

/**
 * An action about an entity, started from its menu without the model (D97, D8). The action must be one the opened entity
 * offers the reader (an about action of that kind they may call), on a key inside the rule of who may be asked about;
 * anything else is undefined, which the route answers 404 as it answers every other address the reader may not reach.
 * The action gets the entity in its `param`, and a propose that asks gets the person's answers (D112). It becomes a card
 * through the stream: a propose's draft, or an execute behind its human decision. The web sends both from the action
 * dialog's last button and nothing before it (D126 item 7): a propose with its answers (`start`), an execute with its
 * answers as the card and its decision at once (`decide`), after the dialog has read what it would write (`effect`).
 * `start` without answers still makes an execute's card for a decision on the card. Nothing is written to a source
 * here, and nothing is kept about the entity beyond the card. A person is named by Clew's key in what Clew keeps (D122):
 * the card's row and an execute's input hold the person's id, and a source is sent the person's user name, resolved
 * again when the person decides.
 */
export interface EntityActionDeps {
  /** The entity as the reader opens it (the module's `detail`): undefined outside the rule, with the actions they may call now. */
  open(
    persona: AuthenticatedContext,
    kind: EntityKind,
    key: string,
  ): Promise<Pick<EntityDetail, 'entity' | 'actions'> | undefined>;
  /**
   * The card an action with its input becomes (composition: the stream's `startCard`): a propose runs as the person and
   * its draft is the card; an execute is the card's button, never called before the decision. Throws in Swedish when the
   * source refuses.
   */
  start(
    persona: AuthenticatedContext,
    capability: string,
    input: Record<string, unknown>,
    context: {
      reason: string;
      items?: ThreadItem[];
      about?: Record<string, unknown>;
      asked?: Record<string, string>;
      /** The person `input[param]` names by id (D122), with the user name a source is sent now. */
      person?: { param: string; personId: string; sourceKey: string };
      /** An execute decided in its dialog: the answers, checked with the input and never kept on the card. */
      answers?: Record<string, string>;
    },
  ): Promise<EntityActionStarted>;
  /**
   * The human decision on a started execute's card, with the person's answers (composition: the stream's `act` on the
   * card's one button): the approved intent goes to the execution ledger first (D45) and the source is reached only from
   * there. Throws in Swedish when it is refused. Absent: an execute is not decided from the entity.
   */
  decide?(persona: AuthenticatedContext, threadId: string, answers: AskValues): Promise<unknown>;
  /**
   * What an execute would write for this input (D112, composition: the stream's `effectFor`): its effect read, run as the
   * person; nothing is written. Throws in Swedish when it has none or the source refuses.
   */
  effect(
    persona: AuthenticatedContext,
    capability: string,
    input: Record<string, unknown>,
    connector: string,
  ): Promise<EffectPreview>;
  clock: () => Date;
}

export function entityActionUsecases(deps: EntityActionDeps) {
  /** The opened entity and the action it offers the reader, or undefined. */
  async function offered(persona: AuthenticatedContext, kind: EntityKind, key: string, capability: string) {
    const opened = await deps.open(persona, kind, key);
    const action = opened?.actions.find(a => a.capability === capability);
    return opened && action ? { entity: opened.entity, action } : undefined;
  }
  /** The person's answers to the asks they meet on this action (D112), refused in Swedish when they do not fit. */
  function answered(action: EntityAction, values: AskValues | undefined, now: string) {
    const result = answersOf(action.path?.asks ?? [], values, now);
    if ('problem' in result) throw new InputError(result.problem);
    return result.answers;
  }
  /** Start `capability` about the entity behind Clew's `key`; undefined when the reader may not. */
  async function start(
    persona: AuthenticatedContext,
    kind: EntityKind,
    key: string,
    capability: string,
    values?: AskValues,
  ): Promise<EntityActionStarted | undefined> {
    const found = await offered(persona, kind, key, capability);
    if (!found) return undefined;
    const { entity, action } = found;
    // An execute's asks are answered on its card, when the person decides (D112): nothing of them is taken here.
    if (action.kind === 'execute' && values && Object.keys(values).length)
      throw new InputError('Svaren ges när du beslutar på ärendet.');
    const asked = action.kind === 'propose' ? answered(action, values, deps.clock().toISOString()) : {};
    return deps.start(
      persona,
      action.capability,
      { ...asked, [action.param]: entity.key },
      {
        ...context(kind, entity, action),
        ...(Object.keys(asked).length ? { asked } : {}),
      },
    );
  }
  /**
   * What the card of an action about `entity` carries beside its input (D97, D122): Clew keeps a person by id, so the
   * card's input names them by Clew's key and the stream sends the source the user name, now and when the person
   * decides; a unit's id is both keys.
   */
  function context(kind: EntityKind, entity: EntityDetail['entity'], action: EntityAction) {
    return {
      ...(kind === 'person'
        ? { person: { param: action.param, personId: entity.key, sourceKey: entity.sourceKey } }
        : {}),
      reason: `Du valde ${action.title} för ${entity.name}`,
      // An execute's card names who it acts on, and the row's subject puts the card on that entity (D97 item 6). The
      // row is Clew's, so its ref is Clew's own id where there is one.
      items: [
        {
          ref: `${kind}:${entity.id ?? entity.key}`.slice(0, 200),
          label: entity.name,
          detail: entity.detail ?? '',
          selectable: false,
          selected: true,
          subject: { entity: kind, key: entity.key },
        },
      ],
      // The audit row names the entity by Clew's own id, as it names the actor: a user name can be renamed, and erasing
      // a person's subjects does not reach the audit.
      about: entity.id ? { entity: kind, id: entity.id } : { entity: kind, key: entity.key },
    };
  }
  /**
   * An execute about the entity behind `key`, sent from its dialog's last button (D126 item 7: nothing is created before
   * it): the person has seen what it asks and "Det här händer" (`effect`), so its card is made now, with the answers
   * checked against the asks and with the input against the capability, and decided at once with those answers through
   * the human decision, which puts the approved intent in the execution ledger before any source is reached (D45). The
   * card holds the outcome. Undefined when the reader may not start it; a refused answer is refused before anything is
   * made. Should the decision itself be refused after the card is made, the card stays open with its button, as any card
   * whose decision was refused does.
   */
  async function decide(
    persona: AuthenticatedContext,
    kind: EntityKind,
    key: string,
    capability: string,
    values?: AskValues,
  ): Promise<EntityActionStarted | undefined> {
    const found = await offered(persona, kind, key, capability);
    if (!found) return undefined;
    const { entity, action } = found;
    if (action.kind !== 'execute' || !deps.decide) throw new InputError('Åtgärden kan inte beslutas härifrån.');
    const answers = answered(action, values, deps.clock().toISOString());
    const started = await deps.start(
      persona,
      action.capability,
      { [action.param]: entity.key },
      {
        ...context(kind, entity, action),
        ...(Object.keys(answers).length ? { answers } : {}),
      },
    );
    await deps.decide(persona, started.threadId, answers);
    return started;
  }
  /**
   * "Det här händer" for an execute about the entity behind `key` (D112), before any card exists: its effect read with the
   * key and the person's answers, as the person; undefined when the reader may not start it. Nothing is written.
   */
  async function effect(
    persona: AuthenticatedContext,
    kind: EntityKind,
    key: string,
    capability: string,
    values?: AskValues,
  ): Promise<EffectPreview | undefined> {
    const found = await offered(persona, kind, key, capability);
    if (!found) return undefined;
    const { entity, action } = found;
    const asked = answered(action, values, deps.clock().toISOString());
    // A source reads the entity by its own key: a person's user name.
    return deps.effect(persona, action.capability, { ...asked, [action.param]: entity.sourceKey }, action.connector);
  }
  return { start, decide, effect };
}
export type EntityActions = ReturnType<typeof entityActionUsecases>;
