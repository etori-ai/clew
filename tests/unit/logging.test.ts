import { describe, expect, test } from 'bun:test';
import { Writable } from 'node:stream';
import { createLogger, logPort } from '../../apps/server/src/logging';

/**
 * The `log` port (D91) is what composition binds to the logger: `(message, ...details)`. One JSON line per call with
 * its scope, level and service; an error among the details keeps its type, message and stack; other details travel
 * as data. The logger under test writes to memory, so the suite needs no stdout and no exporter.
 */
function capture() {
  const lines: Record<string, unknown>[] = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(line));
      callback();
    },
  });
  const logger = createLogger({ level: 'debug' }, sink);
  return { lines, port: (scope: string, level: 'info' | 'error') => logPort(scope, level, logger) };
}

describe('the log port on the structured logger (D91)', () => {
  test('a message with no detail is one JSON line with its scope, level, service and time', () => {
    const { lines, port } = capture();
    port('connectors', 'info')('connector hr registered');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      scope: 'connectors',
      service: 'clew',
      message: 'connector hr registered',
    });
    expect(typeof lines[0]!.time).toBe('string');
    // No span is active in the suite, so no trace ids are claimed.
    expect(lines[0]).not.toHaveProperty('trace_id');
  });
  test('an error detail keeps its type, message and stack; a plain detail travels as data', () => {
    const { lines, port } = capture();
    const failure = new Error('ECONNREFUSED');
    port('dbos', 'error')('durable heartbeat failed', failure);
    port('assistant', 'error')('assistant: model unavailable, falling back to the router:', 'timeout');
    expect(lines[0]).toMatchObject({
      level: 'error',
      scope: 'dbos',
      message: 'durable heartbeat failed',
      error: { type: 'Error', message: 'ECONNREFUSED' },
    });
    expect((lines[0]!.error as { stack: string }).stack).toContain('ECONNREFUSED');
    expect(lines[1]).toMatchObject({ scope: 'assistant', detail: 'timeout' });
  });
  test('several details are kept as a list', () => {
    const { lines, port } = capture();
    port('scheduler', 'info')('adopted', 2, 'executor-a');
    expect(lines[0]).toMatchObject({ details: [2, 'executor-a'] });
  });
});
