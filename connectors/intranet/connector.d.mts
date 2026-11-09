export declare const manifest: {
  protocol: number;
  id: string;
  kind: string;
  source: string;
  areas: unknown[];
  capabilities: Array<Record<string, unknown> & { name: string; kind: string; input: object }>;
  header: { capability: string };
  scan: boolean;
};
export interface SiteHeaderAnswer {
  site: { name: string; href: string };
  items: Array<{
    id: string;
    label: string;
    href: string;
    children?: Array<{ id: string; label: string; href: string }>;
  }>;
  logo?: { src: string; alt: string };
}
export type MenuFile = SiteHeaderAnswer & { items: Array<SiteHeaderAnswer['items'][number] & { roles?: string[] }> };
export declare function loadMenu(path?: string | URL): MenuFile;
export declare function headerFor(
  actor: { id: string; role: 'manager' | 'employee' },
  menu?: MenuFile,
): SiteHeaderAnswer;
export declare function createConnector(options?: {
  jwks?: object | (() => Promise<object>);
  secret?: string;
  clewUrl?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  menu?: MenuFile;
}): { manifest: unknown; handle(request: Request): Promise<Response> };
