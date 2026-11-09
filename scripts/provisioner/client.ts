/**
 * A small SCIM 2.0 client (RFC 7644): one bearer token, JSON in and out, the error resource's `detail` in the thrown
 * error. `fetchImpl` lets a test or an in-process caller hand in a Hono app's `request` instead of the network.
 */
export interface ScimResponse {
  status: number;
  body: any;
}
export interface ScimClient {
  request(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<ScimResponse>;
}
export class ScimClientError extends Error {
  constructor(
    readonly status: number,
    readonly scimType: string | undefined,
    detail: string,
  ) {
    super(detail);
    this.name = 'ScimClientError';
  }
}
/** The part of `fetch` the client uses, so a Hono app's `request` fits as well as the network. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response> | Response;
export function scimClient(baseUrl: string, token: string, fetchImpl: Fetch = fetch): ScimClient {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    async request(method, path, body) {
      const response = await fetchImpl(base + path, {
        method,
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/scim+json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/scim+json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      const parsed = text ? JSON.parse(text) : undefined;
      if (!response.ok)
        throw new ScimClientError(
          response.status,
          parsed?.scimType,
          parsed?.detail ?? `${method} ${path} answered ${response.status}.`,
        );
      return { status: response.status, body: parsed };
    },
  };
}
