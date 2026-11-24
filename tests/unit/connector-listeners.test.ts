import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect, type AddressInfo } from 'node:net';

/**
 * Every connector that serves itself with Node's HTTP server does it through its own copy of the same listener,
 * `connectors/<id>/http.mjs` (CS-M1), unless it is named in `OWN_SERVER` below. Anyone who reaches the port reaches it
 * before Clew's signature is checked: a GET with a body or a Host that is no host once threw before the handler and
 * ended the process, a body was read whole, and an answer was pulled from the handler however slowly the caller read.
 * Each copy is held to the same behaviour here, and each folder to serving through it.
 */
const root = new URL('../../connectors/', import.meta.url);
/**
 * The folders whose `server.mjs` keeps a small server of its own, each with why. Every other folder with a
 * `server.mjs` is held to the listener, so a new connector that is in neither list fails here.
 */
const OWN_SERVER: Record<string, string> = {
  hr: 'a fixture of the development stack (D61) on synthetic data, with a 64 kB limit of its own',
  finance: 'a fixture of the development stack (D61) on synthetic data, with a 64 kB limit of its own',
  incidents: 'a fixture of the development stack (D61) on synthetic data, with a 64 kB limit of its own',
  communication: 'a fixture of the development stack (D61) on synthetic data, with a 64 kB limit of its own',
  timesheet: 'a fixture of the development stack (D61) on synthetic data, with a 64 kB limit of its own',
  payroll: 'a fixture of the development stack (D61) on synthetic data, with a 64 kB limit of its own',
  servicedesk: 'a fixture of the development stack (D61) on synthetic data, with a 64 kB limit of its own',
  reference: "the durability suite's synthetic fixture, started by `bun run test:durability` alone, with a 16 kB limit",
};
const FOLDERS = readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(new URL(`${entry.name}/server.mjs`, root)))
  .map(entry => entry.name)
  .filter(name => !(name in OWN_SERVER))
  .sort();
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
type Listener = (
  handle: (request: Request) => Promise<Response>,
  options?: { limit?: number; log?: (name: unknown) => void },
) => Parameters<typeof createServer>[1];

async function serve(listener: Listener, handle: (request: Request) => Promise<Response>, limit?: number) {
  const unexpected: unknown[] = [];
  const server = createServer(listener(handle, { ...(limit ? { limit } : {}), log: name => unexpected.push(name) }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  /** One request written by hand, so that it can be one a well-behaved client would not send. */
  const raw = (text: string) =>
    new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => socket.write(text));
      let answer = '';
      socket.on('data', chunk => (answer += chunk));
      socket.on('end', () => resolve(answer));
      socket.on('error', reject);
    });
  /**
   * A request written by hand whose body never ends: what comes back before the connection closes. A listener that
   * read on would never answer it.
   */
  const unfinished = (text: string) =>
    new Promise<string>(resolve => {
      const socket = connect(port, '127.0.0.1', () => socket.write(text));
      let answer = '';
      socket.on('data', chunk => (answer += chunk));
      // The listener closes the connection on a body it will not read; a write that meets the close is no failure.
      socket.on('error', () => undefined);
      socket.on('close', () => resolve(answer));
    });
  return { port, raw, unfinished, unexpected, close: () => new Promise(resolve => server.close(resolve)) };
}
const ok = async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });

