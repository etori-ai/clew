// Serves connector.mjs over HTTP. Environment: PORT (default 4011), CLEW_CONNECTOR_SECRET (shared with Clew), ENEO_URL (Eneo's base URL), ENEO_PUBLIC_URL (optional: where a person opens Eneo in a browser, https).
import { createServer } from 'node:http';
import { createConnector } from './connector.mjs';

if (!process.env.ENEO_URL) throw new Error('ENEO_URL is required: the base URL of the Eneo installation.');
const { handle } = createConnector({ secret: process.env.CLEW_CONNECTOR_SECRET });
const port = Number(process.env.PORT ?? 4011);
createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request(`http://${req.headers.host ?? 'connector'}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  const response = await handle(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  // An assistant's answer is written as it arrives; everything else is one body.
  if (response.headers.get('content-type') === 'text/event-stream' && response.body) {
    const reader = response.body.getReader();
    req.on('close', () => void reader.cancel().catch(() => undefined));
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    return res.end();
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`eneo connector listening on :${port}`));
