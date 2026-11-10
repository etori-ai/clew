import { ApiError } from './api-error';

/**
 * Retry only what can pass on a second try (D33): a 5xx, once. A 4xx is an answer, not a hiccup. Anything that is not an
 * ApiError is the session ending (an AbortError from the shared controller, "Session unavailable" before a boundary).
 */
export function retryPolicy(failureCount: number, error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status >= 500 && failureCount < 1;
}

/**
 * The sentences the server answers with when a capability is not the person's to read: the registry's own for a hidden
 * or unknown one and for one outside the person's scope (`@clew/connectors`), and the talks seam's when no system
 * answers the talks profile (D96 item 9). The route maps all three to a 400 with no code, so the text is the signal.
 */
const REFUSALS = new Set([
  'Okänd förmåga.',
  'Du saknar behörighet för åtgärden.',
  'Inget system för utvecklingssamtal är anslutet just nu.',
]);
/**
 * Whether a capability read was refused rather than failed: the capability is not offered to the person (a 403, a
 * 404, or a 400 with one of the refusal sentences). A source that did not answer is a failure, never a refusal.
 */
export function refused(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 403 || error.status === 404) return true;
  return error.status === 400 && REFUSALS.has(error.message);
}
/** A capability read whose refusal means "nothing to show" (D96: a person with no talks system): `null` instead of an error. */
export const unlessRefused = <T>(read: Promise<T>): Promise<T | null> =>
  read.catch((error: unknown) => {
    if (refused(error)) return null;
    throw error;
  });

/** The message a person reads: the server's Swedish one when there is one, the caller's fallback otherwise. */
export const errorMessage = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;
