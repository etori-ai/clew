import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpTool, McpResult } from '@clew/contracts';
import type { McpSession } from '../ports';

/** Official MCP transport. No native Clew connector envelope, manifest, or provider-specific dispatch. */
export async function connectMcp(url: string): Promise<McpSession> {
  const client = new Client(
    { name: 'clew', version: '0.1.0' },
    {
      capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } },
    },
  );
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { redirect: 'error' },
  });
  try {
    await client.connect(transport, { timeout: 10_000 });
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await client.listTools({ cursor }, { timeout: 10_000 });
      tools.push(...result.tools);
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    if (cursor) throw new Error('MCP catalogue exceeds the discovery limit');
    return {
      title: client.getServerVersion()?.title ?? client.getServerVersion()?.name ?? 'MCP',
      tools,
      call: async (name, args) =>
        (await client.callTool({ name, arguments: args }, undefined, { timeout: 15_000 })) as McpResult,
      resource: async uri => {
        const resource = await client.readResource({ uri }, { timeout: 10_000 });
        const html = resource.contents.find(
          c => c.uri === uri && c.mimeType === 'text/html;profile=mcp-app' && 'text' in c,
        );
        if (!html || !('text' in html) || html.text.length > 1_000_000) throw new Error('Unsupported MCP App resource');
        return html.text;
      },
      close: () => client.close(),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
