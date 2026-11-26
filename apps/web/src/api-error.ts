/**
 * The server's answer when a call fails: the status and the Swedish message the UI shows (every route maps its errors to
 * one). Kept in a file of its own so the cache policy and its unit tests import it without the API client behind it.
 */
export class ApiError extends Error {
  status: number;
  /** The server's code for the refusal, where the route gives one: what a page branches on, never the sentence. */
  code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'ApiError';
  }
}
