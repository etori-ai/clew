import { APICallError } from 'ai';
import { createGenerator } from '../model';
import { WireError, type Endpoint, type ModelWire } from '../ports';
import { boundedText } from '../../bounded-body';

/**
 * The live OpenAI-compatible wire (D24): the only protocol, so an open-weight model on a self-hosted endpoint is a
 * complete installation and a closed provider is an operator's entry, never a dependency. `GET {base}/models` lists,
 * one tiny chat completion proves a model id and a key and that the model takes a call shaped like a turn (D84), and the
 * AI SDK's OpenAI-compatible provider runs a turn. The test sets no token limit, as a turn sets none: the parameter's
 * name differs between providers (`max_tokens`, which OpenAI's reasoning models refuse, and `max_completion_tokens`,
 * which older servers do not know), and a limit a reasoning model spends on thinking can leave no answer at all.
 * Every failure becomes a `WireError`: no answer (network, timeout, 5xx), a refused key (401, 403), or anything else;
 * a turn's own requests are classed more narrowly (`turnError`).
 */
/** The most of a probe's answer read: a model list of thousands of models is well under it. */
const ANSWER_BYTES = 4 * 1024 * 1024;
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
    // The provider's key goes to the address the administrator saved and nowhere else: a redirect is not followed.
    response = await fetchImpl(e.baseUrl.replace(/\/+$/, '') + path, {
      ...init,
      headers: headers(e),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new WireError('unreachable', error instanceof Error ? error.message : String(error));
  }
  if (response.status === 401 || response.status === 403 || response.status >= 500) {
    await response.body?.cancel().catch(() => undefined);
    throw new WireError(response.status >= 500 ? 'unreachable' : 'key-rejected', `HTTP ${response.status}`);
  }
  // A model list or a one-word answer: read no further than ANSWER_BYTES, whatever the provider sends.
  const text = await boundedText(response, ANSWER_BYTES);
  if (text === undefined) {
    await response.body?.cancel().catch(() => undefined);
    throw new WireError('unsupported', 'svaret är för stort');
  }
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
/** A tool the model need not call: a turn offers tools, and some models refuse a call only because of them (D84). */
const probeTool = {
  type: 'function',
  function: { name: 'clew_probe', description: 'Not used.', parameters: { type: 'object', properties: {} } },
};
export function openAICompatibleWire(
  fetchImpl: typeof fetch = fetch,
  options: { recordModelContent?: boolean } = {},
): ModelWire {
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
            messages: [{ role: 'user', content: 'Svara med ordet ok.' }],
            ...(tools ? { tools: [probeTool] } : {}),
            ...(reasoning === 'none' ? { reasoning_effort: 'none' } : {}),
          }),
        },
        20_000,
        fetchImpl,
      );
    },
    // A turn's requests follow no redirect either: the key is sent with every one of them. A request that got no answer
    // at all (the address does not connect, a redirect refused) and was not stopped or out of time is the endpoint's.
    generator: (e, model, reasoning) => {
      const generate = createGenerator(
        e,
        model,
        (input, init) =>
          fetchImpl(input, { ...init, redirect: 'error' }).catch((error: unknown) => {
            if (init?.signal?.aborted) throw error;
            throw new WireError('unreachable', error instanceof Error ? error.message.slice(0, 200) : String(error));
          }),
        reasoning,
        { recordContent: options.recordModelContent === true },
      );
      return async request => {
        try {
          return await generate(request);
        } catch (error) {
          throw turnError(error);
        }
      };
    },
  };
}
/**
 * The statuses with which an endpoint says it is not there for anyone: a gateway that reached no server behind it, a
 * server that is down or overloaded, an upstream that did not answer in time.
 */
const DOWN_STATUSES = new Set([502, 503, 504]);
/**
 * A turn's failure as the wire names it, so the assistant marks a provider down for everyone only when the endpoint
 * itself did not answer or refused the key (D8): a call the SDK could not make, or a 502, 503 or 504, is `unreachable`
 * (a request that got no answer at all is named so where it is sent), a 401 is `key-rejected`, and any other answer of
 * the endpoint is `unsupported`, the turn's own failure. A 403 is that too: in front of a model it is as often a web
 * application firewall or a moderation gateway refusing one prompt's content as a refused key, and one person's
 * question must not take the assistant from everyone. So is a 500, which one request can cause. The minute probe and
 * "Testa", which send nobody's prompt, still class a 403 as a refused key and any 5xx as no answer
 * (`call` above). A turn that ran out of time or was stopped is not the endpoint's failure and passes as it is; so
 * does anything that is not the wire's.
 */
export function turnError(error: unknown): unknown {
  if (!APICallError.isInstance(error)) return error;
  const status = error.statusCode;
  const message = (status ? `HTTP ${status}: ` : '') + error.message.slice(0, 200);
  if (status === 401) return new WireError('key-rejected', message);
  if (status === undefined || DOWN_STATUSES.has(status)) return new WireError('unreachable', message);
  return new WireError('unsupported', message);
}
