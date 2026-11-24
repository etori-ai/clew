import { Value } from 'typebox/value';
import {
  MAX_DOCUMENT_BYTES,
  contractProblems,
  type AssistantAsk,
  type AssistantAskEvent,
  type DocumentContent,
} from '@clew/contracts';
import {
  CapabilityError,
  InstallationReadError,
  actorOf,
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
  ASK_ROUTE,
  CallResponseSchema,
  FigureResponseSchema,
  ConnectorManifestSchema,
  INSTALLATION_ROUTE,
  MAX_ANSWER_BYTES,
  MAX_MANIFEST_BYTES,
  PROTOCOL_ACCEPTED,
  ScanResponseSchema,
  type ConnectorManifest,
  type ProtocolErrorCode,
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
  /** For a question to a source's assistant: the longest silence and the longest whole answer; `ASK_IDLE_MS` and `ASK_TOTAL_MS` unless a test says otherwise. */
  askIdleMs?: number;
  askTotalMs?: number;
}
/**
 * What an assertion is bound to (D117): `body`, the exact request body it is sent with, which the signer digests
 * (SHA-256, base64url, the `body` claim), on `/clew/capabilities/{name}` the capability's `name` (the `capability`
 * claim), and on an approved write the `X-Clew-Operation-Id` it is sent with (the `operationId` claim). A connector's
 * verifier recomputes all three from the request it received, so neither the input nor the `about` it carries can be
 * changed, and the assertion cannot be replayed on another capability or as another operation.
 */
export interface AssertionBinding {
  body: string;
  capability?: string;
  /** The operation id the request carries in `X-Clew-Operation-Id`, when it carries one. */
  operationId?: string;
  /**
   * `false`: the assertion carries no callback grant, whatever the connector's `uses` say. A question to a source's
   * assistant, and the read that lists the assistants, are sent so: only the person's text leaves Clew, and nothing is
   * read back while it is answered (D125 item 4, D144).
   */
  callback?: false;
}
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}
/**
 * Why a service's manifest could not be read, by one rule for the loader and for administration: it served one this
 * Clew does not load (`manifest-invalid`), or it did not answer or answered with an error status (`unreachable`).
 */
export const manifestFailure = (error: unknown): 'unreachable' | 'manifest-invalid' =>
  error instanceof ManifestError && !/answered \d+/.test(error.message) ? 'manifest-invalid' : 'unreachable';
/**
 * The short code a failed read carries, which an administrator may be shown: the network's or the TLS library's
 * (`ECONNREFUSED`, `ENOTFOUND`, `UND_ERR_CONNECT_TIMEOUT`, `CERT_HAS_EXPIRED`, `ERR_TLS_CERT_ALTNAME_INVALID`; on fetch's
 * error under Bun, on its cause under Node), or `TimeoutError` when the read ran out of time. Letters, digits and
 * underscores only, so nothing the other end said rides along; undefined when the error carries none.
 */
export function failureCode(error: unknown): string | undefined {
  let e: unknown = error;
  for (let depth = 0; e && typeof e === 'object' && depth < 4; depth++) {
    const { code, name, cause } = e as { code?: unknown; name?: unknown; cause?: unknown };
    if (typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(code)) return code;
    if (name === 'TimeoutError') return 'TimeoutError';
    e = cause;
  }
  return undefined;
}

/**
 * Every problem a manifest document has, in the order Clew finds them; none means Clew would load it. The schema first
 * (every path listed), then the rules between fields. A protocol number this Clew does not load is named as such
 * (D60), with the one it loads, not as a literal mismatch. `previewManifest` shows the whole list; `parseManifest` throws on it.
 */
