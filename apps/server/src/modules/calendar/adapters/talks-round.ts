import type { AuthenticatedContext, TalksResult } from '@clew/contracts';
import type { RoundReader } from '../model';

/**
 * The round the planner works towards (D96 items 1-3) is the one `clew.talks` answers for the person, from whichever
 * system answers the talks profile, read as the person through the registry: its dates, and the people whose talk the
 * source records as held. No system that answers for this person, or no open round, is no round (null). A read that
 * fails or runs out of time is logged and rejects, so that it is never taken for no round: the planner then plans
 * nothing, and a confirmation, which must tell whether the person already has a talk in the round (M1, Q12), approves
 * nothing. The dispatch of an approved invitation does not read it: the confirmation wrote the round's period into the
 * approved command. `composition/index.ts` binds it to the registry.
 */
export function talksRound(deps: {
  /** Whether a system answers the talks profile for this person. */
  answers(persona: AuthenticatedContext): boolean;
  read(persona: AuthenticatedContext): Promise<TalksResult>;
  failed(message: string, error: unknown): void;
}): RoundReader {
  return async persona => {
    if (!deps.answers(persona)) return null;
    let result: TalksResult;
    try {
      result = await deps.read(persona);
    } catch (error) {
      deps.failed('talks: the planning round could not be read', error);
      throw error;
    }
    if (!result.round) return null;
    const { label, opensOn, dueOn } = result.round;
    return { label, opensOn, dueOn, held: result.rows.filter(r => r.state === 'held').map(r => r.personId) };
  };
}