describe.each(FOLDERS)('the listener of %s', folder => {
  const load = async () => (await import(`../../connectors/${folder}/http.mjs`)).listener as Listener;

  test('a GET with a body and a Host that is no host are served, not thrown, and the next request too', async () => {
    const seen: string[] = [];
    const { raw, close } = await serve(await load(), async request => {
      seen.push(`${request.method} ${new URL(request.url).pathname} ${await request.text()}`);
      return ok();
    });
    try {
      expect(
        await raw('GET /clew/manifest HTTP/1.1\r\nHost: connector\r\nContent-Length: 1\r\nConnection: close\r\n\r\nx'),
      ).toStartWith('HTTP/1.1 200');
      expect(await raw('POST /clew/scan HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n')).toStartWith(
        'HTTP/1.1 200',
      );
      expect(
        await raw('POST /clew/scan HTTP/1.1\r\nHost: connector\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}'),
      ).toStartWith('HTTP/1.1 200');
      expect(seen).toEqual(['GET /clew/manifest ', 'POST /clew/scan ', 'POST /clew/scan {}']);
    } finally {
      await close();
    }
  });

  test('a body over the limit is refused unread by the handler, and a handler that throws is an answer', async () => {
    let calls = 0;
    const { raw, unexpected, close } = await serve(
      await load(),
      async () => {
        if (++calls === 1) throw new TypeError('with a person’s text in it');
        return ok();
      },
      8,
    );
    try {
      expect(
        await raw(
          'POST /clew/scan HTTP/1.1\r\nHost: connector\r\nContent-Length: 9\r\nConnection: close\r\n\r\n123456789',
        ),
      ).toStartWith('HTTP/1.1 413');
      expect(calls).toBe(0);
      expect(await raw('POST /clew/scan HTTP/1.1\r\nHost: connector\r\nConnection: close\r\n\r\n')).toStartWith(
        'HTTP/1.1 500',
      );
      // Only the error's name is logged: what it carries may be a person's.
      expect(unexpected).toEqual(['TypeError']);
      expect(await raw('POST /clew/scan HTTP/1.1\r\nHost: connector\r\nConnection: close\r\n\r\n')).toStartWith(
        'HTTP/1.1 200',
      );
    } finally {
      await close();
    }
  });

  test('a declared length over the limit is refused at once, without reading the body, and the connection closed', async () => {
    let calls = 0;
    const { unfinished, close } = await serve(
      await load(),
      async () => {
        calls++;
        return ok();
      },
      8,
    );
    try {
      const started = Date.now();
      // A hundred megabytes declared, three bytes sent: the answer cannot wait for the rest.
      expect(
        await unfinished('POST /clew/scan HTTP/1.1\r\nHost: connector\r\nContent-Length: 100000000\r\n\r\nabc'),
      ).toStartWith('HTTP/1.1 413');
      expect(Date.now() - started).toBeLessThan(1000);
      expect(calls).toBe(0);
    } finally {
      await close();
    }
  });

  test('a body sent in pieces is refused as it passes the limit, and nothing after it is read', async () => {
    let calls = 0;
    const { unfinished, close } = await serve(
      await load(),
      async () => {
        calls++;
        return ok();
      },
      8,
    );
    try {
      const started = Date.now();
      // One chunk of ten bytes and no end: the connection closes once the refusal is out.
      expect(
        await unfinished(
          'POST /clew/scan HTTP/1.1\r\nHost: connector\r\nTransfer-Encoding: chunked\r\n\r\na\r\n0123456789\r\n',
        ),
      ).toStartWith('HTTP/1.1 413');
      expect(Date.now() - started).toBeLessThan(1000);
      expect(calls).toBe(0);
    } finally {
      await close();
    }
  });

  test('a caller that reads nothing holds the handler back, rather than its answer filling memory', async () => {
    const piece = new Uint8Array(16 * 1024);
    let pulled = 0;
    const { port, close } = await serve(
      await load(),
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
    try {
      // Until the handler is no longer pulled: what the connection's buffers hold, a few megabytes.
      let seen = -1;
      for (let i = 0; i < 50 && (pulled === 0 || pulled !== seen); i++) {
        seen = pulled;
        await Bun.sleep(100);
      }
      expect(pulled).toBeGreaterThan(0);
      expect(pulled).toBeLessThan(1024);
    } finally {
      socket.destroy();
      await close();
    }
  }, 10_000);

  test('an answer is written as it arrives, and a caller that goes away aborts the request', async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    let aborted = false;
    const { port, close } = await serve(await load(), async request => {
      if (new URL(request.url).pathname === '/clew/ask')
        return new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"type":"text"}\n\n'));
              await held;
              controller.close();
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      // A read that waits until the caller is gone, as Moodle's calls do.
      await new Promise(resolve =>
        request.signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            resolve(undefined);
          },
          { once: true },
        ),
      );
      return ok();
    });
    try {
      const first = await new Promise<string>((resolve, reject) => {
        const socket = connect(port, '127.0.0.1', () =>
          socket.write('POST /clew/ask HTTP/1.1\r\nHost: connector\r\nConnection: close\r\n\r\n'),
        );
        let text = '';
        socket.on('data', chunk => {
          text += chunk;
          if (text.includes('data: {"type":"text"}')) {
            socket.destroy();
            resolve(text);
          }
        });
        socket.on('error', reject);
      });
      expect(first).toStartWith('HTTP/1.1 200');
      release();
      // A read that is still waiting when the caller goes away hears of it through its request's signal.
      const socket = connect(port, '127.0.0.1', () =>
        socket.write('POST /clew/capabilities/x.read HTTP/1.1\r\nHost: connector\r\nConnection: close\r\n\r\n'),
      );
      await Bun.sleep(50);
      expect(aborted).toBe(false);
      socket.destroy();
      for (let i = 0; i < 100 && !aborted; i++) await Bun.sleep(10);
      expect(aborted).toBe(true);
    } finally {
      release();
      await close();
    }
  });

  test('the folder serves through it, and its image carries it', () => {
    const server = read(`${folder}/server.mjs`);
    expect(server).toContain("import { listener } from './http.mjs';");
    expect(server).toContain('createServer(listener(');
    expect(server).not.toContain('createServer(async');
    expect(read(`${folder}/Dockerfile`)).toMatch(/^COPY .*\bhttp\.mjs\b.* \.\/$/m);
  });
});

test('a folder named as keeping its own server does keep it, so the list holds no folder that serves through the listener', () => {
  expect(FOLDERS).toContain('hello');
  for (const folder of Object.keys(OWN_SERVER)) {
    const server = read(`${folder}/server.mjs`);
    expect(server).toContain('createServer(async');
    expect(server).not.toContain('./http.mjs');
  }
});

test('every copy of the listener is the same file but for the name in its log line', () => {
  const normal = (folder: string) =>
    read(`${folder}/http.mjs`).replace(/console\.error\('[a-z-]+ connector: unexpected'/, "console.error('…'");
  for (const folder of FOLDERS) expect(normal(folder)).toBe(normal('hello'));
});
