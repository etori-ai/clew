import { removeExpiredSignIns } from '@clew/db/auth';
import type { SignInData } from '../scheduler/model';

/**
 * What the nightly `sign-in-cleanup` job empties (D120): Clew's own sign-in machinery on PostgreSQL. Named here so the
 * scheduler gets this binding and the PostgreSQL clean-up test runs through the same one.
 */
export const signInData: SignInData = { removeExpired: removeExpiredSignIns };
