import { reliabilityCounts } from '../apps/server/src/modules/operations/adapters/postgres';
import { closeDatabase } from '@clew/db';
try { console.log(JSON.stringify(await reliabilityCounts(), null, 2)); } finally { await closeDatabase(); }
