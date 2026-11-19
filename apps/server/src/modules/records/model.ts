import type { Actor, RecordAboutAction } from '@clew/connectors';
import type { AskValues, AuthenticatedContext, EffectPreview, ThreadItem, View } from '@clew/contracts';

/**
 * The ports of the records module (D132, D25): an action a connector declares about one record of one of its reads,
 * listed on that record's page and run as an action about a person is. Nothing is stored here: the read, its actions and
 * the record itself are asked on every call, so a revoked grant, a connector switched off or a record the source no
 * longer answers the person shows from the next request on.
 */

/**
 * A read whose records actions are about, as one person may call it now (composition: the registry, its governance
 * refreshed first): its title and view, and the actions about its records they may call (`Registry.recordActions`).
 * Undefined when the person may not call the read.
 */
export interface RecordRead {
  title: string;
  view?: View;
  actions: RecordAboutAction[];
}
export type Records = (actor: Actor, read: string) => Promise<RecordRead | undefined>;
/**
 * The record's read made as the person, as the record's page makes it (composition: the registry's call path with the
 * session's delegated token, as the person with the units they follow up, their own session asking): the output, or a
 * throw. A refusal is the registry's `CapabilityError` with the protocol's code, or its unknown capability.
 */
export type RecordReader = (
  persona: AuthenticatedContext,
  read: string,
  input: Record<string, unknown>,
) => Promise<unknown>;
/** What the started card of an action about a record carries beside its input (the stream's `StartContext`). */
export interface RecordStartContext {
  reason: string;
  items: ThreadItem[];
  about: Record<string, unknown>;
  asked?: Record<string, string>;
  answers?: Record<string, string>;
}
export interface RecordActionDeps {
  records: Records;
  read: RecordReader;
  /**
   * The card an action with its input becomes (composition: the stream's `startCard`): a propose runs as the person and
   * its draft is the card; an execute is the card's button, never called before the decision. Throws in Swedish when the
   * source refuses.
   */
  start(
    persona: AuthenticatedContext,
    capability: string,
    input: Record<string, unknown>,
    context: RecordStartContext,
  ): Promise<{ threadId: string }>;
  /**
   * The human decision on a started execute's card, with the person's answers (composition: the stream's `act` on the
   * card's one button): the approved intent goes to the execution ledger first (D45). Absent: an execute is not decided
   * from the record's page.
   */
  decide?(persona: AuthenticatedContext, threadId: string, answers: AskValues): Promise<unknown>;
  /** What an execute would write for this input (D112, composition: the stream's `effectFor`); nothing is written. */
  effect(
    persona: AuthenticatedContext,
    capability: string,
    input: Record<string, unknown>,
    connector: string,
  ): Promise<EffectPreview>;
  clock: () => Date;
}
