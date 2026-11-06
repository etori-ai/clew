// Serves connector.mjs over HTTP. Environment: PORT (4045), CLEW_CONNECTOR_SECRET, CLEW_URL, HR_FEED_URL and
// FIXTURE_FEED_KEY (the HR fixture's feed payroll imports from), FIXTURE_TODAY, FIXTURE_FAULT, FIXTURE_UNIT_MAP.
import { createServer } from 'node:http';
import { createConnector, httpFeed } from './connector.mjs';

const env = process.env;
const parse = name => {
  if (!env[name]) return {};
  try {
    return JSON.parse(env[name]);
  } catch {
    throw new Error(name + ' must be a JSON object');
  }
};
const connector = createConnector({
  secret: env.CLEW_CONNECTOR_SECRET,
  clewUrl: env.CLEW_URL,
  clock: env.FIXTURE_TODAY ? () => new Date(env.FIXTURE_TODAY + 'T08:00:00+01:00') : () => new Date(),
  fault: env.FIXTURE_FAULT ?? '',
  unitMap: parse('FIXTURE_UNIT_MAP'),
  feed: httpFeed({ url: env.HR_FEED_URL, key: env.FIXTURE_FEED_KEY }),
});
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 65536) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    const response = await connector.handle(
      new Request('http://payroll' + req.url, {
        method: req.method,
        headers: req.headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('payroll fixture failure:', error.message);
    res.destroy();
  }
});
server.listen(Number(env.PORT ?? 4045), '0.0.0.0', () =>
  console.log(
    `payroll connector listening on :${server.address().port}${env.FIXTURE_FAULT ? ` (fault: ${env.FIXTURE_FAULT})` : ''}`,
  ),
);
process.on('SIGTERM', () =>
  server.close(() => {
    connector.close();
    process.exit(0);
  }),
);
