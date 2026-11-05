/** Rotate the installation signing key. Previous public keys overlap for the two-minute assertion lifetime. */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { rotateSigningKey } from '../apps/server/src/connectors/signing';
try { process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local')); } catch { /* operator environment */ }
try { console.log('Connector signing key rotated: ' + await rotateSigningKey('operator:connector-key-rotate')); }
finally { await closeDatabase(); }
