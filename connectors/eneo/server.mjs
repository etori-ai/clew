// Serves connector.mjs over HTTP. Environment: PORT (default 4011), CLEW_CONNECTOR_SECRET (shared with Clew), ENEO_URL (Eneo's base URL), ENEO_PUBLIC_URL (optional: where a person opens Eneo in a browser, https).
import { createServer } from 'node:http';
import { listener } from './http.mjs';
import { createConnector } from './connector.mjs';

if (!process.env.ENEO_URL) throw new Error('ENEO_URL is required: the base URL of the Eneo installation.');
const { handle } = createConnector({ secret: process.env.CLEW_CONNECTOR_SECRET });
const port = Number(process.env.PORT ?? 4011);
createServer(listener(handle)).listen(port, () => console.log(`eneo connector listening on :${port}`));
