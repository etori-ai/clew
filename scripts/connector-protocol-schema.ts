/** Writes the connector protocol as one JSON Schema document for connector authors outside this repository. */
import { protocolSchema } from '../packages/connectors/src/protocol';
const target = new URL('../docs/protocol/connector-protocol.schema.json', import.meta.url);
await Bun.write(target, JSON.stringify(protocolSchema(), null, 2) + '\n');
console.log('Wrote ' + target.pathname);
