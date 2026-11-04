import { ApiError } from './api-error';

/**
 * Retry only what can pass on a second try (D33): a 5xx, once. A 4xx is an answer, not a hiccup. Anything that is not an
 * ApiError is the session ending (an AbortError from the shared controller, "Session unavailable" before a boundary).
 */
export function retryPolicy(failureCount: number, error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status >= 500 && failureCount < 1;
}

/** The message a person reads: the server's Swedish one when there is one, the caller's fallback otherwise. */
export const errorMessage = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback;
