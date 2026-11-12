import type { LearningSource, MatchField } from './learning.mjs';
export declare const MATCH_FIELDS: MatchField[];
export declare const ANSWERED: Array<'self' | 'managed'>;
/** How many places before the cursor a page of the installation's holdings read starts to read Moodle's list (D119). */
export declare const OVERLAP: number;
/** The username of Moodle's guest account, which no read answers. */
export declare const GUEST: 'guest';
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
