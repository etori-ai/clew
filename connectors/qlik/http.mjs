// Node's HTTP server in front of the connector's `handle`. Anyone who reaches the port reaches this file before Clew's
// signature is checked, so nothing a request holds may end the process or fill its memory: a request that cannot be
// read is answered and forgotten, and one larger than the limit is refused without the rest of it being read. Every
// connector in this repository written for a real system or as an example, and the intranet and appraisals fixtures,
// holds this same file, with its own name in the log line, so that each folder stays a service of its own; the other
// fixtures of the development stack, and the durability suite's, keep a small server of their own.

/** The most a request may hold. Clew sends a capability's input, which is a few kilobytes at most. */
export const BODY_LIMIT = 1_000_000;

/**
 * The request's body, or null as soon as it passes `limit`: what follows is then never read. A caller that goes away
 * before the end has sent no request.
 */
function bodyOf(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      if (size > limit) return;
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
      else {
        req.pause();
        resolve(null);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
    req.on('close', () => reject(new Error('The request closed before its end.')));
  });
}

/** Until what was written has gone out to the caller, or the caller is gone. */
function drained(res, signal) {
  return new Promise(resolve => {
    const done = () => {
      res.off('drain', done);
      signal.removeEventListener('abort', done);
      resolve();
    };
    res.on('drain', done);
    signal.addEventListener('abort', done);
    if (signal.aborted) done();
  });
}

/**
 * The listener for `createServer`. `handle` takes a Web `Request` and answers a `Response`; whatever it throws, and
 * whatever the request is, the process goes on. The address a request names is only its path: the Host header is not
 * read, so it cannot make a request unreadable. The request's `signal` is aborted when the caller goes away before the
 * answer is written, and the answer is written as it arrives, so an assistant's answer reaches Clew event by event, and
 * no faster than the caller reads it, so a caller that reads nothing holds the handler back instead of filling memory.
 */
export function listener(
  handle,
  { limit = BODY_LIMIT, log = name => console.error('qlik connector: unexpected', name) } = {},
) {
  return async (req, res) => {
    const gone = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) gone.abort();
    });
    const answer = (status, code, message, then) => {
      if (res.headersSent) return;
      res.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify({ error: { code, message } }), then);
    };
    // Refused without reading the rest: the connection is closed once the answer has gone out.
    const tooLarge = () => answer(413, 'invalid', 'Förfrågan är för stor.', () => req.destroy());
    const declared = req.headers['content-length'];
    if (declared !== undefined && !(/^\d+$/.test(declared) && Number(declared) <= limit)) {
      tooLarge();
      return;
    }
    let request;
    try {
      const body = await bodyOf(req, limit);
      if (!body) {
        tooLarge();
        return;
      }
      // A GET or a HEAD has no body to read, whatever was sent with it.
      const bodied = req.method !== 'GET' && req.method !== 'HEAD' && body.length > 0;
      request = new Request('http://connector' + req.url, {
        method: req.method,
        headers: req.headers,
        body: bodied ? body : undefined,
        signal: gone.signal,
      });
    } catch {
      answer(400, 'invalid', 'Ogiltig förfrågan.');
      return;
    }
    try {
      const response = await handle(request);
      if (gone.signal.aborted) {
        await response.body?.cancel().catch(() => undefined);
        return;
      }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) {
        res.end();
        return;
      }
      const reader = response.body.getReader();
      gone.signal.addEventListener('abort', () => void reader.cancel().catch(() => undefined), { once: true });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(value)) await drained(res, gone.signal);
      }
      res.end();
    } catch (error) {
      // Only the error's name: what it carries may be a person's.
      log(error?.name);
      if (res.headersSent) res.destroy();
      else answer(500, 'unavailable', 'Tjänsten svarar inte just nu.');
    }
  };
}
