import { postgresThreadStore } from '../threads/adapters/postgres';
import { subjectErasure } from '../threads/usecases/subjects';
import { userReads } from './people';
import { clock } from './ambient';
import { ledger } from './durable';

/**
 * The thread store as the index from entity to cards reads and erases it (D97 items 5 and 6). It starts and cancels no
 * timer, so it needs no engine to cancel through; the stream's own store in `index.ts` is the same tables. Its own file so
 * the operator's erasure (`scripts/subject-erase.ts`) loads neither the registry nor the stream.
 */
export const subjectStore = postgresThreadStore({ durable: ledger });
export const subjects = subjectErasure({ store: subjectStore, clock, people: userReads });
