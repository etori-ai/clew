import { Value } from 'typebox/value';
import { MAX_DOCUMENT_BYTES, contractProblems, type DocumentContent } from '@clew/contracts';
import {
  CapabilityError,
  InstallationReadError,
  installationReadText,
  type Actor,
  type Capability,
  type Clew,
  type Connector,
  type InstallationRead,
  type SourceErrorCode,
} from './index';
import { connectorProblems } from './validation';
import {
  CallResponseSchema,
  FigureResponseSchema,
  ConnectorManifestSchema,
  INSTALLATION_ROUTE,
  PROTOCOL_ACCEPTED,
  PROTOCOL_RETIRED,
  protocolTerms,
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
  /**
   * The assertion Clew sends as the bearer token: who is acting, signed for this connector and bound to the one request
   * it was issued for (D117): the exact body it is sent with and, on a capability's route, the capability's name.
   */
  assert: (actor: Actor, chain?: string[], binding?: AssertionBinding) => Promise<string>;
  /**
   * The installation's own assertion for a read it makes itself (D119): no actor, subject `clew:installation`, bound to
   * the request like every assertion. Without it the connector's installation reads answer `denied` and are never sent.
   */
  installation?: (binding: AssertionBinding & { capability: string }) => Promise<string>;
  fetch?: FetchLike;
  /** Milliseconds before a call counts as unavailable. */
  timeoutMs?: number;
}
/**
 * What an assertion is bound to (D117): `body`, the exact request body it is sent with, which the signer digests
 * (SHA-256, base64url, the `body` claim), and on `/clew/capabilities/{name}` the capability's `name` (the `capability`
 * claim). A connector's verifier recomputes both from the request it received, so neither the input nor the `about` it
 * carries can be changed and the assertion cannot be replayed on another capability.
 */
