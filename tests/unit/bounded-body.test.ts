import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { boundedText, textOfAtMost } from '../../apps/server/src/bounded-body';

/**
 * Every route reads a request's body through `boundedText` (ID-8, CB-6): no more of it than the route's limit is held,
 * whether the body declares its length or is sent in pieces.
 */
const sent = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('http://clew.test/x', { method: 'POST', body, headers, duplex: 'half' } as RequestInit);
/** A body sent in pieces that never ends, counting the pieces read. */
function endless(piece = 'x'.repeat(1024)) {
  const counted = { pieces: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        counted.pieces++;
        controller.enqueue(new TextEncoder().encode(piece));
      },
      cancel() {
        counted.cancelled = true;
      },
      // Nothing is pulled until the body is read: every piece counted is one the reader asked for.
    },
    { highWaterMark: 0 },
  );
  return { counted, stream };
}

describe('a body read no further than its limit', () => {
  test('a body within the limit is its text, and no body is the empty text', async () => {
    expect(await boundedText(sent('{"a":1}'), 7)).toBe('{"a":1}');
    expect(await boundedText(sent(null), 10)).toBe('');
    expect(await boundedText(sent('åäö'), 6)).toBe('åäö');
  });
  test('a declared length over the limit, or one that is no length, is refused before anything is read', async () => {
    const { counted, stream } = endless();
    expect(await boundedText(sent(stream, { 'content-length': '2049' }), 2048)).toBeUndefined();
    expect(counted.pieces).toBe(0);
    for (const length of ['-1', '1e3', '12abc', '9'.repeat(16)]) {
      const another = endless();
      expect(await boundedText(sent(another.stream, { 'content-length': length }), 2048)).toBeUndefined();
      expect(another.counted.pieces).toBe(0);
    }
  });
  test('a body without a length is given up as soon as it passes the limit', async () => {
    const { counted, stream } = endless();
    expect(await boundedText(sent(stream), 4096)).toBeUndefined();
    expect(counted.pieces).toBeLessThanOrEqual(6);
    expect(counted.cancelled).toBe(true);
  });
  test('a limit in characters keeps meaning characters: three bytes each is read, and more characters are refused', async () => {
    expect(await textOfAtMost(sent('ö'.repeat(10)), 10)).toBe('ö'.repeat(10));
    expect(await textOfAtMost(sent('€'.repeat(10)), 10)).toBe('€'.repeat(10));
    expect(await textOfAtMost(sent('x'.repeat(11)), 10)).toBeUndefined();
    expect(await textOfAtMost(sent('€'.repeat(11)), 10)).toBeUndefined();
  });
});

test('no body is read anywhere in the server but through the bounded reader', () => {
  // A whole body read with `.text()`, `.json()` and their kind, a request's or an answer's, holds whatever another party
  // sends (ID-8, CB-6). Hono's `parseBody` reads it whole too.
  const server = join(import.meta.dirname, '../../apps/server/src');
  const whole = /\.(text|json|arrayBuffer|formData|blob)\(\s*\)|\bparseBody\(/;
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && name !== 'bounded-body.ts')
        readFileSync(path, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
            if (whole.test(code)) found.push(`${relative(server, path)}:${i + 1}`);
          });
    }
  };
  walk(server);
  expect(found).toEqual([]);
});
