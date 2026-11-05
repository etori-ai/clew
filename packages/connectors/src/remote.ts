import { Value } from '@sinclair/typebox/value';
import { CapabilityError, type Actor, type Capability, type Clew, type Connector } from './index';
import { menuProblem, viewProblem } from './views';
import { CallResponseSchema, FigureResponseSchema, ConnectorManifestSchema, ScanResponseSchema, type ConnectorManifest } from './protocol';

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
  /** The assertion Clew sends as the bearer token: who is acting, signed for this connector. */
  assert: (actor: Actor) => Promise<string>;
  fetch?: FetchLike;
  /** Milliseconds before a call counts as unavailable. */
  timeoutMs?: number;
}
export class ManifestError extends Error { constructor(message: string) { super(message); this.name = 'ManifestError'; } }

/** Validate a manifest document; returns the typed manifest or throws with every problem listed. */
export function parseManifest(document: unknown, expectedId?: string): ConnectorManifest {
  const problems = [...Value.Errors(ConnectorManifestSchema, document)].map(e => `${e.path || '/'}: ${e.message}`);
  if (problems.length) throw new ManifestError('Invalid connector manifest: ' + problems.join('; '));
  const manifest = document as ConnectorManifest;
  if (expectedId && manifest.id !== expectedId) throw new ManifestError(`Manifest id "${manifest.id}" does not match the configured id "${expectedId}".`);
  for (const c of manifest.capabilities) {
    if (!c.name.startsWith(manifest.id + '.')) throw new ManifestError(`Capability ${c.name} must be prefixed with ${manifest.id}.`);
    if (c.kind === 'execute' && c.model) throw new ManifestError(`Capability ${c.name}: execute capabilities are never tools (D8).`);
    const problem = viewProblem(c, manifest.capabilities);
    if (problem) throw new ManifestError(`Capability ${problem} (D38).`);
    const menu = menuProblem(c);
    if (menu) throw new ManifestError(`Capability ${menu} (D40).`);
  }
  for (const a of manifest.areas) for (const s of a.standing) if (!manifest.capabilities.some(c => c.name === s)) throw new ManifestError(`Area ${a.id} lists unknown standing capability ${s}.`);
  return manifest;
}
export async function fetchManifest(url: string, expectedId?: string, fetchImpl: FetchLike = fetch): Promise<ConnectorManifest> {
  const response = await fetchImpl(url + '/clew/manifest', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new ManifestError(`GET ${url}/clew/manifest answered ${response.status}.`);
  return parseManifest(await response.json(), expectedId);
}

function unavailable(source: string) { return new CapabilityError(`${source} svarar inte just nu.`); }
/** The person's own token for the connector's system (D26), beside the assertion that proves Clew. Only when the manifest asks and a session is behind the call. */
export const DELEGATED_TOKEN_HEADER = 'x-clew-delegated-token';
async function delegated(manifest: ConnectorManifest, clew: Clew | undefined, source: string): Promise<string | undefined> {
  if (!manifest.delegation || !clew?.delegate) return undefined;
  try { return await clew.delegate(manifest.delegation.audience); }
  catch { throw new CapabilityError(`${source} kunde inte få din behörighet just nu.`); }
}
async function post(transport: RemoteTransport, source: string, path: string, actor: Actor, body: unknown, token?: string) {
  const fetchImpl = transport.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(transport.url + path, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + await transport.assert(actor), ...(token ? { [DELEGATED_TOKEN_HEADER]: token } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(transport.timeoutMs ?? 10_000),
    });
  } catch { throw unavailable(source); }
  let json: unknown;
  try { json = await response.json(); } catch { throw unavailable(source); }
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
    name: c.name, kind: c.kind, title: c.title, description: c.description, input: c.input as never, output: c.output as never, model: c.model, scope: c.scope,
    ...(c.kinds ? { kinds: c.kinds } : {}), ...(c.view ? { view: c.view } : {}), ...(c.menu ? { menu: c.menu } : {}),
    run: async (actor, input, clew) => {
      const { status, json } = await post(transport, source, '/clew/capabilities/' + encodeURIComponent(c.name), actor, { actor, input }, await delegated(manifest, clew, source));
      if (status >= 500 || !Value.Check(CallResponseSchema, json)) throw unavailable(source);
      if ('error' in json) failWith(json, source);
      return json.output;
    },
  }));
  return {
    id: manifest.id, kind: manifest.kind, source,
    areas: manifest.areas.map(a => ({
      id: a.id, title: a.title, roles: a.roles, standing: a.standing, schedules: a.schedules,
      ...(a.figure ? { figure: async (actor: Actor) => {
        try {
          const { status, json } = await post(transport, source, '/clew/figure', actor, { actor, area: a.id });
          if (status >= 400 || !Value.Check(FigureResponseSchema, json)) return { label: `${source} svarar inte`, tone: 'warn' as const };
          return json.figure;
        } catch { return { label: `${source} svarar inte`, tone: 'warn' as const }; }
      } } : {}),
    })),
    capabilities,
    ...(manifest.scan ? { scan: async (actor: Actor) => {
      const { status, json } = await post(transport, source, '/clew/scan', actor, { actor });
      if (status >= 400 || !Value.Check(ScanResponseSchema, json)) throw unavailable(source);
      return json.drafts;
    } } : {}),
  };
}
