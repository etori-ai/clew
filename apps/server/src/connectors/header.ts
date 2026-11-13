import { registry } from './registry';
import { clock } from '../composition/ambient';
import { siteHeaders } from './usecases/header';

/**
 * The shared header for a signed-in person (D88), over the live registry and the wall clock. What it answers, its budget
 * and the per-person cache, keyed by the person, their authorization version and their groups, are in
 * `usecases/header.ts`; the cache lives in this process only. An administrator's change of who gives the header needs
 * no call here: every read asks the registry who may have it before anything kept is served.
 */
export const readSiteHeader = siteHeaders({ registry, clock }).read;
export { DEFAULT_HEADER, HEADER_FRESH_MS, HEADER_STALE_MS, HEADER_TIMEOUT_MS } from './usecases/header';
