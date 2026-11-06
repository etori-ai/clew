/**
 * Bind a follower to a fact kind (D55 item 9) from the command line, as an alternative to administration: the row and its
 * audit row in one transaction, in Clew's database (D23: no environment variable, no restart). The job assembler reads the
 * rows on every call, so a binding made here counts from the next job on. Runs inside the app container.
 *
 *   bun scripts/job-bind.ts <fact kind> <capability> [--within PT4H] [--units unit-a,unit-b] [--disable]   add or change
 *   bun scripts/job-bind.ts --remove <id>
 *   bun scripts/job-bind.ts --list
 *   bun scripts/job-bind.ts --mocks [--within PT3M]      bind the bundled mocks' followers of hr:absence (development)
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { postgresFollowBindingStore } from '../apps/server/src/modules/jobs/adapters/postgres';
import type { FollowBinding, FollowBindingInput } from '../apps/server/src/modules/jobs/contracts';

try { process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local')); } catch { /* settings may come from the environment */ }
const args = process.argv.slice(2);
const flag = (name: string) => args.includes('--' + name);
const option = (name: string) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const taken = new Set(['within', 'units', 'remove'].flatMap(n => { const i = args.indexOf('--' + n); return i >= 0 ? [i + 1] : []; }));
const positional = args.filter((a, i) => !a.startsWith('--') && !taken.has(i));
const actor = 'bootstrap:binding';
const store = postgresFollowBindingStore();
const usage = () => { console.error('Usage: bun scripts/job-bind.ts <fact kind> <capability> [--within P1D] [--units a,b] [--disable] | --remove <id> | --list | --mocks [--within PT3M]'); process.exit(2); };

/** One binding per kind and capability: a second call changes the row instead of adding a twin. */
async function bind(input: FollowBindingInput, enabled: boolean) {
  // The same shapes as `FollowBindingInputSchema`; the admin use case validates with the schema itself.
  if (!/^[a-z][a-z0-9-]*:[a-z][a-zA-Z0-9-]*$/.test(input.kind)) { console.error(`Invalid fact kind ${input.kind}: <connector id>:<kind>.`); process.exit(2); }
  if (!/^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9]*$/.test(input.capability)) { console.error(`Invalid capability ${input.capability}: <connector id>.<name>.`); process.exit(2); }
  if (input.within && !/^P(?!$)(\d+D)?(T(?=\d)(\d+H)?(\d+M)?)?$/.test(input.within)) { console.error(`Invalid window ${input.within}: an ISO 8601 duration in days, hours and minutes.`); process.exit(2); }
  const existing = (await store.list(input.kind)).find(b => b.capability === input.capability);
  const at = new Date().toISOString();
  const binding: FollowBinding = { id: existing?.id ?? randomUUID(), ...input, enabled, createdAt: existing?.createdAt ?? at, updatedAt: at };
  await store.transaction(async tx => {
    await tx.upsert(binding);
    await tx.audit({ actor, action: existing ? 'job.binding_changed' : 'job.binding_added', subject: 'binding:' + binding.id, at, details: { kind: binding.kind, capability: binding.capability, audience: binding.audience, within: binding.within ?? null, enabled } });
  });
  console.log(`${existing ? 'Changed' : 'Added'} ${binding.kind} -> ${binding.capability}${binding.within ? ' within ' + binding.within : ''} (${binding.id})${enabled ? '' : ', disabled'}`);
}
try {
  const within = option('within');
  if (flag('list')) {
    for (const b of await store.list()) console.log(`${b.id}  ${b.kind.padEnd(16)} ${b.capability.padEnd(28)} ${(b.within ?? '-').padEnd(8)} ${b.audience.mode.padEnd(8)} ${b.enabled ? 'enabled' : 'disabled'}`);
  } else if (flag('remove')) {
    const id = option('remove'); if (!id) usage();
    const existing = await store.read(id!); if (!existing) { console.error(`No binding ${id}.`); process.exit(2); }
    await store.transaction(async tx => { await tx.remove(id!); await tx.audit({ actor, action: 'job.binding_removed', subject: 'binding:' + id, at: new Date().toISOString(), details: { kind: existing.kind, capability: existing.capability } }); });
    console.log(`Removed ${id}.`);
  } else if (flag('mocks')) {
    // The bundled mocks' offer (D55): the HR system registers the report, time reporting marks the shift, payroll is only watched. The window is short in development so a watch can be seen expiring.
    await bind({ kind: 'hr:absence', capability: 'hr.proposeAbsence', audience: { mode: 'all' } }, true);
    await bind({ kind: 'hr:absence', capability: 'timesheet.followAbsence', audience: { mode: 'all' } }, true);
    await bind({ kind: 'hr:absence', capability: 'payroll.followAbsence', audience: { mode: 'all' }, within: within ?? 'PT3M' }, true);
  } else {
    const [kind, capability] = positional;
    if (!kind || !capability) usage();
    const units = option('units')?.split(',').filter(Boolean);
    await bind({ kind: kind!, capability: capability!, audience: units?.length ? { mode: 'selected', units } : { mode: 'all' }, ...(within ? { within } : {}) }, !flag('disable'));
  }
} finally { await closeDatabase(); }
