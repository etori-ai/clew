import type { AuthenticatedContext, McpRegistration, McpTool, McpResult, McpDelivery } from '@clew/contracts';

export interface McpSession {
  title: string;
  tools: McpTool[];
  call(name: string, args: Record<string, unknown>): Promise<McpResult>;
  resource(uri: string): Promise<string>;
  close(): Promise<void>;
}
export interface McpDecision {
  id: string;
  personId: string;
  connectionId: string;
  digest: string;
  state: 'unknown' | 'succeeded' | 'failed';
  result: McpResult | null;
}
export interface McpTx {
  observe(id: string, key: string): Promise<void>;
  deliver(personId: string, delivery: McpDelivery): Promise<boolean>;
  claim(decision: McpDecision): Promise<boolean>;
  finish(decision: McpDecision): Promise<void>;
  audit(actor: string, action: string, subject: string): Promise<void>;
}
export interface McpStore {
  registrations(personId?: string): Promise<McpRegistration[]>;
  deliveries(personId: string, ids: string[]): Promise<McpDelivery[]>;
  decision(personId: string, id: string): Promise<McpDecision | undefined>;
  transaction<T>(run: (tx: McpTx) => Promise<T>): Promise<T>;
}
export interface McpDeps {
  store: McpStore;
  connect(url: string): Promise<McpSession>;
  configured(persona: AuthenticatedContext): Promise<boolean>;
  current(id: string): Promise<AuthenticatedContext | undefined>;
  clock(): Date;
  digest(value: unknown): string;
  fingerprint(value: unknown): string;
  enabled: boolean;
}
