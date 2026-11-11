import type { ApprovalSource, FileVersion } from './approvals.mjs';
export declare function searchBody(userId: string, ids: number[]): string;
export declare function parseSearch(xml: string): FileVersion[];
export declare function createNextcloudApproval(options: {
  url?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  allowHttp?: boolean;
  userAgent?: string;
}): ApprovalSource;
