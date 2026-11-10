import { CapabilityError, TALKS_CONNECTOR, type Actor, type TalkSource } from '@clew/connectors';
import {
  CommitmentsOutputSchema,
  CommitmentsResultSchema,
  TalksOutputSchema,
  TalksResultSchema,
  checkContract,
  type CommitmentsInput,
  type CommitmentsResult,
  type TalksInput,
  type TalksResult,
} from '@clew/contracts';
import { mapCommitmentRows, mapTalkRows } from './domain';
import { DEFAULT_BUDGET, type TalkCall, type TalkSeamDeps } from './model';

/** Said when no system answers the talks profile for the person (none, or several with the built-in module off). */
export const NO_SOURCE = 'Inget system för utvecklingssamtal är anslutet just nu.';
/** Said when the source did not answer in time, failed, or answered out of shape. Never the source's own words. */
export const unexpected = (source: string) => `${source} svarade inte som väntat.`;

/**
 * The talks seam (D96 items 8 and 9): Clew's pages read the round and the action points through `clew.talks` and
 * `clew.commitments`, which ask the one system that answers the profile for this person, check its answer against the
 * profile's shape, keep only rows about people the reader may see and say whether Clew can write. Nothing of what
 * came back is kept.
 */
export function talkSeamUsecases(deps: TalkSeamDeps) {
  const budget = { ...DEFAULT_BUDGET, ...deps.budget };
  const withinBudget = <T>(work: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<typeof TIMEOUT>(resolve => {
      timer = setTimeout(() => resolve(TIMEOUT), ms);
    });
    return Promise.race([work, late]).finally(() => clearTimeout(timer));
  };
  const sourceFor = (actor: Actor): TalkSource => {
    const source = deps.source(actor);
    if (!source) throw new CapabilityError(NO_SOURCE);
    return source;
  };
  /** One read of the source under the budget; whatever goes wrong, the person reads the same sentence. */
  async function ask(source: TalkSource, name: string, input: unknown, call: TalkCall): Promise<unknown> {
    try {
      const answer = await withinBudget(call(name, input), budget.perSourceMs);
      if (answer !== TIMEOUT) return answer;
    } catch {
      // The source's own message stays out of what the person reads.
    }
    throw new CapabilityError(unexpected(source.source));
  }
  /** The round and one row per person the reader manages now, as the source answers it. */
  async function talks(actor: Actor, _input: TalksInput, call: TalkCall): Promise<TalksResult> {
    const source = sourceFor(actor);
    const [answer, directory] = await Promise.all([ask(source, source.talks, {}, call), deps.directory(actor)]);
    if (!checkContract(TalksOutputSchema, answer)) throw new CapabilityError(unexpected(source.source));
    const result: TalksResult = {
      round: answer.round,
      rows: mapTalkRows(answer.rows, directory.staff),
      ...(answer.bookedUnknown !== undefined ? { bookedUnknown: answer.bookedUnknown } : {}),
      writable: source.builtIn,
      source: source.source,
    };
    if (!checkContract(TalksResultSchema, result)) throw new CapabilityError(unexpected(source.source));
    return result;
  }
  /** Action points about the reader or the people they manage now; `person` narrows to one of them. */
  async function commitments(actor: Actor, input: CommitmentsInput, call: TalkCall): Promise<CommitmentsResult> {
    const source = sourceFor(actor);
    if (!source.commitments) return { rows: [], writable: false, source: source.source };
    const [answer, directory] = await Promise.all([
      ask(source, source.commitments, input, call),
      deps.directory(actor),
    ]);
    if (!checkContract(CommitmentsOutputSchema, answer)) throw new CapabilityError(unexpected(source.source));
    const result: CommitmentsResult = {
      rows: mapCommitmentRows(answer.rows, {
        self: directory.self,
        staff: directory.staff,
        ...(input.person !== undefined ? { person: input.person } : {}),
        ...(source.builtIn ? { builtIn: TALKS_CONNECTOR } : {}),
      }),
      writable: source.builtIn,
      source: source.source,
    };
    if (!checkContract(CommitmentsResultSchema, result)) throw new CapabilityError(unexpected(source.source));
    return result;
  }
  return { talks, commitments };
}
const TIMEOUT = Symbol('timeout');
export type TalkSeamUsecases = ReturnType<typeof talkSeamUsecases>;
