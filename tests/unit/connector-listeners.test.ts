import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect, type AddressInfo } from 'node:net';

/**
 * Every connector that serves itself with Node's HTTP server does it through its own copy of the same listener,
 * `connectors/<id>/http.mjs` (CS-M1). Anyone who reaches the port reaches it before Clew's signature is checked: a GET
 * with a body or a Host that is no host once threw before the handler and ended the process, and a body was read
 * whole. Each copy is held to the same behaviour here, and each folder to serving through it.
 */
const FOLDERS = [
  'hello',
  'intranet',
  'eneo',
  'phonebook',
  'appraisals',
  'nextcloud-approval',
  'moodle',
  'qlik',
  'supportmanagement',
  'pob',
] as const;
const root = new URL('../../connectors/', import.meta.url);
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
  return { port, raw, unexpected, close: () => new Promise(resolve => server.close(resolve)) };
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

test('every copy of the listener is the same file but for the name in its log line', () => {
  const normal = (folder: string) =>
    read(`${folder}/http.mjs`).replace(/console\.error\('[a-z-]+ connector: unexpected'/, "console.error('…'");
  for (const folder of FOLDERS) expect(normal(folder)).toBe(normal('hello'));
});
