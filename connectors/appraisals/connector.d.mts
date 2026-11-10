export declare const manifest: {
  protocol: number;
  id: string;
  kind: string;
  source: string;
  areas: unknown[];
  uses: string[];
  scan: boolean;
  capabilities: Array<Record<string, unknown> & { name: string; kind: string; input: object; output: object }>;
};
export declare const DEFAULT_LINK_BASE: string;
export declare const TalksOutput: object;
export declare const CommitmentsInput: object;
export declare const CommitmentsOutput: object;
export declare const PEOPLE: Array<{ userName: string; name: string; manager: string }>;
export declare const MANAGERS: Array<{ userName: string; name: string }>;
export declare const ROUND: { id: string; opensIn: number; dueIn: number };
export declare const TALKS: Record<string, { state: 'held' | 'booked'; day: number; time?: string }>;
export declare const COMMITMENTS: Array<{
  id: string;
  person: string;
  owner: 'employee' | 'manager';
  round: 'earlier' | 'current';
  text: string;
  dueIn: number;
  doneDaysAgo?: number;
}>;
export declare function recordsFor(
  today: string,
  linkBase?: string,
): {
  round: { label: string; opensOn: string; dueOn: string };
  talks: Array<{ manager: string; row: Record<string, unknown> }>;
  commitments: Array<Record<string, unknown>>;
  managerOf(userName: string): string | undefined;
};
export declare function createConnector(options?: {
  jwks?: object | (() => Promise<object>);
  secret?: string;
  clewUrl?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  today?: () => string;
  personMap?: Record<string, string>;
  linkBase?: string;
}): { manifest: unknown; handle(request: Request): Promise<Response> };
