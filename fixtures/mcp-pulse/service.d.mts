export const appUri: string;
export const pendingUri: string;
export const mimeType: string;
export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  _meta?: { ui?: { resourceUri?: string; visibility?: string[] } };
}
export const tools: McpTool[];
export interface PulseService {
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  nextWeek(): void;
  notify(): void;
  onNotification(
    listener: (notification: { jsonrpc: string; method: string; params: { uri: string } }) => void,
  ): () => void;
}
export function createPulseService(html: string): PulseService;
