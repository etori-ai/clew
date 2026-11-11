import { Type, type Static } from 'typebox';
import { ConnectorAudienceSchema } from '@clew/contracts';
import { FactEnvelopeSchema, FactKindName, StepDraftSchema } from '@clew/connectors/protocol';

/**
 * Jobs (D55): one event, work in several systems, assembled from what connectors declare and approved once. The fact is
 * Clew's envelope; a step draft is the follower's answer; a binding is the administrator's decision that this follower
 * runs for this fact kind in this installation (D23: in the database, default deny, no restart).
 */
export const FactSchema = FactEnvelopeSchema.properties.fact;
export type Fact = Static<typeof FactSchema>;
export type StepDraft = Static<typeof StepDraftSchema>;
export const CapabilityName = Type.String({ pattern: '^[a-z][a-z0-9-]*\\.[a-zA-Z][a-zA-Z0-9]*$', maxLength: 80 });
export const FollowBindingInputSchema = Type.Object(
  {
    kind: FactKindName,
    capability: CapabilityName,
    audience: ConnectorAudienceSchema,
    /** For a watch step: the window the follower's `within` may not exceed; absent means the follower's own. */
    within: Type.Optional(Type.String({ pattern: '^P(?!$)(\\d+D)?(T(?=\\d)(\\d+H)?(\\d+M)?)?$' })),
  },
  { additionalProperties: false },
);
export type FollowBindingInput = Static<typeof FollowBindingInputSchema>;
export interface FollowBinding extends FollowBindingInput {
  id: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
export type JobSourceStatus = 'ok' | 'timeout' | 'unavailable' | 'degraded' | 'disabled';
/** Every bound follower is reported: a system that did not answer or can no longer follow is named, never silently missing. */
export interface JobSource {
  binding: string;
  bindingRevision: string;
  connector: string;
  source: string;
  capability: string;
  status: JobSourceStatus;
  reason?: string;
}
export interface JobStepDraft {
  id: string;
  binding: string;
  connector: string;
  source: string;
  draft: StepDraft;
}
export interface JobProposal {
  fact: Fact;
  steps: JobStepDraft[];
  sources: JobSource[];
  partial: boolean;
}
export class JobError extends Error {}
