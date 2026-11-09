import { Value } from '@sinclair/typebox/value';
import { MAX_DOCUMENT_BYTES, type DocumentContent } from '@clew/contracts';
import { CapabilityError, type Actor, type Capability, type Clew, type Connector } from './index';
import { connectorProblems } from './validation';
import {
  CallResponseSchema,
  FigureResponseSchema,
  ConnectorManifestSchema,
  PROTOCOL_ACCEPTED,
  PROTOCOL_RETIRED,
  ScanResponseSchema,
  type ConnectorManifest,
} from './protocol';

/**
 * The transport adapter for a connector that runs as its own service (D21). Turns a manifest into a `Connector`
 * whose `run`, `scan` and `figure` are HTTP calls. The registry treats it like any bundled connector: same scope
 * check, same validation, same audit. Nothing here knows the connector's domain.
 */
/** What the transport needs from fetch: a fake in a test or the real one. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export interface RemoteTransport {
  /** Base URL of the connector service, without a trailing slash. */
  url: string;
  /** Connector transport credential. It never signs user identity or callback authority. */
  key?: string;
  /** The assertion Clew sends as the bearer token: who is acting, signed for this connector. */
  assert: (actor: Actor, chain?: string[]) => Promise<string>;
  fetch?: FetchLike;
  /** Milliseconds before a call counts as unavailable. */
  timeoutMs?: number;
}
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

/**
 * Every problem a manifest document has, in the order Clew finds them; none means Clew would load it. The schema first
 * (every path listed), then the rules between fields. A retired or unknown protocol number is named as such (D60), not
 * as a literal mismatch. `previewManifest` shows the whole list; `parseManifest` throws on it.
 */
