import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createConnector } from './connector.mjs';
const connector = createConnector({
  path: process.env.REFERENCE_DB,
  secret: process.env.CLEW_CONNECTOR_SECRET,
  clewUrl: process.env.CLEW_URL,
  jwks: process.env.REFERENCE_TEST_JWKS ? JSON.parse(readFileSync(process.env.REFERENCE_TEST_JWKS, 'utf8')) : undefined,
  fault: process.env.REFERENCE_TEST_FAULT,
});
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 16384) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    const response = await connector.handle(
      new Request('http://reference' + req.url, {
        method: req.method,
        headers: req.headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('Reference fixture failure:', error.message);
    res.destroy();
  }
});
server.listen(Number(process.env.PORT ?? 4030), '0.0.0.0', () =>
  console.log('Reference connector ready:' + server.address().port),
);
process.on('SIGTERM', () =>
  server.close(() => {
    connector.close();
    process.exit(0);
  }),
);
