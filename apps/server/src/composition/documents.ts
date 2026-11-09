import type { AuthenticatedContext, DocumentRequest } from '@clew/contracts';
import { CapabilityError } from '@clew/connectors';
import { registry, runCapability, actorOf } from '../connectors/registry';
import { authorizationVersion } from '../auth-crypto';
import { InputError } from '../context';
import { documentReviews } from '../connectors/usecases/documents';
import { clock } from './ambient';

export const reviewDocuments = documentReviews({ registry, run: runCapability, sign: authorizationVersion, clock });
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
