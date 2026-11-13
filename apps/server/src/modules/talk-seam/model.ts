import type { Actor, TalkSource } from '@clew/connectors';

/**
 * The ports of the talks seam (D25, D96 items 8 and 9). The source comes from the registry at call time, so switching
 * the built-in module off or registering another system changes who answers from the next read on; the call handle is
 * the one the registry gives the capability for this run, so scope and the person's delegated token travel with it.
 */
/** The one system that answers the talks profile for this person, or none (composition: `registry.talkSource`). */
export type Source = (actor: Actor) => TalkSource | undefined;
/** A person as the seam needs them: the id Clew's pages use and the user name another system keys a row on. */
export interface DirectoryPerson {
  id: string;
  /** Null for a person provisioned without one; such a person is keyed on their id. */
  userName: string | null;
}
/**
 * The reader and the people on the units the reader manages now (D94); `staff` is empty for someone who manages
 * nobody. Read on every call, never cached here, so a change of unit or manager narrows the next read at once.
 */
export type Directory = (actor: Actor) => Promise<{ self: DirectoryPerson; staff: DirectoryPerson[] }>;
/**
 * Whom these keys name now in the reader's organisation, active or not, by person id, keyed by the key as asked: the
 * holder of a user name, compared as Clew compares one (D119), or the person provisioned without one whose id the key
 * is (`personKey`). A key that names nobody there is absent. The seam asks only about the action points the reader owns
 * about someone they no longer manage, when Clew's own module answers (M2).
 */
export type Holders = (actor: Actor, keys: readonly string[]) => Promise<ReadonlyMap<string, string>>;
/**
 * Which of these action points of Clew's own module, by its own id, the reader may take over now (Q12): a manager's
 * point about someone they manage, whose owner no longer manages that person or was erased. Asked only when a manager
 * reads one person's points; the talks module answers it with the rule its write enforces.
 */
export type Takeovers = (actor: Actor, ids: readonly string[]) => Promise<ReadonlySet<string>>;
export type TalkCall = <O = unknown>(name: string, input?: unknown) => Promise<O>;
export interface TalkSeamBudget {
  /** Milliseconds the source gets before it counts as not answering. */
  perSourceMs: number;
}
export interface TalkSeamDeps {
  source: Source;
  directory: Directory;
  holders: Holders;
  takeovers: Takeovers;
  budget?: Partial<TalkSeamBudget>;
}
export const DEFAULT_BUDGET: TalkSeamBudget = { perSourceMs: 4_000 };
