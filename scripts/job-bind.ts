/**
 * Bind a follower to a fact kind (D55 item 9) from the command line, as an alternative to administration: the row and its
 * audit row in one transaction, in Clew's database (D23: no environment variable, no restart). Runs inside the app
 * container. The work is `job-bindings.ts`, shared with the development chain's `dev-connectors.ts`.
 *
 *   bun scripts/job-bind.ts <fact kind> <capability> [--within PT4H] [--units unit-a,unit-b] [--disable]   add or change
 *   bun scripts/job-bind.ts --remove <id>
 *   bun scripts/job-bind.ts --list
 *   bun scripts/job-bind.ts --fixtures [--within PT3M]   bind the fixture connectors' followers of hr:absence (development)
 */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { bindFixtureFollowers, bindFollower, bindingStore, describeBinding } from './job-bindings';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const args = process.argv.slice(2);
const flag = (name: string) => args.includes('--' + name);
const option = (name: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
const taken = new Set(
  ['within', 'units', 'remove'].flatMap(n => {
    const i = args.indexOf('--' + n);
    return i >= 0 ? [i + 1] : [];
  }),
);
const positional = args.filter((a, i) => !a.startsWith('--') && !taken.has(i));
const usage = () => {
  console.error(
    'Usage: bun scripts/job-bind.ts <fact kind> <capability> [--within P1D] [--units a,b] [--disable] | --remove <id> | --list | --fixtures [--within PT3M]',
  );
  process.exit(2);
};
try {
  const within = option('within');
  if (flag('list')) {
    for (const b of await bindingStore.list())
      console.log(
        `${b.id}  ${b.kind.padEnd(16)} ${b.capability.padEnd(28)} ${(b.within ?? '-').padEnd(8)} ${b.audience.mode.padEnd(8)} ${b.enabled ? 'enabled' : 'disabled'}`,
      );
  } else if (flag('remove')) {
    const id = option('remove');
    if (!id) usage();
    const existing = await bindingStore.read(id!);
    if (!existing) {
      console.error(`No binding ${id}.`);
      process.exit(2);
    }
    await bindingStore.transaction(async tx => {
      await tx.remove(id!);
      await tx.audit({
        actor: 'bootstrap:binding',
        action: 'job.binding_removed',
        subject: 'binding:' + id,
        at: new Date().toISOString(),
        details: { kind: existing.kind, capability: existing.capability },
      });
    });
    console.log(`Removed ${id}.`);
  } else if (flag('fixtures')) {
    for (const result of await bindFixtureFollowers(within)) console.log(describeBinding(result));
  } else {
    const [kind, capability] = positional;
    if (!kind || !capability) usage();
    const units = option('units')?.split(',').filter(Boolean);
    try {
      const result = await bindFollower(
        {
          kind: kind!,
          capability: capability!,
          audience: units?.length ? { mode: 'selected', units } : { mode: 'all' },
          ...(within ? { within } : {}),
        },
        !flag('disable'),
      );
      console.log(describeBinding(result));
    } catch (error) {
      console.error((error as Error).message);
      process.exit(2);
    }
  }
} finally {
  await closeDatabase();
}
