import assert from 'node:assert/strict';
import { test } from 'node:test';
import { context, trace, type Span, type SpanContext, type SpanOptions, type Tracer } from '@opentelemetry/api';
import { registerTelemetry } from 'ai';
import { OpenTelemetry } from '@ai-sdk/otel';
import { createGenerator, modelAnswer, type ToolSchemaInfo } from '../src/assistant/model';

/**
 * What a model turn puts on its spans (D91, D122 item 8), through the real AI SDK and its OpenTelemetry integration, as
 * `telemetry.ts` registers it, with a tracer that keeps every attribute and event: the turn reads one person's holdings
 * through a tool and answers. Unless an operator sets `CLEW_MODEL_TELEMETRY_CONTENT` (`recordContent`), no span holds
 * the system prompt, the question, the tool's arguments, what the tool answered or the answer; with it, they are there,
 * which shows the recorder would have seen them.
 */
type Recorded = { name: string; attributes: Record<string, unknown>; events: unknown[] };
const spans: Recorded[] = [];
let n = 0;
function spanFor(name: string, options?: SpanOptions): Span {
  const recorded: Recorded = { name, attributes: { ...(options?.attributes ?? {}) }, events: [] };
  spans.push(recorded);
  const id: SpanContext = {
    traceId: '0af7651916cd43dd8448eb211c80319c',
    spanId: (++n).toString(16).padStart(16, '0'),
    traceFlags: 1,
  };
  const span: Span = {
    spanContext: () => id,
    setAttribute: (key, value) => {
      recorded.attributes[key] = value;
      return span;
    },
    setAttributes: attributes => {
      Object.assign(recorded.attributes, attributes);
      return span;
    },
    addEvent: (event, attributes) => {
      recorded.events.push({ event, attributes });
      return span;
    },
    addLink: () => span,
    addLinks: () => span,
    setStatus: status => {
      recorded.events.push({ status });
      return span;
    },
    updateName: renamed => {
      recorded.name = renamed;
      return span;
    },
    end: () => undefined,
    isRecording: () => true,
    recordException: exception => {
      recorded.events.push({ exception: String(exception) });
    },
  };
  return span;
}
const tracer: Tracer = {
  startSpan: (name, options) => spanFor(name, options),
  startActiveSpan: ((name: string, ...rest: unknown[]) => {
    const fn = rest.at(-1) as (span: Span) => unknown;
    const options = typeof rest[0] === 'object' && rest[0] !== null ? (rest[0] as SpanOptions) : undefined;
    const span = spanFor(name, options);
    return context.with(trace.setSpan(context.active(), span), () => fn(span));
  }) as Tracer['startActiveSpan'],
};
registerTelemetry(new OpenTelemetry({ agentSpanName: 'functionId', tracer }));

/** An OpenAI-compatible endpoint that asks for one read of holdings, then answers. */
function endpoint() {
  let call = 0;
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const stream = (...events: string[]) =>
    new Response(events.join('') + 'data: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  return async () => {
    call += 1;
    if (call === 1)
      return stream(
        chunk(
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'competence__holdings', arguments: '{"person":"ARG-MARKER"}' },
              },
            ],
          },
          null,
        ),
        chunk({}, 'tool_calls'),
      );
    return stream(chunk({ role: 'assistant', content: 'SVAR-MARKER finns.' }, null), chunk({}, 'stop'));
  };
}
const holdings: ToolSchemaInfo = {
  name: 'competence.holdings',
  title: 'Mina kompetenser',
  description: 'Registrerade intyg.',
  kind: 'read',
  source: 'Kompetens',
  input: { type: 'object', properties: { person: { type: 'string' } }, additionalProperties: false },
};
async function turn(recordContent: boolean) {
  spans.length = 0;
  const answer = await modelAnswer({
    system: 'SYSTEM-MARKER Du hjälper Hillevi.',
    history: [],
    text: 'FRÅGA-MARKER vad har Anna?',
    tools: [holdings],
    run: async () => ({ rows: [{ competence: 'ROW-MARKER', status: 'Utgånget' }] }),
    generate: createGenerator({ baseUrl: 'http://fake.test/v1' }, 'open-model', endpoint(), 'provider-default', {
      recordContent,
    }),
  });
  assert.equal(answer.toolCalls[0]?.capability, 'competence.holdings');
  return JSON.stringify(spans);
}

test('a turn that reads holdings puts no prompt, argument, row or answer on a span unless the operator says so', async () => {
  const recorded = await turn(false);
  // The turn was traced: the spans are there, with the model, the tool's name and the token counts.
  assert.ok(spans.length > 0, 'no span was recorded');
  assert.ok(recorded.includes('competence__holdings'), 'the tool call is not on a span');
  for (const marker of ['SYSTEM-MARKER', 'FRÅGA-MARKER', 'ARG-MARKER', 'ROW-MARKER', 'SVAR-MARKER'])
    assert.ok(!recorded.includes(marker), `${marker} is on a span`);
  // With CLEW_MODEL_TELEMETRY_CONTENT the same turn's content is there: the recorder sees what it is given.
  const withContent = await turn(true);
  for (const marker of ['ROW-MARKER', 'SVAR-MARKER'])
    assert.ok(withContent.includes(marker), `${marker} is not on a span with content on`);
});
