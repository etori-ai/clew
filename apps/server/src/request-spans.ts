import type { Context } from 'hono';
import type { Tracer } from '@opentelemetry/api';
import { httpInstrumentationMiddleware } from '@hono/otel';

/**
 * The address a request's span records as `url.full` (D91): the path alone, because the sign-in callback's query
 * carries the authorization code and a view's input may name a person, and with an entity's key, the segment after
 * `/api/entities/<kind>/`, as `:key`, because a person's key may be their user name, often their sign-in address. The
 * route template is on the span as `http.route`.
 */
export const spanAddress = (url: string) =>
  new URL(url).pathname.replace(/^(\/api\/entities\/[^/]+\/)[^/]+/i, '$1:key');
/**
 * One server span per request, mounted first when export is on (D91). An unexpected failure is recorded as `failure()`
 * leaves it in `c.error`, without the values of a failed statement. A test passes its own tracer.
 */
export const requestSpans = (options: { tracer?: Tracer } = {}) =>
  httpInstrumentationMiddleware({ ...options, getUrlFull: (c: Context) => spanAddress(c.req.url) });
