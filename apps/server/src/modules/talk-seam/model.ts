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
export type TalkCall = <O = unknown>(name: string, input?: unknown) => Promise<O>;
export interface TalkSeamBudget {
  /** Milliseconds the source gets before it counts as not answering. */
  perSourceMs: number;
}
export interface TalkSeamDeps {
  source: Source;
  directory: Directory;
  budget?: Partial<TalkSeamBudget>;
}
export const DEFAULT_BUDGET: TalkSeamBudget = { perSourceMs: 4_000 };
