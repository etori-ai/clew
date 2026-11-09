// SupportManagement's API behind the errand port (D89). Every call carries the person's own token as the bearer and
// nothing else: no service credential, no X-Sent-By, no header from the incoming request. Two of the three calls
// exist in SupportManagement today; `errands/mine` is the one this connector asks for (README.md, "What
// SupportManagement has to provide"). Not run against a real installation.
import { RELATIONS, SourceDenied, SourceNotFound, SourceUnavailable, toSourceErrand } from './errands.mjs';

const namespacePattern = /^[A-Za-z0-9_.-]{1,60}$/;
const MAX_PAGES = 5;

/**
 * url: the API base, the gateway's address for SupportManagement. municipalityId: the installation's.
 * areas: namespace -> the name a person reads, used where SupportManagement does not send one. metadataSeconds: how long a namespace's categories and statuses are kept; they are display names, not errands, and
 * nothing a person owns is cached. `fetch` and `now` are injectable for tests.
 */
export function createSupportManagementErrands({
  url,
  municipalityId,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
  pageSize = 100,
  metadataSeconds = 600,
  areas = {},
  now = () => Date.now(),
} = {}) {
  if (!url) throw new Error('SM_URL is required: the base URL of the SupportManagement API.');
  if (!/^[0-9]{1,8}$/.test(String(municipalityId ?? '')))
    throw new Error('SM_MUNICIPALITY_ID is required: the municipality id the installation serves.');
  const base = new URL(url);
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname))
    throw new Error('SM_URL must be https outside local development.');
  const root = base.toString().replace(/\/+$/, '') + '/' + municipalityId;

  async function get(token, path) {
    let response;
    try {
      response = await fetchImpl(root + path, {
        method: 'GET',
        headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new SourceUnavailable('SupportManagement did not answer.');
    }
    if (response.status === 401 || response.status === 403) throw new SourceDenied('The token was refused.');
    if (response.status === 404) throw new SourceNotFound('Not found.');
    if (!response.ok) throw new SourceUnavailable('SupportManagement answered ' + response.status + '.');
    try {
      return await response.json();
    } catch {
      throw new SourceUnavailable('SupportManagement answered with something that is not JSON.');
    }
  }

  // Display names per namespace. A person who may not read a namespace's metadata (a reporter outside it) still gets
  // their errand, with the source's own names instead.
  const metadataCache = new Map();
  async function metadataFor(token, namespace) {
    const cached = metadataCache.get(namespace);
    if (cached && now() - cached.at < metadataSeconds * 1000) return cached.value;
    try {
      const value = await get(token, `/${encodeURIComponent(namespace)}/metadata`);
      metadataCache.set(namespace, { at: now(), value });
      return value;
    } catch (error) {
      if (error instanceof SourceUnavailable) throw error;
      return {};
    }
  }

  return {
    /** The person's open errands in one relation, across every namespace SupportManagement lets them see. */
    async mine(token, relation) {
      if (!RELATIONS.includes(relation)) return [];
      const raws = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const answer = await get(token, `/errands/mine?relation=${relation}&page=${page}&size=${pageSize}`);
        const content = Array.isArray(answer?.content) ? answer.content : [];
        raws.push(...content);
        if (answer?.last !== false || content.length === 0) break;
      }
      const usable = raws.filter(raw => typeof raw?.namespace === 'string' && namespacePattern.test(raw.namespace));
      const namespaces = [...new Set(usable.map(raw => raw.namespace))];
      const metadata = new Map(
        await Promise.all(namespaces.map(async namespace => [namespace, await metadataFor(token, namespace)])),
      );
      return usable
        .map(raw =>
          toSourceErrand(raw, { area: areas[raw.namespace], metadata: metadata.get(raw.namespace), relation }),
        )
        .filter(Boolean);
    },

    /** One errand with its free text. SupportManagement answers 404 for an errand the person may not see. */
    async errand(token, namespace, id) {
      const [raw, metadata] = await Promise.all([
        get(token, `/${encodeURIComponent(namespace)}/errands/${encodeURIComponent(id)}`),
        metadataFor(token, namespace),
      ]);
      const relation = RELATIONS.includes(raw?.relation) ? raw.relation : undefined;
      const errand = toSourceErrand(raw, { namespace, area: areas[namespace], metadata, relation });
      if (!errand) throw new SourceUnavailable('SupportManagement answered with an errand that cannot be read.');
      return errand;
    },
  };
}
