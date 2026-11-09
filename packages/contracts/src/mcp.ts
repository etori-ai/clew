/** Clew's registration policy and chat envelopes; the provider speaks standard MCP only (D81). */
export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  _meta?: Record<string, unknown>;
}
export interface McpResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
}
export interface McpWatch {
  tool: string;
  arguments: Record<string, unknown>;
  intervalSeconds: number;
  /** RFC 6901 pointers into structuredContent. No provider-specific fields in the host. */
  identity: string[];
  condition?: { pointer: string; equals: unknown };
  deliverInitial: boolean;
}
export interface McpRegistration {
  id: string;
  personId: string;
  url: string;
  enabled: boolean;
  readTools: string[];
  writeTools: string[];
  watch: McpWatch;
  lastKey: string | null;
}
export interface McpDelivery {
  id: string;
  connectionId: string;
  title: string;
  text: string;
  createdAt: string;
}
export interface McpService {
  id: string;
  title: string;
  tools: McpTool[];
  intervalSeconds: number;
}
export interface McpView {
  service: McpService;
  result: McpResult;
  html?: string;
  /** An older delivery is readable, but cannot open an App for a different source item. */
  isCurrent?: boolean;
}
