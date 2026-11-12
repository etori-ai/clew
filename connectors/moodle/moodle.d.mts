import type {
  Account,
  Badge,
  CompletionStatus,
  Course,
  CourseInfo,
  LearningSource,
  ListedAccount,
} from './learning.mjs';
/** Moodle's front page course, whose participants are every account of the site (D119). */
export declare const SITE_COURSE: number;
export declare function moodleError(body: unknown): { exception: string; errorcode: string } | undefined;
export declare function unescapeText(value: unknown): string;
export declare function plainText(html: unknown): string;
export declare function parseAccounts(body: unknown): Account[];
export declare function parseListedAccounts(body: unknown): ListedAccount[];
export declare function parseCourses(body: unknown): Course[];
export declare function parseCompletion(body: unknown): number | null;
export declare function parseCompletionStatus(body: unknown): CompletionStatus;
export declare function parseCourse(body: unknown, courseId: number): CourseInfo | null;
export declare function parseBadges(body: unknown): Badge[];
export declare function formOf(token: string, wsfunction: string, params?: Record<string, unknown>): URLSearchParams;
export declare function createMoodleLearning(options: {
  url?: string;
  token?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  allowHttp?: boolean;
  userAgent?: string;
}): LearningSource;
