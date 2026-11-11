import type { AuthenticatedContext, DocumentRequest } from '@clew/contracts';
import { CapabilityError } from '@clew/connectors';
import { registry, runCapability, actorOf } from '../connectors/registry';
import { keyedDigest } from '../auth-crypto';
import { InputError } from '../context';
import { documentReviews } from '../connectors/usecases/documents';
import { clock } from './ambient';

// The proof on review evidence is a keyed digest of the evidence itself. It was wired to `authorizationVersion` until
// 2026-11-11, which reads an access record since D68 and threw on every preview.
export const reviewDocuments = documentReviews({
  registry,
  run: runCapability,
  sign: input => keyedDigest('document-review', input),
  clock,
});
export async function readDocument(persona: AuthenticatedContext, request: DocumentRequest, signal?: AbortSignal) {
  await persona.authorize();
  try {
    const result = await registry.document(actorOf(persona), request, { signal, delegate: persona.delegate });
    await persona.authorize();
    return result;
  } catch (error) {
    if (error instanceof CapabilityError) throw new InputError(error.message);
    throw error;
  }
}
