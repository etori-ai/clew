/** The adapters: the real Moodle API, and the in-memory stand-in of learning.mjs, for development and tests only. */
export declare const ADAPTERS: readonly ['moodle', 'fixture'];
/**
 * The adapter the environment names. Throws when none is named, when the name is unknown, when `moodle` lacks its
 * address or token, and when `fixture` is named beside a Moodle address or token.
 */
export declare function adapterOf(env: Record<string, string | undefined>): 'moodle' | 'fixture';
