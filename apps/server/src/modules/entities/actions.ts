import type { AuthenticatedContext, EntityActionStarted, EntityDetail, EntityKind, ThreadItem } from '@clew/contracts';

/**
 * An action about an entity, started from its menu without the model (D97, D8). The action must be one the opened entity
 * offers the reader (an about action of that kind they may call), on a key inside the rule of who may be asked about;
 * anything else is undefined, which the route answers 404 as it answers every other address the reader may not reach.
 * The action gets the key in its `param` and nothing else (the loader holds every about action to that) and becomes a
 * card through the stream: a propose's draft, or an execute behind its human decision. Nothing is written to a source
 * here, and nothing is kept about the entity beyond the card.
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
    context: { reason: string; items?: ThreadItem[]; about?: Record<string, unknown> },
  ): Promise<EntityActionStarted>;
}

export function entityActionUsecases(deps: EntityActionDeps) {
  /** Start `capability` about the entity behind `key`; undefined when the reader may not. */
  async function start(
    persona: AuthenticatedContext,
    kind: EntityKind,
    key: string,
    capability: string,
  ): Promise<EntityActionStarted | undefined> {
    const opened = await deps.open(persona, kind, key);
    const action = opened?.actions.find(a => a.capability === capability);
    if (!opened || !action) return undefined;
    const { entity } = opened;
    // The key in the directory's spelling, whatever case the address had.
    return deps.start(
      persona,
      action.capability,
      { [action.param]: entity.key },
      {
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
      },
    );
  }
  return { start };
}
export type EntityActions = ReturnType<typeof entityActionUsecases>;
