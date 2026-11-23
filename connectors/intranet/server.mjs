// Serves connector.mjs over HTTP. Environment: PORT (default 4049), CLEW_CONNECTOR_SECRET (shared with Clew), CLEW_URL.
import { createServer } from 'node:http';
import { listener } from './http.mjs';
import { createConnector } from './connector.mjs';

const { handle } = createConnector({ secret: process.env.CLEW_CONNECTOR_SECRET });
const port = Number(process.env.PORT ?? 4049);
createServer(listener(handle)).listen(port, () => console.log(`intranet connector listening on :${port}`));
