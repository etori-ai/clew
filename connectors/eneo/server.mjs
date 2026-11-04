// Serves connector.mjs over HTTP. Environment: PORT (default 4011), CLEW_CONNECTOR_SECRET (shared with Clew), ENEO_URL (Eneo's base URL), ENEO_COLLECTIONS_TTL_SECONDS.
import { createServer } from 'node:http';
import { createConnector } from './connector.mjs';

if (!process.env.ENEO_URL) throw new Error('ENEO_URL is required: the base URL of the Eneo installation.');
const { handle } = createConnector({ secret: process.env.CLEW_CONNECTOR_SECRET });
const port = Number(process.env.PORT ?? 4011);
createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const request = new Request(`http://${req.headers.host ?? 'connector'}${req.url}`, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
  const response = await handle(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`eneo connector listening on :${port}`));