export function manifestProblems(
  document: unknown,
  expectedId?: string,
  compile?: (schema: object) => unknown,
): string[] {
  const errors = contractProblems(ConnectorManifestSchema, document);
  if (errors.length) {
    const protocol = (document as { protocol?: unknown } | null)?.protocol;
    return errors.map(e =>
      e.path === '/protocol' && typeof protocol === 'number' && !PROTOCOL_ACCEPTED.includes(protocol)
        ? `/protocol: ${protocol} is not accepted by this Clew, which loads ${PROTOCOL_ACCEPTED.join(' and ')}`
        : `${e.path || '/'}: ${e.message}`,
    );
  }
  const manifest = document as ConnectorManifest;
  const problems: string[] = [];
  if (expectedId && manifest.id !== expectedId)
    problems.push(`Manifest id "${manifest.id}" does not match the configured id "${expectedId}".`);
  problems.push(...connectorProblems(manifest, compile));
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
/** An answer read past `limit` bytes: stopped there, and the connector counts as failing. */
class TooLarge extends Error {}
/**
 * A JSON answer, read no further than `limit` bytes (CB-5): a declared length above it is refused before anything is
 * read, and a body sent in pieces is read a piece at a time and given up as soon as it passes the limit. Throws
 * `TooLarge` for a body over the limit and a `SyntaxError` for one that is not JSON.
 */
export async function boundedJson(response: Response, limit: number): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new TooLarge();
  }
  if (!response.body) return JSON.parse('');
  const reader = response.body.getReader();
  const pieces: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new TooLarge();
      pieces.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const piece of pieces) {
    bytes.set(piece, at);
    at += piece.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
/**
 * The manifest a service serves. Read at the registered address only (CB-4): a redirect is refused, so the address an
 * administrator registered is the one Clew reads, and the refusal never names another host's answer. At most
 * `MAX_MANIFEST_BYTES` of it is read.
 */
export async function fetchManifest(
  url: string,
  expectedId?: string,
  fetchImpl: FetchLike = fetch,
): Promise<ConnectorManifest> {
  // A redirect is not followed (CB-4), and it is said as such: the address registered is where every call goes, so the
  // administrator registers the one the service answers on. Followed by `redirect: 'error'` it was "fetch failed", which
  // the loader took for a service that does not answer yet.
  const response = await fetchImpl(url + '/clew/manifest', {
    headers: { accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  });
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    await response.body?.cancel().catch(() => undefined);
    throw new ManifestError(
      `GET ${url}/clew/manifest answered with a redirect (${response.status}), which Clew does not follow. Register the address the connector answers on itself.`,
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ManifestError(`GET ${url}/clew/manifest answered ${response.status}.`);
  }
  let document: unknown;
  try {
    document = await boundedJson(response, MAX_MANIFEST_BYTES);
  } catch (error) {
    if (error instanceof TooLarge)
      throw new ManifestError(`GET ${url}/clew/manifest answered more than ${MAX_MANIFEST_BYTES} bytes.`);
    throw error;
  }
  return parseManifest(document, expectedId);
}

function unavailable(source: string) {
  return new CapabilityError(`${source} svarar inte just nu.`, 'unavailable');
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
    throw new CapabilityError(`${source} kunde inte få din behörighet just nu.`, 'unavailable');
  }
}
const CAPABILITY_ROUTE = '/clew/capabilities/';
/** How long a source's assistant may be silent, and how long one answer may take in all, before it counts as unavailable. */
export const ASK_IDLE_MS = 30_000;
export const ASK_TOTAL_MS = 180_000;
/** The most bytes of one answer's event stream Clew reads. */
const ASK_STREAM_MAX = 2_000_000;
/**
 * The answer of `POST /clew/ask` as its events: server-sent events, one JSON value per `data:` line, read as they
 * arrive. Anything that is not JSON, a silence longer than `ASK_IDLE_MS` or a stream longer than `ASK_STREAM_MAX` is
 * the source failing. The shape of each event is the registry's to check.
 */
async function* askEvents(body: ReadableStream<Uint8Array>, source: string, idleMs: number): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let size = 0;
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(unavailable(source)), idleMs);
        }),
      ]).finally(() => clearTimeout(timer));
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > ASK_STREAM_MAX) throw unavailable(source);
      buffer += decoder.decode(chunk.value, { stream: true });
      for (;;) {
        const end = buffer.search(/\r?\n\r?\n/);
        if (end < 0) break;
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, '');
        const data = block
          .split(/\r?\n/)
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).replace(/^ /, ''))
          .join('\n');
        // A comment line (a keep-alive) or an event without data is not an event of the profile.
        if (!data) continue;
        let event: unknown;
        try {
          event = JSON.parse(data);
        } catch {
          throw unavailable(source);
        }
        yield event;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
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
  callback?: false,
) {
  const fetchImpl = transport.fetch ?? fetch;
  // The body is serialised once: the assertion is bound to exactly these bytes (D117).
  const text = JSON.stringify(body);
  const binding: AssertionBinding = {
    body: text,
    ...(path.startsWith(CAPABILITY_ROUTE)
      ? { capability: decodeURIComponent(path.slice(CAPABILITY_ROUTE.length)) }
      : {}),
    ...(operationId ? { operationId } : {}),
    ...(callback === false ? { callback } : {}),
  };
  let response: Response;
  try {
    response = await fetchImpl(transport.url + path, {
      method: 'POST',
      // The registered address only (CB-4): a redirect would carry the key, the person's token and the body to a host
      // nobody registered, and put that host's words in front of the person. It is the connector failing.
      redirect: 'error',
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
    json = await boundedJson(response, MAX_ANSWER_BYTES);
  } catch {
    throw unavailable(source);
  }
  return { status: response.status, json };
}
/**
 * A connector's error answer in the protocol's shape, mapped to what the person sees, with its code kept: a caller
 * tells the connector's refusal of the person (`denied`) from its failure by it. The status decides what the code may
 * claim, as the protocol gives them: a 401 is the connector rejecting Clew's key or assertion, and a `denied` refuses
 * the person only with its 403, so either is the connector failing, `unavailable`, whatever the body says. The message
 * stays the connector's, so the conformance check still names the rejection.
 */
function failWith(json: unknown, status: number, source: string): never {
  const error = (json as { error?: { code?: ProtocolErrorCode; message?: string } } | null)?.error;
  if (error?.code === 'unavailable' || !error?.message) throw unavailable(source);
  const failed = status === 401 || (error.code === 'denied' && status !== 403);
  throw new CapabilityError(error.message, failed ? 'unavailable' : error.code);
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
        json = await boundedJson(response, MAX_ANSWER_BYTES);
      } catch (error) {
        if (error instanceof TooLarge) throw down();
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

/**
 * Build the `Connector` the registry runs: every operation is a call to the service as the acting person. The registry
 * hands it the actor inside the process, which may carry the person's groups or a whole authenticated context; every
 * body posted here carries the published actor (`actorOf`) and nothing more, as the protocol's request schemas require.
 */
export function remoteConnector(manifest: ConnectorManifest, given: RemoteTransport): Connector {
  const source = manifest.source;
  const told = (clew: Clew) => (clew.about ? { about: clew.about } : {});
  // D135: a person's assignments reach only a connector that says it takes them, so one built to refuse a property it
  // does not know is never sent one. Left out of the body and the assertion alike.
  const tell = (actor: Actor): Actor => (manifest.assignments ? actor : { ...actor, assignments: undefined });
  const published = (actor: Actor) => actorOf(tell(actor));
  const transport: RemoteTransport = manifest.assignments
    ? given
    : { ...given, assert: (actor, chain, binding) => given.assert(tell(actor), chain, binding) };
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
        { actor: published(actor), input, ...told(clew) },
        await delegated(manifest, clew, source),
        clew.chain,
        clew.operationId,
        clew.signal,
        // The assistants listing is read before and while a question is answered: it reads nothing back (D125 item 4, D144).
        c.name === manifest.assistants?.list ? false : undefined,
      );
      if (status >= 500 || !Value.Check(CallResponseSchema, json)) throw unavailable(source);
      if ('error' in json) failWith(json, status, source);
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
            const text = JSON.stringify({ actor: published(actor), request, ...told(clew) });
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
              if (response.status === 409)
                throw new CapabilityError('Underlaget har ändrats. Läs in underlagen igen.', 'invalid');
              if (response.status === 403)
                throw new CapabilityError('Du saknar behörighet att läsa underlaget.', 'denied');
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
    ...(manifest.assistants
      ? {
          assistants: {
            list: manifest.assistants.list,
            ask: async function* (actor: Actor, ask: AssistantAsk, clew: Clew): AsyncGenerator<AssistantAskEvent> {
              // The body is serialised once: the assertion is bound to exactly these bytes (D117).
              const text = JSON.stringify({ actor: published(actor), ask });
              const signal = AbortSignal.any([
                AbortSignal.timeout(transport.askTotalMs ?? ASK_TOTAL_MS),
                ...(clew.signal ? [clew.signal] : []),
              ]);
              let response: Response;
              try {
                response = await (transport.fetch ?? fetch)(transport.url + ASK_ROUTE, {
                  redirect: 'error',
                  method: 'POST',
                  headers: {
                    'content-type': 'application/json',
                    accept: 'text/event-stream',
                    authorization:
                      'Bearer ' + (await transport.assert(actor, clew.chain, { body: text, callback: false })),
                    ...(transport.key ? { 'x-clew-connector-key': transport.key } : {}),
                    ...(manifest.delegation
                      ? { [DELEGATED_TOKEN_HEADER]: (await delegated(manifest, clew, source)) ?? '' }
                      : {}),
                  },
                  body: text,
                  signal,
                });
              } catch (error) {
                if (error instanceof CapabilityError) throw error;
                throw unavailable(source);
              }
              if (!response.ok || !response.body) {
                // A refusal before the answer starts: the protocol's error body with its status, as a capability's.
                let json: unknown;
                try {
                  json = await boundedJson(response, MAX_ANSWER_BYTES);
                } catch {
                  throw unavailable(source);
                }
                const code = (json as { error?: { code?: ProtocolErrorCode } } | null)?.error?.code;
                if (response.status === 403 && code === 'denied') yield { type: 'error', code: 'denied' };
                else if (response.status === 404 && code === 'not-found') yield { type: 'error', code: 'not-found' };
                else throw unavailable(source);
                return;
              }
              try {
                yield* askEvents(
                  response.body,
                  source,
                  transport.askIdleMs ?? ASK_IDLE_MS,
                ) as AsyncGenerator<AssistantAskEvent>;
              } catch (error) {
                if (error instanceof CapabilityError) throw error;
                throw unavailable(source);
              }
            },
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
                { actor: published(actor), area: a.id },
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
              { actor: published(actor) },
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
