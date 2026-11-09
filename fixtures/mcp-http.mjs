import { createServer } from 'node:http';

/** Synthetic vendor transport. Fixture controls are local test setup, outside the MCP tool catalogue. */
export function serveMock(service, defaultPort, controls = {}) {
  const server = createServer(async (req, res) => {
    if (req.headers.origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin)) {
      res.writeHead(403).end();
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200).end('ok');
      return;
    }
    if (req.method === 'POST' && Object.hasOwn(controls, req.url)) {
      controls[req.url]();
      res.writeHead(204).end();
      return;
    }
    if (req.url !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    // Stateless Streamable HTTP: no server stream or session to resume.
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }
    let message;
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 65536) throw new Error('Request too large');
      }
      message = JSON.parse(body);
      if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') throw new Error('Invalid JSON-RPC request');
      if (message.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      const result = await service.request(message.method, message.params);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    } catch (error) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message?.id ?? null,
          error: { code: error.code ?? -32600, message: error.message },
        }),
      );
    }
  });
  server.listen(Number(process.env.PORT ?? defaultPort), process.env.HOST ?? '127.0.0.1', () => {
    console.log(`Mock MCP listening on ${server.address().port}`);
  });
  return server;
}
