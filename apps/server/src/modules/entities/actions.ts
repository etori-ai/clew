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
 * The action gets the entity in its `param`, and a propose that asks gets the person's answers (D112); an execute's asks
 * are answered when the person decides on its card. It becomes a card through the stream: a propose's draft, or an
 * execute behind its human decision. Nothing is written to a source here, and nothing is kept about the entity beyond
 * the card. A person is named by Clew's key in what Clew keeps (D116): the card's row and an execute's input hold the
 * person's id, and a source is sent the person's user name, resolved again when the person decides.
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
      /** The person `input[param]` names by id (D116), with the user name a source is sent now. */
      person?: { param: string; personId: string; sourceKey: string };
    },
  ): Promise<EntityActionStarted>;
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
    // Clew keeps a person by id (D116): the card's input names them by Clew's key, and the stream sends the source the
    // user name, now and when the person decides. A unit's id is both keys.
    return deps.start(
      persona,
      action.capability,
      { ...asked, [action.param]: entity.key },
      {
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
        ...(Object.keys(asked).length ? { asked } : {}),
      },
    );
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
  return { start, effect };
}
export type EntityActions = ReturnType<typeof entityActionUsecases>;
