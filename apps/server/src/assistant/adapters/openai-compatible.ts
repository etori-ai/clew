import { createGenerator } from '../model';
import { WireError, type Endpoint, type ModelWire } from '../ports';

/**
 * The live OpenAI-compatible wire (D24): the only protocol, so an open-weight model on a self-hosted endpoint is a
 * complete installation and a closed provider is an operator's entry, never a dependency. `GET {base}/models` lists,
 * one tiny chat completion proves a model id and a key and that the model takes a call shaped like a turn (D82), and the
 * AI SDK's OpenAI-compatible provider runs a turn.
 * Every failure becomes a `WireError`: no answer (network, timeout, 5xx), a refused key (401, 403), or anything else.
 */
const headers = (e: Endpoint): Record<string, string> => ({
  'content-type': 'application/json',
  ...(e.apiKey ? { authorization: `Bearer ${e.apiKey}` } : {}),
});
async function call(
  e: Endpoint,
  path: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(e.baseUrl.replace(/\/+$/, '') + path, {
      ...init,
      headers: headers(e),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new WireError('unreachable', error instanceof Error ? error.message : String(error));
  }
  if (response.status === 401 || response.status === 403)
    throw new WireError('key-rejected', `HTTP ${response.status}`);
  if (response.status >= 500) throw new WireError('unreachable', `HTTP ${response.status}`);
  const text = await response.text();
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = JSON.parse(text) as { error?: { message?: string } | string };
      const message = typeof body.error === 'string' ? body.error : body.error?.message;
      if (message) detail += `: ${message.slice(0, 200)}`;
    } catch {
      /* not JSON */
    }
    throw new WireError('unsupported', detail);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new WireError('unsupported', 'svaret är inte JSON');
  }
}
/** A tool the model need not call: a turn offers tools, and some models refuse a call only because of them (D82). */
const probeTool = {
  type: 'function',
  function: { name: 'clew_probe', description: 'Not used.', parameters: { type: 'object', properties: {} } },
};
export function openAICompatibleWire(fetchImpl: typeof fetch = fetch): ModelWire {
  return {
    async listModels(e) {
      const body = (await call(e, '/models', { method: 'GET' }, 5_000, fetchImpl)) as {
        data?: Array<{ id?: unknown }>;
      };
      if (!Array.isArray(body?.data)) throw new WireError('unsupported', 'svaret har ingen modellista');
      return body.data
        .map(m => m.id)
        .filter((id): id is string => typeof id === 'string')
        .sort();
    },
    async ping(e, model, { tools, reasoning }) {
      await call(
        e,
        '/chat/completions',
        {
          method: 'POST',
          body: JSON.stringify({
            model,
            max_tokens: 4,
            messages: [{ role: 'user', content: 'Svara med ordet ok.' }],
            ...(tools ? { tools: [probeTool] } : {}),
            ...(reasoning === 'none' ? { reasoning_effort: 'none' } : {}),
          }),
        },
        20_000,
        fetchImpl,
      );
    },
    generator: (e, model, reasoning) => createGenerator(e, model, fetchImpl, reasoning),
  };
}
