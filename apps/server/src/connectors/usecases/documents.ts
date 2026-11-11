import {
  checkContract,
  DocumentBundleSchema,
  ReviewEvidenceSchema,
  ReviewRecoverySchema,
  type AuthenticatedContext,
  type DocumentBundle,
  type DocumentReview,
  type ReviewEvidence,
  type ReviewRecovery,
} from '@clew/contracts';
import type { Registry } from '@clew/connectors';
import { InputError } from '../../context';

export interface DocumentReviewDeps {
  registry: Pick<Registry, 'allowed'>;
  run(persona: AuthenticatedContext, capability: string, input: unknown): Promise<unknown>;
  /** A keyed digest of any value. A property, not a method, so the compiler refuses a signer that takes less than `unknown`. */
  sign: (input: unknown) => string;
  clock(): Date;
}
/** Stateless, integrity-protected review evidence; no file content or unsigned client claims grant authority. */
export function documentReviews({ registry, run, sign, clock }: DocumentReviewDeps) {
  async function read(
    persona: AuthenticatedContext,
    capability: string,
    ref: string,
  ): Promise<{ bundle: DocumentBundle; recovery?: ReviewRecovery }> {
    const target = registry.allowed(persona, capability);
    const view = target?.capability.view;
    const key = view?.kind === 'document' ? view.body : view?.kind === 'record' ? view.document : undefined;
    if (target?.capability.kind !== 'read' || !key) throw new InputError('Underlaget finns inte.');
    const output = await run(persona, capability, { ref });
    const bundle = (output as Record<string, unknown>)?.[key];
    if (!checkContract(DocumentBundleSchema, bundle) || bundle.ref !== ref)
      throw new InputError('Underlaget kunde inte verifieras.');
    const recovery =
      view?.kind === 'record' && view.recovery ? (output as Record<string, unknown>)[view.recovery] : undefined;
    if (recovery !== undefined) {
      if (!checkContract(ReviewRecoverySchema, recovery)) throw new InputError('Rättelserna kunde inte verifieras.');
      for (const [kind, action] of [
        ['execute', recovery.correction],
        ['read', recovery.source],
      ] as const) {
        if (!action) continue;
        const allowed = registry.allowed(persona, action.capability);
        if (!allowed || allowed.connector.id !== target.connector.id || allowed.capability.kind !== kind)
          throw new InputError('Rättelsen är inte tillgänglig.');
      }
      if (
        recovery.correction &&
        new Set(recovery.correction.fields.map(f => f.key)).size !== recovery.correction.fields.length
      )
        throw new InputError('Rättelserna kunde inte verifieras.');
    }
    return { bundle, ...(recovery ? { recovery: recovery as ReviewRecovery } : {}) };
  }
  // Explicit field order makes evidence independent of the source's JSON property ordering.
  const proof = (p: AuthenticatedContext, capability: string, bundle: DocumentBundle, expiresAt: string) =>
    sign({
      purpose: 'document-review',
      person: p.id,
      unit: p.unitId,
      authorization: p.authorizationVersion,
      capability,
      bundle: {
        ref: bundle.ref,
        revision: bundle.revision,
        title: bundle.title,
        documents: bundle.documents.map(d => ({
          id: d.id,
          revision: d.revision,
          title: d.title,
          filename: d.filename,
          mediaType: d.mediaType,
          size: d.size,
          sha256: d.sha256,
          required: d.required,
        })),
      },
      expiresAt,
    });
  async function preview(persona: AuthenticatedContext, capability: string, ref: string): Promise<DocumentReview> {
    const { bundle, recovery } = await read(persona, capability, ref);
    const expiresAt = new Date(clock().getTime() + 2 * 3600_000).toISOString();
    return {
      kind: 'documents',
      capability,
      bundle,
      ...(recovery ? { recovery } : {}),
      evidence: {
        ref,
        revision: bundle.revision,
        documents: bundle.documents.map(d => ({ id: d.id, revision: d.revision })),
        expiresAt,
        proof: proof(persona, capability, bundle, expiresAt),
      },
    };
  }
  async function validate(persona: AuthenticatedContext, operation: string, payload: unknown) {
    const found = registry.allowed(persona, operation);
    const capability = found?.capability.review;
    if (!capability) return;
    const input = payload as { refs?: unknown; reviews?: unknown } | null;
    if (
      !input ||
      !Array.isArray(input.refs) ||
      !input.refs.length ||
      input.refs.length > 50 ||
      input.refs.some(ref => typeof ref !== 'string' || !ref || ref.length > 200) ||
      !Array.isArray(input.reviews) ||
      input.refs.length !== input.reviews.length ||
      new Set(input.refs).size !== input.refs.length
    )
      throw new InputError('Granska varje underlag innan du skickar.');
    for (const ref of input.refs) {
      const evidence = input.reviews.find(e => e?.ref === ref) as ReviewEvidence | undefined;
      if (!checkContract(ReviewEvidenceSchema, evidence))
        throw new InputError('Granskningen kunde inte verifieras. Granska underlaget igen.');
      if (Date.parse(evidence.expiresAt) <= clock().getTime())
        throw new InputError('Granskningen har gått ut. Granska underlaget igen.');
      const { bundle } = await read(persona, capability, ref);
      if (
        evidence.revision !== bundle.revision ||
        evidence.proof !== proof(persona, capability, bundle, evidence.expiresAt) ||
        JSON.stringify(evidence.documents) !==
          JSON.stringify(bundle.documents.map(d => ({ id: d.id, revision: d.revision })))
      )
        throw new InputError('Underlaget har ändrats. Granska underlaget igen.');
    }
    await persona.authorize();
  }
  return { preview, validate };
}
