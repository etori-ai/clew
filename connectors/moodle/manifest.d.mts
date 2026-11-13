export declare const CONNECTOR: 'moodle';
export declare const DEFAULT_SOURCE: string;
export declare const PERSON_KEYS_MAX: number;
/** The most accounts one page of the installation's holdings read answers (D119). */
export declare const HOLDINGS_PAGE: number;
/** The most holdings one row carries. */
export declare const HOLDINGS_PER_ROW: number;
/** The most rows one person's list of courses and badges carries; a longer list is cut and its last row says so. */
export declare const COURSES_ROWS_MAX: number;
/** The cursor of the next page: the last account answered and its place in Moodle's list. */
export declare const cursorPattern: string;
export declare const SUMMARY_MAX: number;
export declare const CRITERIA_MAX: number;
export declare const courseIdPattern: string;
export declare const STATUS: Record<'completed' | 'ongoing' | 'valid' | 'expired', string>;
export declare const KIND: Record<'course' | 'badge', string>;
export declare const Holding: unknown;
export declare const HoldingsInput: unknown;
export declare const HoldingsOutput: unknown;
export declare function createManifest(options?: { source?: string }): unknown;
export declare const manifest: unknown;