export interface AssertionBinding {
  body: string;
  capability?: string;
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
  const errors = contractProblems(ConnectorManifestSchema, document);
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
const CAPABILITY_ROUTE = '/clew/capabilities/';
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
  // The body is serialised once: the assertion is bound to exactly these bytes (D117).
  const text = JSON.stringify(body);
  const binding: AssertionBinding = {
    body: text,
    ...(path.startsWith(CAPABILITY_ROUTE)
      ? { capability: decodeURIComponent(path.slice(CAPABILITY_ROUTE.length)) }
      : {}),
  };
  let response: Response;
  try {
    response = await fetchImpl(transport.url + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: 'Bearer ' + (await transport.assert(actor, chain, binding)),
        ...(operationId ? { 'x-clew-operation-id': operationId } : {}),
        ...(transport.key ? { 'x-clew-connector-key': transport.key } : {}),
        ...(token ? { [DELEGATED_TOKEN_HEADER]: token } : {}),
      },
      body: text,
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

const ERROR_CODES: readonly SourceErrorCode[] = ['invalid', 'denied', 'not-found', 'unavailable', 'unknown'];
/**
 * A read Clew makes as the installation (D119): posted to `/clew/installation/{name}` with the input alone and the
 * installation's assertion, bound to the body and the name. Every failure keeps the protocol's error kind, so the
 * register that copies the pages can tell a cursor the source no longer knows (`invalid`) from a source that is down
 * (`unavailable`) or one that refuses (`denied`): a connector that answers 401 without the protocol's error body has
 * refused Clew's assertion, which is `denied` too.
 */
function installationRead(
  manifest: ConnectorManifest,
  declared: NonNullable<ConnectorManifest['installation']>[number],
  transport: RemoteTransport,
): InstallationRead {
  const source = manifest.source;
  const down = () => new InstallationReadError('unavailable', installationReadText('unavailable', source));
  return {
    name: declared.name,
    title: declared.title,
    description: declared.description,
    input: declared.input as never,
    output: declared.output as never,
    run: async (input, { signal }) => {
      if (!transport.installation) throw new InstallationReadError('denied', installationReadText('denied', source));
      // The body is serialised once: the assertion is bound to exactly these bytes and this name (D117, D119).
      const text = JSON.stringify({ input });
      let response: Response;
      try {
        response = await (transport.fetch ?? fetch)(
          transport.url + INSTALLATION_ROUTE + encodeURIComponent(declared.name),
          {
            method: 'POST',
            redirect: 'error',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
              authorization: 'Bearer ' + (await transport.installation({ body: text, capability: declared.name })),
              ...(transport.key ? { 'x-clew-connector-key': transport.key } : {}),
            },
            body: text,
            signal: AbortSignal.any([AbortSignal.timeout(transport.timeoutMs ?? 10_000), ...(signal ? [signal] : [])]),
          },
        );
      } catch {
        throw down();
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        if (response.status === 401) throw new InstallationReadError('denied', installationReadText('denied', source));
        throw down();
      }
      if (Value.Check(CallResponseSchema, json) && 'output' in json && response.status < 300) return json.output;
      // The kind is the connector's; the words are Clew's. A connector's own message never travels further, into a
      // log, an audit row or an administrator's check (D91): it is not known what it carries.
      const error = (json as { error?: { code?: unknown } } | null)?.error;
      const code = ERROR_CODES.find(c => c === error?.code);
      if (code && code !== 'unavailable') throw new InstallationReadError(code, installationReadText(code, source));
      if (response.status === 401) throw new InstallationReadError('denied', installationReadText('denied', source));
      throw down();
    },
  };
}

/** Build the `Connector` the registry runs: every operation is a call to the service as the acting person. */
export function remoteConnector(manifest: ConnectorManifest, transport: RemoteTransport): Connector {
  const source = manifest.source;
  // A connector on the previous protocol (D60) was written against bodies without `about`; it is never sent one.
  const told = (clew: Clew) => (protocolTerms(manifest.protocol).about && clew.about ? { about: clew.about } : {});
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
    ...(c.about ? { about: c.about } : {}),
    ...(c.person ? { person: c.person } : {}),
    ...(c.unit ? { unit: c.unit } : {}),
    ...(c.asks ? { asks: c.asks } : {}),
    ...(c.effect ? { effect: c.effect } : {}),
    run: async (actor, input, clew) => {
      const { status, json } = await post(
        transport,
        source,
        CAPABILITY_ROUTE + encodeURIComponent(c.name),
        actor,
        // How the actor stands to each key the input names (D117), bound with the input by the assertion.
        { actor, input, ...told(clew) },
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
            const text = JSON.stringify({ actor, request, ...told(clew) });
            const response = await (transport.fetch ?? fetch)(transport.url + '/clew/documents', {
              redirect: 'error',
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                accept: 'application/octet-stream',
                authorization: 'Bearer ' + (await transport.assert(actor, clew.chain, { body: text })),
                ...(transport.key ? { 'x-clew-connector-key': transport.key } : {}),
                ...(manifest.delegation
                  ? { [DELEGATED_TOKEN_HEADER]: (await delegated(manifest, clew, source)) ?? '' }
                  : {}),
              },
              body: text,
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
    protocol: manifest.protocol,
    // Kept apart from `capabilities` (D119): only the registry's installation entry points reach these.
    ...(manifest.installation?.length
      ? { installation: manifest.installation.map(r => installationRead(manifest, r, transport)) }
      : {}),
    ...(manifest.facts ? { facts: manifest.facts } : {}),
    ...(manifest.header ? { header: manifest.header.capability } : {}),
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
          // A connector that acts as the person gets their token on a scan their live session asked for (D26).
          scan: async (actor: Actor, clew: Clew) => {
            const { status, json } = await post(
              transport,
              source,
              '/clew/scan',
              actor,
              { actor },
              await delegated(manifest, clew, source),
              clew.chain,
              undefined,
              clew.signal,
            );
            if (status >= 400 || !Value.Check(ScanResponseSchema, json)) throw unavailable(source);
            return json;
          },
        }
      : {}),
  };
}
