import type { LearningSource, MatchField } from './learning.mjs';
export declare const MATCH_FIELDS: MatchField[];
export declare const ANSWERED: Array<'self' | 'managed'>;
export type Deadlines = { person: number; courses: number; course: number; holdings: number };
export declare const DEADLINES: Deadlines;
export declare function createManifest(options?: { source?: string }): unknown;
export declare function createConnector(options?: {
  jwks?: object | (() => Promise<object>);
  secret?: string;
  source?: LearningSource;
  match?: MatchField;
  sourceLabel?: string;
  publicUrl?: string;
  timeZone?: string;
  concurrency?: number;
  deadlines?: Deadlines;
  clewUrl?: string;
  now?: () => number;
}): { manifest: unknown; handle(request: Request): Promise<Response> };
