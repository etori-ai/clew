// Node's HTTP server in front of the connector's `handle`. Anyone who reaches the port reaches this file before Clew's
// signature is checked, so nothing a request holds may end the process or fill its memory: a request that cannot be
// read is answered and forgotten. Every connector folder that serves itself with Node's server holds this same file,
// with its own name in the log line, so that each folder stays a service of its own.

/** The most a request may hold. Clew sends a capability's input, which is a few kilobytes at most. */
export const BODY_LIMIT = 1_000_000;

/**
 * The listener for `createServer`. `handle` takes a Web `Request` and answers a `Response`; whatever it throws, and
 * whatever the request is, the process goes on. The address a request names is only its path: the Host header is not
 * read, so it cannot make a request unreadable. The request's `signal` is aborted when the caller goes away before the
 * answer is written, and the answer is written as it arrives, so an assistant's answer reaches Clew event by event.
 */
export function listener(
  handle,
  { limit = BODY_LIMIT, log = name => console.error('moodle connector: unexpected', name) } = {},
) {
  return async (req, res) => {
    const gone = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) gone.abort();
    });
    const answer = (status, code, message) => {
      if (res.headersSent) return;
      res.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify({ error: { code, message } }));
    };
    let request;
    try {
      const chunks = [];
      let size = 0;
      // What is over the limit is read past and never kept, so the answer below reaches the sender.
      for await (const chunk of req) {
        size += chunk.length;
        if (size <= limit) chunks.push(chunk);
        else chunks.length = 0;
      }
      if (size > limit) {
        answer(413, 'invalid', 'Förfrågan är för stor.');
        return;
      }
      // A GET or a HEAD has no body to read, whatever was sent with it.
      const bodied = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0;
      request = new Request('http://connector' + req.url, {
        method: req.method,
        headers: req.headers,
        body: bodied ? Buffer.concat(chunks) : undefined,
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
        res.write(value);
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
