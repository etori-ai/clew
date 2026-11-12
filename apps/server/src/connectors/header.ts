import { registry } from './registry';
import { clock } from '../composition/ambient';
import { siteHeaders } from './usecases/header';

/**
 * The shared header for a signed-in person (D88), over the live registry and the wall clock. What it answers, its budget
 * and the per-person cache, keyed by the person, their authorization version and their groups, are in
 * `usecases/header.ts`; the cache lives in this process only.
 */
const headers = siteHeaders({ registry, clock });
export const readSiteHeader = headers.read;
/** For an administrator's change of holder: the next read asks the connector again. */
export const forgetSiteHeaders = headers.forget;
export { DEFAULT_HEADER, HEADER_FRESH_MS, HEADER_TIMEOUT_MS } from './usecases/header';