export function manifestProblems(document: unknown, expectedId?: string): string[] {
  const errors = [...Value.Errors(ConnectorManifestSchema, document)];
  if (errors.length) {
    const protocol = (document as { protocol?: unknown } | null)?.protocol;
    return errors.map(e =>
      e.path === '/protocol' && typeof protocol === 'number' && !PROTOCOL_ACCEPTED.includes(protocol)
        ? `/protocol: ${protocol} is not accepted by this Clew, which loads ${PROTOCOL_ACCEPTED.join(' and ')}${PROTOCOL_RETIRED[protocol] ? `; ${PROTOCOL_RETIRED[protocol]}` : ''}`
        : `${e.path || '/'}: ${e.message}`,
    );
  }
  const manifest = document as ConnectorManifest;
  const problems: string[] = [];
  if (expectedId && manifest.id !== expectedId)
    problems.push(`Manifest id "${manifest.id}" does not match the configured id "${expectedId}".`);
  problems.push(...connectorProblems(manifest));
  return problems;
}
/** Validate a manifest document; returns the typed manifest or throws with the schema problems listed, else the first rule it breaks. */
export function parseManifest(document: unknown, expectedId?: string): ConnectorManifest {
  const problems = manifestProblems(document, expectedId);
  if (!problems.length) return document as ConnectorManifest;
  throw new ManifestError(
    Value.Check(ConnectorManifestSchema, document)
      ? problems[0]!
      : 'Invalid connector manifest: ' + problems.join('; '),
  );
}
export async function fetchManifest(
  url: string,
  expectedId?: string,
  fetchImpl: FetchLike = fetch,
): Promise<ConnectorManifest> {
  const response = await fetchImpl(url + '/clew/manifest', {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new ManifestError(`GET ${url}/clew/manifest answered ${response.status}.`);
  return parseManifest(await response.json(), expectedId);
}

function unavailable(source: string) {
  return new CapabilityError(`${source} svarar inte just nu.`);
}
/** The person's own token for the connector's system (D26), beside the assertion that proves Clew. Only when the manifest asks and a session is behind the call. */
export const DELEGATED_TOKEN_HEADER = 'x-clew-delegated-token';
async function delegated(
  manifest: ConnectorManifest,
  clew: Clew | undefined,
  source: string,
): Promise<string | undefined> {
  if (!manifest.delegation || !clew?.delegate) return undefined;
  try {
    return await clew.delegate(manifest.delegation.audience);
  } catch {
    throw new CapabilityError(`${source} kunde inte få din behörighet just nu.`);
  }
}
async function post(
  transport: RemoteTransport,
  source: string,
  path: string,
  actor: Actor,
  body: unknown,
  token?: string,
  chain?: string[],
  operationId?: string,
  signal?: AbortSignal,
) {
  const fetchImpl = transport.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(transport.url + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: 'Bearer ' + (await transport.assert(actor, chain)),
        ...(operationId ? { 'x-clew-operation-id': operationId } : {}),
        ...(transport.key ? { 'x-clew-connector-key': transport.key } : {}),
        ...(token ? { [DELEGATED_TOKEN_HEADER]: token } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([AbortSignal.timeout(transport.timeoutMs ?? 10_000), ...(signal ? [signal] : [])]),
    });
  } catch {
    throw unavailable(source);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw unavailable(source);
  }
  return { status: response.status, json };
}
/** A connector's error answer in the protocol's shape, mapped to what the person sees. */
function failWith(json: unknown, source: string): never {
  const error = (json as { error?: { code?: string; message?: string } } | null)?.error;
  if (error?.code === 'unavailable' || !error?.message) throw unavailable(source);
  throw new CapabilityError(error.message);
}

/** Build the `Connector` the registry runs: every operation is a call to the service as the acting person. */
export function remoteConnector(manifest: ConnectorManifest, transport: RemoteTransport): Connector {
  const source = manifest.source;
  const capabilities: Capability<any, any>[] = manifest.capabilities.map(c => ({
    name: c.name,
    kind: c.kind,
    title: c.title,
    description: c.description,
    input: c.input as never,
    output: c.output as never,
    model: c.model,
    scope: c.scope,
    ...(c.execution ? { execution: c.execution } : {}),
    ...(c.review ? { review: c.review } : {}),
    ...(c.kinds ? { kinds: c.kinds } : {}),
    ...(c.follows ? { follows: c.follows } : {}),
    ...(c.creates ? { creates: c.creates } : {}),
    ...(c.view ? { view: c.view } : {}),
    ...(c.menu ? { menu: c.menu } : {}),
    run: async (actor, input, clew) => {
      const { status, json } = await post(
        transport,
        source,
        '/clew/capabilities/' + encodeURIComponent(c.name),
        actor,
        { actor, input },
        await delegated(manifest, clew, source),
        clew.chain,
        clew.operationId,
        clew.signal,
      );
      if (status >= 500 || !Value.Check(CallResponseSchema, json)) throw unavailable(source);
      if ('error' in json) failWith(json, source);
      return json.output;
    },
  }));
  return {
    id: manifest.id,
    kind: manifest.kind,
    source,
    ...(manifest.documents
      ? {
          documents: async (
            actor: Actor,
            request: import('@clew/contracts').DocumentRequest,
            clew: Clew,
          ): Promise<DocumentContent> => {
            const response = await (transport.fetch ?? fetch)(transport.url + '/clew/documents', {
              redirect: 'error',
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                accept: 'application/octet-stream',
                authorization: 'Bearer ' + (await transport.assert(actor, clew.chain)),
                ...(transport.key ? { 'x-clew-connector-key': transport.key } : {}),
                ...(manifest.delegation
                  ? { [DELEGATED_TOKEN_HEADER]: (await delegated(manifest, clew, source)) ?? '' }
                  : {}),
              },
              body: JSON.stringify({ actor, request }),
              signal: AbortSignal.any([
                AbortSignal.timeout(transport.timeoutMs ?? 10_000),
                ...(clew.signal ? [clew.signal] : []),
              ]),
            });
            if (!response.ok || !response.body) {
              await response.body?.cancel();
              if (response.status === 409) throw new CapabilityError('Underlaget har ändrats. Läs in underlagen igen.');
              if (response.status === 403) throw new CapabilityError('Du saknar behörighet att läsa underlaget.');
              throw unavailable(source);
            }
            const declaredSize = Number(response.headers.get('content-length'));
            if (declaredSize > MAX_DOCUMENT_BYTES) {
              await response.body.cancel();
              throw unavailable(source);
            }
            const reader = response.body.getReader(),
              chunks: Uint8Array[] = [];
            let size = 0;
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.length;
                if (size > MAX_DOCUMENT_BYTES) throw unavailable(source);
                chunks.push(value);
              }
            } catch (error) {
              await reader.cancel();
              throw error;
            } finally {
              reader.releaseLock();
            }
            const bytes = new Uint8Array(size);
            let at = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, at);
              at += chunk.length;
            }
            return {
              bytes,
              mediaType: response.headers.get('content-type') as DocumentContent['mediaType'],
              revision: response.headers.get('x-clew-document-revision') ?? '',
            };
          },
        }
      : {}),
    uses: manifest.uses ?? [],
    ...(manifest.facts ? { facts: manifest.facts } : {}),
    ...(manifest.delegation ? { delegation: manifest.delegation } : {}),
    areas: manifest.areas.map(a => ({
      id: a.id,
      title: a.title,
      roles: a.roles,
      standing: a.standing,
      schedules: a.schedules,
      ...(a.icon ? { icon: a.icon } : {}),
      ...(a.figure
        ? {
            // A figure that does not come back, or not in the protocol's shape, throws: the registry makes it the warning figure (D8).
            figure: async (actor: Actor, clew: Clew) => {
              const { status, json } = await post(
                transport,
                source,
                '/clew/figure',
                actor,
                { actor, area: a.id },
                undefined,
                clew.chain,
                undefined,
                clew.signal,
              );
              if (status >= 400 || !Value.Check(FigureResponseSchema, json)) throw unavailable(source);
              return json.figure;
            },
          }
        : {}),
    })),
    capabilities,
    ...(manifest.scan
      ? {
          scan: async (actor: Actor) => {
            const { status, json } = await post(transport, source, '/clew/scan', actor, { actor });
            if (status >= 400 || !Value.Check(ScanResponseSchema, json)) throw unavailable(source);
            return json;
          },
        }
      : {}),
  };
}
