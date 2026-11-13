export declare class SourceUnavailable extends Error {}
export declare class SourceRefused extends Error {}
export declare class ItemUnreadable extends Error {}
export type MatchField = 'username' | 'idnumber';
export interface Account {
  id: number;
  username: string;
  idnumber: string;
  suspended: boolean;
}
export interface Course {
  id: number;
  name: string;
  idnumber: string;
  completed: boolean;
  /** Whether the course records completion. */
  tracked: boolean;
}
export interface Badge {
  id: number;
  name: string;
  /** Unix seconds. */
  issuedAt: number;
  /** Unix seconds; null when the badge does not expire. */
  expiresAt: number | null;
}
export interface Criterion {
  /** Moodle's COMPLETION_CRITERIA_TYPE_*: 1 self, 2 date, 3 unenrol, 4 activity, 5 duration, 6 grade, 7 role, 8 course. */
  type: number;
  title: string;
  complete: boolean;
  /** Unix seconds, when met. */
  at: number | null;
}
export interface CompletionStatus {
  completed: boolean;
  at: number | null;
  criteria: Criterion[];
}
export interface CourseInfo {
  id: number;
  name: string;
  idnumber: string;
  category: string;
  /** Plain text. */
  summary: string;
}
/** An account as the site's list gives it (D119): an empty username when its details are withheld. */
export interface ListedAccount {
  id: number;
  username: string;
  idnumber: string;
}
export interface CallOptions {
  /** Stops the call: it then throws SourceUnavailable. */
  signal?: AbortSignal;
}
/** The learning-platform port: one service account, no person's token. */
export interface LearningSource {
  accounts(field: MatchField, values: string[], options?: CallOptions): Promise<Account[]>;
  /** Every account of the site in id order, `count` of them from position `from`; deleted ones left out. */
  everyone(from: number, count: number, options?: CallOptions): Promise<ListedAccount[]>;
  courses(userId: number, options?: CallOptions): Promise<Course[]>;
  /** Unix seconds, or null when not completed, not enrolled or not dated. */
  completion(userId: number, courseId: number, options?: CallOptions): Promise<number | null>;
  completionStatus(userId: number, courseId: number, options?: CallOptions): Promise<CompletionStatus | null>;
  course(courseId: number, options?: CallOptions): Promise<CourseInfo | null>;
  badges(userId: number, options?: CallOptions): Promise<Badge[]>;
}
export interface FixtureControls {
  outage(on?: boolean): void;
  refuse(on?: boolean): void;
  unreadable(what: 'courses' | 'badges' | 'completion', username: string, courseId?: number): void;
  complete(username: string, courseId: number, daysAgo?: number): void;
  add(username: string, idnumber: string): Account;
  suspend(username: string): void;
  remove(username: string): void;
  withhold(username: string): void;
  calls: { accounts: number; everyone: number; courses: number; completion: number; badges: number; course: number };
  account(username: string): Account | undefined;
}
export declare function createFixtureLearning(options?: { now?: () => number }): LearningSource & {
  controls: FixtureControls;
};
