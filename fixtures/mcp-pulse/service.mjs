/** Synthetic vendor: only standard MCP concepts; no Clew manifest, callbacks or imports. */
export const appUri = 'ui://employee-pulse/poll.html';
export const pendingUri = 'pulse://me/pending';
export const mimeType = 'text/html;profile=mcp-app';
const object = properties => ({ type: 'object', properties, additionalProperties: false });
export const tools = [
  {
    name: 'get_pending_poll',
    title: 'Visa veckans enkät',
    description: 'Hämta din aktuella medarbetarenkät.',
    inputSchema: object({}),
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: appUri, visibility: ['model', 'app'] } },
  },
  {
    name: 'submit_poll',
    title: 'Skicka enkätsvar',
    description: 'Lämna ditt svar på den aktuella enkäten.',
    inputSchema: {
      ...object({ pollId: { type: 'string' }, score: { type: 'integer', minimum: 1, maximum: 5 } }),
      required: ['pollId', 'score'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    _meta: { ui: { visibility: ['app'] } },
  },
];

export function createPulseService(html) {
  let week = 46;
  const answers = new Map();
  const listeners = new Set();
  const poll = () => ({
    id: `pulse-2026-W${week}`,
    week,
    title: `Din arbetsvecka · vecka ${week}`,
    question: 'Hur har du haft det på jobbet den här veckan?',
    answered: answers.has(week),
  });
  const result = () => ({
    content: [
      { type: 'text', text: answers.has(week) ? 'Enkäten är besvarad.' : 'Din veckopuls är redo att besvaras.' },
    ],
    structuredContent: { pollId: poll().id, week, answered: answers.has(week) },
    // UI-only data; a host must not send _meta to the model.
    _meta: { poll: poll() },
  });
  const invalid = message => {
    throw Object.assign(new Error(message), { code: -32602 });
  };
  return {
    onNotification(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Fixture clock, deliberately outside the MCP tool catalogue. */
    nextWeek() {
      week += 1;
      this.notify();
    },
    notify() {
      for (const listener of listeners)
        listener({ jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri: pendingUri } });
    },
    async request(method, params = {}) {
      if (method === 'initialize')
        return {
          protocolVersion: '2025-11-25',
          serverInfo: { name: 'employee-pulse', title: 'Medarbetarpuls', version: '0.1.0' },
          capabilities: { tools: {}, resources: {}, extensions: { 'io.modelcontextprotocol/ui': {} } },
        };
      if (method === 'ping' || method === 'notifications/initialized') return {};
      if (method === 'tools/list') return { tools };
      if (method === 'resources/list')
        return {
          resources: [
            { uri: appUri, name: 'employee-pulse', title: 'Veckopuls', mimeType },
            { uri: pendingUri, name: 'pending-polls', title: 'Dina aktuella enkäter', mimeType: 'application/json' },
          ],
        };
      if (method === 'resources/subscribe' || method === 'resources/unsubscribe') {
        if (params.uri !== pendingUri) invalid('Resursen finns inte.');
        return {};
      }
      if (method === 'resources/read') {
        if (params.uri === appUri)
          return {
            contents: [
              {
                uri: appUri,
                mimeType,
                text: html,
                _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
              },
            ],
          };
        if (params.uri === pendingUri)
          return { contents: [{ uri: pendingUri, mimeType: 'application/json', text: JSON.stringify(poll()) }] };
        invalid('Resursen finns inte.');
      }
      if (method === 'tools/call') {
        const args = params.arguments ?? {};
        if (params.name === 'get_pending_poll') {
          if (Object.keys(args).length) invalid('Läsningen tar inga argument.');
          return result();
        }
        if (params.name === 'submit_poll') {
          if (
            args.pollId !== poll().id ||
            !Number.isInteger(args.score) ||
            args.score < 1 ||
            args.score > 5 ||
            Object.keys(args).some(k => !['pollId', 'score'].includes(k))
          )
            invalid('Kontrollera enkät och svar.');
          if (answers.has(week) && answers.get(week) !== args.score)
            return { isError: true, content: [{ type: 'text', text: 'Enkäten är redan besvarad.' }] };
          answers.set(week, args.score);
          return {
            content: [{ type: 'text', text: 'Tack! Ditt svar har tagits emot.' }],
            structuredContent: { receiptId: `receipt-${poll().id}`, pollId: poll().id, accepted: true },
          };
        }
      }
      throw Object.assign(new Error('Metoden stöds inte av demonstrationen.'), { code: -32601 });
    },
  };
}
