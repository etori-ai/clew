// Serves connector.mjs over HTTP. Environment: PORT (default 4011), CLEW_CONNECTOR_SECRET (shared with Clew), CLEW_URL (where Clew's keys are fetched; required), ENEO_URL (Eneo's base URL, https but on localhost), ENEO_ALLOW_HTTP (true: plain http on a private network), ENEO_PUBLIC_URL (optional: where a person opens Eneo in a browser, https).
import { createServer } from 'node:http';
import { listener } from './http.mjs';
import { createConnector } from './connector.mjs';
import { keysAddress } from './verification.mjs';

// CLEW_URL is where Clew's public keys are fetched on the first call: one they cannot be fetched from is refused here.
if (!keysAddress(process.env.CLEW_URL))
  throw new Error(
    "CLEW_URL must be Clew's base URL, where its public keys are fetched: https, or plain http only on a host of the " +
      'development stack.',
  );

if (!process.env.ENEO_URL) throw new Error('ENEO_URL is required: the base URL of the Eneo installation.');
const { handle } = createConnector({ secret: process.env.CLEW_CONNECTOR_SECRET });
const port = Number(process.env.PORT ?? 4011);
createServer(listener(handle)).listen(port, () => console.log(`eneo connector listening on :${port}`));
