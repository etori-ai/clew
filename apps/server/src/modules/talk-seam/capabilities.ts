import { SEARCH_CONNECTOR, type Actor, type Capability, type Connector } from '@clew/connectors';
import {
  CommitmentsInputSchema,
  CommitmentsResultSchema,
  TalksInputSchema,
  TalksResultSchema,
  type CommitmentsInput,
  type TalksInput,
} from '@clew/contracts';
import type { TalkSeamUsecases } from './usecases';

/**
 * The talks seam as part of Clew's core connector (D96 item 8): `clew.talks` and `clew.commitments` are what Clew's own
 * pages read, whichever system answers the profile. The registry joins these with the composite search under the core
 * connector's id, so neither module knows the other. They are never tools (D96 item 6) and have no view: Clew's pages
 * draw them.
 *
 * `offered` says whether a system answers the profile for the person at all: without one both reads are out of scope.
 */
export const TALKS_CAPABILITY = SEARCH_CONNECTOR + '.talks';
export const COMMITMENTS_CAPABILITY = SEARCH_CONNECTOR + '.commitments';

export function talkSeamCapabilities(
  seam: TalkSeamUsecases,
  offered: (actor: Actor) => boolean,
): Pick<Connector, 'capabilities'> {
  const talks: Capability<TalksInput> = {
    name: TALKS_CAPABILITY,
    kind: 'read',
    title: 'Utvecklingssamtal',
    model: false,
    description:
      'Den öppna samtalsomgången och var varje person på enheterna du är chef för står, från det system som håller utvecklingssamtalen.',
    input: TalksInputSchema,
    output: TalksResultSchema,
    scope: offered,
    run: (actor, input, clew) => seam.talks(actor, input, clew.call),
  };
  const commitments: Capability<CommitmentsInput> = {
    name: COMMITMENTS_CAPABILITY,
    kind: 'read',
    title: 'Åtgärdspunkter',
    model: false,
    description:
      'Åtgärdspunkter från utvecklingssamtal: dina egna och, för den som är chef, de som gäller personerna på enheten.',
    input: CommitmentsInputSchema,
    output: CommitmentsResultSchema,
    scope: offered,
    run: (actor, input, clew) => seam.commitments(actor, input, clew.call),
  };
  return { capabilities: [talks as Capability, commitments as Capability] };
}
