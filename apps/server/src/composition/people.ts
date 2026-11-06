import { postgresUserReads } from '../modules/people/adapters/postgres';

/** Local identity reads use the same scoped capability dispatch as other internal functions. */
export const userReads = postgresUserReads();
