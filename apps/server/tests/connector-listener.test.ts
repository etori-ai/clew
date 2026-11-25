import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createServer, type RequestListener } from 'node:http';
import { once } from 'node:events';
import { connect, type AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * One copy of the connectors' listener, `connectors/hello/http.mjs`, under Node, which the connector images run. The
 * unit suite holds every copy to the same file and behaviour under Bun (`tests/unit/connector-listeners.test.ts`); this
 * checks that the behaviour holds in the runtime that serves it. Loaded by its address: nothing of Clew imports a
 * connector.
 */
type Listener = (
  handle: (request: Request) => Promise<Response>,
  options?: { limit?: number; log?: (name: unknown) => void },
) => RequestListener;
const address = new URL('../../../connectors/hello/http.mjs', import.meta.url).href;
const { listener } = (await import(address)) as { listener: Listener };

async function serve(t: TestContext, handle: (request: Request) => Promise<Response>, limit?: number) {
  const logged: unknown[] = [];
  const server = createServer(listener(handle, { ...(limit ? { limit } : {}), log: name => logged.push(name) }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>(resolve => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const { port } = server.address() as AddressInfo;
  /** A request written by hand: what comes back before the connection closes, and how long that took. */
  const raw = (text: string) =>
    new Promise<{ answer: string; ms: number }>(resolve => {
      const started = Date.now();
      const socket = connect(port, '127.0.0.1', () => socket.write(text));
      let answer = '';
      socket.on('data', chunk => (answer += chunk));
      // The listener closes the connection on a body it will not read; a write that meets the close is no failure.
      socket.on('error', () => undefined);
      socket.on('close', () => resolve({ answer, ms: Date.now() - started }));
    });
  return { port, raw, logged };
}
const ok = async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });

test('a GET with a body is served, and the body is not handed on', async t => {
  const seen: string[] = [];
  const { raw } = await serve(t, async request => {
    seen.push(`${request.method} ${await request.text()}`);
    return ok();
  });
  const { answer } = await raw(
    'GET /clew/manifest HTTP/1.1\r\nHost: connector\r\nContent-Length: 1\r\nConnection: close\r\n\r\nx',
  );
  assert.match(answer, /^HTTP\/1\.1 200 /);
  assert.deepEqual(seen, ['GET ']);
});

test(
  'a declared length over the limit is answered 413 at once, without the body being read',
  { timeout: 5000 },
  async t => {
    let calls = 0;
    const { raw } = await serve(
      t,
      async () => {
        calls++;
        return ok();
      },
      8,
    );
    // A hundred megabytes declared and three bytes sent: the answer cannot wait for the rest.
    const declared = await raw('POST /clew/scan HTTP/1.1\r\nHost: connector\r\nContent-Length: 100000000\r\n\r\nabc');
    assert.match(declared.answer, /^HTTP\/1\.1 413 /);
    assert.ok(declared.ms < 1000, `answered after ${declared.ms} ms`);
    // A body in pieces that passes the limit and never ends: refused as it passes, and the connection closed.
    const chunked = await raw(
      'POST /clew/scan HTTP/1.1\r\nHost: connector\r\nTransfer-Encoding: chunked\r\n\r\na\r\n0123456789\r\n',
    );
    assert.match(chunked.answer, /^HTTP\/1\.1 413 /);
    assert.ok(chunked.ms < 1000, `answered after ${chunked.ms} ms`);
    assert.equal(calls, 0);
  },
);

test('a handler that throws is a 500, with only the error’s name logged', async t => {
  const { raw, logged } = await serve(t, async () => {
    throw new TypeError('with a person’s text in it');
  });
  const { answer } = await raw('POST /clew/scan HTTP/1.1\r\nHost: connector\r\nConnection: close\r\n\r\n');
  assert.match(answer, /^HTTP\/1\.1 500 /);
  assert.ok(!answer.includes('person'));
  assert.deepEqual(logged, ['TypeError']);
});

test('a caller that goes away aborts the request’s signal', async t => {
  let aborted = false;
  let arrived!: () => void;
  const waiting = new Promise<void>(resolve => (arrived = resolve));
  const { port } = await serve(t, async request => {
    arrived();
    // A read that waits until the caller is gone, as Moodle's calls do.
    await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true }));
    aborted = true;
    return ok();
  });
  const socket = connect(port, '127.0.0.1', () =>
    socket.write('POST /clew/capabilities/x.read HTTP/1.1\r\nHost: connector\r\nConnection: close\r\n\r\n'),
  );
  await waiting;
  assert.equal(aborted, false);
  socket.destroy();
  for (let i = 0; i < 100 && !aborted; i++) await sleep(10);
  assert.equal(aborted, true);
});

test(
  'a caller that reads nothing holds the handler back, rather than its answer filling memory',
  { timeout: 10_000 },
  async t => {
    const piece = new Uint8Array(16 * 1024);
    let pulled = 0;
    const { port } = await serve(
      t,
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              // 64 MiB in all, were nothing to hold it back.
              if (++pulled > 4096) controller.close();
              else controller.enqueue(piece);
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const socket = connect(port, '127.0.0.1', () =>
      socket.write('POST /clew/ask HTTP/1.1\r\nHost: connector\r\nConnection: close\r\n\r\n'),
    );
    socket.pause();
    t.after(() => void socket.destroy());
    // Until the handler is no longer pulled: what the connection's buffers hold, a few megabytes.
    let seen = -1;
    for (let i = 0; i < 50 && (pulled === 0 || pulled !== seen); i++) {
      seen = pulled;
      await sleep(100);
    }
    assert.ok(pulled > 0);
    assert.ok(pulled < 1024, `the handler was pulled ${pulled} times`);
  },
);
