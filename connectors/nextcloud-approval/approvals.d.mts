export declare class SourceDenied extends Error {}
export declare class SourceUnavailable extends Error {}
export declare class SourceLost extends Error {}
export declare const STATE: { none: 0; others: 1; approved: 2; rejected: 3; mine: 4 };
export type ApprovalState = 0 | 1 | 2 | 3 | 4;
export interface Activity {
  userId: string;
  userName: string;
  /** Unix seconds. */
  at: number;
  message: string;
}
export interface PendingFile {
  fileId: number;
  name: string;
  mimetype: string;
  request: Activity | null;
}
export interface FileState extends Partial<Activity> {
  state: ApprovalState;
}
export interface FileVersion {
  fileId: number;
  etag: string;
  name: string;
}
export type Decision = 'approve' | 'reject';
export type DecideAnswer =
  { outcome: 'accepted' } | { outcome: 'refused'; reason: 'stale' | 'not-allowed' | 'invalid' };
/** The approval port: every method takes the person's own token. */
export interface ApprovalSource {
  whoami(token: string): Promise<{ id: string; name: string }>;
  pending(token: string): Promise<PendingFile[]>;
  state(token: string, fileId: number): Promise<FileState>;
  versions(token: string, userId: string, fileIds: number[]): Promise<FileVersion[]>;
  decide(token: string, fileId: number, decision: Decision, etag: string, message?: string): Promise<DecideAnswer>;
}
export interface FixtureControls {
  edit(fileId: number): void;
  share(fileId: number, user: string): void;
  unshare(fileId: number, user: string): void;
  request(fileId: number, options?: { by?: string; message?: string }): void;
  disable(user: string): void;
  enable(user: string): void;
  outage(down?: boolean): void;
  loseNextAnswer(mode?: 'after' | 'before'): void;
}
export declare function createFixtureApproval(options?: {
  audience?: string;
  approvers?: string[];
  now?: () => number;
}): ApprovalSource & { controls: FixtureControls };
