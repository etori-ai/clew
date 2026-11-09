/** A synthetic standards-only MCP provider with tools but no App. */
export function createStatusFixture() {
  let down = false;
  let incident = 0;
  return {
    setDown(value) {
      if (value && !down) incident += 1;
      down = value;
    },
    async request(method, params = {}) {
      if (method === 'initialize')
        return {
          protocolVersion: '2025-11-25',
          serverInfo: { name: 'status-watch', title: 'Driftkollen', version: '0.1.0' },
          capabilities: { tools: {} },
        };
      if (method === 'ping' || method === 'notifications/initialized') return {};
      if (method === 'tools/list')
        return {
          tools: [
            {
              name: 'get_service_status',
              title: 'Läs driftstatus',
              description: 'Läs aktuell driftstatus för e-post.',
              inputSchema: { type: 'object', properties: {}, additionalProperties: false },
              annotations: { readOnlyHint: true },
            },
          ],
        };
      if (method === 'tools/call' && (params.name === 'get_service_status' || !params.name))
        return {
          content: [
            {
              type: 'text',
              text: down
                ? 'E-post har en driftstörning. Meddelanden kan bli försenade.'
                : 'E-post fungerar normalt igen.',
            },
          ],
          structuredContent: {
            service: 'mail',
            state: down ? 'degraded' : 'operational',
            incidentId: incident ? `mail-${incident}` : null,
          },
        };
      throw Object.assign(new Error('Metoden stöds inte.'), { code: -32601 });
    },
  };
}
export function statusChangeKey(result) {
  return `${result.service}:${result.incidentId ?? 'baseline'}:${result.state}`;
}
